// ─────────────────────────────────────────────────────────────────────────────
// Real-Postgres integration smoke test for the WRITE endpoints.
//
// WHY: the unit tests mock `db.query`, so they pass on SQL a real Postgres
// rejects — type-deduction errors (the 42P08 that 500'd every profile save
// since 05.08), bad casts, constraint violations. This suite runs the actual
// controllers against a real database so that whole class of bug is caught
// before deploy. External I/O (geocoding) is mocked and push is a no-op with
// no subscriptions configured; the database is real.
//
// RUN: needs a throwaway Postgres. Set SMOKE_DATABASE_URL and run
//   npm run test:smoke
// or use the one-shot local runner (spins up Docker, fresh DB, tears down):
//   npm run test:smoke:local
// Without SMOKE_DATABASE_URL the whole suite is skipped, so plain
// `vitest run` / CI without a database stays green.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest';
import { distanceKmSql, distanceKm } from '../../src/utils/geoRadius.js';
import { MOTIVATION_KEYS } from '../../src/utils/motivations.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_URL = process.env.SMOKE_DATABASE_URL;

// Point the pool at the smoke DB BEFORE any module that imports database.js.
if (SMOKE_URL) {
  process.env.DATABASE_URL = SMOKE_URL;
  process.env.NODE_ENV = 'test'; // ssl off; no moderation keys → fail-open blocklist only
  // "No moderation keys" has to be made true: database.js runs dotenv.config(),
  // and a developer's backend/.env carries real ones. With them every create
  // waited on a live OpenAI call (2.5 s when the network is slow — two creates
  // and the 5-s test timeout was gone, seen 17.11.2026). dotenv never
  // overrides a variable that is already set, so empty pins them off.
  process.env.OPENAI_API_KEY = '';
  process.env.SIGHTENGINE_API_USER = '';
  process.env.SIGHTENGINE_API_SECRET = '';
  // Declare the image-origin allowlist this suite's fixtures assume
  // (utils/safeUrl.js), instead of inheriting whatever the developer's local
  // .env happens to hold — which points at localhost and would reject the
  // production-shaped avatar URL below.
  process.env.FRONTEND_URL = 'https://app.jamie-app.com';
  process.env.STORAGE_PUBLIC_URL = 'https://app.jamie-app.com/media';
  // register() signs a session token; CI has no backend/.env to supply one.
  process.env.JWT_SECRET ||= 'smoke-test-secret';
}

// Mock external geocoding so the create/update paths never hit the network.
vi.mock('../../src/utils/geocode.js', () => ({
  resolveCreateLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.37 } })),
  resolveClubEventLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.37 } })),
  geocodeAllowedRegion: vi.fn(async () => ({ lat: 48.2, lng: 16.37, country: 'AT' })),
  geocodeLocation: vi.fn(async () => ({ lat: 48.2, lng: 16.37 })),
}));

// Mock outbound email — createReport fires sendAdminReportEmail unawaited and
// would otherwise hit the real Resend API from the smoke run.
vi.mock('../../src/utils/email.js', () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async () => {}),
  sendAdminReportEmail: vi.fn(async () => {}),
  sendAdminClubPendingEmail: vi.fn(async () => {}),
  sendContactEmail: vi.fn(async () => {}),
  sendFeedbackEmail: vi.fn(async () => {}),
  sendOTPEmail: vi.fn(async () => {}),
}));

// Socket.IO is looked up via req.app.get('io'); provide a chainable no-op.
// sendMessage additionally chains .except() on to() and reads the room
// presence via io.in(room).fetchSockets() (push suppression, audit risk #8).
// Every emit is recorded (and otherwise ignored) so payloads can be checked.
const emitted = [];
const emitChain = { emit: (ev, payload) => { emitted.push({ ev, payload }); }, except: () => emitChain };
const fakeIo = {
  to: () => emitChain,
  in: () => ({ fetchSockets: async () => [] }),
};
const fakeApp = { get: (k) => (k === 'io' ? fakeIo : undefined) };

const makeRes = () => {
  const res = { statusCode: 200, body: null, cookies: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  // register / login set the httpOnly session cookie.
  res.cookie = (name, value) => { res.cookies[name] = value; return res; };
  res.clearCookie = (name) => { delete res.cookies[name]; return res; };
  return res;
};
const call = async (fn, { userId, params = {}, body = {}, query = {} }) => {
  const res = makeRes();
  await fn({ userId, params, body, query, app: fakeApp }, res, () => {});
  return res;
};
const avatar = 'https://app.jamie-app.com/media/uploads/a.webp';
// A clean SQL run is the invariant this suite guards: a handled 4xx is fine, a
// 500 means the controller threw (almost always a real DB/SQL error).
const noServerError = (res) => expect(res.statusCode, JSON.stringify(res.body)).not.toBe(500);
const ok = (res) => expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(400);

const suite = SMOKE_URL ? describe : describe.skip;

suite('write endpoints against real Postgres', () => {
  let db, C = {};
  let A, B, D;          // user ids: A = owner/admin/actor, B = friend/member, D = block target
  let groupId, pastGroupId, pastGroup2Id, dealId, friendReqId;

  beforeAll(async () => {
    db = (await import('../../src/config/database.js')).default;
    const { runStartupMigrations } = await import('../../src/config/migrations.js');

    // Production-faithful schema: canonical schema.sql THEN the real migrations.
    const schema = fs.readFileSync(path.join(__dirname, '../../src/config/schema.sql'), 'utf8');
    await db.query(schema);
    await runStartupMigrations();

    const mkUser = async (email, name, admin = false) => {
      const r = await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, is_admin)
         VALUES ($1,$2,'1995-03-03','female',$3, TRUE, 'email', $4) RETURNING id`,
        [email, name, avatar, admin]
      );
      return r.rows[0].id;
    };
    A = await mkUser('smoke-a@x.com', 'Ann', true);
    B = await mkUser('smoke-b@x.com', 'Bea');
    D = await mkUser('smoke-d@x.com', 'Dee');

    // Past-dated group with A (owner) and B (member) — for submitReview.
    const pg = await db.query(
      `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
       VALUES ('Past Event','group', NOW() - INTERVAL '2 days', $1, 'Sport', 'Wien', 10) RETURNING id`,
      [A]
    );
    pastGroupId = pg.rows[0].id;
    // Members since before the event — only they may answer "Wer war dabei?".
    await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at)
                     VALUES ($1,$2,'owner', NOW() - INTERVAL '10 days'),($1,$3,'member', NOW() - INTERVAL '10 days')`,
      [pastGroupId, A, B]);

    // A second past group for the "did not take place" flow (A owner, B member).
    const pg2 = await db.query(
      `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
       VALUES ('No-Show Event','group', NOW() - INTERVAL '2 days', $1, 'Sport', 'Wien', 10) RETURNING id`,
      [A]
    );
    pastGroup2Id = pg2.rows[0].id;
    await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at)
                     VALUES ($1,$2,'owner', NOW() - INTERVAL '10 days'),($1,$3,'member', NOW() - INTERVAL '10 days')`,
      [pastGroup2Id, A, B]);

    // Boost credits so applyBoost exercises the INSERT path (not the 402 branch).
    await db.query(`INSERT INTO boost_credits (user_id, credits) VALUES ($1, 5)`, [A]);

    const a = await import('../../src/controllers/authController.js');
    const g = await import('../../src/controllers/groupController.js');
    const c = await import('../../src/controllers/clubController.js');
    const f = await import('../../src/controllers/friendshipController.js');
    const dm = await import('../../src/controllers/dmController.js');
    const rv = await import('../../src/controllers/reviewController.js');
    const dl = await import('../../src/controllers/dealController.js');
    const bo = await import('../../src/controllers/boostController.js');
    const ms = await import('../../src/controllers/messageController.js');
    const rp = await import('../../src/controllers/reportController.js');
    const mp = await import('../../src/controllers/mapController.js');
    const ad = await import('../../src/controllers/adminController.js');
    const pu = await import('../../src/controllers/pushController.js');
    const us = await import('../../src/controllers/userController.js');
    const er = await import('../../src/jobs/eventReminders.js');
    const fa = await import('../../src/utils/friendActivity.js');
    const fc = await import('../../src/controllers/featuredClubController.js');
    C = {
      register: a.register, getStats: ad.getStats,
      getFeaturedClubs: fc.getFeaturedClubs, getFeaturedClubsAdmin: fc.getFeaturedClubsAdmin,
      setFeaturedClubs: fc.setFeaturedClubs,
      updateProfile: a.updateProfile, completeOnboarding: a.completeOnboarding, getProfile: a.getProfile,
      updatePushPreferences: pu.updatePushPreferences, searchUsers: us.searchUsers,
      subscribePush: pu.subscribe, saveApnsToken: pu.saveApnsToken,
      runEventReminders: er.runEventReminders, notifyFriendsOfActivity: fa.notifyFriendsOfActivity,
      createGroup: g.createGroup, updateGroup: g.updateGroup, createClub: c.createClub,
      inviteMember: g.inviteMember,
      sendFriendRequest: f.sendFriendRequest, respondFriendRequest: f.respondFriendRequest,
      getPendingRequests: f.getPendingRequests,
      removeFriend: f.removeFriend, blockUser: f.blockUser, unblockUser: f.unblockUser,
      sendDM: dm.sendDM, submitReview: rv.submitReview, getPendingReviews: rv.getPendingReviews,
      createDeal: dl.createDeal, redeemDeal: dl.redeemDeal, applyBoost: bo.applyBoost,
      startNewRound: dl.startNewRound, getDeals: dl.getDeals, getDealsForAdmin: dl.getDealsForAdmin,
      getRedemptionStatus: dl.getRedemptionStatus,
      sendMessage: ms.sendMessage, getMessages: ms.getMessages,
      getConversation: dm.getConversation, markDMRead: dm.markDMRead,
      getMessageReceipts: ms.getMessageReceipts,
      updatePrivacyPreferences: a.updatePrivacyPreferences,
      markChatRead: ms.markChatRead, deleteMessage: ms.deleteMessage,
      setMessageReaction: ms.setMessageReaction, setDmReaction: dm.setDmReaction,
      createReport: rp.createReport, getReports: rp.getReports,
      updateReportStatus: rp.updateReportStatus,
      setUserActive: ad.setUserActive, rejectClub: ad.rejectClub,
      getPendingClubs: ad.getPendingClubs,                                 // „Club“/„Community“ label (16.11.2026)
      removeUserAvatar: ad.removeUserAvatar,
      getUserDetail: ad.getUserDetail, sendUserTestPush: ad.sendUserTestPush,
      getMyAttendance: rv.getMyAttendance, getReviewForGroup: rv.getReviewForGroup, getUserById: us.getUserById,
      exportData: a.exportData,
      getGroupMembers: g.getGroupMembers, getClubMembers: c.getClubMembers,
      getJoinRequests: g.getJoinRequests,
      getAllJoinRequests: g.getAllJoinRequests,
      deleteClub: c.deleteClub, deleteClubEvent: c.deleteClubEvent,
      createClubEvent: c.createClubEvent, updateClubEvent: c.updateClubEvent,
      deleteDM: dm.deleteDM,
      joinGroup: g.joinGroup, handleJoinRequest: g.handleJoinRequest, kickMember: g.kickMember,
      leaveGroup: g.leaveGroup, bulkAcceptJoinRequests: g.bulkAcceptJoinRequests,
      joinWaitlist: g.joinWaitlist, joinClub: c.joinClub,
      handleClubJoinRequest: c.handleClubJoinRequest,
      getGroups: g.getGroups, getClubs: c.getClubs, getClubById: c.getClubById,
      updateClub: c.updateClub, classifyClub: ad.classifyClub, getClubsForAdmin: ad.getClubsForAdmin,
      getDiscoverEvents: c.getDiscoverEvents, getMapPins: mp.getMapPins,
      getGroupById: g.getGroupById,
      cancelGroup: g.cancelGroup, deleteGroup: g.deleteGroup,
      getUserClubs: c.getUserClubs, setMyClubOrder: c.setMyClubOrder,     // profile order (16.11.2026)
      getMyUpcomingEvents: g.getMyUpcomingEvents,                         // „Demnächst dabei“ (16.11.2026)
      getClubEvents: c.getClubEvents, setEventDeal: dl.setEventDeal,     // deals at events (16.11.2026)
      getDeal: dl.getDeal, getClubDeals: dl.getClubDeals,                 // club deals (P4 v2, 16.11.2026)
      createClubDeal: dl.createClubDeal, updateClubDeal: dl.updateClubDeal,
      deleteClubDeal: dl.deleteClubDeal, deleteAccount: a.deleteAccount,
    };
  }, 90000);

  afterAll(async () => { await db?.pool?.end?.(); });

  // ── auth / profile ─────────────────────────────────────────────────────────
  it('updateProfile saves with a location (the 42P08 regression)', async () => {
    ok(await call(C.updateProfile, { userId: A, body: {
      name: 'Ann', bio: null, location: 'Wien', date_of_birth: '1995-03-03', gender: 'female',
      interests: ['Yoga'], avatar_url: avatar, photos: [], pinnwand: [], favorite_song: null } }));
  });
  it('updateProfile saves with location = null', async () => {
    ok(await call(C.updateProfile, { userId: A, body: {
      name: 'Ann', bio: null, location: null, date_of_birth: '1995-03-03', gender: 'female',
      interests: ['Yoga'], avatar_url: avatar, photos: [], pinnwand: [], favorite_song: null } }));
  });
  // Reordering profile photos / Pinnwand is ProfileEdit-only (Wunsch
  // 10.10.2026): the server must store both JSONB arrays in exactly the order
  // sent and accept any of the photos as the new avatar.
  it('updateProfile keeps a reordered photo list and Pinnwand exactly as sent', async () => {
    const img = (n) => `https://app.jamie-app.com/media/uploads/${n}.webp`;
    ok(await call(C.updateProfile, { userId: A, body: {
      avatar_url: img('p3'), photos: [img('p1'), img('p2')], pinnwand: [img('w3'), img('w1'), img('w2')] } }));
    const r = await db.query('SELECT avatar_url, photos, pinnwand FROM users WHERE id=$1', [A]);
    expect(r.rows[0].avatar_url).toBe(img('p3'));
    expect(r.rows[0].photos).toEqual([img('p1'), img('p2')]);
    expect(r.rows[0].pinnwand).toEqual([img('w3'), img('w1'), img('w2')]);
    // Put the shared fixture back for the tests below.
    ok(await call(C.updateProfile, { userId: A, body: { avatar_url: avatar, photos: [], pinnwand: [] } }));
  });
  // Tina spotted a member with no age on 2026-09-15. Cause: googleLogin creates
  // its user with date_of_birth = NULL and NOTHING ever asked — completeOnboarding
  // did not accept the field and the form did not show it. Those accounts ended
  // up fully onboarded, visible, ageless, and never 18+-checked.
  it('completeOnboarding refuses to finish without a birth date, and enforces 18+', async () => {
    const social = (await db.query(
      `INSERT INTO users (email, name, avatar_url, auth_provider, is_verified)
       VALUES ('smoke-google@x.com','Gina',$1,'google',TRUE) RETURNING id`,
      [avatar])).rows[0].id;
    // Exactly the state googleLogin leaves behind.
    expect((await db.query('SELECT date_of_birth FROM users WHERE id=$1', [social])).rows[0].date_of_birth).toBe(null);

    const noDob = await call(C.completeOnboarding, { userId: social, body: {
      gender: 'female', location: 'Wien', interests: ['Yoga'] } });
    expect(noDob.statusCode, JSON.stringify(noDob.body)).toBe(400);
    expect(noDob.body.code).toBe('DOB_REQUIRED');
    // ...and onboarding must NOT have been marked done.
    expect((await db.query('SELECT onboarding_completed FROM users WHERE id=$1', [social])).rows[0].onboarding_completed).toBe(false);

    const under18 = new Date();
    under18.setFullYear(under18.getFullYear() - 15);
    const minor = await call(C.completeOnboarding, { userId: social, body: {
      gender: 'female', location: 'Wien', date_of_birth: under18.toISOString().slice(0, 10) } });
    expect(minor.statusCode).toBe(400);
    expect(minor.body.code).toBe('DOB_UNDERAGE');

    ok(await call(C.completeOnboarding, { userId: social, body: {
      gender: 'female', location: 'Wien', date_of_birth: '1995-04-04' } }));
    const done = await db.query(
      `SELECT to_char(date_of_birth,'YYYY-MM-DD') AS dob, onboarding_completed, date_of_birth_changed
         FROM users WHERE id=$1`, [social]);
    expect(done.rows[0].dob).toBe('1995-04-04');
    expect(done.rows[0].onboarding_completed).toBe(true);
    // Setting it the FIRST time is not the one edit the user is entitled to.
    expect(done.rows[0].date_of_birth_changed).toBe(false);
  });

  it('an email signup keeps its registration birth date through onboarding', async () => {
    const before = await db.query(`SELECT to_char(date_of_birth,'YYYY-MM-DD') AS dob FROM users WHERE id=$1`, [B]);
    ok(await call(C.completeOnboarding, { userId: B, body: { gender: 'female', location: 'Wien' } }));
    const after = await db.query(`SELECT to_char(date_of_birth,'YYYY-MM-DD') AS dob FROM users WHERE id=$1`, [B]);
    expect(after.rows[0].dob).toBe(before.rows[0].dob);
    expect(after.rows[0].dob).not.toBe(null);
  });

  it('completeOnboarding saves', async () => {
    ok(await call(C.completeOnboarding, { userId: A, body: {
      gender: 'female', location: 'Graz', interests: ['Wandern'], bio: 'hallo', photos: [],
      avatar_url: avatar, favorite_song: null } }));
  });

  // ── groups / clubs ───────────────────────────────────────────────────────
  it('createGroup inserts a group', async () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const res = await call(C.createGroup, { userId: A, body: {
      name: 'Smoke Group', description: 'desc', type: 'group', category: 'Sport',
      date: future, time: '18:00', location: 'Wien', max_members: 10 } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
    groupId = res.body?.id;
    expect(groupId).toBeTruthy();
  });
  it('updateGroup updates it (name + location)', async () => {
    ok(await call(C.updateGroup, { userId: A, params: { id: String(groupId) },
      body: { name: 'Smoke Group Renamed', location: 'Salzburg' } }));
  });
  it('createClub inserts a club', async () => {
    const res = await call(C.createClub, { userId: A, body: {
      name: 'Smoke Club', description: 'a club', category: 'Sport', location: 'Wien', max_members: 50 } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
  });

  // ── friendships ──────────────────────────────────────────────────────────
  it('sendFriendRequest A→B', async () => {
    ok(await call(C.sendFriendRequest, { userId: A, body: { userId: B } }));
    const r = await db.query('SELECT id FROM friendships WHERE requester_id=$1 AND addressee_id=$2', [A, B]);
    friendReqId = r.rows[0]?.id;
    expect(friendReqId).toBeTruthy();
  });
  it('respondFriendRequest B accepts', async () => {
    ok(await call(C.respondFriendRequest, { userId: B, params: { requestId: String(friendReqId) }, body: { action: 'accept' } }));
  });
  it('blockUser then unblockUser (A ↔ D)', async () => {
    noServerError(await call(C.blockUser, { userId: A, body: { userId: D } }));
    noServerError(await call(C.unblockUser, { userId: A, body: { userId: D } }));
  });

  // ── direct messages (A and B are now friends) ────────────────────────────
  it('sendDM A→B', async () => {
    ok(await call(C.sendDM, { userId: A, body: { receiverId: B, content: 'hallo Bea' } }));
  });

  // ── event reviews (past group, A reviews B) ──────────────────────────────
  it('submitReview marks attendance', async () => {
    const res = await call(C.submitReview, { userId: A, body: {
      group_id: pastGroupId, attendances: [{ user_id: B, was_present: true }] } });
    ok(res);
    expect(res.body).toEqual({ success: true, counted: true });
  });
  it('submitReview not_held (owner) flags the event + writes no attendance', async () => {
    ok(await call(C.submitReview, { userId: A, body: { group_id: pastGroup2Id, not_held: true } }));
    const flag = await db.query('SELECT did_not_take_place FROM groups WHERE id=$1', [pastGroup2Id]);
    expect(flag.rows[0].did_not_take_place).toBe(true);
    // Only the reviewer sentinel — no attendance rows for other members.
    const rows = await db.query('SELECT reviewed_user_id, was_present FROM event_reviews WHERE group_id=$1', [pastGroup2Id]);
    expect(rows.rows).toEqual([{ reviewed_user_id: A, was_present: false }]);
  });
  it('getPendingReviews skips a not-held event', async () => {
    const res = await call(C.getPendingReviews, { userId: B });
    ok(res);
    expect((res.body || []).some(r => r.group_id === pastGroup2Id)).toBe(false);
    // …and still asks about the one that took place (A reviewed it, B has not)
    expect((res.body || []).some(r => r.group_id === pastGroupId)).toBe(true);
  });
  it('updateGroup: re-saving a PAST group with its own date is no reschedule (GroupEdit always sends it)', async () => {
    const before = (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d, date::text AS ts FROM groups WHERE id = $1`, [pastGroupId])).rows[0];
    const res = await call(C.updateGroup, { userId: A, params: { id: String(pastGroupId) },
      body: { date: before.d, description: 'Fotos sind oben' } });
    ok(res);
    const after = (await db.query('SELECT is_recurring_weekly, description, date::text AS ts FROM groups WHERE id = $1', [pastGroupId])).rows[0];
    // the stored value is kept as it was (a legacy time is not reset to 00:00)
    expect(after).toEqual({ is_recurring_weekly: false, description: 'Fotos sind oben', ts: before.ts });
    // another past day is still refused
    const prev = (await db.query(`SELECT to_char(date - INTERVAL '1 day', 'YYYY-MM-DD') AS d FROM groups WHERE id = $1`, [pastGroupId])).rows[0].d;
    const bad = await call(C.updateGroup, { userId: A, params: { id: String(pastGroupId) }, body: { date: prev } });
    expect(bad.statusCode).toBe(400);
  });

  // ── deals (create by admin A, redeem by B) ───────────────────────────────
  it('createDeal inserts a deal', async () => {
    const res = await call(C.createDeal, { userId: A, body: {
      name: 'Smoke Deal', deal_label: '10% off', description: 'nice', address: 'Wien' } });
    ok(res);
    dealId = res.body?.id ?? res.body?.deal?.id;
    const d = await db.query("SELECT id FROM deals WHERE name='Smoke Deal' ORDER BY id DESC LIMIT 1");
    dealId = dealId ?? d.rows[0]?.id;
    expect(dealId).toBeTruthy();
  });
  it('redeemDeal by B', async () => {
    noServerError(await call(C.redeemDeal, { userId: B, params: { id: String(dealId) } }));
  });

  // ── "Neue Runde starten" (Tina 24.09.2026) ────────────────────────────────
  // A 'once' deal that B already redeemed. Round 0 rows carry the bare
  // period_key 'once' (pre-feature data), round 1 keys on 'once:1'.
  it('a second redeem in the same round is a 409, not a new row', async () => {
    const r = await call(C.redeemDeal, { userId: B, params: { id: String(dealId) } });
    expect(r.statusCode).toBe(409);
    const n = await db.query('SELECT COUNT(*)::int AS n FROM deal_redemptions WHERE deal_id=$1', [dealId]);
    expect(n.rows[0].n).toBe(1);
  });
  it('cap reached in round 0 takes the deal offline for the feed', async () => {
    await db.query('UPDATE deals SET max_redemptions = 1 WHERE id=$1', [dealId]);
    const feed = await call(C.getDeals, { userId: B });
    ok(feed);
    expect((feed.body || []).some(d => d.id === dealId)).toBe(false);
  });
  it('startNewRound bumps the round, reopens the deal, keeps the old redemption', async () => {
    const r = await call(C.startNewRound, { userId: A, params: { id: String(dealId) } });
    ok(r);
    expect(r.body.redeem_round).toBe(1);
    // old row untouched (stats), status for B is "not redeemed" again
    const old = await db.query("SELECT period_key FROM deal_redemptions WHERE deal_id=$1", [dealId]);
    expect(old.rows.map(x => x.period_key)).toEqual(['once']);
    const st = await call(C.getRedemptionStatus, { userId: B, params: { id: String(dealId) } });
    ok(st);
    expect(st.body.redeemed).toBe(false);
    // cap counts the current round only → back in the feed
    const feed = await call(C.getDeals, { userId: B });
    expect((feed.body || []).some(d => d.id === dealId)).toBe(true);
  });
  it('B redeems again in round 1; admin list shows total 2, round 1', async () => {
    const r = await call(C.redeemDeal, { userId: B, params: { id: String(dealId) } });
    expect(r.statusCode).toBe(201);
    const keys = await db.query("SELECT period_key FROM deal_redemptions WHERE deal_id=$1 ORDER BY id", [dealId]);
    expect(keys.rows.map(x => x.period_key)).toEqual(['once', 'once:1']);
    const adm = await call(C.getDealsForAdmin, { userId: A });
    ok(adm);
    const row = (adm.body || []).find(d => d.id === dealId);
    expect(row.redemption_count).toBe(2);
    expect(row.round_redemption_count).toBe(1);
    expect(row.redeem_round).toBe(1);
  });
  it('startNewRound refuses weekly deals (409 NOT_ONCE)', async () => {
    await db.query("UPDATE deals SET redeem_interval='weekly' WHERE id=$1", [dealId]);
    const r = await call(C.startNewRound, { userId: A, params: { id: String(dealId) } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('NOT_ONCE');
    await db.query("UPDATE deals SET redeem_interval='once', max_redemptions=NULL WHERE id=$1", [dealId]);
  });
  // Tina 26.09.2026: "nur das Datum aktualisieren" — an expired library deal
  // gets a new end date AND a new round in one call; the stats stay.
  it('startNewRound with visible_until reopens an expired deal with the new date', async () => {
    await db.query("UPDATE deals SET visible_until = '2026-01-01' WHERE id=$1", [dealId]);
    const feedBefore = await call(C.getDeals, { userId: B });
    expect((feedBefore.body || []).some(d => d.id === dealId)).toBe(false);
    const r = await call(C.startNewRound, { userId: A, params: { id: String(dealId) }, body: { visible_until: '2099-12-31' } });
    ok(r);
    expect(r.body.redeem_round).toBe(2);
    const row = await db.query("SELECT to_char(visible_until, 'YYYY-MM-DD HH24:MI:SS') AS d FROM deals WHERE id=$1", [dealId]);
    expect(row.rows[0].d).toBe('2099-12-31 22:59:59'); // all of the 31st in Vienna (CET), review 16.11.2026
    const feed = await call(C.getDeals, { userId: B });
    expect((feed.body || []).some(d => d.id === dealId)).toBe(true);
    const n = await db.query('SELECT COUNT(*)::int AS n FROM deal_redemptions WHERE deal_id=$1', [dealId]);
    expect(n.rows[0].n).toBe(2); // old rounds untouched
  });
  it('startNewRound rejects a past visible_until (400) and keeps the round', async () => {
    const r = await call(C.startNewRound, { userId: A, params: { id: String(dealId) }, body: { visible_until: '2020-01-01' } });
    expect(r.statusCode).toBe(400);
    const row = await db.query('SELECT redeem_round FROM deals WHERE id=$1', [dealId]);
    expect(row.rows[0].redeem_round).toBe(2);
  });
  it('startNewRound without a body keeps the date; null clears it', async () => {
    const keep = await call(C.startNewRound, { userId: A, params: { id: String(dealId) } });
    ok(keep);
    expect(keep.body.redeem_round).toBe(3);
    let row = await db.query("SELECT to_char(visible_until, 'YYYY-MM-DD') AS d FROM deals WHERE id=$1", [dealId]);
    expect(row.rows[0].d).toBe('2099-12-31');
    const clear = await call(C.startNewRound, { userId: A, params: { id: String(dealId) }, body: { visible_until: null } });
    ok(clear);
    row = await db.query('SELECT visible_until FROM deals WHERE id=$1', [dealId]);
    expect(row.rows[0].visible_until).toBeNull();
  });

  // ── user search ranking (support mail Lena 23.09.2026) ───────────────────
  // 25 strangers named "Lena …" plus one "Lena Heider" who shares a group
  // with the caller. Before: LIMIT 20 with no ORDER BY → the group-mate could
  // be cut off. Now she is first, prefix matches beat infix ("Helena").
  it('searchUsers ranks group-mates first, then prefix matches, and returns > 20', async () => {
    const ids = [];
    for (let i = 0; i < 25; i++) {
      const r = await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, onboarding_completed, auth_provider)
         VALUES ($1, $2, '1996-06-06', 'female', TRUE, 'email') RETURNING id`,
        [`smoke-lena-${i}@x.com`, `Lena Stranger ${String(i).padStart(2, '0')}`]);
      ids.push(r.rows[0].id);
    }
    const mate = (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, onboarding_completed, auth_provider)
       VALUES ('smoke-lena-mate@x.com', 'Lena Heider', '1996-06-06', 'female', TRUE, 'email') RETURNING id`)).rows[0].id;
    const helena = (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, onboarding_completed, auth_provider)
       VALUES ('smoke-helena@x.com', 'Helena Aaa', '1996-06-06', 'female', TRUE, 'email') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [groupId, mate]);

    const res = await call(C.searchUsers, { userId: A, query: { q: 'lena' } });
    ok(res);
    const names = res.body.map(u => u.id);
    expect(names[0]).toBe(mate);                       // shares groupId with A
    expect(names.length).toBeGreaterThan(20);          // old LIMIT 20 would have cut
    expect(names.indexOf(helena)).toBe(names.length - 1); // infix match sorts last
  });

  // ── boosts (A boosts own group, funded by credits) ───────────────────────
  it('applyBoost on own group', async () => {
    ok(await call(C.applyBoost, { userId: A, body: { target_type: 'group', target_id: groupId, hours: 24 } }));
  });

  // ── audit 2026-08-10 regressions ─────────────────────────────────────────
  it('inviteMember A invites friend B (group_members has no id column)', async () => {
    // Was 500 forever: the membership pre-check selected the nonexistent
    // group_members.id (42703). A and B are friends; B not in groupId.
    ok(await call(C.inviteMember, { userId: A, params: { id: String(groupId), friendId: String(B) } }));
    const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, B]);
    expect(m.rows.length).toBe(1);
  });
  it('re-request after the cron expired the old one (uniq_friend_pair lockout)', async () => {
    ok(await call(C.sendFriendRequest, { userId: B, body: { userId: D } }));
    // Simulate the 04:00 expiry cron.
    await db.query(`UPDATE friendships SET status='expired'
                    WHERE requester_id=$1 AND addressee_id=$2`, [B, D]);
    // Was 400 "already pending" forever: no expired branch → INSERT → 23505.
    ok(await call(C.sendFriendRequest, { userId: B, body: { userId: D } }));
    const r = await db.query(`SELECT status FROM friendships
                              WHERE (requester_id=$1 AND addressee_id=$2)
                                 OR (requester_id=$2 AND addressee_id=$1)`, [B, D]);
    expect(r.rows).toEqual([{ status: 'pending' }]);
  });
  // Chat → Anfragen shows friend requests next to join requests (Lea,
  // 18.10.2026). The pending list must carry what RequestCard renders (the
  // unit tests mock the SQL — only a real Postgres proves the new columns),
  // and reject + undo must hand the deck a NEW updated_at, its dedupe key, or
  // the restored request would stay hidden for the rest of the session.
  // Leaves B → D pending, as the case above did.
  it('getPendingRequests carries interests, the seal and the Abzeichen-Stufe; undo refreshes updated_at', async () => {
    const mine = async () => {
      const res = await call(C.getPendingRequests, { userId: D });
      ok(res);
      return res.body.find(r => r.requester_id === B);
    };
    const row = await mine();
    expect(row).toBeTruthy();
    expect(row).toHaveProperty('requester_interests');
    expect(row).toHaveProperty('requester_trusted');
    expect(row).toHaveProperty('requester_name', 'Bea');
    expect(row.requester_attendance_step).toBe(0);
    expect(row.requester_attendance_tier).toBe(0);

    const pings = () => emitted.filter(e => e.ev === 'friend_request_update').length;
    const before = pings();
    ok(await call(C.respondFriendRequest, { userId: D, params: { requestId: String(row.id) }, body: { action: 'reject' } }));
    expect(await mine()).toBeUndefined();
    ok(await call(C.respondFriendRequest, { userId: D, params: { requestId: String(row.id) }, body: { action: 'undo' } }));
    const restored = await mine();
    expect(restored.id).toBe(row.id);
    expect(new Date(restored.updated_at).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
    expect(pings()).toBe(before + 2); // after each stored write, nothing else
  });

  // ── group chat (messageController — the hottest write path, audit risk #6) ─
  let msgId;
  it('sendMessage persists to the group chat (A is member via createGroup)', async () => {
    const res = await call(C.sendMessage, { userId: A, body: { groupId, content: 'hallo Gruppe' } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
    expect(res.body?.content).toBe('hallo Gruppe');
    msgId = res.body?.id;
    expect(msgId).toBeTruthy();
  });
  it('sendMessage 403s for a non-member', async () => {
    const res = await call(C.sendMessage, { userId: D, body: { groupId, content: 'lass mich rein' } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
  });
  it('getMessages pages the chat (query params hit real SQL)', async () => {
    const res = await call(C.getMessages, {
      userId: A, params: { groupId: String(groupId) }, query: { limit: '10' },
    });
    ok(res);
    const msgs = res.body?.messages ?? res.body;
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs.some(m => m.id === msgId)).toBe(true);
  });
  it('markChatRead stamps last_read_at', async () => {
    ok(await call(C.markChatRead, { userId: B, params: { groupId: String(groupId) } }));
    const r = await db.query(
      'SELECT last_read_at FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, B]);
    expect(r.rows[0]?.last_read_at).toBeTruthy();
  });
  it('deleteMessage by its author', async () => {
    ok(await call(C.deleteMessage, { userId: A, params: { messageId: String(msgId) } }));
  });

  // ── Reply-to + voice messages (2026-09-15) ──────────────────────────────
  // Both add columns and JOINs to the app's hottest read/write paths, and the
  // reply target is scoped by a WHERE that decides whether private content can
  // leak into a quote — exactly the kind of SQL a mocked db.query cannot judge.
  describe('reply + voice messages', () => {
    let firstId, replyId, voiceId;

    it('a reply carries the quoted message back on send AND on read', async () => {
      const base = await call(C.sendMessage, { userId: A, body: {
        groupId, content: 'Wann treffen wir uns?' }, app: fakeApp });
      ok(base);
      firstId = base.body.id;
      expect(base.body.reply_to).toBe(null);

      const res = await call(C.sendMessage, { userId: B, body: {
        groupId, content: 'Um 19:00!', reply_to_id: firstId } });
      ok(res);
      replyId = res.body.id;
      expect(res.body.reply_to).toMatchObject({
        id: firstId, content: 'Wann treffen wir uns?', user_name: 'Ann', message_type: 'text',
      });

      const list = await call(C.getMessages, { userId: A, params: { groupId: String(groupId) }, query: {} });
      ok(list);
      const rows = list.body.messages || list.body;
      const fromRead = rows.find(m => m.id === replyId);
      expect(fromRead.reply_to).toMatchObject({ id: firstId, user_name: 'Ann' });
      // A plain message must not sprout an empty quote object.
      expect(rows.find(m => m.id === firstId).reply_to).toBe(null);
    });

    it('a quote of a message in ANOTHER group is silently dropped, not leaked', async () => {
      const other = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members)
         VALUES ('Smoke Other Chat','group',$1,'Sport','Wien',10) RETURNING id`, [A])).rows[0].id;
      const secret = (await db.query(
        `INSERT INTO messages (group_id, user_id, content) VALUES ($1,$2,'geheim') RETURNING id`,
        [other, A])).rows[0].id;

      const res = await call(C.sendMessage, { userId: B, body: {
        groupId, content: 'versuch', reply_to_id: secret } });
      ok(res);                                   // the message still sends...
      expect(res.body.reply_to).toBe(null);      // ...without the foreign quote
      expect(res.body.reply_to_id).toBe(null);
    });

    it('stores a voice message and rejects a non-upload URL as one', async () => {
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId, message_type: 'voice',
        content: '/media/uploads/abc123.webm', duration_ms: 4200 } });
      ok(res);
      voiceId = res.body.id;
      expect(res.body.message_type).toBe('voice');
      expect(res.body.duration_ms).toBe(4200);

      // `content` is rendered by an <audio> element, so it must be a URL our
      // own upload route minted — never an arbitrary host, and never text.
      for (const bad of ['https://attacker.tld/evil.webm', 'nur text', '/media/uploads/x.exe']) {
        const r = await call(C.sendMessage, { userId: A, body: {
          groupId, message_type: 'voice', content: bad } });
        expect(r.statusCode, `${bad}: ${JSON.stringify(r.body)}`).toBe(400);
      }
    });

    it('clamps an absurd client-reported duration and rejects an unknown type', async () => {
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId, message_type: 'voice',
        content: '/media/uploads/def456.m4a', duration_ms: 999999999 } });
      ok(res);
      expect(res.body.duration_ms).toBe(120000);
      expect((await call(C.sendMessage, { userId: A, body: {
        groupId, message_type: 'sticker', content: 'x' } })).statusCode).toBe(400);
    });

    it('a text message never carries a duration', async () => {
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId, content: 'normal', duration_ms: 5000 } });
      ok(res);
      expect(res.body.duration_ms).toBe(null);
      expect(res.body.message_type).toBe('text');
    });

    it('deleting the quoted message leaves the reply standing (ON DELETE SET NULL)', async () => {
      ok(await call(C.deleteMessage, { userId: A, params: { messageId: String(firstId) } }));
      const list = await call(C.getMessages, { userId: A, params: { groupId: String(groupId) }, query: {} });
      const rows = list.body.messages || list.body;
      const reply = rows.find(m => m.id === replyId);
      expect(reply).toBeTruthy();          // the reply survives...
      expect(reply.reply_to).toBe(null);   // ...the quote just loses its source
      expect(rows.map(m => m.id)).not.toContain(firstId);
      expect(voiceId).toBeTruthy();
    });

    it('stores a photo message and rejects a foreign image URL', async () => {
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId, message_type: 'image', content: '/media/uploads/photo1.webp' } });
      ok(res);
      expect(res.body.message_type).toBe('image');
      // `content` is fed to an <img>, so it must be a URL our own upload route
      // minted — which is also where Sightengine ran on it.
      for (const bad of ['https://attacker.tld/porn.jpg', 'nur text']) {
        const r = await call(C.sendMessage, { userId: A, body: {
          groupId, message_type: 'image', content: bad } });
        expect(r.statusCode, `${bad}: ${JSON.stringify(r.body)}`).toBe(400);
      }
    });

    it('the chat-list nudge of a photo / voice note carries a readable label for older apps', async () => {
      const nudgeAfter = async (fn, args, ev) => {
        const from = emitted.length;
        ok(await call(fn, args));
        for (let i = 0; i < 20 && !emitted.slice(from).some(e => e.ev === ev); i++) await new Promise(r => setTimeout(r, 10));
        return emitted.slice(from).find(e => e.ev === ev)?.payload;
      };
      expect(await nudgeAfter(C.sendMessage, { userId: A, body: {
        groupId, message_type: 'image', content: '/media/uploads/photo3.webp' } }, 'group_message_notification'))
        .toMatchObject({ message_type: 'image', content: '📷 Foto' });
      expect(await nudgeAfter(C.sendDM, { userId: A, body: {
        receiverId: B, message_type: 'voice', content: '/media/uploads/dm9.webm', duration_ms: 2000 } }, 'new_dm_notification'))
        .toMatchObject({ message_type: 'voice', message: '🎤 Sprachnachricht' });
      expect((await nudgeAfter(C.sendMessage, { userId: A, body: { groupId, content: 'nur Text' } },
        'group_message_notification')).content).toBe('nur Text');
    });

    it('a photo can be quoted, and the quote carries no URL', async () => {
      const photo = await call(C.sendMessage, { userId: A, body: {
        groupId, message_type: 'image', content: '/media/uploads/photo2.webp' } });
      ok(photo);
      const reply = await call(C.sendMessage, { userId: B, body: {
        groupId, content: 'schoenes Foto!', reply_to_id: photo.body.id } });
      ok(reply);
      expect(reply.body.reply_to).toMatchObject({ id: photo.body.id, message_type: 'image' });
      // The client renders a label off the type; the storage path never travels.
      expect(reply.body.reply_to.content).toBe(null);
    });

    it('DMs support both too, scoped to the conversation', async () => {
      const first = await call(C.sendDM, { userId: A, body: { receiverId: B, content: 'hi' } });
      ok(first);
      const reply = await call(C.sendDM, { userId: B, body: {
        receiverId: A, content: 'hallo!', reply_to_id: first.body.id } });
      ok(reply);
      expect(reply.body.reply_to).toMatchObject({ id: first.body.id, content: 'hi', user_name: 'Ann' });

      const voice = await call(C.sendDM, { userId: A, body: {
        receiverId: B, message_type: 'voice', content: '/media/uploads/dm1.webm', duration_ms: 3000 } });
      ok(voice);
      expect(voice.body).toMatchObject({ message_type: 'voice', duration_ms: 3000 });

      const photo = await call(C.sendDM, { userId: A, body: {
        receiverId: B, message_type: 'image', content: '/media/uploads/dm2.webp' } });
      ok(photo);
      expect(photo.body.message_type).toBe('image');
      expect((await call(C.sendDM, { userId: A, body: {
        receiverId: B, message_type: 'image', content: 'https://attacker.tld/x.jpg' } })).statusCode).toBe(400);

      const convo = await call(C.getConversation, { userId: A, params: { userId: String(B) }, query: {} });
      ok(convo);
      const got = convo.body.find(m => m.id === reply.body.id);
      expect(got.reply_to).toMatchObject({ id: first.body.id, user_name: 'Ann' });
    });
  });

  // ── Emoji-Reaktionen (2026-09-17) ───────────────────────────────────────
  // The aggregate uses json_agg + array_agg with ORDER BY inside them, an
  // ANY() array parameter and an ON CONFLICT upsert — none of which a mocked
  // db.query can judge. One-reaction-per-person also lives in a PRIMARY KEY,
  // so only a real Postgres proves it actually holds.
  describe('emoji reactions', () => {
    let rxMsgId, rxDmId;

    it('a reaction comes back on the write AND on the next read', async () => {
      const sent = await call(C.sendMessage, { userId: A, body: { groupId, content: 'Wer ist dabei?' } });
      ok(sent);
      rxMsgId = sent.body.id;

      const res = await call(C.setMessageReaction, {
        userId: B, params: { messageId: String(rxMsgId) }, body: { emoji: '👍' } });
      ok(res);
      expect(res.body.reactions).toEqual([{ emoji: '👍', count: 1, user_ids: [B] }]);

      const list = await call(C.getMessages, { userId: A, params: { groupId: String(groupId) }, query: {} });
      ok(list);
      const rows = list.body.messages || list.body;
      expect(rows.find(m => m.id === rxMsgId).reactions)
        .toEqual([{ emoji: '👍', count: 1, user_ids: [B] }]);
      // A message nobody reacted to carries an empty array, never undefined —
      // the clients map over it without guarding.
      expect(rows.every(m => Array.isArray(m.reactions))).toBe(true);
    });

    it('picking another emoji REPLACES it — one reaction per person', async () => {
      const res = await call(C.setMessageReaction, {
        userId: B, params: { messageId: String(rxMsgId) }, body: { emoji: '🎉' } });
      ok(res);
      // With a wrong primary key or a plain INSERT this would be two chips of
      // one each — the exact bug the upsert exists to prevent.
      expect(res.body.reactions).toEqual([{ emoji: '🎉', count: 1, user_ids: [B] }]);
    });

    it('aggregates two people on the same emoji', async () => {
      ok(await call(C.setMessageReaction, {
        userId: A, params: { messageId: String(rxMsgId) }, body: { emoji: '🎉' } }));
      const res = await call(C.setMessageReaction, {
        userId: B, params: { messageId: String(rxMsgId) }, body: { emoji: '🎉' } });
      ok(res);
      expect(res.body.reactions).toHaveLength(1);
      expect(res.body.reactions[0].count).toBe(2);
      expect([...res.body.reactions[0].user_ids].sort()).toEqual([A, B].sort());
    });

    it('orders chips by count, most-used first', async () => {
      const res = await call(C.setMessageReaction, {
        userId: A, params: { messageId: String(rxMsgId) }, body: { emoji: '🔥' } });
      ok(res);
      // B still on 🎉 (1), A now on 🔥 (1) — equal counts fall back to who
      // reacted first, which is B.
      expect(res.body.reactions.map(r => r.emoji)).toEqual(['🎉', '🔥']);
      ok(await call(C.setMessageReaction, {
        userId: B, params: { messageId: String(rxMsgId) }, body: { emoji: '🔥' } }));
      const after = await call(C.setMessageReaction, {
        userId: A, params: { messageId: String(rxMsgId) }, body: { emoji: '🔥' } });
      expect(after.body.reactions.map(r => r.emoji)).toEqual(['🔥']);
      expect(after.body.reactions[0].count).toBe(2);
    });

    it('emoji: null removes only my own', async () => {
      const res = await call(C.setMessageReaction, {
        userId: A, params: { messageId: String(rxMsgId) }, body: { emoji: null } });
      ok(res);
      expect(res.body.reactions).toEqual([{ emoji: '🔥', count: 1, user_ids: [B] }]);
    });

    it('rejects an emoji that is not on the allowlist', async () => {
      for (const bad of ['🍆', 'hallo', '<b>x</b>', '👍👍']) {
        const res = await call(C.setMessageReaction, {
          userId: A, params: { messageId: String(rxMsgId) }, body: { emoji: bad } });
        expect(res.statusCode, bad).toBe(400);
      }
    });

    it('403s a non-member — membership is read off the message, not the request', async () => {
      const res = await call(C.setMessageReaction, {
        userId: D, params: { messageId: String(rxMsgId) }, body: { emoji: '👍' } });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
    });

    it('404s on a deleted message and on one that never existed', async () => {
      const gone = await call(C.sendMessage, { userId: A, body: { groupId, content: 'gleich weg' } });
      ok(gone);
      ok(await call(C.deleteMessage, { userId: A, params: { messageId: String(gone.body.id) } }));
      expect((await call(C.setMessageReaction, {
        userId: A, params: { messageId: String(gone.body.id) }, body: { emoji: '👍' } })).statusCode).toBe(404);
      expect((await call(C.setMessageReaction, {
        userId: A, params: { messageId: '99999999' }, body: { emoji: '👍' } })).statusCode).toBe(404);
    });

    it('400s on an unparsable id instead of letting Postgres raise 22P02', async () => {
      // Optimistic bubbles carry `temp-…` ids and a mis-tap can send one.
      const res = await call(C.setMessageReaction, {
        userId: A, params: { messageId: 'temp-1726500000' }, body: { emoji: '👍' } });
      expect(res.statusCode).toBe(400);
    });

    it('works on DMs and is scoped to the two participants', async () => {
      const dmSent = await call(C.sendDM, { userId: A, body: { receiverId: B, content: 'Reaktions-Test' } });
      ok(dmSent);
      rxDmId = dmSent.body.id;

      const res = await call(C.setDmReaction, {
        userId: B, params: { id: String(rxDmId) }, body: { emoji: '😂' } });
      ok(res);
      expect(res.body.reactions).toEqual([{ emoji: '😂', count: 1, user_ids: [B] }]);

      const convo = await call(C.getConversation, { userId: A, params: { userId: String(B) }, query: {} });
      ok(convo);
      expect(convo.body.find(m => m.id === rxDmId).reactions)
        .toEqual([{ emoji: '😂', count: 1, user_ids: [B] }]);

      // D is neither sender nor receiver of this message.
      expect((await call(C.setDmReaction, {
        userId: D, params: { id: String(rxDmId) }, body: { emoji: '👍' } })).statusCode).toBe(403);
    });

    it('deleting the message takes its reactions with it (ON DELETE CASCADE)', async () => {
      const m = await call(C.sendMessage, { userId: A, body: { groupId, content: 'kurz da' } });
      ok(m);
      ok(await call(C.setMessageReaction, {
        userId: A, params: { messageId: String(m.body.id) }, body: { emoji: '👍' } }));
      await db.query('DELETE FROM messages WHERE id = $1', [m.body.id]);
      const left = await db.query('SELECT 1 FROM message_reactions WHERE message_id = $1', [m.body.id]);
      expect(left.rows).toHaveLength(0);
    });

    it('deleting a user takes their reactions with them and is not blocked by them', async () => {
      // A foreign key to users(id) WITHOUT a cascade is exactly what broke
      // account deletion once already (reports.reviewed_by) — a column nothing
      // ever wrote, holding the delete hostage. Pin both cascades.
      const r = await db.query(
        "INSERT INTO users (email, name, date_of_birth, onboarding_completed, auth_provider)" +
        " VALUES ('smoke-rx@x.com','Rex','1995-03-03', TRUE, 'email') RETURNING id"
      );
      const rex = r.rows[0].id;
      await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')", [groupId, rex]);
      ok(await call(C.setMessageReaction, {
        userId: rex, params: { messageId: String(rxMsgId) }, body: { emoji: '🙏' } }));
      await db.query('DELETE FROM users WHERE id = $1', [rex]);
      const left = await db.query('SELECT 1 FROM message_reactions WHERE user_id = $1', [rex]);
      expect(left.rows).toHaveLength(0);
    });
  });

  // ── Umkreis (2026-09-18) ────────────────────────────────────────────────
  // Play review „Suzkapu" 02.09.2026. Two things only a real Postgres proves:
  // that the acos/radians expression computes the same number as the JS
  // helper the feed filter uses, and that the fail-open OR-chain in the push
  // fan-out actually selects who it claims to.
  describe('Umkreis / notification radius', () => {
    const WIEN    = { lat: 48.2082, lng: 16.3738 };
    const BADEN   = { lat: 47.9956, lng: 16.2318 };  // ~25 km from Wien
    const BREGENZ = { lat: 47.5031, lng: 9.7471 };   // ~480 km — the review's case

    it('Postgres and the JS helper agree on the distance', () => {
      // If these drift, the feed filter and the push fan-out silently disagree
      // about what "50 km" means and nobody notices until someone complains.
      return db.query(
        `SELECT ${distanceKmSql('$1::double precision', '$2::double precision',
                                '$3::double precision', '$4::double precision')} AS km`,
        [WIEN.lat, WIEN.lng, BREGENZ.lat, BREGENZ.lng]
      ).then(({ rows }) => {
        const fromJs = distanceKm(WIEN.lat, WIEN.lng, BREGENZ.lat, BREGENZ.lng);
        expect(Math.abs(Number(rows[0].km) - fromJs)).toBeLessThan(1e-6);
        expect(fromJs).toBeGreaterThan(450);
      });
    });

    it('acos does not blow up on two identical points', async () => {
      // Without LEAST(1, …) the inner term can exceed 1.0 by a rounding error
      // and Postgres raises "input is out of range", 500ing the fan-out.
      const { rows } = await db.query(
        `SELECT ${distanceKmSql('$1::double precision', '$2::double precision',
                                '$1::double precision', '$2::double precision')} AS km`,
        [WIEN.lat, WIEN.lng]
      );
      expect(Number(rows[0].km)).toBeLessThan(0.001);
    });

    // The fan-out's WHERE clause, exercised directly: building a real group
    // through createGroup would need a geocoder answer per case, and the thing
    // under test is the SQL, not the controller plumbing around it.
    const targeted = async (groupPoint) => {
      const { rows } = await db.query(
        `SELECT u.id FROM users u
          WHERE u.id = ANY($1::int[])
            AND (
                 u.notify_radius_km IS NULL
              OR $2::double precision IS NULL OR $3::double precision IS NULL
              OR u.lat IS NULL OR u.lng IS NULL
              OR ${distanceKmSql('u.lat', 'u.lng', '$2::double precision', '$3::double precision')}
                 <= u.notify_radius_km
            )`,
        [[A, B, D], groupPoint?.lat ?? null, groupPoint?.lng ?? null]
      );
      return rows.map(r => r.id).sort();
    };

    it('drops a far-away group for a user with a radius, keeps a nearby one', async () => {
      // A: 50 km around Wien. B: unlimited. D: a radius but no coordinates.
      await db.query('UPDATE users SET lat=$2, lng=$3, notify_radius_km=50 WHERE id=$1', [A, WIEN.lat, WIEN.lng]);
      await db.query('UPDATE users SET lat=$2, lng=$3, notify_radius_km=NULL WHERE id=$1', [B, WIEN.lat, WIEN.lng]);
      await db.query('UPDATE users SET lat=NULL, lng=NULL, notify_radius_km=10 WHERE id=$1', [D]);

      // Bregenz: A is out. B has no limit, D cannot be measured → both stay.
      expect(await targeted(BREGENZ)).toEqual([B, D].sort());
      // Baden is 25 km away — everyone is in.
      expect(await targeted(BADEN)).toEqual([A, B, D].sort());
    });

    it('a group without a map pin still reaches everyone', async () => {
      // Geocoding fails often enough (Nominatim throttling) that muting those
      // groups would quietly cost real reach.
      expect(await targeted(null)).toEqual([A, B, D].sort());
    });

    it('the smallest radius still keeps the coordinate-less user', async () => {
      await db.query('UPDATE users SET notify_radius_km=10 WHERE id=$1', [A]);
      expect(await targeted(BREGENZ)).toEqual([B, D].sort());
      await db.query('UPDATE users SET notify_radius_km=NULL WHERE id=$1', [A]);
    });

    it('PUT /push/preferences stores a radius and rejects one off the list', async () => {
      const ok1 = await call(C.updatePushPreferences, { userId: A, body: { notify_radius_km: 25 } });
      ok(ok1);
      expect(ok1.body.notify_radius_km).toBe(25);

      // '' is how the picker says „Überall".
      const ok2 = await call(C.updatePushPreferences, { userId: A, body: { notify_radius_km: '' } });
      ok(ok2);
      expect(ok2.body.notify_radius_km).toBeNull();

      for (const bad of [7, 5000, -1, 'weit']) {
        const res = await call(C.updatePushPreferences, { userId: A, body: { notify_radius_km: bad } });
        expect(res.statusCode, String(bad)).toBe(400);
      }
      // A bad radius must not smuggle the boolean toggles through either.
      const mixed = await call(C.updatePushPreferences, {
        userId: A, body: { push_reminders: false, notify_radius_km: 3 } });
      expect(mixed.statusCode).toBe(400);
      const row = await db.query('SELECT push_reminders FROM users WHERE id=$1', [A]);
      expect(row.rows[0].push_reminders).not.toBe(false);
    });

    it('changing the profile city clears the coordinates so they get re-geocoded', async () => {
      // Otherwise someone who moves keeps having their Umkreis measured from
      // the city they left.
      await db.query('UPDATE users SET lat=$2, lng=$3 WHERE id=$1', [B, WIEN.lat, WIEN.lng]);
      ok(await call(C.updateProfile, { userId: B, body: { location: 'Graz', avatar_url: avatar } }));
      const after = await db.query('SELECT lat, lng, country FROM users WHERE id=$1', [B]);
      expect(after.rows[0].lat).toBeNull();
      expect(after.rows[0].lng).toBeNull();
      expect(after.rows[0].country).toBeNull();
    });

    it('saving the profile WITHOUT touching the city keeps the coordinates', async () => {
      await db.query('UPDATE users SET lat=$2, lng=$3 WHERE id=$1', [B, WIEN.lat, WIEN.lng]);
      ok(await call(C.updateProfile, { userId: B, body: { bio: 'nur die Bio', avatar_url: avatar } }));
      const after = await db.query('SELECT lat, lng FROM users WHERE id=$1', [B]);
      expect(Number(after.rows[0].lat)).toBeCloseTo(WIEN.lat, 4);
    });
  });

  // ── reports (reportController — window query + ON CONFLICT dedup) ────────
  it('createReport inserts; an IDENTICAL re-report is a silent no-op', async () => {
    ok(await call(C.createReport, { userId: B, body: {
      reported_type: 'user', reported_id: D, reason: 'spam', details: 'smoke' } }));
    const again = await call(C.createReport, { userId: B, body: {
      reported_type: 'user', reported_id: D, reason: 'spam', details: 'smoke' } });
    ok(again);
    expect(again.body.alreadyOpen).toBe(true);   // the client stops claiming success
    const r = await db.query(
      "SELECT COUNT(*)::int AS n FROM reports WHERE reporter_id=$1 AND reported_type='user' AND reported_id=$2",
      [B, D]);
    expect(r.rows[0].n).toBe(1);
  });

  it('re-reporting with NEW details updates the open report instead of dropping it', async () => {
    const res = await call(C.createReport, { userId: B, body: {
      reported_type: 'user', reported_id: D, reason: 'harassment', details: 'es wird schlimmer' } });
    ok(res);
    expect(res.body.alreadyOpen).toBeUndefined();   // treated as new evidence
    const r = await db.query(
      "SELECT reason, details FROM reports WHERE reporter_id=$1 AND reported_type='user' AND reported_id=$2",
      [B, D]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]).toMatchObject({ reason: 'harassment', details: 'es wird schlimmer' });
  });

  // Finding 12: the old UNIQUE was status-independent, so a resolved report
  // blocked that reporter from ever reporting that target again — silently,
  // while the app said "Meldung erfolgreich gesendet. Danke!".
  it('a RESOLVED report no longer blocks the same reporter from reporting again', async () => {
    const open = await db.query(
      "SELECT id FROM reports WHERE reporter_id=$1 AND reported_type='user' AND reported_id=$2", [B, D]);
    ok(await call(C.updateReportStatus, {
      userId: A, params: { id: String(open.rows[0].id) }, body: { status: 'resolved' } }));

    const res = await call(C.createReport, { userId: B, body: {
      reported_type: 'user', reported_id: D, reason: 'harassment', details: 'zweiter Vorfall Monate spaeter' } });
    ok(res);
    expect(res.body.alreadyOpen).toBeUndefined();

    const rows = await db.query(
      `SELECT status, details FROM reports
        WHERE reporter_id=$1 AND reported_type='user' AND reported_id=$2
        ORDER BY created_at`, [B, D]);
    expect(rows.rows.length).toBe(2);                      // the old one is kept as history
    expect(rows.rows.map(r => r.status).sort()).toEqual(['pending', 'resolved']);
    expect(rows.rows.some(r => r.details === 'zweiter Vorfall Monate spaeter')).toBe(true);
  });

  it('two DIFFERENT reporters can both have an open report on the same target', async () => {
    ok(await call(C.createReport, { userId: A, body: {
      reported_type: 'user', reported_id: D, reason: 'spam', details: 'auch mir aufgefallen' } }));
    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM reports
        WHERE reported_type='user' AND reported_id=$1 AND status='pending'`, [D]);
    expect(n.rows[0].n).toBe(2);
  });
  it('getReports serves the admin list (COUNT(*) OVER() window SQL)', async () => {
    const res = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '10', offset: '0' } });
    ok(res);
  });

  // ── report context resolution (2026-09-15) ──────────────────────────────
  // The report row is a polymorphic pointer with no FK, so resolving it is
  // three hand-written `= ANY($1)` queries against three different tables —
  // precisely the SQL a mocked db.query cannot judge. This is what turns the
  // admin alert from "user #984" into a name, an e-mail and a message body.
  it('getReports resolves each report target (user / group / message) with content', async () => {
    // A reported MESSAGE: the content has to survive into the admin list,
    // because the message is usually gone by the time anyone looks.
    const m = await db.query(
      `INSERT INTO messages (group_id, user_id, content) VALUES ($1,$2,$3) RETURNING id`,
      [groupId, B, 'Smoke: reported message body']
    );
    ok(await call(C.createReport, { userId: D, body: {
      reported_type: 'message', reported_id: m.rows[0].id, reason: 'harassment', details: 'Beleidigung im Chat' } }));
    ok(await call(C.createReport, { userId: D, body: {
      reported_type: 'group', reported_id: groupId, reason: 'inappropriate' } }));

    const res = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '50' } });
    ok(res);
    const byType = Object.fromEntries(res.body.reports.map(r => [r.reported_type, r]));

    // user report (filed by B against D earlier in this file)
    expect(byType.user?.target?.name).toBe('Dee');
    expect(byType.user?.target?.email).toBe('smoke-d@x.com');
    expect(byType.user?.target?.missing).toBe(false);

    // message report — content, author and chat all resolved
    expect(byType.message?.target?.content).toBe('Smoke: reported message body');
    expect(byType.message?.target?.author?.name).toBe('Bea');
    expect(byType.message?.target?.group?.id).toBe(groupId);
    expect(byType.message?.target?.path).toBe(`/chat/${groupId}`);
    // the reporter's own words must reach the admin — they were dropped
    // from the alert entirely before this change
    expect(byType.message?.details).toBe('Beleidigung im Chat');
    expect(byType.message?.reporter_name).toBe('Dee');

    // group report
    expect(byType.group?.target?.kind).toBe('group');
    expect(byType.group?.target?.owner?.name).toBe('Ann');

    // per-status queue sizes for the admin filter tabs. Every status key is
    // always present (zero-filled) so the UI can label all four tabs without
    // four extra round trips.
    expect(Object.keys(res.body.counts).sort())
      .toEqual(['dismissed', 'pending', 'resolved', 'reviewed']);
    expect(res.body.counts.pending).toBeGreaterThanOrEqual(3);
    expect(res.body.counts.pending).toBe(res.body.total);
  });

  it('a hard-deleted target resolves to missing instead of vanishing', async () => {
    // Moderation-relevant: "already gone" must be distinguishable from a hole
    // in the list. reports has no FK to messages, so the row outlives it.
    const m = await db.query(
      `INSERT INTO messages (group_id, user_id, content) VALUES ($1,$2,'to be deleted') RETURNING id`,
      [groupId, B]
    );
    const goneId = m.rows[0].id;
    ok(await call(C.createReport, { userId: B, body: {
      reported_type: 'message', reported_id: goneId, reason: 'spam' } }));
    await db.query('DELETE FROM messages WHERE id = $1', [goneId]);

    const res = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '50' } });
    const row = res.body.reports.find(r => r.reported_type === 'message' && r.reported_id === goneId);
    expect(row?.target?.missing).toBe(true);
    expect(row?.target?.path).toBe(null);
  });

  // ── Enforcement (audit 2026-09-15, finding 11) ─────────────────────────
  // The moderation queue could label a report but not act on it: the only
  // lever was an irreversible account hard-delete that did not even remove
  // the reported message.
  describe('moderation enforcement', () => {
    let modMsgId;

    it('an admin can remove any message; it soft-deletes and leaves the chat', async () => {
      const m = await db.query(
        `INSERT INTO messages (group_id, user_id, content) VALUES ($1,$2,$3) RETURNING id`,
        [groupId, B, 'Smoke: to be moderated']
      );
      modMsgId = m.rows[0].id;

      // A is an admin but neither the author (B) nor necessarily the owner.
      ok(await call(C.deleteMessage, { userId: A, params: { messageId: String(modMsgId) } }));

      // Soft: the row survives as evidence for any report filed against it...
      const row = await db.query('SELECT content, is_deleted FROM messages WHERE id=$1', [modMsgId]);
      expect(row.rows.length).toBe(1);
      expect(row.rows[0].is_deleted).toBe(true);
      expect(row.rows[0].content).toBe('Smoke: to be moderated');

      // ...but it is gone from the chat.
      const list = await call(C.getMessages, { userId: A, params: { groupId: String(groupId) }, query: {} });
      ok(list);
      const shown = Array.isArray(list.body) ? list.body : (list.body.messages || []);
      expect(shown.map(x => x.id)).not.toContain(modMsgId);
    });

    it('a soft-deleted message is still resolvable as report evidence', async () => {
      ok(await call(C.createReport, { userId: D, body: {
        reported_type: 'message', reported_id: modMsgId, reason: 'harassment' } }));
      const res = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '50' } });
      const row = res.body.reports.find(r => r.reported_type === 'message' && r.reported_id === modMsgId);
      expect(row?.target?.deleted).toBe(true);
      expect(row?.target?.content).toBe('Smoke: to be moderated');
    });

    it('deleting an already-deleted message 404s instead of double-acting', async () => {
      expect((await call(C.deleteMessage, { userId: A, params: { messageId: String(modMsgId) } })).statusCode).toBe(404);
    });

    it('a non-author non-owner non-admin still cannot delete', async () => {
      const m = await db.query(
        `INSERT INTO messages (group_id, user_id, content) VALUES ($1,$2,'mine') RETURNING id`,
        [groupId, A]);
      expect((await call(C.deleteMessage, { userId: B, params: { messageId: String(m.rows[0].id) } })).statusCode).toBe(403);
    });

    it('freezing an account is reversible and blocks nobody else', async () => {
      ok(await call(C.setUserActive, { userId: A, params: { id: String(D) }, body: { active: false } }));
      expect((await db.query('SELECT is_active FROM users WHERE id=$1', [D])).rows[0].is_active).toBe(false);
      // The report card must show the CURRENT state on load, not only after
      // the admin flips it in this session.
      const listed = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '50' } });
      const userRow = listed.body.reports.find(r => r.reported_type === 'user' && r.reported_id === D);
      expect(userRow?.target?.frozen).toBe(true);
      ok(await call(C.setUserActive, { userId: A, params: { id: String(D) }, body: { active: true } }));
      expect((await db.query('SELECT is_active FROM users WHERE id=$1', [D])).rows[0].is_active).toBe(true);
    });

    it('freeze refuses self-lockout, other admins and a non-boolean', async () => {
      expect((await call(C.setUserActive, { userId: A, params: { id: String(A) }, body: { active: false } })).statusCode).toBe(400);
      expect((await call(C.setUserActive, { userId: A, params: { id: String(D) }, body: { active: 'no' } })).statusCode).toBe(400);
      expect((await call(C.setUserActive, { userId: A, params: { id: '99999999' }, body: { active: false } })).statusCode).toBe(404);
    });

    // Tina 12.10.2026: a SpongeBob avatar — remove the picture instead of
    // deleting the account. The real-Postgres part is the jsonb filter that
    // drops the same URL from photos (the onboarding keeps the avatar there).
    it('removing a profile picture clears avatar_url, drops it from photos and notifies the person', async () => {
      const pic = '/media/uploads/spongebob.webp';
      const other = '/media/uploads/beach.webp';
      await db.query('UPDATE users SET avatar_url = $2, photos = $3::jsonb WHERE id = $1',
        [D, pic, JSON.stringify([pic, other])]);
      const res = await call(C.removeUserAvatar, { userId: A, params: { id: String(D) } });
      ok(res);
      const row = (await db.query('SELECT avatar_url, photos FROM users WHERE id = $1', [D])).rows[0];
      expect(row.avatar_url).toBeNull();
      expect(row.photos).toEqual([other]);
      // The notification is written fire-and-forget after the response.
      await vi.waitFor(async () => {
        const again = await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'avatar_removed'`, [D]);
        expect(again.rows.length).toBe(1);
      });
      // Nothing left to remove → 409, not a second notification.
      const twice = await call(C.removeUserAvatar, { userId: A, params: { id: String(D) } });
      expect(twice.statusCode).toBe(409);
      expect(twice.body.code).toBe('NO_AVATAR');
      expect((await call(C.removeUserAvatar, { userId: A, params: { id: '99999999' } })).statusCode).toBe(404);
      expect((await call(C.removeUserAvatar, { userId: A, params: { id: 'x' } })).statusCode).toBe(400);
    });

    // Hit for real on 2026-09-15: an admin looking at a reported group could
    // not remove it. deleteGroup was owner-only with no override, so the only
    // lever was hard-deleting the OWNER's account — irreversible, cascading,
    // and it does not even remove the group when it has other members.
    it('an admin can delete a group they do not own', async () => {
      const g = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date)
         VALUES ('Smoke Reported Group','group',$1,'Yoga','Wien',20, NOW() + INTERVAL '5 days') RETURNING id`,
        [B])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [g, B]);

      // A is an admin and NOT a member — the realistic moderation position.
      ok(await call(C.deleteGroup, { userId: A, params: { id: String(g) } }));
      const row = await db.query('SELECT deleted_at FROM groups WHERE id=$1', [g]);
      expect(row.rows[0].deleted_at).not.toBe(null);
      // Soft: chat and member history survive as evidence.
      const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1', [g]);
      expect(m.rows.length).toBeGreaterThan(0);
    });

    // The question a normal member will ask: can I delete the group I am in?
    // Only the owner and a PLATFORM admin may — "is_admin" on users, never
    // group_members.role, which is a club CO-MANAGER wearing the same word.
    it('a plain MEMBER cannot delete or cancel the group they are in', async () => {
      const g = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date)
         VALUES ('Smoke Member Perms','group',$1,'Yoga','Wien',20, NOW() + INTERVAL '5 days') RETURNING id`,
        [B])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
        [g, B, D]);

      // D is a member, not the owner, not a platform admin.
      expect((await db.query('SELECT is_admin FROM users WHERE id=$1', [D])).rows[0].is_admin).toBe(false);
      expect((await call(C.deleteGroup, { userId: D, params: { id: String(g) } })).statusCode).toBe(403);
      expect((await call(C.cancelGroup, { userId: D, params: { id: String(g) }, body: { reason: 'weil' } })).statusCode).toBe(403);
      const row = await db.query('SELECT deleted_at, is_active FROM groups WHERE id=$1', [g]);
      expect(row.rows[0].deleted_at).toBe(null);
      expect(row.rows[0].is_active).toBe(true);

      // ...and role='admin' in group_members (a club CO-MANAGER) is NOT the
      // platform admin flag — this is the confusable one.
      await db.query(`UPDATE group_members SET role = 'admin' WHERE group_id=$1 AND user_id=$2`, [g, D]);
      expect((await call(C.deleteGroup, { userId: D, params: { id: String(g) } })).statusCode).toBe(403);
      expect((await db.query('SELECT deleted_at FROM groups WHERE id=$1', [g])).rows[0].deleted_at).toBe(null);

      // The owner still can.
      ok(await call(C.deleteGroup, { userId: B, params: { id: String(g) } }));
    });

    it('a member cannot delete a CLUB either, but an admin can', async () => {
      const c = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, approval_status)
         VALUES ('Smoke Club Perms','club',$1,'Sport','Wien',50,'approved') RETURNING id`,
        [B])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'admin')`,
        [c, B, D]);

      // Co-manager: may edit and create events, may NOT delete the club.
      expect((await call(C.deleteClub, { userId: D, params: { id: String(c) } })).statusCode).toBe(403);
      // A is a platform admin and not a member — the takedown path.
      ok(await call(C.deleteClub, { userId: A, params: { id: String(c) } }));
      expect((await db.query('SELECT deleted_at FROM groups WHERE id=$1', [c])).rows[0].deleted_at).not.toBe(null);
    });

    it('a NON-admin still cannot delete someone else’s group', async () => {
      const g = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date)
         VALUES ('Smoke Someone Elses','group',$1,'Yoga','Wien',20, NOW() + INTERVAL '5 days') RETURNING id`,
        [A])).rows[0].id;
      expect((await call(C.deleteGroup, { userId: D, params: { id: String(g) } })).statusCode).toBe(403);
      expect((await db.query('SELECT deleted_at FROM groups WHERE id=$1', [g])).rows[0].deleted_at).toBe(null);
    });

    it('an APPROVED club can be taken down, not just a pending one', async () => {
      const club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, approval_status)
         VALUES ('Smoke Live Club','club',$1,'Sport','Wien',50,'approved') RETURNING id`, [B])).rows[0].id;
      const ev = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id)
         VALUES ('Smoke Live Club Event','event',$1,'Sport','Wien',20, NOW() + INTERVAL '2 days', $2) RETURNING id`,
        [B, club])).rows[0].id;

      const res = await call(C.rejectClub, { userId: A, params: { id: String(club) } });
      ok(res);
      expect(res.body.wasPending).toBe(false);   // it was live, not queued
      const after = await db.query('SELECT approval_status, is_active FROM groups WHERE id=$1', [club]);
      expect(after.rows[0]).toMatchObject({ approval_status: 'rejected', is_active: false });
      // ...and its events go down with it, not just out of the feeds.
      expect((await db.query('SELECT is_active FROM groups WHERE id=$1', [ev])).rows[0].is_active).toBe(false);
    });
  });

  it('updateReportStatus moves a report out of pending and back again', async () => {
    const first = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '1' } });
    const id = first.body.reports[0].id;

    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(id) }, body: { status: 'resolved' } }));
    const row = await db.query('SELECT status, reviewed_by, reviewed_at FROM reports WHERE id=$1', [id]);
    expect(row.rows[0].status).toBe('resolved');
    expect(row.rows[0].reviewed_by).toBe(A);
    expect(row.rows[0].reviewed_at).not.toBe(null);

    // Re-opening clears the reviewer stamp — otherwise a pending report would
    // still read as "Ann already handled this".
    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(id) }, body: { status: 'pending' } }));
    const back = await db.query('SELECT status, reviewed_by, reviewed_at FROM reports WHERE id=$1', [id]);
    expect(back.rows[0].status).toBe('pending');
    expect(back.rows[0].reviewed_by).toBe(null);
    expect(back.rows[0].reviewed_at).toBe(null);

    expect((await call(C.updateReportStatus, { userId: A, params: { id: String(id) }, body: { status: 'nope' } })).statusCode).toBe(400);

    // Re-opening an old report when the SAME reporter already has a newer
    // pending one against the same target collides with the partial unique
    // index. That must be a clear 409, not an opaque 500 that leaves the
    // moderation queue stuck.
    const dup = await db.query(
      `SELECT reporter_id, reported_type, reported_id FROM reports WHERE id = $1`, [id]);
    const { reporter_id, reported_type, reported_id } = dup.rows[0];
    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(id) }, body: { status: 'resolved' } }));
    const newer = await db.query(
      `INSERT INTO reports (reporter_id, reported_type, reported_id, reason, status)
       VALUES ($1,$2,$3,'spam','pending') RETURNING id`,
      [reporter_id, reported_type, reported_id]);
    const clash = await call(C.updateReportStatus, {
      userId: A, params: { id: String(id) }, body: { status: 'pending' } });
    expect(clash.statusCode, JSON.stringify(clash.body)).toBe(409);
    expect(clash.body.code).toBe('REPORT_ALREADY_OPEN');
    await db.query('DELETE FROM reports WHERE id = $1', [newer.rows[0].id]);
    // With the collision gone, re-opening works again.
    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(id) }, body: { status: 'pending' } }));
    expect((await call(C.updateReportStatus, { userId: A, params: { id: '99999999' }, body: { status: 'resolved' } })).statusCode).toBe(404);
  });

  it('resolving a report notifies the reporter ONCE — on the transition, not on dismiss or re-save (Tina 07.11.)', async () => {
    const first = await call(C.getReports, { userId: A, query: { limit: '5' } });
    const rep = first.body.reports[0];
    const ackCount = async () => (await db.query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND type = 'report_resolved'`,
      [rep.reporter_id])).rows[0].c;
    const settle = () => new Promise(r => setTimeout(r, 50)); // fire-and-forget chain
    await db.query(`DELETE FROM notifications WHERE user_id = $1 AND type = 'report_resolved'`, [rep.reporter_id]);

    // Dismiss → silence.
    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(rep.id) }, body: { status: 'dismissed' } }));
    await settle();
    expect(await ackCount()).toBe(0);

    // Resolve → exactly one ack row for the reporter.
    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(rep.id) }, body: { status: 'resolved' } }));
    await settle();
    expect(await ackCount()).toBe(1);

    // Re-saving "resolved" is not a transition → no second ping.
    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(rep.id) }, body: { status: 'resolved' } }));
    await settle();
    expect(await ackCount()).toBe(1);

    ok(await call(C.updateReportStatus, { userId: A, params: { id: String(rep.id) }, body: { status: 'pending' } }));
  });

  // Tina 07.11.2026: category pushes „2× im Monat". Immediate pushes and the
  // 18:00 digest share one budget per VIENNA calendar month. Time is injected
  // — never coupled to the real NOW().
  describe('category push monthly budget', () => {
    let budget;
    const NOV_3 = '2026-11-03T10:00:00+01:00';
    const NOV_20 = '2026-11-20T10:00:00+01:00';
    const DEC_1_VIENNA = '2026-11-30T23:30:00Z'; // 00:30 on 1 Dec in Vienna
    const state = async (uid) => (await db.query(
      'SELECT month_key::text AS mk, month_sent, pending_count FROM category_push_state WHERE user_id = $1', [uid])).rows[0];

    beforeAll(async () => {
      budget = await import('../../src/utils/categoryPushBudget.js');
    });
    beforeEach(async () => {
      await db.query('DELETE FROM category_push_state WHERE user_id IN ($1, $2)', [B, D]);
    });

    it('spends at most 2 immediate pushes per month; the third is refused', async () => {
      expect(await budget.claimImmediate([B], { now: NOV_3, cap: 2 })).toEqual([B]);
      expect(await budget.claimImmediate([B], { now: NOV_20, cap: 2 })).toEqual([B]);
      expect(await budget.claimImmediate([B], { now: NOV_20, cap: 2 })).toEqual([]);
      expect(await state(B)).toMatchObject({ mk: '2026-11-01', month_sent: 2 });
    });

    it('a new Vienna month resets the budget (UTC still says November)', async () => {
      await budget.claimImmediate([B], { now: NOV_3, cap: 2 });
      await budget.claimImmediate([B], { now: NOV_20, cap: 2 });
      expect(await budget.claimImmediate([B], { now: DEC_1_VIENNA, cap: 2 })).toEqual([B]);
      expect(await state(B)).toMatchObject({ mk: '2026-12-01', month_sent: 1 });
    });

    it('the digest spends from the same budget and skips users who are out of it', async () => {
      const sent = [];
      const send = (ids) => sent.push(...ids);
      // B: one immediate this month, then a suppressed match → digest allowed.
      await budget.claimImmediate([B], { now: NOV_3, cap: 2 });
      await budget.bumpPending([B], { now: NOV_3, cap: 2 });
      // D: budget already spent → the bump is not even recorded.
      await budget.claimImmediate([D], { now: NOV_3, cap: 2 });
      await budget.claimImmediate([D], { now: NOV_3, cap: 2 });
      await budget.bumpPending([D], { now: NOV_3, cap: 2 });
      expect((await state(D)).pending_count).toBe(0);

      expect(await budget.runCategoryDigest({ now: NOV_3, cap: 2, send })).toBe(1);
      expect(sent).toEqual([B]);
      expect(await state(B)).toMatchObject({ month_sent: 2, pending_count: 0 });

      // Budget spent → no further digest this month, pending is dropped.
      await db.query('UPDATE category_push_state SET pending_count = 3 WHERE user_id = $1', [B]);
      expect(await budget.runCategoryDigest({ now: NOV_20, cap: 2, send })).toBe(0);
      expect(await state(B)).toMatchObject({ month_sent: 2, pending_count: 0 });
    });
  });

  // Tina 07.11.2026: Friends — 5 requests per Vienna day for free accounts,
  // and „Von deinen letzten Events" suggestions for the ⊕ sheet.
  describe('friend requests: daily limit + suggestions', () => {
    let fr;
    const mk = async (tag, admin = false) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, is_admin)
       VALUES ($1, $2, '1996-04-04', 'female', $3, TRUE, 'email', $4) RETURNING id`,
      [`fr-${tag}-${Date.now()}@x.com`, `Fr ${tag}`, avatar, admin])).rows[0].id;
    const send = (from, to) => call(C.sendFriendRequest, { userId: from, body: { userId: to } });

    beforeAll(async () => {
      fr = await import('../../src/controllers/friendshipController.js');
    });

    it('a free account may ask 5 people per day; the 6th is refused with DAILY_FRIEND_LIMIT', async () => {
      const sender = await mk('sender');
      const targets = [];
      for (let i = 0; i < 6; i++) targets.push(await mk(`t${i}`));
      for (let i = 0; i < 5; i++) ok(await send(sender, targets[i]));
      const sixth = await send(sender, targets[5]);
      expect(sixth.statusCode).toBe(403);
      expect(sixth.body.code).toBe('DAILY_FRIEND_LIMIT');
      expect(sixth.body.limit).toBe(5);
      expect(sixth.body.error).not.toMatch(/Pro/);
      // No friendship row was written for the refused request.
      expect((await db.query(
        'SELECT 1 FROM friendships WHERE requester_id = $1 AND addressee_id = $2', [sender, targets[5]])).rowCount).toBe(0);
      // „Already pending" stays a free 400, never a limit refusal.
      expect((await send(sender, targets[0])).statusCode).toBe(400);
    });

    it('re-asking a person after a rejection reuses the row and counts once per day', async () => {
      const sender = await mk('reask');
      const target = await mk('reask-t');
      ok(await send(sender, target));
      await db.query(`UPDATE friendships SET status = 'rejected' WHERE requester_id = $1 AND addressee_id = $2`, [sender, target]);
      ok(await send(sender, target));
      const used = (await db.query(
        'SELECT COUNT(DISTINCT target_id)::int AS c FROM friend_request_log WHERE user_id = $1', [sender])).rows[0].c;
      expect(used).toBe(1);
    });

    it('app admins are not limited', async () => {
      const admin = await mk('admin', true);
      for (let i = 0; i < 6; i++) ok(await send(admin, await mk(`a${i}`)));
    });

    it('suggests co-members of recent past events — never friends, blocks or people who said no', async () => {
      const me = await mk('me');
      const pal = await mk('pal');        // was at my event → suggested
      const friend = await mk('friend');  // already a friend → hidden
      const nope = await mk('nope');      // rejected my request → hidden
      const blocked = await mk('blocked'); // blocked → hidden
      const asked = await mk('asked');    // open request from me → listed as pending_out
      const ev = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
         VALUES ('Spieleabend Test', 'group', NOW() - INTERVAL '3 days', $1, 'Spiele', 'Wien', 20) RETURNING id`,
        [me])).rows[0].id;
      for (const u of [me, pal, friend, nope, blocked, asked]) {
        await db.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
          [ev, u, u === me ? 'owner' : 'member']);
      }
      await db.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES
        ($1, $2, 'accepted'), ($1, $3, 'rejected'), ($1, $4, 'blocked'), ($1, $5, 'pending')`,
        [me, friend, nope, blocked, asked]);

      const res = await call(fr.getFriendSuggestions, { userId: me });
      ok(res);
      const byId = Object.fromEntries(res.body.map(r => [r.id, r]));
      expect(byId[pal]).toMatchObject({ event_name: 'Spieleabend Test', friend_status: 'none' });
      expect(byId[asked]).toMatchObject({ friend_status: 'pending_out' });
      expect(byId[friend]).toBeUndefined();
      expect(byId[nope]).toBeUndefined();
      expect(byId[blocked]).toBeUndefined();
      expect(byId[me]).toBeUndefined();
    });
  });

  // ── join / accept / kick (the FOR-UPDATE transaction cores) ──────────────
  // Pins the riskiest duplicated tx logic ahead of the planned extraction
  // into services/entityLifecycle.js (audit 2026-09-02, phase 6).
  let E, privateGroupId, joinReqId;
  it('joinGroup: public join lands in the capacity transaction', async () => {
    E = await (async () => {
      const r = await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-e@x.com','Eva','1998-05-05','female',$1, TRUE, 'email') RETURNING id`,
        [avatar]
      );
      return r.rows[0].id;
    })();
    ok(await call(C.joinGroup, { userId: E, params: { id: String(groupId) }, body: {} }));
    const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, E]);
    expect(m.rows.length).toBe(1);
    // Churn counter bumped exactly once by the tx.
    const jc = await db.query('SELECT join_count FROM group_join_counts WHERE group_id=$1 AND user_id=$2', [groupId, E]);
    expect(jc.rows[0]?.join_count).toBe(1);
  });
  it('joinGroup on a private group files a join request instead', async () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const created = await call(C.createGroup, { userId: A, body: {
      name: 'Private Smoke', description: 'x', type: 'group', category: 'Sport',
      date: future, time: '19:00', location: 'Wien', max_members: 8, is_private: true } });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
    privateGroupId = created.body.id;
    noServerError(await call(C.joinGroup, { userId: E, params: { id: String(privateGroupId) }, body: { message: 'darf ich?' } }));
    const r = await db.query(
      "SELECT id, status FROM group_join_requests WHERE group_id=$1 AND user_id=$2", [privateGroupId, E]);
    expect(r.rows[0]?.status).toBe('pending');
    joinReqId = r.rows[0].id;
  });
  // The owner is a stranger to the asker: the request shows the age, never
  // the birth date (sign-up: „dein Geburtsdatum nicht“, 2026-10).
  it('join-request payloads carry the age but no birth date', async () => {
    const noDob = (row) => {
      expect(row).not.toHaveProperty('user_dob');
      expect(row).not.toHaveProperty('date_of_birth');
      // created_at / updated_at are the request's own timestamps; no OTHER
      // value may be a date under some new alias (DATE columns come back as
      // 'YYYY-MM-DD' strings — database.js pins OID 1082). group_date is let
      // through deliberately (deck band, 16.11.2026): it is the EVENT's date,
      // not a birth date — the asker's age stays the only thing about them.
      const { created_at, updated_at, group_date, ...rest } = row;  // eslint-disable-line no-unused-vars
      for (const [k, v] of Object.entries(rest)) {
        expect(v instanceof Date, k).toBe(false);
        if (typeof v === 'string') expect(v, k).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    };
    const one = await call(C.getJoinRequests, { userId: A, params: { id: String(privateGroupId) } });
    ok(one);
    const mine = one.body.find(x => x.user_id === E);
    expect(mine.user_age).toEqual(expect.any(Number));
    noDob(mine);
    const deck = await call(C.getAllJoinRequests, { userId: A });
    ok(deck);
    const card = deck.body.find(x => x.user_id === E);
    expect(card.user_age).toBe(mine.user_age);
    noDob(card);
  });
  it('handleJoinRequest accept runs the capacity-checked tx and adds the member', async () => {
    ok(await call(C.handleJoinRequest, {
      userId: A, params: { id: String(privateGroupId), requestId: String(joinReqId) }, body: { action: 'accept' } }));
    const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [privateGroupId, E]);
    expect(m.rows.length).toBe(1);
  });
  it('kickMember (owner) removes the member again', async () => {
    ok(await call(C.kickMember, { userId: A, params: { id: String(privateGroupId), userId: String(E) } }));
    const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [privateGroupId, E]);
    expect(m.rows.length).toBe(0);
  });

  // ── Gruppen feed: club events, public clubs only ───────────────────────────
  // Tobi 2026-09-04: "nur events von öffentlichen clubs bei gruppen". The gate
  // is a live parent-club lookup in getGroups, so it needs a real database —
  // a mocked db.query would happily "pass" a broken EXISTS subquery.
  it('include_club_events adds PUBLIC club events to the Gruppen feed and never private ones', async () => {
    const mkClub = async (name, isPrivate) => {
      const r = await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status)
         VALUES ($1,'club',$2,'Sport','Wien',100,$3,'approved') RETURNING id`,
        [name, A, isPrivate]
      );
      return r.rows[0].id;
    };
    const mkEvent = async (name, clubId, isPrivate) => {
      const r = await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, is_private)
         VALUES ($1,'event',$2,'Sport','Wien',20, NOW() + INTERVAL '3 days', $3, $4) RETURNING id`,
        [name, A, clubId, isPrivate]
      );
      return r.rows[0].id;
    };
    const publicClub  = await mkClub('Smoke Public Club', false);
    const privateClub = await mkClub('Smoke Private Club', true);
    const publicEvent  = await mkEvent('Smoke Public Event', publicClub, false);
    const privateEvent = await mkEvent('Smoke Private Event', privateClub, true);

    const idsOf = async (query) => {
      const res = await call(C.getGroups, { userId: B, query });
      ok(res);
      return res.body.map(r => r.id);
    };

    const withEvents = await idsOf({ type: 'group', upcoming: 'true', include_club_events: 'true' });
    expect(withEvents).toContain(publicEvent);
    expect(withEvents).not.toContain(privateEvent);

    // Without the flag the feed stays groups-only — the other callers of this
    // route (groups.getAll) must not start seeing events.
    const withoutEvents = await idsOf({ type: 'group', upcoming: 'true' });
    expect(withoutEvents).not.toContain(publicEvent);
    expect(withoutEvents).not.toContain(privateEvent);

    // A club that flips to private takes its already-created events out of the
    // feed with it: the gate reads the club's CURRENT flag, not the copy
    // createClubEvent stamped onto the event row. (updateClub busts this same
    // cache prefix in production — do it here too, or the 30s-cached response
    // above answers the query and the assertion proves nothing.)
    await db.query('UPDATE groups SET is_private = TRUE WHERE id = $1', [publicClub]);
    const { invalidatePrefix } = await import('../../src/utils/cache.js');
    invalidatePrefix('groups:');
    const afterFlip = await idsOf({ type: 'group', upcoming: 'true', include_club_events: 'true' });
    expect(afterFlip).not.toContain(publicEvent);
  });

  // ── Club-Gate: approval/liveness is judged on the LIVE parent club ──────
  // (audit 2026-09-15, findings 1/3/4/10). All four are pure SQL predicates or
  // a request-body guard — exactly what a mocked db.query cannot judge.
  describe('club approval gate', () => {
    // A dedicated owner, NOT A: A is near the 10-groups-per-24h create cap by
    // this point in the suite, and the friend-feed cases further down assert
    // that B is A's ONLY accepted friend — an invite fixture hung off A would
    // break both.
    let gateOwner, pendingClub, pendingEvent, privClub, privEvent, outsider;

    it('seed: a PENDING club with an event, and a PRIVATE approved club with an event', async () => {
      const mkUser = async (email, name) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ($1,$2,'1994-01-01','male',$3, TRUE, 'email') RETURNING id`,
        [email, name, avatar])).rows[0].id;
      gateOwner = await mkUser('smoke-gate@x.com', 'Gustav');

      const mk = async (name, approval, isPrivate) => (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, lat, lng)
         VALUES ($1,'club',$2,'Sport','Wien',100,$3,$4,48.2,16.37) RETURNING id`,
        [name, gateOwner, isPrivate, approval])).rows[0].id;
      const mkEv = async (name, clubId, isPrivate) => (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, is_private, lat, lng)
         VALUES ($1,'event',$2,'Sport','Wien',20, NOW() + INTERVAL '3 days', $3, $4, 48.2, 16.37) RETURNING id`,
        [name, gateOwner, clubId, isPrivate])).rows[0].id;

      pendingClub = await mk('Gate Pending Club', 'pending', false);
      pendingEvent = await mkEv('Gate Pending Event', pendingClub, false);
      privClub  = await mk('Gate Private Club', 'approved', true);
      privEvent = await mkEv('Gate Private Event', privClub, true);

      outsider = await mkUser('smoke-out@x.com', 'Otto');
      // gateOwner owns the club and is therefore a member of it; outsider must
      // be their friend so the invite reaches the CLUB gate rather than
      // stopping at the friendship check before it.
      await db.query(
        `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,'accepted')`,
        [gateOwner, outsider]);
      // The club owner is a member of the club, but createClub's membership row
      // is not created by a raw INSERT — add it so the private-club gate sees
      // gateOwner as a member and the "member can be invited" case is real.
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
        [privClub, gateOwner]);
    });

    it('createGroup refuses type:"club" and type:"event" (finding 1)', async () => {
      const before = await db.query(`SELECT COUNT(*)::int n FROM groups WHERE type='club'`);
      for (const t of ['club', 'event']) {
        const res = await call(C.createGroup, { userId: gateOwner, body: {
          name: `Sneaky ${t}`, description: 'x', type: t, category: 'Sport',
          location: 'Wien', max_members: 20 } });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(400);
      }
      const after = await db.query(`SELECT COUNT(*)::int n FROM groups WHERE type='club'`);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('a genuine group still writes approval_status explicitly', async () => {
      const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
      const res = await call(C.createGroup, { userId: gateOwner, body: {
        name: 'Gate Normal Group', description: 'x', type: 'group', category: 'Sport',
        date: future, time: '18:00', location: 'Wien', max_members: 8 } });
      expect(res.statusCode).toBe(201);
      const r = await db.query('SELECT type, approval_status FROM groups WHERE id=$1', [res.body.id]);
      expect(r.rows[0]).toMatchObject({ type: 'group', approval_status: 'approved' });
    });

    it('Discover-Events hides a pending club event, keeps a private club event (finding 3)', async () => {
      const { invalidatePrefix } = await import('../../src/utils/cache.js');
      invalidatePrefix('discover_events');
      const res = await call(C.getDiscoverEvents, { userId: B, query: {} });
      ok(res);
      const ids = res.body.map(e => e.id);
      expect(ids).not.toContain(pendingEvent);
      // Robert 2026-06-17: private clubs' events DO belong in this feed.
      expect(ids).toContain(privEvent);
    });

    it('the public map hides both (finding 10 — requirePublic)', async () => {
      const { invalidatePrefix } = await import('../../src/utils/cache.js');
      invalidatePrefix('map:');
      const res = await call(C.getMapPins, { userId: B, query: {} });
      ok(res);
      const pins = Array.isArray(res.body) ? res.body : (res.body.pins || []);
      const ids = pins.map(p => p.id);
      expect(ids).not.toContain(pendingEvent);
      expect(ids).not.toContain(privEvent);
    });

    it('inviteMember cannot walk a non-member into a private club event (finding 4)', async () => {
      const res = await call(C.inviteMember, {
        userId: gateOwner, params: { id: String(privEvent), friendId: String(outsider) } });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
      expect(res.body.code).toBe('CLUB_MEMBERS_ONLY');
      const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [privEvent, outsider]);
      expect(m.rows.length).toBe(0);
    });

    it('an event whose club was deleted is no longer joinable (finding 24)', async () => {
      // The app never hard-deletes, so the ON DELETE CASCADE on parent_club_id
      // never fires: the event row survives its club and used to stay joinable
      // by anyone holding an old share link.
      const liveClub = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status)
         VALUES ('Gate Doomed Club','club',$1,'Sport','Wien',100,FALSE,'approved') RETURNING id`,
        [gateOwner])).rows[0].id;
      const ev = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, is_private)
         VALUES ('Gate Doomed Event','event',$1,'Sport','Wien',20, NOW() + INTERVAL '2 days', $2, FALSE) RETURNING id`,
        [gateOwner, liveClub])).rows[0].id;

      // Public club, public event: joinable while the club lives.
      ok(await call(C.joinGroup, { userId: outsider, params: { id: String(ev) }, body: {} }));
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [ev, outsider]);

      // deleteClub's actual effect: a soft delete on the CLUB row only.
      await db.query('UPDATE groups SET deleted_at = NOW(), is_active = FALSE WHERE id = $1', [liveClub]);

      const res = await call(C.joinGroup, { userId: outsider, params: { id: String(ev) }, body: {} });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
      expect(res.body.code).toBe('CLUB_GONE');

      // ...and the detail page says so instead of 404ing members out of their chat.
      const detail = await call(C.getGroupById, { userId: outsider, params: { id: String(ev) } });
      ok(detail);
      expect(detail.body.parent_club_gone).toBe(true);

      // ...and the reminder cron stops pushing for it. Claim window is the
      // evening before; assert the event is simply not among the candidates.
      const claimed = await C.runEventReminders({
        now: new Date(Date.now() + 24 * 3600e3), limit: 200 });
      expect(claimed).toBeTruthy();
      const marker = await db.query('SELECT reminder_day_sent_for FROM groups WHERE id=$1', [ev]);
      expect(marker.rows[0].reminder_day_sent_for).toBe(null);
    });

    // ── Private events in a PUBLIC club (Tina 30.09.2026) ──────────────────
    // Private = join by request, the host approves. A private CLUB's events
    // keep the 08-03 rule: club membership is the gate, members join directly.
    it('public club: is_private event → join is a request, host accepts', async () => {
      const pubClub = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, lat, lng)
         VALUES ('Priv-Ev Public Club','club',$1,'Sport','Wien',100,FALSE,'approved',48.2,16.37) RETURNING id`,
        [gateOwner])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [pubClub, gateOwner]);
      const day = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);

      const privRes = await call(C.createClubEvent, { userId: gateOwner, params: { id: String(pubClub) },
        body: { name: 'Geheimer Spieleabend', date: day, time: '19:00', is_private: true } });
      expect(privRes.statusCode, JSON.stringify(privRes.body)).toBe(201);
      expect(privRes.body.is_private).toBe(true);
      const privEv = privRes.body.id;

      const pubRes = await call(C.createClubEvent, { userId: gateOwner, params: { id: String(pubClub) },
        body: { name: 'Offener Spieleabend', date: day, time: '19:00' } });
      expect(pubRes.statusCode).toBe(201);
      expect(pubRes.body.is_private).toBe(false);

      // Detail page tells the outsider the button sends a request.
      const d = await call(C.getGroupById, { userId: outsider, params: { id: String(privEv) } });
      ok(d);
      expect(d.body.joins_by_request).toBe(true);
      expect(d.body.parent_club_private).toBe(false);

      const j = await call(C.joinGroup, { userId: outsider, params: { id: String(privEv) }, body: {} });
      ok(j);
      expect(j.body.status).toBe('pending');
      const notYet = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [privEv, outsider]);
      expect(notYet.rows.length).toBe(0);

      const owner = await call(C.getGroupById, { userId: gateOwner, params: { id: String(privEv) } });
      expect(owner.body.pending_request_count).toBe(1);
      const req = await db.query('SELECT id FROM group_join_requests WHERE group_id=$1 AND user_id=$2', [privEv, outsider]);
      ok(await call(C.handleJoinRequest, { userId: gateOwner,
        params: { id: String(privEv), requestId: String(req.rows[0].id) }, body: { action: 'accept' } }));
      const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [privEv, outsider]);
      expect(m.rows.length).toBe(1);

      // The public sibling still joins instantly.
      const jp = await call(C.joinGroup, { userId: outsider, params: { id: String(pubRes.body.id) }, body: {} });
      ok(jp);
      expect(jp.body.status).not.toBe('pending');

      // updateClubEvent flips it public → the next outsider walks straight in.
      ok(await call(C.updateClubEvent, { userId: gateOwner,
        params: { id: String(pubClub), eventId: String(privEv) }, body: { is_private: false } }));
      const flipped = await db.query('SELECT is_private FROM groups WHERE id=$1', [privEv]);
      expect(flipped.rows[0].is_private).toBe(false);
      const bad = await call(C.updateClubEvent, { userId: gateOwner,
        params: { id: String(pubClub), eventId: String(privEv) }, body: { is_private: 'yes' } });
      expect(bad.statusCode).toBe(400);
    });

    it('private club: events stay private and members still join directly', async () => {
      const day = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
      const res = await call(C.createClubEvent, { userId: gateOwner, params: { id: String(privClub) },
        body: { name: 'Clubabend', date: day, time: '20:00', is_private: false } });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
      expect(res.body.is_private).toBe(true); // inherited, client can't opt out
      ok(await call(C.updateClubEvent, { userId: gateOwner,
        params: { id: String(privClub), eventId: String(res.body.id) }, body: { is_private: false } }));
      const still = await db.query('SELECT is_private FROM groups WHERE id=$1', [res.body.id]);
      expect(still.rows[0].is_private).toBe(true);

      // A club member joins the event directly — no per-event request.
      const member = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-privmember@x.com','Paula','1996-01-01','female',$1, TRUE, 'email') RETURNING id`,
        [avatar])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [privClub, member]);
      const d = await call(C.getGroupById, { userId: member, params: { id: String(res.body.id) } });
      expect(d.body.joins_by_request).toBe(false);
      const j = await call(C.joinGroup, { userId: member, params: { id: String(res.body.id) }, body: {} });
      ok(j);
      expect(j.body.status).not.toBe('pending');
      const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [res.body.id, member]);
      expect(m.rows.length).toBe(1);
    });

    it('...but a club MEMBER can still be invited to the same event', async () => {
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
        [privClub, outsider]);
      ok(await call(C.inviteMember, {
        userId: gateOwner, params: { id: String(privEvent), friendId: String(outsider) } }));
      const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [privEvent, outsider]);
      expect(m.rows.length).toBe(1);
    });
  });

  // ── Gruppen feed: "Heute & Morgen" first (Tobi 2026-09-15) ───────────────
  // The bucket is Vienna-local date arithmetic over a naive TIMESTAMP, plus a
  // week-rollforward for recurring groups — SQL a mocked db.query would
  // happily accept while Postgres rejected or mis-ordered it. It also has to
  // stay a SERVER-side sort: the feed is LIMIT-ed, so an imminent group that
  // ranks below `created_at DESC` never reaches the client to be re-sorted.
  it('orders groups happening today/tomorrow above everything else', async () => {
    const mk = async (name, dateSql, recurring = false) => {
      const r = await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, is_recurring_weekly)
         VALUES ($1,'group',$2,'Sport','Wien',20, ${dateSql}, $3) RETURNING id`,
        [name, A, recurring]
      );
      return r.rows[0].id;
    };
    // Vienna-local "now", so the fixtures land on the same calendar day the
    // SQL bucket computes — not the container's UTC day.
    const vienna = `(NOW() AT TIME ZONE 'Europe/Vienna')`;
    // Created LAST but happening far out: under the old pure created_at order
    // this sat on top of everything.
    const farFuture = await mk('Smoke Far Future', `${vienna} + INTERVAL '30 days'`);
    const tomorrow  = await mk('Smoke Tomorrow',   `date_trunc('day', ${vienna}) + INTERVAL '1 day 19 hours'`);
    const today     = await mk('Smoke Today',      `date_trunc('day', ${vienna}) + INTERVAL '20 hours'`);
    // Weekly recurring whose STORED date is 3 weeks in the past but whose next
    // occurrence is minutes away — the card badges it "Heute", so the feed must
    // too. Anchored to NOW, not to 20:00: a fixed hour turned the test red every
    // evening once 20:00 had passed (the next occurrence moved to next week —
    // 12.10.2026). Run just before midnight, the occurrence lands tomorrow,
    // which is still the imminent bucket.
    const weekly    = await mk('Smoke Weekly Today', `${vienna} + INTERVAL '5 minutes' - INTERVAL '21 days'`, true);
    const undated   = await mk('Smoke Undated', 'NULL');

    const { invalidatePrefix } = await import('../../src/utils/cache.js');
    invalidatePrefix('groups:');
    const res = await call(C.getGroups, { userId: B, query: { type: 'group', upcoming: 'true' } });
    ok(res);
    const ids = res.body.map(r => r.id);
    const at = (id) => ids.indexOf(id);

    // All five are in the feed (an undated group is ongoing, not past).
    for (const id of [farFuture, tomorrow, today, weekly, undated]) expect(at(id)).toBeGreaterThanOrEqual(0);

    // The imminent block leads, and sorts soonest-first inside itself.
    expect(at(today)).toBeLessThan(at(tomorrow));
    expect(at(tomorrow)).toBeLessThan(at(farFuture));
    // …and it beats a NEWER group that is not imminent — the whole point.
    expect(at(tomorrow)).toBeLessThan(at(undated));
    // Recurring group rolled forward to today counts as imminent.
    expect(at(weekly)).toBeLessThan(at(farFuture));
    expect(res.body.find(r => r.id === weekly).is_imminent).toBe(1);
    // An undated group is explicitly NOT pinned to the top.
    expect(res.body.find(r => r.id === undated).is_imminent).toBe(0);
    expect(res.body.find(r => r.id === farFuture).is_imminent).toBe(0);
  });

  // ── Batch 1 (2026-09-06): push preferences, event reminders, friend feed ──
  // Three new pieces of backend code whose SQL is time-zone arithmetic and
  // atomic UPDATE … RETURNING claims — exactly what a mocked db.query cannot
  // judge. Push DELIVERY is a no-op here (no VAPID/APNs env), so every case
  // asserts return values and DB state, never delivery.
  //
  // Clock facts used below: September 2026 is CEST (UTC+2), so 16:30Z = 18:30
  // Vienna. groups.date is a NAIVE timestamp holding Vienna wall-clock; the
  // job turns it into an instant via AT TIME ZONE 'Europe/Vienna'. Windows are
  // half-open [from, to) — the `to` side uses a strict `>`.
  describe('push preferences, event reminders, friend activity', () => {
    const naive = (col) => `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS')`;
    const markers = async (id) => {
      const r = await db.query(
        `SELECT ${naive('reminder_day_sent_for')} AS day, ${naive('reminder_hour_sent_for')} AS hour,
                ${naive('owner_nudge_sent_for')} AS nudge, members_count
         FROM groups WHERE id = $1`, [id]);
      return r.rows[0];
    };
    // Raw seed, mirroring createEntityWithOwner: the owner is a group_members
    // row too, so members_count (schema.sql trigger) INCLUDES the owner.
    const mkGroup = async (name, { type = 'group', owner = A, date = null, members = [],
      isActive = true, recurring = false, isPrivate = false } = {}) => {
      // created_at is PINNED before every simulated tick. With the DB default
      // (real NOW()) the owner-nudge rule `created_at < now - 6h` compared the
      // real clock against the injected 2026-09-23 tick: the suite went red for
      // good once the real date passed that tick (23.09.2026). Tests that need
      // a "too new" group set created_at themselves (see the 6-hour test).
      const r = await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date,
                             is_active, is_recurring_weekly, is_private, created_at)
         VALUES ($1,$2,$3,'Sport','Wien',10,$4::timestamp,$5,$6,$7,'2026-09-01 00:00:00') RETURNING id`,
        [name, type, owner, date, isActive, recurring, isPrivate]);
      const id = r.rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [id, owner]);
      for (const uid of members) {
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [id, uid]);
      }
      // Batch 3: these are REMINDER-block events — stamp the review marker so the
      // post-event review nudge (a 4th trigger) never fires for them and inflates
      // the exact counts below. The dedicated review test raw-inserts its own
      // event with a NULL review marker.
      if (date) await db.query('UPDATE groups SET review_nudge_sent_for = date WHERE id = $1', [id]);
      return id;
    };
    const tick = (iso) => C.runEventReminders({ now: new Date(iso) });

    // ── A. updatePushPreferences (pushController) ────────────────────────────
    it('updatePushPreferences writes only the keys sent and returns the whole set', async () => {
      const res = await call(C.updatePushPreferences, { userId: A, body: { push_reminders: false } });
      ok(res);
      // notify_radius_km joined this payload with the Umkreis feature
      // (2026-09-18). It rides the same endpoint because it IS a notification
      // preference and sits next to these toggles in Settings — the response
      // stays the full set so the client can merge one object onto `user`.
      expect(res.body).toEqual({
        push_reminders: false, push_friends: true, push_recommendations: false,
        notify_radius_km: null,
      });
    });
    it('getProfile carries the new columns (SAFE_USER_COLS)', async () => {
      const res = await call(C.getProfile, { userId: A });
      ok(res);
      expect(res.body.push_reminders).toBe(false);
      expect(res.body.push_friends).toBe(true);
      expect(res.body.push_recommendations).toBe(false);
    });
    it('updatePushPreferences: guest → 403, non-boolean value → 400 (nothing written)', async () => {
      // `call` never sets req.isGuest — build the guest request by hand.
      const guest = makeRes();
      await C.updatePushPreferences({ userId: 0, isGuest: true, body: { push_reminders: false }, app: fakeApp }, guest, () => {});
      expect(guest.statusCode).toBe(403);
      const bad = await call(C.updatePushPreferences, { userId: A, body: { push_reminders: 'true' } });
      expect(bad.statusCode).toBe(400);
      const r = await db.query('SELECT push_reminders FROM users WHERE id = $1', [A]);
      expect(r.rows[0].push_reminders).toBe(false);
    });
    it('updatePushPreferences turns A back on (the reminder cases below count A as a recipient)', async () => {
      const res = await call(C.updatePushPreferences, { userId: A, body: { push_reminders: true } });
      ok(res);
      expect(res.body.push_reminders).toBe(true);
    });

    // ── B. runEventReminders (jobs/eventReminders) ───────────────────────────
    let G1, G2, K1, G3, G4, G5, G6, G7;
    it('seed: timed group, all-day group, club, inactive, weekly — and pre-claim every earlier row', async () => {
      // Every group the suite created so far is dated RELATIVE to the wall
      // clock (NOW() ± n days), so on some run dates one of them would fall
      // into a fixed window below and inflate the counts. Stamping marker =
      // date is the job's own "already sent for this date" state → they are
      // skipped and the counts are exact on any run date.
      await db.query(`UPDATE groups SET reminder_day_sent_for = date, reminder_hour_sent_for = date,
                                        owner_nudge_sent_for = date, review_nudge_sent_for = date WHERE date IS NOT NULL`);
      G1 = await mkGroup('Rem Timed',    { date: '2026-09-20 19:00:00', members: [B] });
      G2 = await mkGroup('Rem AllDay',   { date: '2026-09-21 00:00:00', members: [B] });
      K1 = await mkGroup('Rem Club',     { date: '2026-09-20 19:00:00', members: [B], type: 'club' });
      G3 = await mkGroup('Rem Inactive', { date: '2026-09-20 19:00:00', members: [B], isActive: false });
      G4 = await mkGroup('Rem Weekly',   { date: '2026-09-20 19:00:00', members: [B], recurring: true });
      expect((await markers(G1)).members_count).toBe(2);
    });
    it('D-1 18:30 Vienna: day-before claims the timed group; all-day not yet; club/inactive/weekly never', async () => {
      // 2026-09-19T16:30Z = 18:30 CEST Sep 19.
      //   G1 (Sep 20 19:00): day window [Sep 19 18:00, Sep 20 00:00) Vienna = [16:00Z, 22:00Z) → in.
      //   G2 (Sep 21 00:00): day window opens Sep 20 18:00 Vienna → not yet.
      //   G2 owner nudge:   [Sep 19 11:00, Sep 20 00:00) Vienna, 1 other, not full → fires NOW.
      //   G1 owner nudge:   [Sep 18 11:00, Sep 19 00:00) → already over (and 1 other — it simply never got one).
      // pushes = G1 day → A + B (2) + G2 nudge → owner A (1).
      const r = await tick('2026-09-19T16:30:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 1, reviewNudge: 0, pushes: 3 });
      expect((await markers(G1)).day).toBe('2026-09-20 19:00:00');
      expect((await markers(G2)).nudge).toBe('2026-09-21 00:00:00');
      for (const id of [G2, K1, G3, G4]) expect((await markers(id)).day, `day marker of ${id}`).toBeNull();
      for (const id of [G1, K1, G3, G4]) expect((await markers(id)).nudge, `nudge marker of ${id}`).toBeNull();
    });
    it('same tick again → nothing (marker = date is the idempotency key)', async () => {
      expect(await tick('2026-09-19T16:30:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
    });
    it('D-day 18:30 Vienna: all-day group gets its day-before (muted member skipped); 30 min before is OUTSIDE the hour window', async () => {
      await db.query('UPDATE group_members SET notifications_muted = TRUE WHERE group_id = $1 AND user_id = $2', [G2, B]);
      // 2026-09-20T16:30Z = 18:30 CEST Sep 20.
      //   G2 day window [Sep 20 18:00, Sep 21 00:00) Vienna = [16:00Z, 22:00Z) → in; recipients A only (B muted).
      //   G1 hour window = start 17:00Z − [60, 30) min = [16:00Z, 16:30Z): the upper bound is a strict `>`,
      //   so exactly 30 min before (16:30Z) is EXCLUDED.
      const r = await tick('2026-09-20T16:30:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 1 });
      expect((await markers(G2)).day).toBe('2026-09-21 00:00:00');
      expect((await markers(G1)).hour).toBeNull();
    });
    it('D-day 18:15 Vienna (45 min before): hour-before claims the timed group; recipients A + B', async () => {
      // 2026-09-20T16:15Z = 18:15 CEST → inside [16:00Z, 16:30Z). Ticks are injected, so probing the
      // boundary first and the interior second is fine — the claim only cares about marker <> date.
      const r = await tick('2026-09-20T16:15:00Z');
      expect(r).toEqual({ dayBefore: 0, hourBefore: 1, ownerNudge: 0, reviewNudge: 0, pushes: 2 });
      expect((await markers(G1)).hour).toBe('2026-09-20 19:00:00');
      expect((await markers(G2)).hour).toBeNull();
    });
    it('all-day group never gets an hour-before, even 45 min before its midnight', async () => {
      // 2026-09-20T21:15Z = 23:15 CEST Sep 20. If G2's 00:00 were treated as a real start (22:00Z),
      // its hour window would be [21:00Z, 21:30Z) and 21:15Z would be inside — the `date::time <> '00:00'`
      // guard is the only thing keeping it out.
      expect(await tick('2026-09-20T21:15:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
      expect((await markers(G2)).hour).toBeNull();
    });
    it('owner nudge at 12:00 Vienna on D-2: lonely owner yes; opted-out owner no; 3 others no', async () => {
      await db.query('UPDATE users SET push_reminders = FALSE WHERE id = $1', [D]);
      const F = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-f@x.com','Fay','1997-07-07','female',$1, TRUE, 'email') RETURNING id`, [avatar])).rows[0].id;
      G5 = await mkGroup('Nudge Lonely',   { date: '2026-09-25 19:00:00' });
      G6 = await mkGroup('Nudge OptedOut', { date: '2026-09-25 19:00:00', owner: D });
      G7 = await mkGroup('Nudge Busy',     { date: '2026-09-25 19:00:00', members: [B, D, F] });
      expect((await markers(G7)).members_count).toBe(4);
      // 2026-09-23T10:00Z = 12:00 CEST Sep 23: nudge window [Sep 23 11:00, Sep 24 00:00) Vienna = [09:00Z, 22:00Z) → in.
      // Day/hour windows for Sep 25 open on Sep 24 18:00 / Sep 25 18:00 → 0.
      const r = await tick('2026-09-23T10:00:00Z');
      expect(r).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 1, reviewNudge: 0, pushes: 1 });
      expect((await markers(G5)).nudge).toBe('2026-09-25 19:00:00');
      expect((await markers(G6)).nudge).toBeNull();
      expect((await markers(G7)).nudge).toBeNull();
      // The G6 exclusion was the owner's toggle and nothing else: flip it back → nudged on the next tick.
      await db.query('UPDATE users SET push_reminders = TRUE WHERE id = $1', [D]);
      expect(await tick('2026-09-23T10:15:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 1, reviewNudge: 0, pushes: 1 });
      expect((await markers(G6)).nudge).toBe('2026-09-25 19:00:00');
      expect((await markers(G7)).nudge).toBeNull();
    });
    it('re-arms after an edit: marker <> new date → day-before fires again, marker = NEW date', async () => {
      // Also re-stamp the review marker to the new date: a raw date edit would
      // otherwise re-arm the review nudge too (marker <> date), and G1's new
      // 09-27 date puts it in a review window a later tick lands in. This test
      // is about the DAY re-arm only, so keep G1 review-inert.
      await db.query(`UPDATE groups SET date = '2026-09-27 19:00:00', review_nudge_sent_for = '2026-09-27 19:00:00' WHERE id = $1`, [G1]);
      // 2026-09-26T16:30Z = 18:30 CEST Sep 26: G1 day window [Sep 26 18:00, Sep 27 00:00) → in.
      // Hour window (Sep 27 18:00–18:30) not yet; nudge window ([Sep 25 11:00, Sep 26 00:00)) already over.
      const r = await tick('2026-09-26T16:30:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 2 });
      const m = await markers(G1);
      expect(m.day).toBe('2026-09-27 19:00:00');
      expect(m.hour).toBe('2026-09-20 19:00:00'); // stale → re-armed too, its window just hasn't opened
    });

    // Review 2026-09-06 follow-ups — each pins one guard added after the review.
    it('00:30 start: day-before yes, hour-before NEVER — its window would lie on the evening before and say "Heute"', async () => {
      const G8 = await mkGroup('Rem Midnight', { date: '2026-09-21 00:30:00', members: [B] });
      // 2026-09-20T21:35Z = 23:35 CEST Sep 20. Day window [Sep 20 18:00, Sep 21 00:00) → in.
      // Hour window [start-60, start-30) = [21:30Z, 22:00Z) → in too — but the event's LOCAL DAY
      // (Sep 21 00:00 Vienna = 22:00Z) has not begun, so the clamp keeps it out. G2's day marker is
      // already set from the 16:30Z tick, so only G8 counts.
      const r = await tick('2026-09-20T21:35:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 2 });
      const m = await markers(G8);
      expect(m.day).toBe('2026-09-21 00:30:00');
      expect(m.hour).toBeNull();
      // 00:05 local on the event day: the un-clamped window is over anyway → nothing.
      expect(await tick('2026-09-20T22:05:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
      expect((await markers(G8)).hour).toBeNull();
    });
    it('sole-owner event: no day-before while nobody else is in; once someone joins, the next tick sends it', async () => {
      const G9 = await mkGroup('Rem Lonely', { date: '2026-09-22 19:00:00' }); // owner A only
      // 2026-09-21T16:30Z = 18:30 CEST Sep 21: day window open, but members_count = 1 → not claimed.
      expect(await tick('2026-09-21T16:30:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
      expect((await markers(G9)).day).toBeNull();
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [G9, B]);
      const r = await tick('2026-09-21T16:45:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 2 });
      expect((await markers(G9)).day).toBe('2026-09-22 19:00:00');
    });
    it('owner nudge waits until the event is 6 h old — no "Noch niemand dabei" five minutes after publishing', async () => {
      const G10 = await mkGroup('Nudge Fresh', { date: '2026-09-30 19:00:00' });
      // created_at is a naive TIMESTAMP written in the DB session zone (UTC here and on Railway).
      await db.query(`UPDATE groups SET created_at = '2026-09-28 08:00:00' WHERE id = $1`, [G10]);
      // 2026-09-28T10:00Z = 12:00 CEST on D-2 → window open, but the event is only 2 h old.
      expect(await tick('2026-09-28T10:00:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
      expect((await markers(G10)).nudge).toBeNull();
      // 15:00Z: 7 h old → nudged.
      expect(await tick('2026-09-28T15:00:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 1, reviewNudge: 0, pushes: 1 });
      expect((await markers(G10)).nudge).toBe('2026-09-30 19:00:00');
    });

    it('review nudge (Batch 3): fires ONCE the day after a group event, to unreviewed members', async () => {
      // Raw insert (NOT mkGroup, which stamps the review marker) so the review
      // marker starts NULL; stamp the pre-event markers so ONLY review is eligible.
      const r = await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, is_active, is_recurring_weekly)
         VALUES ('Review Me','group',$1,'Sport','Wien',10,'2026-10-01 19:00:00', TRUE, FALSE) RETURNING id`, [A]);
      const RG = r.rows[0].id;
      // Members since BEFORE the event (16.11.2026): the push now counts the
      // participants like the prompt (joined by the end of the event day), and
      // the DB default joined_at = NOW() would make both of them late joiners.
      await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at)
                       VALUES ($1,$2,'owner','2026-09-25 00:00:00'),($1,$3,'member','2026-09-25 00:00:00')`, [RG, A, B]);
      await db.query(`UPDATE groups SET reminder_day_sent_for = date, reminder_hour_sent_for = date, owner_nudge_sent_for = date WHERE id = $1`, [RG]);
      const revMarker = async () => (await db.query(`SELECT to_char(review_nudge_sent_for,'YYYY-MM-DD HH24:MI:SS') AS m FROM groups WHERE id = $1`, [RG])).rows[0].m;

      // On the event day the window hasn't opened yet.
      expect(await tick('2026-10-01T20:00:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
      expect(await revMarker()).toBeNull();

      // 2026-10-02T09:00Z = 11:00 CEST on D+1 → inside [D+1 10:00, D+2 00:00).
      // A (owner) + B, both push_reminders ON, unmuted, neither reviewed → 2 recipients.
      expect(await tick('2026-10-02T09:00:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 1, pushes: 2 });
      expect(await revMarker()).toBe('2026-10-01 19:00:00');

      // Idempotent: marker = date now.
      expect(await tick('2026-10-02T12:00:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });

      // Re-arm + let B dismiss it: the recipient filter drops B, leaving only A.
      await db.query(`UPDATE groups SET review_nudge_sent_for = NULL WHERE id = $1`, [RG]);
      await db.query(`INSERT INTO event_review_dismissals (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [RG, B]);
      expect(await tick('2026-10-02T13:00:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 1, pushes: 1 });
    });

    // ── C. notifyFriendsOfActivity (utils/friendActivity) ────────────────────
    const friendState = async (uid) => {
      const r = await db.query(
        `SELECT sent_count, day = (NOW() AT TIME ZONE 'Europe/Vienna')::date AS today,
                to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at
         FROM friend_push_state WHERE user_id = $1`, [uid]);
      return r.rows[0] ?? null;
    };
    const notify = (groupId, kind) => C.notifyFriendsOfActivity({ actorId: A, groupId, kind });
    const far = '2026-10-10 19:00:00'; // outside every reminder window used above

    it('friend feed precondition: B is A\'s only accepted friend (from the friendship cases above)', async () => {
      const r = await db.query(
        `SELECT requester_id, addressee_id FROM friendships
         WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`, [A]);
      expect(r.rows).toEqual([{ requester_id: A, addressee_id: B }]);
    });
    it('public group by A → B claimed once; friend_push_state stamped with today (Vienna)', async () => {
      const P1 = await mkGroup('Friend P1', { date: far });
      expect(await notify(P1, 'created')).toBe(1);
      expect(await friendState(B)).toMatchObject({ sent_count: 1, today: true });
    });
    it('private group → 0 and the state row is untouched (visibility gate returns before the claim)', async () => {
      const before = await friendState(B);
      const P2 = await mkGroup('Friend P2', { date: far, isPrivate: true });
      expect(await notify(P2, 'created')).toBe(0);
      expect(await friendState(B)).toEqual(before);
    });
    it('second activity → 1 (sent_count 2); third → 0 (FRIEND_PUSH_DAILY_CAP = 2)', async () => {
      const P3 = await mkGroup('Friend P3', { date: far });
      expect(await notify(P3, 'joined')).toBe(1);
      expect((await friendState(B)).sent_count).toBe(2);
      const P4 = await mkGroup('Friend P4', { date: far });
      expect(await notify(P4, 'created')).toBe(0);
      expect((await friendState(B)).sent_count).toBe(2);
    });
    it('a stale day resets the cap: yesterday at 2 → today counts 1 again', async () => {
      await db.query('UPDATE friend_push_state SET day = day - 1 WHERE user_id = $1', [B]);
      const P = await mkGroup('Friend P-rollover', { date: far });
      expect(await notify(P, 'created')).toBe(1);
      expect(await friendState(B)).toMatchObject({ sent_count: 1, today: true });
    });
    it('B already a member → 0 even with budget left', async () => {
      await db.query('DELETE FROM friend_push_state WHERE user_id = $1', [B]);
      const P5 = await mkGroup('Friend P5', { date: far, members: [B] });
      expect(await notify(P5, 'created')).toBe(0);
      expect(await friendState(B)).toBeNull();
    });
    it('push_friends = FALSE → 0 and no state row; back ON → 1', async () => {
      await db.query('UPDATE users SET push_friends = FALSE WHERE id = $1', [B]);
      const P6 = await mkGroup('Friend P6', { date: far });
      expect(await notify(P6, 'created')).toBe(0);
      expect(await friendState(B)).toBeNull();
      await db.query('UPDATE users SET push_friends = TRUE WHERE id = $1', [B]);
      expect(await notify(P6, 'created')).toBe(1);
      expect(await friendState(B)).toMatchObject({ sent_count: 1, today: true });
    });
    it('a join that FILLS the group sends no "auch dabei?" — nobody could follow it (review 2026-09-06)', async () => {
      await db.query('DELETE FROM friend_push_state WHERE user_id = $1', [B]);
      const P7 = await mkGroup('Friend P7 full', { date: far, owner: D, members: [A] });
      await db.query('UPDATE groups SET max_members = 2 WHERE id = $1', [P7]); // D + A → full
      expect(await notify(P7, 'joined')).toBe(0);
      expect(await friendState(B)).toBeNull();
      await db.query('UPDATE groups SET max_members = 5 WHERE id = $1', [P7]);
      expect(await notify(P7, 'joined')).toBe(1);
    });
  });

  // ── Batch 2 (2026-09-07): lifecycle notifications (edit / cancel / delete) ──
  describe('lifecycle notifications (Batch 2)', () => {
    // The edit/delete fan-outs are fire-and-forget, so they settle AFTER the
    // response — poll the notifications table briefly (real SQL, so a bad
    // notify query surfaces as the row never appearing).
    const waitFor = async (fn, tries = 60, ms = 25) => {
      for (let i = 0; i < tries; i++) {
        const v = await fn();
        if (v) return v;
        await new Promise(r => setTimeout(r, ms));
      }
      return null;
    };
    const notifId = (uid, type, gid) => waitFor(async () => {
      // reference_id::text keeps the match type-safe whatever the column type.
      const r = await db.query(
        'SELECT id FROM notifications WHERE user_id=$1 AND type=$2 AND reference_id::text=$3 ORDER BY id DESC LIMIT 1',
        [uid, type, String(gid)]);
      return r.rows[0]?.id || null;
    });
    const mkGroupWith = async (name, members = []) => {
      const r = await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
         VALUES ($1,'group', NOW() + INTERVAL '7 days', $2, 'Sport', 'Wien', 10) RETURNING id`,
        [name, A]);
      const gid = r.rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [gid, A]);
      for (const m of members) {
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [gid, m]);
      }
      return gid;
    };

    it('updateGroup: a location change notifies members (group_updated)', async () => {
      const gid = await mkGroupWith('B2 edit', [B]);
      ok(await call(C.updateGroup, { userId: A, params: { id: String(gid) }, body: { location: 'Graz' } }));
      expect(await notifId(B, 'group_updated', gid)).toBeTruthy();
    });

    it('updateGroup: a name-only edit does NOT notify (no when/where move)', async () => {
      const gid = await mkGroupWith('B2 noop', [B]);
      ok(await call(C.updateGroup, { userId: A, params: { id: String(gid) }, body: { name: 'B2 noop v2' } }));
      await new Promise(r => setTimeout(r, 200)); // give any unwanted async notify a chance
      const r = await db.query(
        "SELECT COUNT(*)::int c FROM notifications WHERE user_id=$1 AND type='group_updated' AND reference_id::text=$2",
        [B, String(gid)]);
      expect(r.rows[0].c).toBe(0);
    });

    it('cancelGroup notifies members with the reason (group_cancelled, awaited)', async () => {
      const gid = await mkGroupWith('B2 cancel', [B]);
      ok(await call(C.cancelGroup, { userId: A, params: { id: String(gid) }, body: { reason: 'Regen' } }));
      const r = await db.query(
        "SELECT message FROM notifications WHERE user_id=$1 AND type='group_cancelled' AND reference_id::text=$2",
        [B, String(gid)]);
      expect(r.rows[0]?.message).toBe('Regen');
    });

    it('deleteGroup notifies members the group is gone (group_deleted)', async () => {
      const gid = await mkGroupWith('B2 delete', [B]);
      ok(await call(C.deleteGroup, { userId: A, params: { id: String(gid) } }));
      expect(await notifId(B, 'group_deleted', gid)).toBeTruthy();
    });
  });

  // -- 'dm' is its own report target (2026-09-15) ---------------------------
  // Reporting a DM shipped filing reported_type='message'. `messages` and
  // `direct_messages` are both plain SERIALs starting at 1, so that id landed
  // on a real, unrelated GROUP message: the admin card showed a stranger's
  // text as the evidence, the admin e-mail and push quoted it, and the
  // "Nachricht loeschen" button soft-deleted it -- while the reported DM
  // stayed untouched. These cases force the collision instead of hoping for it.
  describe('DM reports resolve against direct_messages, never messages', () => {
    let collidingId;

    it('seed: a group message and a DM that share the SAME id', async () => {
      const m = await db.query(
        `INSERT INTO messages (group_id, user_id, content) VALUES ($1,$2,$3) RETURNING id`,
        [groupId, B, 'UNRELATED innocent group message']
      );
      collidingId = m.rows[0].id;
      // Force direct_messages to mint exactly that id.
      await db.query(
        `SELECT setval(pg_get_serial_sequence('direct_messages','id'), $1::bigint - 1, true)`,
        [collidingId]
      );
      const d = await db.query(
        `INSERT INTO direct_messages (sender_id, receiver_id, content)
         VALUES ($1,$2,$3) RETURNING id`,
        [A, B, 'THE ACTUAL harassing DM']
      );
      expect(d.rows[0].id).toBe(collidingId);
    });

    it("a 'dm' report resolves the DM, not the group message with the same id", async () => {
      const { resolveReportTargets } = await import('../../src/utils/reportContext.js');
      const map = await resolveReportTargets([{ reported_type: 'dm', reported_id: collidingId }]);
      const tg = map.get(`dm:${collidingId}`);
      expect(tg.kind).toBe('dm');
      expect(tg.content).toBe('THE ACTUAL harassing DM');
      expect(tg.content).not.toContain('innocent');
      expect(tg.sender.id).toBe(A);
      expect(tg.receiver.id).toBe(B);
      // No admin route into a private two-party thread.
      expect(tg.path).toBe(null);
    });

    it("a 'group' report carries the creator's e-mail, join date, profile path and prior-report count", async () => {
      const { resolveReportTargets } = await import('../../src/utils/reportContext.js');
      // One earlier report against A as a PERSON → owner_report_count must see it.
      await db.query(
        `INSERT INTO reports (reporter_id, reported_type, reported_id, reason, status)
         VALUES ($1, 'user', $2, 'fake', 'pending')`, [B, A]);
      const map = await resolveReportTargets([{ reported_type: 'group', reported_id: groupId }]);
      const tg = map.get(`group:${groupId}`);
      expect(tg.owner.id).toBe(A);
      expect(tg.owner.email).toBe('smoke-a@x.com');
      expect(tg.owner.joined_at).toBeTruthy();
      expect(tg.owner.path).toBe(`/user/${A}`);
      expect(tg.owner.report_count).toBeGreaterThanOrEqual(1);
    });

    it("a 'message' report with the same id still resolves the GROUP message", async () => {
      const { resolveReportTargets } = await import('../../src/utils/reportContext.js');
      const map = await resolveReportTargets([{ reported_type: 'message', reported_id: collidingId }]);
      const tg = map.get(`message:${collidingId}`);
      expect(tg.kind).toBe('message');
      expect(tg.content).toBe('UNRELATED innocent group message');
    });

    it("createReport accepts reported_type='dm' and getReports renders it", async () => {
      ok(await call(C.createReport, { userId: B, body: {
        reported_type: 'dm', reported_id: collidingId, reason: 'harassment', details: 'Belaestigung per DM' } }));
      const res = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '100' } });
      ok(res);
      const row = res.body.reports.find(r => r.reported_type === 'dm');
      expect(row?.target?.kind).toBe('dm');
      expect(row?.target?.content).toBe('THE ACTUAL harassing DM');
    });

    it('deleteDM: a non-admin gets 403 and the row survives', async () => {
      const res = await call(C.deleteDM, { userId: B, params: { id: String(collidingId) } });
      expect(res.statusCode).toBe(403);
      const r = await db.query(
        'SELECT is_deleted_sender FROM direct_messages WHERE id=$1', [collidingId]);
      expect(r.rows[0].is_deleted_sender).toBe(false);
    });

    it('deleteDM: an admin takes it down (both sides); the group message is untouched', async () => {
      ok(await call(C.deleteDM, { userId: A, params: { id: String(collidingId) } }));
      const d = await db.query(
        'SELECT is_deleted_sender, is_deleted_receiver, content FROM direct_messages WHERE id=$1', [collidingId]);
      expect(d.rows[0].is_deleted_sender).toBe(true);
      expect(d.rows[0].is_deleted_receiver).toBe(true);
      // Content kept as evidence for the report the admin just acted on.
      expect(d.rows[0].content).toBe('THE ACTUAL harassing DM');
      // The whole point: the collision victim is still there.
      const m = await db.query('SELECT is_deleted FROM messages WHERE id=$1', [collidingId]);
      expect(m.rows[0].is_deleted).toBe(false);
    });

    it('a taken-down DM is gone from the conversation for BOTH sides on reload', async () => {
      // The socket drop is not enough: getConversation selected both hide flags
      // and applied NEITHER, so the message came straight back on the next
      // load. Harmless while nothing set them, wrong the moment the admin
      // takedown did.
      for (const uid of [A, B]) {
        const res = await call(C.getConversation, {
          userId: uid, params: { userId: String(uid === A ? B : A) }, query: { limit: '100' } });
        ok(res);
        const ids = (res.body || []).map(m => m.id);
        expect(ids).not.toContain(collidingId);
      }
    });

    it('a DM one side hid is still visible to the OTHER side', async () => {
      const d = await db.query(
        `INSERT INTO direct_messages (sender_id, receiver_id, content, is_deleted_sender)
         VALUES ($1,$2,$3,TRUE) RETURNING id`,
        [A, B, 'hidden by its sender only']
      );
      const hidden = d.rows[0].id;
      const forSender = await call(C.getConversation, {
        userId: A, params: { userId: String(B) }, query: { limit: '100' } });
      const forReceiver = await call(C.getConversation, {
        userId: B, params: { userId: String(A) }, query: { limit: '100' } });
      expect((forSender.body || []).map(m => m.id)).not.toContain(hidden);
      expect((forReceiver.body || []).map(m => m.id)).toContain(hidden);
    });

    it('deleteDM: an unparsable id is a 400, not a 22P02 crash', async () => {
      const res = await call(C.deleteDM, { userId: A, params: { id: 'temp-1758' } });
      expect(res.statusCode).toBe(400);
    });
  });

  // -- media_url: content stays human-readable (2026-09-15) -----------------
  // Voice/photo messages put the storage URL straight into `content`, which
  // every client that predates the feature renders verbatim -- and the iOS app
  // bundles the web build, so every iPhone showed a raw
  // "https://.../media/uploads/....webm" text bubble.
  describe('voice + photo messages keep content readable', () => {
    it('sendMessage stores the URL in media_url and a label in content', async () => {
      const url = 'https://app.jamie-app.com/media/uploads/smoke-voice.webm';
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId, content: url, message_type: 'voice', duration_ms: 4200 } });
      ok(res);
      const row = await db.query(
        'SELECT content, media_url, duration_ms FROM messages WHERE id=$1', [res.body.id]);
      expect(row.rows[0].media_url).toBe(url);
      expect(row.rows[0].content).not.toContain('http');
      expect(row.rows[0].duration_ms).toBe(4200);
      // ...and the API echoes both back, so a current client still plays it.
      expect(res.body.media_url).toBe(url);
    });

    it('a chat photo may not be an arbitrary Google-CDN URL (Sightengine bypass)', async () => {
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId,
        content: 'https://lh3.googleusercontent.com/a/ACg8ocK-attacker=s9999',
        message_type: 'image' } });
      expect(res.statusCode).toBe(400);
    });

    it('a photo minted by our own upload route is accepted', async () => {
      const url = 'https://app.jamie-app.com/media/uploads/smoke-photo.webp';
      const res = await call(C.sendMessage, { userId: A, body: {
        groupId, content: url, message_type: 'image' } });
      ok(res);
      const row = await db.query('SELECT content, media_url FROM messages WHERE id=$1', [res.body.id]);
      expect(row.rows[0].media_url).toBe(url);
      expect(row.rows[0].content).not.toContain('http');
    });

    it('sendDM does the same split', async () => {
      const url = 'https://app.jamie-app.com/media/uploads/smoke-dm-voice.m4a';
      const res = await call(C.sendDM, { userId: A, body: {
        receiverId: B, content: url, message_type: 'voice', duration_ms: 1500 } });
      ok(res);
      const row = await db.query(
        `SELECT content, media_url FROM direct_messages
          WHERE sender_id=$1 AND receiver_id=$2 ORDER BY id DESC LIMIT 1`, [A, B]);
      expect(row.rows[0].media_url).toBe(url);
      expect(row.rows[0].content).not.toContain('http');
    });
  });


  // -- Join-request attempt budget (Arno 2026-09-15) -------------------------
  // "Es gibt Leute die fragen das 4. mal schon an, obwohl ich sie abgelehnt
  // habe." One row per (group_id, user_id) that the join paths upserted back to
  // 'pending' every time, so a rejection cost the applicant nothing. Tobi's
  // rule: two attempts, then no more. Everything here needs REAL Postgres --
  // the budget lives in an ON CONFLICT ... DO UPDATE ... WHERE, which a mocked
  // db.query cannot evaluate at all.
  describe('join-request attempt budget', () => {
    let gid, applicant, reqId;

    const reqRow = () => db.query(
      'SELECT id, status, rejected_count FROM group_join_requests WHERE group_id=$1 AND user_id=$2',
      [gid, applicant]).then(r => r.rows[0]);

    const rejectCurrent = async () => {
      const row = await reqRow();
      return call(C.handleJoinRequest, {
        userId: A, params: { id: String(gid), requestId: String(row.id) }, body: { action: 'reject' } });
    };

    it('seed: a private group and an applicant', async () => {
      applicant = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-budget@x.com','Budget','1995-03-03','female',$1,TRUE,'email') RETURNING id`,
        [avatar])).rows[0].id;
      // Inserted directly, not via createGroup: A has already created plenty of
      // groups earlier in this file and would hit the 10-per-day cap here.
      gid = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members, is_private)
         VALUES ($1,'group', NOW() + INTERVAL '7 days', $2, 'Sport', 'Wien', 8, TRUE) RETURNING id`,
        ['Budget Smoke', A])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
        [gid, A]);
    });

    it('attempt 1 is allowed', async () => {
      ok(await call(C.joinGroup, { userId: applicant, params: { id: String(gid) }, body: { message: 'bitte' } }));
      const row = await reqRow();
      expect(row.status).toBe('pending');
      expect(row.rejected_count).toBe(0);
    });

    it('rejecting counts one attempt, records who did it, and reports what is left', async () => {
      const res = await rejectCurrent();
      ok(res);
      expect(res.body.attempts_left).toBe(1);
      const row = await reqRow();
      expect(row.status).toBe('rejected');
      expect(row.rejected_count).toBe(1);
      const who = await db.query('SELECT reviewed_by FROM group_join_requests WHERE id=$1', [row.id]);
      expect(who.rows[0].reviewed_by).toBe(A);
    });

    it('attempt 2 is still allowed - the rule is TWO tries, not one', async () => {
      ok(await call(C.joinGroup, { userId: applicant, params: { id: String(gid) }, body: { message: 'nochmal' } }));
      const row = await reqRow();
      expect(row.status).toBe('pending');
      expect(row.rejected_count).toBe(1);
    });

    it('the second rejection uses the budget up', async () => {
      const res = await rejectCurrent();
      ok(res);
      expect(res.body.attempts_left).toBe(0);
      expect((await reqRow()).rejected_count).toBe(2);
    });

    it('attempt 3 is refused with a coded 403 and writes nothing', async () => {
      const res = await call(C.joinGroup, { userId: applicant, params: { id: String(gid) }, body: { message: 'bitte bitte' } });
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('JOIN_REQUEST_BLOCKED');
      const row = await reqRow();
      // Still rejected, still 2 - the refusal must not upsert back to pending.
      expect(row.status).toBe('rejected');
      expect(row.rejected_count).toBe(2);
    });

    it('the waitlist is not a side door for a used-up applicant', async () => {
      // Fill the group so the waitlist is the offered path, then try it.
      await db.query('UPDATE groups SET max_members = members_count WHERE id=$1', [gid]);
      const res = await call(C.joinWaitlist, { userId: applicant, params: { id: String(gid) }, body: {} });
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('JOIN_REQUEST_BLOCKED');
      const w = await db.query('SELECT 1 FROM group_waitlist WHERE group_id=$1 AND user_id=$2', [gid, applicant]);
      expect(w.rows.length).toBe(0);
      await db.query('UPDATE groups SET max_members = 8 WHERE id=$1', [gid]);
    });

    it('undo refunds the attempt it spent', async () => {
      const row = await reqRow();
      ok(await call(C.handleJoinRequest, {
        userId: A, params: { id: String(gid), requestId: String(row.id) }, body: { action: 'undo' } }));
      const after = await reqRow();
      expect(after.status).toBe('pending');
      expect(after.rejected_count).toBe(1);
    });

    it('rejecting a row that is no longer pending is a no-op, not a second charge', async () => {
      // Burn it back down to rejected (count 2), then reject the same row again.
      const first = await rejectCurrent();
      ok(first);
      expect((await reqRow()).rejected_count).toBe(2);
      const row = await reqRow();
      const again = await call(C.handleJoinRequest, {
        userId: A, params: { id: String(gid), requestId: String(row.id) }, body: { action: 'reject' } });
      ok(again);
      // The guard is what stops a stale second surface from burning attempts
      // nobody spent - and, on an accepted row, from banning a current member.
      expect((await reqRow()).rejected_count).toBe(2);
    });

    it('accepting works from rejected and clears the budget', async () => {
      const row = await reqRow();
      ok(await call(C.handleJoinRequest, {
        userId: A, params: { id: String(gid), requestId: String(row.id) }, body: { action: 'accept' } }));
      const after = await reqRow();
      expect(after.status).toBe('accepted');
      expect(after.rejected_count).toBe(0);
      const m = await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [gid, applicant]);
      expect(m.rows.length).toBe(1);
    });

    it('deleting the reviewer does not break: reviewed_by is ON DELETE SET NULL', async () => {
      // Writing reviewed_by for the first time armed a constraint that had been
      // dead weight since the original schema: group_join_requests.reviewed_by
      // had NO ON DELETE clause. Both account-deletion paths transfer a
      // multi-member group to another member and only then DELETE FROM users,
      // so the request row survives and the FK would abort the transaction -
      // i.e. "Konto loeschen" 500s forever for any owner who ever handled a
      // request. That is a GDPR path, so it is pinned here.
      const reviewer = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-reviewer@x.com','Rev','1990-01-01','male',$1,TRUE,'email') RETURNING id`,
        [avatar])).rows[0].id;
      const rowId = (await db.query(
        `INSERT INTO group_join_requests (group_id, user_id, status, reviewed_by)
         VALUES ($1, $2, 'rejected', $3) RETURNING id`,
        [gid, B, reviewer])).rows[0].id;
      await db.query('DELETE FROM users WHERE id = $1', [reviewer]);
      const after = await db.query('SELECT reviewed_by FROM group_join_requests WHERE id=$1', [rowId]);
      expect(after.rows[0].reviewed_by).toBe(null);
      await db.query('DELETE FROM group_join_requests WHERE id = $1', [rowId]);
    });

    it('exhausting the budget takes the applicant off the waitlist', async () => {
      const waiter = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-waiter@x.com','Wait','1990-01-01','male',$1,TRUE,'email') RETURNING id`,
        [avatar])).rows[0].id;
      // Two rejections worth of history, then a live pending request + a
      // waitlist row, then the rejection that uses the budget up.
      await db.query(
        `INSERT INTO group_join_requests (group_id, user_id, status, rejected_count)
         VALUES ($1, $2, 'pending', 1) RETURNING id`, [gid, waiter]);
      await db.query(
        'INSERT INTO group_waitlist (group_id, user_id, position) VALUES ($1,$2,1)',
        [gid, waiter]);
      const row = await db.query(
        'SELECT id FROM group_join_requests WHERE group_id=$1 AND user_id=$2', [gid, waiter]);
      ok(await call(C.handleJoinRequest, {
        userId: A, params: { id: String(gid), requestId: String(row.rows[0].id) },
        body: { action: 'reject' } }));
      const w = await db.query(
        'SELECT 1 FROM group_waitlist WHERE group_id=$1 AND user_id=$2', [gid, waiter]);
      // Left in place, promoteFromWaitlist would eventually claim this row,
      // push "Platz frei!" to somebody the server refuses, and consume the
      // opening for good (the promotion CTE only ever reads 'waiting').
      expect(w.rows.length).toBe(0);
    });

    it('flipping the group PUBLIC lifts the block - flag and gate agree', async () => {
      const blocked = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-public@x.com','Pub','1990-01-01','male',$1,TRUE,'email') RETURNING id`,
        [avatar])).rows[0].id;
      await db.query(
        `INSERT INTO group_join_requests (group_id, user_id, status, rejected_count)
         VALUES ($1, $2, 'rejected', 2)`, [gid, blocked]);

      // While private: blocked, and the detail payload says so.
      const priv = await call(C.getGroupById, { userId: blocked, params: { id: String(gid) } });
      expect(priv.body.join_request_blocked).toBe(true);
      expect((await call(C.joinGroup, {
        userId: blocked, params: { id: String(gid) }, body: {} })).statusCode).toBe(403);

      // Owner opens the group to everyone - the documented way to lift it.
      await db.query('UPDATE groups SET is_private = FALSE WHERE id = $1', [gid]);
      const pub = await call(C.getGroupById, { userId: blocked, params: { id: String(gid) } });
      // The flag must be scoped exactly like the gate, or the button stays dead
      // on a group anyone may now join and nothing can ever clear it.
      expect(pub.body.join_request_blocked).toBe(false);
      ok(await call(C.joinGroup, { userId: blocked, params: { id: String(gid) }, body: {} }));

      await db.query('UPDATE groups SET is_private = TRUE WHERE id = $1', [gid]);
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [gid, blocked]);
    });

    it('a member who leaves is NOT blocked - status stays accepted, budget is clear', async () => {
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [gid, applicant]);
      const res = await call(C.joinGroup, { userId: applicant, params: { id: String(gid) }, body: { message: 'zurueck' } });
      // The gate keys on the counter, never on "status is not pending" - which
      // would have barred every member who ever left or was kicked.
      ok(res);
      expect((await reqRow()).status).toBe('pending');
    });
  });


  // -- Lesebestaetigungen (Tobi 2026-09-15) ---------------------------------
  // All of this is SQL: a CASE that hides the read flag unless BOTH sides have
  // receipts on, two watermark columns, and a MIN() aggregate. A mocked
  // db.query evaluates none of it.
  describe('read receipts', () => {
    let reader, writer, gid;

    it('seed: two users and a group they are both in', async () => {
      const mk = async (email, name) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ($1,$2,'1995-03-03','female',$3,TRUE,'email') RETURNING id`,
        [email, name, avatar])).rows[0].id;
      writer = await mk('smoke-rr-writer@x.com', 'Writer');
      reader = await mk('smoke-rr-reader@x.com', 'Reader');
      // Friends, so DMs are allowed in both directions.
      await db.query(
        `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,'accepted')`,
        [writer, reader]);
      gid = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
         VALUES ('Receipts Smoke','group', NOW() + INTERVAL '7 days', $1, 'Sport', 'Wien', 10) RETURNING id`,
        [writer])).rows[0].id;
      for (const [u, role] of [[writer, 'owner'], [reader, 'member']]) {
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [gid, u, role]);
      }
      // Everyone defaults to receipts ON.
      const d = await db.query('SELECT read_receipts FROM users WHERE id = ANY($1)', [[writer, reader]]);
      expect(d.rows.every(r => r.read_receipts === true)).toBe(true);
    });

    it('a DM starts undelivered and unread', async () => {
      const res = await call(C.sendDM, { userId: writer, body: { receiverId: reader, content: 'hallo' } });
      ok(res);
      const row = await db.query(
        'SELECT is_read, delivered_at FROM direct_messages WHERE id=$1', [res.body.id]);
      expect(row.rows[0].is_read).toBe(false);
      expect(row.rows[0].delivered_at).toBe(null);
    });

    it('markDMRead sets read AND backfills delivered', async () => {
      ok(await call(C.markDMRead, { userId: reader, params: { userId: String(writer) } }));
      const row = await db.query(
        `SELECT is_read, delivered_at FROM direct_messages
          WHERE sender_id=$1 AND receiver_id=$2 ORDER BY id DESC LIMIT 1`, [writer, reader]);
      expect(row.rows[0].is_read).toBe(true);
      // Read can never precede delivered - a receipt that claims otherwise is
      // a visibly wrong tick.
      expect(row.rows[0].delivered_at).not.toBe(null);
    });

    it('markDMRead always lets you clear your OWN badge, but writes no receipt for a stranger', async () => {
      // A blanket 403 here was a regression: clearing your own unread badge is
      // not a privilege, and after an unfriend or block the pair fails
      // dmAllowed forever — the badge would have been stuck at "1 ungelesen"
      // with no way to clear it.
      const before = await db.query(
        `SELECT COUNT(*)::int c FROM direct_messages
          WHERE sender_id=$1 AND receiver_id=$2 AND is_read = TRUE`, [writer, D]);
      ok(await call(C.markDMRead, { userId: D, params: { userId: String(writer) } }));
      const after = await db.query(
        `SELECT COUNT(*)::int c FROM direct_messages
          WHERE sender_id=$1 AND receiver_id=$2 AND is_read = TRUE`, [writer, D]);
      expect(after.rows[0].c).toBe(before.rows[0].c);
    });

    it('the SENDER opting out suppresses the receipt too — reciprocity is not one-way', async () => {
      ok(await call(C.updatePrivacyPreferences, { userId: writer, body: { read_receipts: false } }));
      const sent = await call(C.sendDM, { userId: writer, body: { receiverId: reader, content: 'stumm' } });
      ok(sent);
      ok(await call(C.markDMRead, { userId: reader, params: { userId: String(writer) } }));
      const row = await db.query('SELECT is_read, delivered_at FROM direct_messages WHERE id=$1', [sent.body.id]);
      // Nothing written at all — an opted-out sender must not be able to watch
      // their own ticks turn blue live and then revert on the next reload.
      expect(row.rows[0].is_read).toBe(false);
      // Delivered is never opt-outable.
      expect(row.rows[0].delivered_at).not.toBe(null);
      ok(await call(C.updatePrivacyPreferences, { userId: writer, body: { read_receipts: true } }));
    });

    it('the read flag is reciprocal: reader turns receipts off, writer stops seeing it', async () => {
      ok(await call(C.updatePrivacyPreferences, { userId: reader, body: { read_receipts: false } }));
      const conv = await call(C.getConversation, {
        userId: writer, params: { userId: String(reader) }, query: { limit: '50' } });
      ok(conv);
      const mine = (conv.body || []).filter(m => m.sender_id === writer);
      expect(mine.length).toBeGreaterThan(0);
      // Not false - NULL. "I am not telling you" is a different answer from
      // "they have not read it", and the tick must fall back to delivered.
      expect(mine.every(m => m.is_read === null)).toBe(true);
      // Delivered is NOT opt-outable, exactly as in WhatsApp.
      expect(mine.every(m => m.delivered_at !== null)).toBe(true);
    });

    it('...and the opted-out reader loses sight of the OTHER side too', async () => {
      // Reciprocity: turning it off is not a one-way mirror.
      const res = await call(C.sendDM, { userId: reader, body: { receiverId: writer, content: 'und?' } });
      ok(res);
      ok(await call(C.markDMRead, { userId: writer, params: { userId: String(reader) } }));
      const conv = await call(C.getConversation, {
        userId: reader, params: { userId: String(writer) }, query: { limit: '50' } });
      const theirs = (conv.body || []).filter(m => m.sender_id === reader);
      expect(theirs.every(m => m.is_read === null)).toBe(true);
    });

    it('turning receipts back on restores it', async () => {
      ok(await call(C.updatePrivacyPreferences, { userId: reader, body: { read_receipts: true } }));
      const conv = await call(C.getConversation, {
        userId: writer, params: { userId: String(reader) }, query: { limit: '50' } });
      const mine = (conv.body || []).filter(m => m.sender_id === writer);
      expect(mine.some(m => m.is_read === true)).toBe(true);
    });

    it('getConversation still returns a BARE ARRAY', async () => {
      // The bundled iOS 1.4.1 renderer does `res.data || []` then `.filter`.
      // Wrapping this in an object to carry receipt metadata would white-screen
      // every iPhone in the field - the single most expensive mistake available
      // in this feature.
      const conv = await call(C.getConversation, {
        userId: writer, params: { userId: String(reader) }, query: { limit: '5' } });
      expect(Array.isArray(conv.body)).toBe(true);
    });

    it('group getMessages carries the two watermarks', async () => {
      ok(await call(C.sendMessage, { userId: writer, body: { groupId: gid, content: 'gruppe hallo' } }));
      const res = await call(C.getMessages, { userId: writer, params: { groupId: String(gid) }, query: {} });
      ok(res);
      expect(res.body).toHaveProperty('receipts');
      expect(res.body.receipts).toHaveProperty('delivered_through');
      expect(res.body.receipts).toHaveProperty('read_through');
    });

    it('paging back through history does NOT count as reading', async () => {
      const before = (await db.query(
        'SELECT receipt_read_at FROM group_members WHERE group_id=$1 AND user_id=$2', [gid, reader])).rows[0];
      await call(C.getMessages, {
        userId: reader, params: { groupId: String(gid) }, query: { before: '999999' } });
      await new Promise(r => setTimeout(r, 150)); // the stamp is fire-and-forget
      const after = (await db.query(
        'SELECT receipt_read_at, last_read_at FROM group_members WHERE group_id=$1 AND user_id=$2',
        [gid, reader])).rows[0];
      // Scrolling up through old messages moves the unread marker but must not
      // claim "I have seen your newest message".
      expect(String(after.receipt_read_at)).toBe(String(before.receipt_read_at));
      expect(after.last_read_at).not.toBe(null);
    });

    it('opening the chat DOES count, and the author sees who read it', async () => {
      await call(C.getMessages, { userId: reader, params: { groupId: String(gid) }, query: {} });
      await new Promise(r => setTimeout(r, 150));
      const msg = (await db.query(
        'SELECT id FROM messages WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1',
        [gid, writer])).rows[0];
      const res = await call(C.getMessageReceipts, { userId: writer, params: { id: String(msg.id) } });
      ok(res);
      expect(res.body.read.map(p => p.id)).toContain(reader);
    });

    it('only the author may open the Nachrichteninfo', async () => {
      const msg = (await db.query(
        'SELECT id FROM messages WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1',
        [gid, writer])).rows[0];
      const res = await call(C.getMessageReceipts, { userId: reader, params: { id: String(msg.id) } });
      expect(res.statusCode).toBe(403);
    });


    it('a member who never opened the chat keeps the group ticks grey', async () => {
      // COALESCE(receipt_read_at, joined_at) — the expression the unread badge
      // uses — would have turned every older message blue the moment somebody
      // joined, while the Nachrichteninfo sheet still said "Noch niemand".
      const newbie = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-rr-newbie@x.com','Newbie','1995-03-03','male',$1,TRUE,'email') RETURNING id`,
        [avatar])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`,
        [gid, newbie]);
      const res = await call(C.getMessages, { userId: writer, params: { groupId: String(gid) }, query: {} });
      ok(res);
      expect(res.body.receipts.read_through).toBe(null);
      // …and delivery is unaffected: they can see the history, so it reached them.
      expect(res.body.receipts.delivered_through).not.toBe(null);
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [gid, newbie]);
    });

    it('group receipts are reciprocal: an opted-out viewer gets no read watermark', async () => {
      await db.query('UPDATE users SET read_receipts = FALSE WHERE id = $1', [writer]);
      const res = await call(C.getMessages, { userId: writer, params: { groupId: String(gid) }, query: {} });
      ok(res);
      expect(res.body.receipts.read_through).toBe(null);
      expect(res.body.receipts.delivered_through).not.toBe(null);
      await db.query('UPDATE users SET read_receipts = TRUE WHERE id = $1', [writer]);
    });

    it('a kicked author can no longer read the roster through Nachrichteninfo', async () => {
      const msg = (await db.query(
        'SELECT id FROM messages WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1',
        [gid, writer])).rows[0];
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [gid, writer]);
      // Authorship alone used to be enough — so an ex-member still holding one
      // of their own message ids got names, avatars and per-person timestamps
      // for the CURRENT roster, with none of getGroupMembers' gates.
      const res = await call(C.getMessageReceipts, { userId: writer, params: { id: String(msg.id) } });
      expect(res.statusCode).toBe(403);
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
        [gid, writer]);
    });

    it('an opted-out member is counted, never silently listed as unread', async () => {
      await db.query('UPDATE users SET read_receipts = FALSE WHERE id = $1', [reader]);
      const msg = (await db.query(
        'SELECT id FROM messages WHERE group_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1',
        [gid, writer])).rows[0];
      const res = await call(C.getMessageReceipts, { userId: writer, params: { id: String(msg.id) } });
      ok(res);
      expect(res.body.read.map(p => p.id)).not.toContain(reader);
      expect(res.body.opted_out).toBe(1);
      await db.query('UPDATE users SET read_receipts = TRUE WHERE id = $1', [reader]);
    });
  });

  // ── Push subscribe cap (tester 06.10.2026, "Push klappt immer noch nicht") ──
  // At 25 web rows the endpoint used to answer 429 — also for the CURRENT
  // device re-posting its own endpoint — and the client only console.warns.
  // Now the stalest rows are evicted instead. Real Postgres, because the
  // eviction is a parameterised OFFSET inside a sub-select.
  describe('web push subscribe cap evicts, never refuses', () => {
    let P;
    const ep = (n) => `https://fcm.googleapis.com/fcm/send/smoke-${n}`;
    const keys = { p256dh: 'p'.repeat(20), auth: 'a'.repeat(8) };
    const webRows = async () => (await db.query(
      `SELECT endpoint, created_at FROM push_subscriptions WHERE user_id = $1 AND platform = 'web' ORDER BY created_at DESC`,
      [P])).rows;

    beforeAll(async () => {
      P = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-push@x.com','Pia','1995-03-03','female',$1, TRUE, 'email') RETURNING id`,
        [avatar])).rows[0].id;
      // 25 rows, endpoint n registered n days ago → smoke-25 is the stalest.
      for (let n = 1; n <= 25; n++) {
        await db.query(
          `INSERT INTO push_subscriptions (user_id, platform, endpoint, p256dh, auth_key, created_at)
           VALUES ($1, 'web', $2, 'p', 'a', NOW() - ($3 || ' days')::interval)`,
          [P, ep(n), String(n)]);
      }
    });

    it('a NEW device at the cap is registered and the stalest row makes room', async () => {
      ok(await call(C.subscribePush, { userId: P, body: { endpoint: ep('new'), keys } }));
      const rows = await webRows();
      expect(rows).toHaveLength(25);
      expect(rows.map(r => r.endpoint)).toContain(ep('new'));
      expect(rows.map(r => r.endpoint)).not.toContain(ep(25));
    });

    it('re-posting an existing endpoint at the cap is accepted and refreshes it', async () => {
      const res = await call(C.subscribePush, { userId: P, body: { endpoint: ep(20), keys } });
      ok(res);
      const rows = await webRows();
      expect(rows).toHaveLength(25);
      // the re-posted device is now the freshest row, not a 20-day-old one
      expect(rows[0].endpoint).toBe(ep(20));
    });

    it('admin user detail lists the push devices — host only, never the endpoint', async () => {
      const res = await call(C.getUserDetail, { userId: A, params: { id: String(P) } });
      ok(res);
      expect(res.body.push).toHaveLength(25);
      expect(res.body.push[0]).toMatchObject({ platform: 'web', host: 'fcm.googleapis.com' });
      expect(JSON.stringify(res.body.push)).not.toContain('/fcm/send/');
    });

    it('admin test push answers with one result per device (none configured here → [])', async () => {
      const res = await call(C.sendUserTestPush, { userId: A, params: { id: String(P) } });
      ok(res);
      expect(Array.isArray(res.body.results)).toBe(true);
      expect((await call(C.sendUserTestPush, { userId: A, params: { id: '99999999' } })).statusCode).toBe(404);
    });

    it('an endpoint still registered under ANOTHER account moves to the current one', async () => {
      await db.query(
        `INSERT INTO push_subscriptions (user_id, platform, endpoint, p256dh, auth_key) VALUES ($1,'web',$2,'p','a')`,
        [B, ep('shared')]);
      ok(await call(C.subscribePush, { userId: P, body: { endpoint: ep('shared'), keys } }));
      const owners = (await db.query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [ep('shared')])).rows;
      expect(owners).toEqual([{ user_id: P }]);
    });

    it('an iPhone re-posting its token refreshes "last registered"; another account takes the token over', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const token = 'a'.repeat(64);
      ok(await call(C.saveApnsToken, { userId: P, body: { token } }));
      await db.query(`UPDATE push_subscriptions SET created_at = NOW() - INTERVAL '3 days' WHERE device_token = $1`, [token]);
      ok(await call(C.saveApnsToken, { userId: P, body: { token } }));
      const rows = (await db.query(
        `SELECT user_id, created_at > NOW() - INTERVAL '1 minute' AS fresh FROM push_subscriptions WHERE device_token = $1`,
        [token])).rows;
      expect(rows).toEqual([{ user_id: P, fresh: true }]);
      ok(await call(C.saveApnsToken, { userId: B, body: { token } }));
      expect((await db.query('SELECT user_id FROM push_subscriptions WHERE device_token = $1', [token])).rows)
        .toEqual([{ user_id: B }]);
      log.mockRestore();
    });
  });

  // ── Tote Web-Push-Endpoints (Lea, 18.10.2026) ────────────────────────────
  // A 404/410 prune now remembers the endpoint (sha256) and subscribe refuses
  // a re-post of it with 409 { resubscribe: true } — the loop that pruned the
  // same endpoint over and over. Real Postgres for the ON CONFLICT upsert and
  // the boot-time 180-day sweep in the migration.
  describe('a pruned web endpoint is never registered again', () => {
    let Q;
    const dead = 'https://fcm.googleapis.com/fcm/send/smoke-dead';
    const keys = { p256dh: 'p'.repeat(20), auth: 'a'.repeat(8) };

    beforeAll(async () => {
      Q = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-deadpush@x.com','Dora','1995-03-03','female',$1, TRUE, 'email') RETURNING id`,
        [avatar])).rows[0].id;
    });

    it('the migration step ran clean and created the table', async () => {
      const { getMigrationHealth } = await import('../../src/config/migrations.js');
      expect(getMigrationHealth().stepFailures.map(f => f.label || String(f))
        .filter(l => /push_dead_endpoints/.test(l))).toEqual([]);
      expect((await db.query(`SELECT to_regclass('push_dead_endpoints') AS r`)).rows[0].r).not.toBeNull();
    });

    it('remember (twice — the upsert) → re-post answers 409 resubscribe and stores nothing; a fresh endpoint registers', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { rememberDeadEndpoint } = await import('../../src/controllers/pushController.js');
      expect(await rememberDeadEndpoint(dead)).toBe(true);
      expect(await rememberDeadEndpoint(dead)).toBe(true);
      // One row, keyed by the sha256 — never the URL (it is the device's push credential).
      const { createHash } = await import('crypto');
      const stored = (await db.query('SELECT endpoint_hash FROM push_dead_endpoints')).rows.map(r => r.endpoint_hash);
      expect(stored.filter(h => h === createHash('sha256').update(dead).digest('hex'))).toHaveLength(1);
      expect(stored.some(h => h.includes('fcm.googleapis.com'))).toBe(false);

      const res = await call(C.subscribePush, { userId: Q, body: { endpoint: dead, keys } });
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({ resubscribe: true });
      expect((await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [dead])).rowCount).toBe(0);

      ok(await call(C.subscribePush, { userId: Q, body: { endpoint: `${dead}-fresh`, keys } }));
      expect((await db.query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [`${dead}-fresh`])).rows)
        .toEqual([{ user_id: Q }]);
      warn.mockRestore();
    });
  });

  // ── Abzeichen-Stufen (B2, tester 06.10.2026) ─────────────────────────────
  // Confirmed attendance, never sign-ups: ✓ must strictly outnumber ✗ from
  // OTHER people; „nicht stattgefunden“/cancelled/recurring/club events never
  // count, nor a group deleted BEFORE it began (one deleted afterwards keeps
  // its attendees' credit). Real Postgres, because the aggregate is a
  // GROUP BY/HAVING + LATERAL unnest over event_reviews × groups.
  describe('attendance tiers (Abzeichen-Stufen)', () => {
    let T, R1, R2, R3, firstEvent, cancelledEvent, at;
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1995-03-03','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    // Dates are always days in the past/future, never "today": CURRENT_DATE
    // flips at UTC midnight. Default 20 days ago: the review round
    // (REVIEW_WINDOW_DAYS = 14) has closed, so the meetup can count; daysAgo 3
    // = round still open (writes allowed, nothing counted yet). Members joined
    // long before the event.
    const mkEvent = async (owner, o = {}) => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members,
                             did_not_take_place, is_recurring_weekly, is_active)
         VALUES ($1, $2, NOW() - make_interval(days => $7), $3, 'Sport', 'Wien', 20, $4, $5, $6) RETURNING id`,
        [o.name || 'Tier-Event', o.type || 'group', owner, !!o.notHeld, !!o.recurring, o.active !== false,
          o.daysAgo ?? 20])).rows[0].id;
      if (o.deletedBefore) await db.query(`UPDATE groups SET deleted_at = date - INTERVAL '1 day' WHERE id = $1`, [id]);
      if (o.deletedAfter) await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [id]);
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role, joined_at)
         SELECT $1, u, CASE WHEN u = $2 THEN 'owner' ELSE 'member' END, NOW() - INTERVAL '40 days'
           FROM unnest($3::int[]) AS u
         ON CONFLICT DO NOTHING`, [id, owner, [owner, T, R1, R2]]);
      return id;
    };
    const vote = (gid, reviewer, present) => db.query(
      'INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present) VALUES ($1,$2,$3,$4)',
      [gid, reviewer, T, present]);
    const statsOfT = async () => {
      const m = await at.getAttendanceStats(db, [T]);
      const s = m.get(T) || { confirmedEvents: 0, confirmers: 0 };
      return { events: s.confirmedEvents, confirmers: s.confirmers, tier: at.tierFor(s.confirmedEvents, s.confirmers) };
    };

    beforeAll(async () => {
      at = await import('../../src/utils/attendanceTiers.js');
      T = await mkU('smoke-tier-t@x.com', 'Tia');
      R1 = await mkU('smoke-tier-r1@x.com', 'Rea');
      R2 = await mkU('smoke-tier-r2@x.com', 'Rob');
      R3 = await mkU('smoke-tier-r3@x.com', 'Ria');
    });

    it('counts a meetup only when ✓ STRICTLY outnumber ✗ from other people', async () => {
      firstEvent = await mkEvent(R3);
      await vote(firstEvent, R1, true); await vote(firstEvent, R2, true); await vote(firstEvent, R3, false); // 2:1 → counts
      const tie = await mkEvent(R3);
      await vote(tie, R1, true); await vote(tie, R2, false);                                               // 1:1 → no
      const own = await mkEvent(R3);
      await db.query(
        'INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present) VALUES ($1,$2,$2,FALSE)',
        [own, T]);
      await vote(own, R1, true);                                                                           // own sentinel ignored → counts
      expect(await statsOfT()).toEqual({ events: 2, confirmers: 2, tier: 0 });
    });

    // Weekly series are kept out at WRITE time (never asked, ticks refused —
    // see the write-gate test); votes recorded before an owner ticked
    // „wöchentlich“ keep counting (see "moving, re-dating…").
    it('never counts „nicht stattgefunden“, cancelled, club events or a group deleted before it began', async () => {
      for (const o of [{ notHeld: true }, { active: false }, { deletedBefore: true }, { type: 'event' }]) {
        const gid = await mkEvent(R3, o);
        await vote(gid, R1, true); await vote(gid, R2, true);
      }
      expect((await statsOfT()).events).toBe(2);
    });

    it('a group cleaned up AFTER it took place keeps its attendees\' credit', async () => {
      const gid = await mkEvent(R3, { deletedAfter: true });
      await vote(gid, R1, true);
      expect((await statsOfT()).events).toBe(3);
    });

    it('🏅 at 5 confirmed meetups from at least 2 different people — getMyAttendance shows the progress', async () => {
      for (let i = 0; i < 2; i++) {
        const gid = await mkEvent(R3);
        await vote(gid, R1, true);
      }
      const res = await call(C.getMyAttendance, { userId: T });
      ok(res);
      expect(res.body).toEqual({
        available: true, tier: 1, confirmed_events: 5, confirmers: 2,
        next: { tier: 2, events_missing: 5, confirmers_missing: 1 },
        step: 1,
        next_step: { tier: 2, events_missing: 5, confirmers_missing: 1 },
        window_days: 14,
      });
    });

    it('an owner flagging „nicht stattgefunden“ AFTER confirmations removes the meetup at once (order race)', async () => {
      // The flag directly — R3 already voted on this event, so submitReview's
      // not_held would (rightly) answer 409 "Bereits bewertet". What matters
      // here is that the count reacts on the next read, with nothing to recompute.
      await db.query('UPDATE groups SET did_not_take_place = TRUE WHERE id = $1', [firstEvent]);
      expect(await statsOfT()).toMatchObject({ events: 4, tier: 0 });
      await db.query('UPDATE groups SET did_not_take_place = FALSE WHERE id = $1', [firstEvent]);
      expect((await statsOfT()).tier).toBe(1);
    });

    it('write gate: ticks for a cancelled event are not recorded — 2xx {counted:false}, sentinel only', async () => {
      cancelledEvent = await mkEvent(R3, { active: false, daysAgo: 3 });
      const res = await call(C.submitReview, { userId: R1, body: {
        group_id: cancelledEvent, attendances: [{ user_id: T, was_present: true }] } });
      ok(res);
      expect(res.body).toEqual({ success: true, counted: false });
      const rows = (await db.query(
        'SELECT reviewed_user_id, was_present FROM event_reviews WHERE group_id = $1 AND reviewer_id = $2',
        [cancelledEvent, R1])).rows;
      expect(rows).toEqual([{ reviewed_user_id: R1, was_present: false }]);
      // a weekly series: never asked about, ticks refused the same way
      const weekly = await mkEvent(R3, { recurring: true, daysAgo: 3 });
      const wk = await call(C.submitReview, { userId: R1, body: {
        group_id: weekly, attendances: [{ user_id: T, was_present: true }] } });
      expect(wk.body).toEqual({ success: true, counted: false });
      // …and a countable one (round still open) still records them
      const countable = await mkEvent(R3, { daysAgo: 3 });
      const ok2 = await call(C.submitReview, { userId: R2, body: {
        group_id: countable, attendances: [{ user_id: T, was_present: true }] } });
      expect(ok2.body).toEqual({ success: true, counted: true });
    });

    it('the prompts no longer ask about cancelled events', async () => {
      const pending = await call(C.getPendingReviews, { userId: R2 });
      ok(pending);
      expect(pending.body.map(r => r.group_id)).not.toContain(cancelledEvent);
    });

    // ── review findings (B2): anonymity, owner edits, late joiners, blocks ──
    it('a meetup counts only once its review round has closed — never vote by vote', async () => {
      const before = await statsOfT();
      const fresh = await mkEvent(R3, { daysAgo: 3 });
      await vote(fresh, R1, true);
      expect(await statsOfT()).toEqual(before);          // open round: nothing moves…
      await vote(fresh, R2, true);
      expect(await statsOfT()).toEqual(before);
      await db.query(`UPDATE groups SET date = NOW() - INTERVAL '20 days' WHERE id = $1`, [fresh]);
      expect((await statsOfT()).events).toBe(before.events + 1); // …closed: counts once, final
    });

    it('moving, re-dating, making weekly or deleting a past group afterwards keeps the meetup', async () => {
      const before = await statsOfT();
      const gid = await mkEvent(R3);
      await db.query(
        `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present, created_at)
         VALUES ($1, $2, $3, TRUE, NOW() - INTERVAL '19 days')`, [gid, R1, T]);
      const counts = async () => (await statsOfT()).events;
      expect(await counts()).toBe(before.events + 1);
      await db.query(`UPDATE groups SET date = NOW() + INTERVAL '10 days' WHERE id = $1`, [gid]); // the next meetup
      expect(await counts()).toBe(before.events + 1);
      // …and once that date has passed, the CLOSED round does not reopen
      await db.query(`UPDATE groups SET date = NOW() - INTERVAL '2 days' WHERE id = $1`, [gid]);
      const late = await call(C.submitReview, { userId: R2, body: {
        group_id: gid, attendances: [{ user_id: T, was_present: false }] } });
      expect(late.body).toEqual({ success: true, counted: false });
      expect(await counts()).toBe(before.events + 1);
      await db.query('UPDATE groups SET is_recurring_weekly = TRUE WHERE id = $1', [gid]);
      expect(await counts()).toBe(before.events + 1);
      await db.query(`UPDATE groups SET date = NOW() + INTERVAL '10 days', deleted_at = NOW() WHERE id = $1`, [gid]);
      expect(await counts()).toBe(before.events + 1);
    });

    it('a group deleted ON its own day never counts — even with ticks written afterwards (legacy prompts)', async () => {
      const before = await statsOfT();
      const gid = await mkEvent(R3);
      // date-only event at 00:00, called off by deleting it at 10:00 that day
      await db.query(`UPDATE groups SET date = date_trunc('day', date),
                                        deleted_at = date_trunc('day', date) + INTERVAL '10 hours' WHERE id = $1`, [gid]);
      await vote(gid, R1, true); await vote(gid, R2, true);
      expect((await statsOfT()).events).toBe(before.events);
    });

    it('late joiners are neither asked nor listed, their answers are not recorded, nobody can vote on them', async () => {
      const late = await mkU('smoke-tier-late@x.com', 'Lou');
      const gid = await mkEvent(R3, { daysAgo: 3 });
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [gid, late]); // joined NOW
      const own = await call(C.getPendingReviews, { userId: late });
      ok(own);
      expect(own.body.map(r => r.group_id)).not.toContain(gid);
      const r1 = await call(C.getPendingReviews, { userId: R1 });
      const listed = r1.body.find(r => r.group_id === gid).members.map(m => m.id);
      expect(listed).toContain(T);
      expect(listed).not.toContain(late);
      const reopen = await call(C.getReviewForGroup, { userId: late, params: { groupId: String(gid) } });
      expect(reopen.statusCode).toBe(404);

      const theirs = await call(C.submitReview, { userId: late, body: {
        group_id: gid, attendances: [{ user_id: T, was_present: false }] } });
      expect(theirs.body).toEqual({ success: true, counted: false });
      const mine = await call(C.submitReview, { userId: R1, body: {
        group_id: gid, attendances: [{ user_id: late, was_present: true }, { user_id: T, was_present: true }] } });
      expect(mine.body).toEqual({ success: true, counted: true });
      const votes = (await db.query(
        `SELECT reviewer_id, reviewed_user_id FROM event_reviews
          WHERE group_id = $1 AND reviewer_id <> reviewed_user_id`, [gid])).rows;
      expect(votes).toEqual([{ reviewer_id: R1, reviewed_user_id: T }]);
    });

    it('blocks: neither side is listed in the other\'s prompt, and the blocked one\'s ✗ never lands', async () => {
      const H = await mkU('smoke-tier-h@x.com', 'Hal');
      const gid = await mkEvent(R3, { daysAgo: 3 });
      await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at)
                       VALUES ($1, $2, 'member', NOW() - INTERVAL '40 days')`, [gid, H]);
      await db.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'blocked')`, [T, H]);
      const promptOf = async (uid) => (await call(C.getPendingReviews, { userId: uid })).body
        .find(r => r.group_id === gid).members.map(m => m.id);
      const hSees = await promptOf(H);
      expect(hSees).not.toContain(T);
      expect(hSees).toContain(R1);
      expect(await promptOf(T)).not.toContain(H);

      await vote(gid, R1, true);
      const res = await call(C.submitReview, { userId: H, body: {
        group_id: gid, attendances: [{ user_id: T, was_present: false }, { user_id: R1, was_present: true }] } });
      expect(res.body).toEqual({ success: true, counted: true });
      const hVotes = (await db.query(
        `SELECT reviewed_user_id, was_present FROM event_reviews
          WHERE group_id = $1 AND reviewer_id = $2 AND reviewed_user_id <> reviewer_id`, [gid, H])).rows;
      expect(hVotes).toEqual([{ reviewed_user_id: R1, was_present: true }]);
      const before = await statsOfT();
      await db.query(`UPDATE groups SET date = NOW() - INTERVAL '20 days' WHERE id = $1`, [gid]);
      expect((await statsOfT()).events).toBe(before.events + 1); // 1:0 — the ✗ never landed
    });

    it('profile, roster and join-request payloads carry the step (the level, never the counts)', async () => {
      const prof = await call(C.getUserById, { userId: R1, params: { id: String(T) } });
      ok(prof);
      expect(prof.body.attendance_tier).toBe(1);
      expect(prof.body.attendance_step).toBe(1);
      expect(prof.body).not.toHaveProperty('confirmed_events');
      expect(prof.body).not.toHaveProperty('confirmers');

      const roster = await call(C.getGroupMembers, { userId: R3, params: { id: String(firstEvent) } });
      ok(roster);
      expect(roster.body.members.find(m => m.id === T).attendance_tier).toBe(1);
      expect(roster.body.members.find(m => m.id === T).attendance_step).toBe(1);

      const reqGroup = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members, is_private)
         VALUES ('Tier-Anfrage','group', NOW() + INTERVAL '5 days', $1, 'Sport', 'Wien', 10, TRUE) RETURNING id`,
        [R1])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [reqGroup, R1]);
      await db.query(`INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1,$2,'pending')`, [reqGroup, T]);
      const reqs = await call(C.getJoinRequests, { userId: R1, params: { id: String(reqGroup) } });
      ok(reqs);
      expect(reqs.body.find(r => r.user_id === T).user_attendance_tier).toBe(1);
      expect(reqs.body.find(r => r.user_id === T).user_attendance_step).toBe(1);
      const deck = await call(C.getAllJoinRequests, { userId: R1 });
      ok(deck);
      expect(deck.body.find(r => r.user_id === T).user_attendance_tier).toBe(1);
      expect(deck.body.find(r => r.user_id === T).user_attendance_step).toBe(1);
    });

    it('reads never write: the seal and updated_at are untouched by tier reads', async () => {
      const before = (await db.query('SELECT is_trusted_user, trusted_count, updated_at FROM users WHERE id = $1', [T])).rows[0];
      await call(C.getMyAttendance, { userId: T });
      await call(C.getUserById, { userId: R1, params: { id: String(T) } });
      await call(C.getGroupMembers, { userId: R3, params: { id: String(firstEvent) } });
      const after = (await db.query('SELECT is_trusted_user, trusted_count, updated_at FROM users WHERE id = $1', [T])).rows[0];
      expect(after).toEqual(before);
    });

    it('the optional covering index exists and its migration step did not fail', async () => {
      const idx = (await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_event_reviews_votes'`)).rowCount;
      expect(idx).toBe(1);
      const { getMigrationHealth } = await import('../../src/config/migrations.js');
      expect(getMigrationHealth().stepFailures.map(f => f.label || String(f))
        .filter(l => /Abzeichen/.test(l))).toEqual([]);
    });

    it('fail-soft in the boot window: missing table/column → null / field absent, nothing logged, no throw', async () => {
      at._resetAttendanceLog(); // no earlier log may mute this one
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = await db.pool.connect();
      let logged;
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE event_reviews RENAME TO event_reviews_boot');
        expect(await at.getAttendanceStats(client, [T])).toBeNull();
        await client.query('ROLLBACK');

        await client.query('BEGIN');
        await client.query('ALTER TABLE groups RENAME COLUMN did_not_take_place TO dntp_boot');
        const rows = [{ id: T }];
        await at.attachAttendanceTiers(client, rows);
        expect(rows[0]).not.toHaveProperty('attendance_tier');
        expect(rows[0]).not.toHaveProperty('attendance_step');
        await client.query('ROLLBACK');
      } finally {
        logged = err.mock.calls.slice(); // mockRestore() empties mock.calls
        client.release();
        err.mockRestore();
      }
      expect(logged).toEqual([]);
      expect((await statsOfT()).tier).toBe(1);
    });

    it('the seal recompute never lowers: an admin-granted seal and a higher count survive the next review', async () => {
      const S = await mkU('smoke-tier-seal@x.com', 'Sol');
      const gid = await mkEvent(R3, { daysAgo: 3 });
      await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at)
                       VALUES ($1, $2, 'member', NOW() - INTERVAL '40 days')`, [gid, S]);
      await db.query('UPDATE users SET is_trusted_user = TRUE, trusted_count = 7 WHERE id = $1', [S]);
      const res = await call(C.submitReview, { userId: R2, body: {
        group_id: gid, attendances: [{ user_id: S, was_present: true }] } });
      expect(res.body).toEqual({ success: true, counted: true });
      const seal = (await db.query('SELECT is_trusted_user, trusted_count FROM users WHERE id = $1', [S])).rows[0];
      expect(seal).toEqual({ is_trusted_user: true, trusted_count: 7 }); // was: false / 1
    });

    it("deleting a confirmer's account takes their ticks with it (FKs cascade, no 500)", async () => {
      const gone = await mkU('smoke-tier-gone@x.com', 'Gina');
      const gid = await mkEvent(R3);
      await vote(gid, gone, true); await vote(gid, R3, true);
      const before = await statsOfT();
      await db.query('DELETE FROM users WHERE id = $1', [gone]);
      const after = await statsOfT();
      expect(after.events).toBe(before.events);          // R3's tick alone is still a majority
      expect(after.confirmers).toBe(before.confirmers - 1);
    });
  });

  // ── Abstimmungen im Chat (B1, tester 06.10.2026) ─────────────────────────
  // Real Postgres, because the create path is ONE data-modifying CTE with
  // unnest(text[], date[], time[]), votes are version-bumping CTEs that take
  // the poll-row lock, and the summary counts only CURRENT members.
  describe('chat polls (B1)', () => {
    let O, M1, M2, M3, CM, OUT, grp, club, pl, choicePoll, datePoll;
    const mk = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1995-03-03','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    // Dates relative to Vienna's calendar day, computed by Postgres — never
    // hard-coded, so the suite cannot turn into a time bomb.
    const viennaDay = async (offset) => (await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'Europe/Vienna')::date + $1::int, 'YYYY-MM-DD') AS d`, [offset])).rows[0].d;
    const messagesCount = async () => Number((await db.query('SELECT COUNT(*)::int AS n FROM messages')).rows[0].n);
    const create = (userId, groupId, body) => call(pl.createPoll, { userId, params: { groupId: String(groupId) }, body });
    const vote = (userId, messageId, choices) => call(pl.votePoll, { userId, params: { messageId: String(messageId) }, body: { choices } });
    const close = (userId, messageId) => call(pl.closePoll, { userId, params: { messageId: String(messageId) } });

    beforeAll(async () => {
      pl = await import('../../src/controllers/pollController.js');
      O = await mk('smoke-poll-owner@x.com', 'Olga');
      M1 = await mk('smoke-poll-m1@x.com', 'Mia');
      M2 = await mk('smoke-poll-m2@x.com', 'Max');
      M3 = await mk('smoke-poll-m3@x.com', 'Mo');
      CM = await mk('smoke-poll-cm@x.com', 'Cem');
      OUT = await mk('smoke-poll-out@x.com', 'Otto');
      grp = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
         VALUES ('Poll-Gruppe','group', NOW() + INTERVAL '3 days', $1, 'Sport', 'Wien', 20) RETURNING id`, [O])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member'),($1,$4,'member'),($1,$5,'member'),($1,$6,'member')`,
        [grp, O, M1, M2, M3, CM]);
      club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, chat_only_owner)
         VALUES ('Poll-Club','club', $1, 'Sport', 'Wien', 50, TRUE) RETURNING id`, [O])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member'),($1,$4,'admin')`,
        [club, O, M1, CM]);
    });

    it('the migration ran, all three tables exist, and every FK has its ON DELETE rule', async () => {
      const { getMigrationHealth } = await import('../../src/config/migrations.js');
      expect(getMigrationHealth().stepFailures.map(f => f.label || String(f)).filter(l => /chat polls/.test(l))).toEqual([]);
      for (const t of ['message_polls', 'message_poll_options', 'message_poll_votes']) {
        expect((await db.query('SELECT to_regclass($1) AS r', [t])).rows[0].r).not.toBeNull();
      }
      const fks = (await db.query(
        `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref, confdeltype
           FROM pg_constraint WHERE contype = 'f'
            AND conrelid::regclass::text IN ('message_polls','message_poll_options','message_poll_votes')`)).rows;
      const rule = (tbl, ref) => fks.filter(f => f.tbl === tbl && f.ref === ref).map(f => f.confdeltype).sort().join('');
      expect(rule('message_polls', 'messages')).toBe('cn');      // the poll CASCADE, its result pill SET NULL
      expect(rule('message_polls', 'users')).toBe('n');          // closed_by SET NULL
      expect(rule('message_poll_options', 'message_polls')).toBe('c');
      expect(rule('message_poll_votes', 'message_polls')).toBe('c');
      expect(rule('message_poll_votes', 'users')).toBe('c');
    });

    it('a choice poll is a normal messages row with a readable one-line content', async () => {
      const res = await create(M1, grp, { kind: 'choice', question: 'Was machen wir?', options: [{ label: 'Bowling' }, { label: 'Kino' }] });
      ok(res);
      expect(res.statusCode).toBe(201);
      choicePoll = res.body.id;
      expect(res.body.poll).toMatchObject({ kind: 'choice', version: 0, voter_count: 0, my_votes: [] });
      const row = (await db.query('SELECT message_type, content FROM messages WHERE id = $1', [choicePoll])).rows[0];
      expect(row).toEqual({ message_type: 'poll', content: '📊 Was machen wir? — Bowling · Kino' });
      expect(row.content).not.toContain('\n');

      const page = await call(C.getMessages, { userId: M2, params: { groupId: String(grp) }, query: {} });
      ok(page);
      const rows = Array.isArray(page.body) ? page.body : page.body.messages;
      const p = rows.find(m => m.id === choicePoll);
      expect(p.poll).toMatchObject({ version: 0, voter_count: 0, my_votes: [] });
      for (const m of rows.filter(r => r.message_type !== 'poll')) expect(m).not.toHaveProperty('poll');
    });

    it('a date poll is stored sorted (all-day first), strings round-trip, multi forced, German labels by default', async () => {
      const d2 = await viennaDay(2);
      const d3 = await viennaDay(3);
      const res = await create(M1, grp, { kind: 'date', question: 'Wann passt es euch?', multi: false, options: [
        { date: d3, time: '18:00' }, { date: d2, time: null }, { date: d3, time: null },
      ] });
      ok(res);
      datePoll = res.body.id;
      expect(res.body.poll.multi).toBe(true);
      expect(res.body.poll.options.map(o => [o.date, o.time])).toEqual([[d2, null], [d3, null], [d3, '18:00']]);
      const opts = (await db.query(
        `SELECT position, to_char(opt_date,'YYYY-MM-DD') AS d, to_char(opt_time,'HH24:MI') AS t, label
           FROM message_poll_options WHERE message_id = $1 ORDER BY position`, [datePoll])).rows;
      expect(opts.map(o => [o.d, o.t])).toEqual([[d2, null], [d3, null], [d3, '18:00']]);
      expect(opts[2].label).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So) \d\d\.\d\d\.(\d{4})? 18:00$/);
    });

    it('invalid input → 400 POLL_INVALID and not a single row written', async () => {
      const before = await messagesCount();
      const cases = [
        { kind: 'choice', question: 'q', options: [{ label: 'nur eine' }] },
        { kind: 'choice', question: 'q', options: [{ label: 'Kino' }, { label: ' kino' }] },
        { kind: 'date', question: 'q', options: [{ date: await viennaDay(-2) }, { date: await viennaDay(2) }] },
        { kind: 'date', question: 'q', options: [{ date: await viennaDay(400) }, { date: await viennaDay(2) }] },
        { kind: 'date', question: 'q', options: [{ date: await viennaDay(2), time: '24:00' }, { date: await viennaDay(3) }] },
        { kind: 'sticker', question: 'q', options: [] },
      ];
      for (const body of cases) {
        const res = await create(M1, grp, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.body.code).toBe('POLL_INVALID');
      }
      expect(await messagesCount()).toBe(before);
    });

    it('moderation: a blocked word in an option → 422, nothing written', async () => {
      const before = await messagesCount();
      const res = await create(M1, grp, { kind: 'choice', question: 'Wer kommt?', options: [{ label: 'Hurensohn' }, { label: 'Kino' }] });
      expect(res.statusCode).toBe(422);
      expect(await messagesCount()).toBe(before);
    });

    it('permissions: outsider 403; owner-only club: member 403 isOwnerOnly, owner 201, members still vote', async () => {
      expect((await create(OUT, grp, { kind: 'choice', question: 'q', options: [{ label: 'A' }, { label: 'B' }] })).statusCode).toBe(403);
      const m = await create(M1, club, { kind: 'choice', question: 'q', options: [{ label: 'A' }, { label: 'B' }] });
      expect(m.statusCode).toBe(403);
      expect(m.body.isOwnerOnly).toBe(true);
      const o = await create(O, club, { kind: 'choice', question: 'Clubabend?', options: [{ label: 'Ja' }, { label: 'Nein' }] });
      expect(o.statusCode).toBe(201);
      ok(await vote(M1, o.body.id, [0]));
    });

    it('POST /api/messages still refuses message_type "poll" (no forged poll bubbles)', async () => {
      const res = await call(C.sendMessage, { userId: M1, body: { groupId: grp, content: 'x', message_type: 'poll' } });
      expect(res.statusCode).toBe(400);
    });

    it('single choice: vote, change, retract — one ballot row, version climbs each time', async () => {
      let r = await vote(M2, choicePoll, [1]);
      ok(r);
      expect(r.body.poll).toMatchObject({ voter_count: 1, my_votes: [1], version: 1 });
      expect(r.body.poll.options.map(o => o.votes)).toEqual([0, 1]);
      r = await vote(M2, choicePoll, [0]);
      expect(r.body.poll.version).toBe(2);
      expect((await db.query('SELECT COUNT(*)::int AS n FROM message_poll_votes WHERE message_id = $1', [choicePoll])).rows[0].n).toBe(1);
      r = await vote(M2, choicePoll, []);
      expect(r.body.poll).toMatchObject({ voter_count: 0, version: 3, my_votes: [] });
      expect((await db.query('SELECT COUNT(*)::int AS n FROM message_poll_votes WHERE message_id = $1', [choicePoll])).rows[0].n).toBe(0);
    });

    it('multi (date) poll counts every chosen option once per voter', async () => {
      const r = await vote(M2, datePoll, [0, 2]);
      ok(r);
      expect(r.body.poll.voter_count).toBe(1);
      expect(r.body.poll.options.map(o => o.votes)).toEqual([1, 0, 1]);
    });

    it('vote errors: wrong shape 400, unknown/text/deleted message 404, outsider 403', async () => {
      expect((await vote(M2, choicePoll, [0, 1])).statusCode).toBe(400);
      expect((await vote(M2, choicePoll, [9])).statusCode).toBe(400);
      expect((await vote(M2, choicePoll, ['x'])).statusCode).toBe(400);
      expect((await call(pl.votePoll, { userId: M2, params: { messageId: 'temp-1726500000' }, body: { choices: [0] } })).statusCode).toBe(400);
      expect((await vote(M2, 99999999, [0])).statusCode).toBe(404);
      const text = await call(C.sendMessage, { userId: M2, body: { groupId: grp, content: 'nur Text' } });
      expect((await vote(M2, text.body.id, [0])).statusCode).toBe(404);
      expect((await vote(OUT, choicePoll, [0])).statusCode).toBe(403);
      const tmp = await create(M1, grp, { kind: 'choice', question: 'Weg damit?', options: [{ label: 'A' }, { label: 'B' }] });
      ok(await call(C.deleteMessage, { userId: M1, params: { messageId: String(tmp.body.id) } }));
      expect((await vote(M2, tmp.body.id, [0])).statusCode).toBe(404);
    });

    it('concurrency: parallel voters all count; one user racing two choices leaves ONE ballot', async () => {
      const before = (await vote(M3, choicePoll, [])).body.poll.version;
      const rs = await Promise.all([M1, M2, M3, CM, O].map(u => vote(u, choicePoll, [0])));
      rs.forEach(r => ok(r));
      const after = (await readSummary(choicePoll)).version;
      expect(after).toBe(before + 5);
      const [a, b] = await Promise.all([vote(M1, choicePoll, [0]), vote(M1, choicePoll, [1])]);
      ok(a); ok(b);
      expect((await db.query('SELECT COUNT(*)::int AS n FROM message_poll_votes WHERE message_id = $1 AND user_id = $2', [choicePoll, M1])).rows[0].n).toBe(1);
    });

    // Reads the current summary like getMessages does (viewer = O).
    const readSummary = async (id) => {
      const { readPollSummaries } = await import('../../src/utils/polls.js');
      return (await readPollSummaries(db, [id], O)).get(id);
    };

    // Review B1: recounting by membership showed, right after the named
    // "X hat die Gruppe verlassen" line, exactly how X had voted.
    it('a voter who leaves keeps their ballot counted, and can no longer change it', async () => {
      const before = await readSummary(choicePoll);
      await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [grp, M3]);
      const after = await readSummary(choicePoll);
      expect(after.voter_count).toBe(before.voter_count);
      expect(after.options.map(o => o.votes)).toEqual(before.options.map(o => o.votes));
      expect((await vote(M3, choicePoll, [1])).statusCode).toBe(403);
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [grp, M3]);
      expect((await readSummary(choicePoll)).voter_count).toBe(before.voter_count);
    });

    it('close: member 403; author closes once with ONE result pill; votes afterwards 409; co-manager and non-member admin may close', async () => {
      expect((await close(M2, choicePoll)).statusCode).toBe(403);
      const pillsBefore = Number((await db.query(
        `SELECT COUNT(*)::int AS n FROM messages WHERE group_id = $1 AND message_type = 'system' AND content LIKE '📊 Ergebnis%'`, [grp])).rows[0].n);
      const c1 = await close(M1, choicePoll);
      ok(c1);
      expect(c1.body.poll.closed).toBe(true);
      const late = await vote(M2, choicePoll, [1]);
      expect(late.statusCode).toBe(409);
      expect(late.body.code).toBe('POLL_CLOSED');
      ok(await close(M1, choicePoll)); // idempotent
      const pillsAfter = Number((await db.query(
        `SELECT COUNT(*)::int AS n FROM messages WHERE group_id = $1 AND message_type = 'system' AND content LIKE '📊 Ergebnis%'`, [grp])).rows[0].n);
      expect(pillsAfter).toBe(pillsBefore + 1);

      const clubPoll = await create(O, club, { kind: 'choice', question: 'Termin?', options: [{ label: 'A' }, { label: 'B' }] });
      ok(await close(CM, clubPoll.body.id));                 // co-manager (role = admin)
      const p3 = await create(M1, grp, { kind: 'choice', question: 'Admin?', options: [{ label: 'A' }, { label: 'B' }] });
      ok(await close(A, p3.body.id));                         // platform admin, not a member
    });

    it('taking a closed poll down takes its result pill down too (it repeats user text and cannot be reported)', async () => {
      const p = await create(M2, grp, { kind: 'choice', question: 'Pille weg?', options: [{ label: 'A' }, { label: 'B' }] });
      ok(await vote(M2, p.body.id, [0]));
      ok(await close(M2, p.body.id));
      const link = (await db.query('SELECT result_message_id FROM message_polls WHERE message_id = $1', [p.body.id])).rows[0];
      expect(link.result_message_id).toBeTruthy();
      ok(await call(C.deleteMessage, { userId: M2, params: { messageId: String(p.body.id) } }));
      const pill = (await db.query('SELECT is_deleted, message_type FROM messages WHERE id = $1', [link.result_message_id])).rows[0];
      expect(pill).toEqual({ is_deleted: true, message_type: 'system' });
    });

    it('a 10×60 poll is fully visible to admins in the report (clip > 500)', async () => {
      const long = Array.from({ length: 10 }, (_, i) => ({ label: `${String(i).repeat(1)}${'x'.repeat(59)}` }));
      const res = await create(M1, grp, { kind: 'choice', question: 'q'.repeat(140), options: long });
      ok(res);
      ok(await call(C.createReport, { userId: M2, body: { reported_type: 'message', reported_id: res.body.id, reason: 'spam' } }));
      const reports = await call(C.getReports, { userId: A, query: {} });
      ok(reports);
      const list = reports.body.reports || reports.body;
      const r = list.find(x => Number(x.reported_id) === Number(res.body.id));
      expect(r.target.content.length).toBeGreaterThan(500);
      expect(r.target.content).toContain(long[9].label);
    });

    it('a poll can be replied to (quote shows the 📊 line) and reacted to', async () => {
      const reply = await call(C.sendMessage, { userId: M2, body: { groupId: grp, content: 'Ich bin für Kino', reply_to_id: datePoll } });
      ok(reply);
      expect(reply.body.reply_to).toMatchObject({ message_type: 'poll' });
      expect(reply.body.reply_to.content.startsWith('📅 ')).toBe(true);
      ok(await call(C.setMessageReaction, { userId: M2, params: { messageId: String(datePoll) }, body: { emoji: '👍' } }));
    });

    it('GDPR export lists the person\'s ballots', async () => {
      const exp = await call(C.exportData, { userId: M2 });
      ok(exp);
      const votes = exp.body.poll_votes;
      expect(Array.isArray(votes)).toBe(true);
      expect(votes.find(v => v.message_id === datePoll)).toMatchObject({ question: 'Wann passt es euch?' });
    });

    it('cascades: deleting the poll message, a voter, the author and the closer never blocks and never orphans', async () => {
      const p = await create(M2, grp, { kind: 'choice', question: 'Kaskade?', options: [{ label: 'A' }, { label: 'B' }] });
      ok(await vote(M3, p.body.id, [1]));
      await db.query('DELETE FROM messages WHERE id = $1', [p.body.id]);
      for (const t of ['message_polls', 'message_poll_options', 'message_poll_votes']) {
        expect((await db.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE message_id = $1`, [p.body.id])).rows[0].n).toBe(0);
      }
      // a voter's account
      await db.query('DELETE FROM users WHERE id = $1', [M3]);
      expect((await db.query('SELECT COUNT(*)::int AS n FROM message_poll_votes WHERE user_id = $1', [M3])).rows[0].n).toBe(0);
      // the AUTHOR of datePoll (not the group owner)
      await db.query('DELETE FROM users WHERE id = $1', [M1]);
      const row = (await db.query('SELECT user_id FROM messages WHERE id = $1', [datePoll])).rows[0];
      expect(row.user_id).toBeNull();
      const page = await call(C.getMessages, { userId: M2, params: { groupId: String(grp) }, query: {} });
      ok(page);
      // the CLOSER (co-manager CM closed a club poll)
      await db.query('DELETE FROM users WHERE id = $1', [CM]);
      const closedBy = (await db.query(`SELECT COUNT(*)::int AS n FROM message_polls WHERE closed_at IS NOT NULL AND closed_by IS NULL`)).rows[0].n;
      expect(closedBy).toBeGreaterThan(0);
    });

    it('boot window (LAST): without the poll tables chat still loads; writes answer 503', async () => {
      try {
        await db.query('ALTER TABLE message_polls RENAME TO message_polls_bootwin');
        const page = await call(C.getMessages, { userId: M2, params: { groupId: String(grp) }, query: {} });
        ok(page);
        const rows = Array.isArray(page.body) ? page.body : page.body.messages;
        const p = rows.find(m => m.id === datePoll);
        expect(p.content.startsWith('📅 ')).toBe(true);
        expect(p).not.toHaveProperty('poll');
        const before = await messagesCount();
        const c = await create(M2, grp, { kind: 'choice', question: 'Boot?', options: [{ label: 'A' }, { label: 'B' }] });
        expect(c.statusCode).toBe(503);
        expect(c.body.code).toBe('POLLS_UNAVAILABLE');
        expect(await messagesCount()).toBe(before);
        expect((await vote(M2, datePoll, [0])).statusCode).toBe(503);
        expect((await close(O, datePoll)).statusCode).toBe(503);
      } finally {
        await db.query('ALTER TABLE IF EXISTS message_polls_bootwin RENAME TO message_polls');
      }
    });
  });


  // Profile completeness (10.10.2026): only the onboarding wizard ever set
  // onboarding_completed, so a profile completed in the editor stayed blocked
  // from every group. The rule (utils/profileCompleteness.js) now heals the
  // flag on save, app start, login and at the join gate; a one-shot backfill
  // unlocks those already stuck; redoing the wizard keeps song and bio.
  describe('profile completeness (10.10.2026)', () => {
    const mkStuck = async (email, { gender = null, interests = [] } = {}) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, interests, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1, 'Elli', '1999-05-05', $2, $3::jsonb, $4, FALSE, 'email') RETURNING id`,
      [email, gender, JSON.stringify(interests), avatar])).rows[0].id;
    const flag = async (id) =>
      (await db.query('SELECT onboarding_completed FROM users WHERE id = $1', [id])).rows[0].onboarding_completed;

    it('the backfill ran clean and its SQL rule matches the JS rule', async () => {
      const { getMigrationHealth } = await import('../../src/config/migrations.js');
      expect(getMigrationHealth().stepFailures.map(f => f.label || String(f))
        .filter(l => /onboarding_completed backfill/.test(l))).toEqual([]);
      const { PROFILE_COMPLETE_SQL } = await import('../../src/utils/profileCompleteness.js');
      const complete = await mkStuck('smoke-pc-1@x.com', { gender: 'female', interests: ['Musik', 'Kunst', 'Yoga'] });
      const blank = await mkStuck('smoke-pc-2@x.com', { gender: 'female', interests: ['Musik', ' ', 'Kunst'] });
      const noGender = await mkStuck('smoke-pc-2b@x.com', { interests: ['Musik', 'Kunst', 'Yoga'] });
      const r = await db.query(
        `SELECT id FROM users WHERE id = ANY($1::int[]) AND ${PROFILE_COMPLETE_SQL}`, [[complete, blank, noGender]]);
      expect(r.rows.map(x => x.id)).toEqual([complete]);
    });

    it('saving a complete profile in the editor unlocks it in the same response', async () => {
      const u = await mkStuck('smoke-pc-3@x.com');
      const res = await call(C.updateProfile, { userId: u, body: { gender: 'female', interests: ['Musik', 'Kunst', 'Yoga'] } });
      ok(res);
      expect(res.body.onboarding_completed).toBe(true);
      expect(await flag(u)).toBe(true);
    });

    it('an already stuck user is unlocked on the next app start (GET /api/auth/profile)', async () => {
      const u = await mkStuck('smoke-pc-4@x.com', { gender: 'diverse', interests: ['Gaming', 'Kochen', 'Reisen'] });
      const res = await call(C.getProfile, { userId: u });
      ok(res);
      expect(res.body.onboarding_completed).toBe(true);
      expect(await flag(u)).toBe(true);
    });

    it('the join gate heals a complete profile and names what an incomplete one lacks', async () => {
      const { requireCompleteProfile } = await import('../../src/middleware/auth.js');
      const gate = async (userId) => {
        let passed = false;
        const res = await call((req, r) => requireCompleteProfile(req, r, () => { passed = true; }), { userId });
        return { res, passed };
      };
      const done = await mkStuck('smoke-pc-5@x.com', { gender: 'male', interests: ['Laufen', 'Tennis', 'Golf'] });
      const ok1 = await gate(done);
      expect(ok1.passed).toBe(true);
      expect(await flag(done)).toBe(true);

      const half = await mkStuck('smoke-pc-5b@x.com', { interests: ['Laufen'] });
      const no = await gate(half);
      expect(no.passed).toBe(false);
      expect(no.res.statusCode).toBe(403);
      expect(no.res.body).toMatchObject({ code: 'PROFILE_INCOMPLETE', missing: ['gender', 'interests'] });
      expect(await flag(half)).toBe(false);
    });

    it('redoing the wizard keeps the favourite song and a bio left blank', async () => {
      const u = await mkStuck('smoke-pc-6@x.com', { gender: 'female', interests: ['Musik', 'Kunst', 'Yoga'] });
      ok(await call(C.updateProfile, { userId: u, body: { bio: 'Hallo aus Wien', favorite_song: { title: 'Song', artist: 'X' } } }));
      ok(await call(C.completeOnboarding, { userId: u, body: {
        gender: 'female', interests: ['Musik', 'Kunst', 'Yoga'], bio: '', photos: [], location: '' } }));
      const r = await db.query('SELECT bio, favorite_song, onboarding_completed FROM users WHERE id = $1', [u]);
      expect(r.rows[0].bio).toBe('Hallo aus Wien');
      expect(r.rows[0].favorite_song).toMatchObject({ title: 'Song' });
      expect(r.rows[0].onboarding_completed).toBe(true);
    });
  });


  // Teilnehmerzahl nachträglich ändern (Tina 10.10.2026): an event at 20 could
  // not be raised (the edit page's stepper used the group cap). The server now
  // checks a CHANGED limit: 2–500 and never below the people already in.
  describe('club event participant limit after creation (10.10.2026)', () => {
    it('raises past 20, accepts the unchanged value, refuses > 500 and below the attendees', async () => {
      const mk = async (email) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ($1, 'Ev', '1995-01-01', 'female', $2, TRUE, 'email') RETURNING id`, [email, avatar])).rows[0].id;
      const host = await mk('smoke-evsize-host@x.com');
      const club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, lat, lng)
         VALUES ('Size Club', 'club', $1, 'Sport', 'Wien', 100, FALSE, 'approved', 48.2, 16.37) RETURNING id`,
        [host])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [club, host]);
      const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
      const created = await call(C.createClubEvent, { userId: host, params: { id: String(club) },
        body: { name: 'Halloween', date: day, time: '20:00', max_members: 20 } });
      expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
      const ev = created.body.id;
      const tooBigNew = await call(C.createClubEvent, { userId: host, params: { id: String(club) },
        body: { name: 'Zu groß', date: day, time: '20:00', max_members: 501 } });
      expect(tooBigNew.statusCode).toBe(400);                // create checks the same 2–500
      const upd = (max) => call(C.updateClubEvent, { userId: host,
        params: { id: String(club), eventId: String(ev) }, body: { max_members: max } });
      const stored = async () => (await db.query('SELECT max_members FROM groups WHERE id = $1', [ev])).rows[0].max_members;

      ok(await upd(80));
      expect(await stored()).toBe(80);
      ok(await upd(80));                                  // GroupEdit always re-sends the value
      expect((await upd(501)).statusCode).toBe(400);
      for (const e of ['smoke-evsize-a@x.com', 'smoke-evsize-b@x.com', 'smoke-evsize-c@x.com']) {
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [ev, await mk(e)]);
      }
      const below = await upd(2);
      expect(below.statusCode).toBe(400);
      expect(below.body.error).toMatch(/bereits \d+ Teilnehmer/);
      expect(await stored()).toBe(80);

      // „ab 18" on club events (Tina 05.11.2026): only „von" is stored and
      // „bis" stays open; an edit that doesn't send the fields keeps them;
      // '' clears. The edit page always showed these fields — they were dropped.
      const age = (body) => call(C.updateClubEvent, { userId: host,
        params: { id: String(club), eventId: String(ev) }, body });
      const ages = async () => (await db.query(
        'SELECT target_age_min AS mn, target_age_max AS mx FROM groups WHERE id = $1', [ev])).rows[0];
      ok(await age({ target_age_min: '18', target_age_max: null }));
      expect(await ages()).toEqual({ mn: 18, mx: null });
      ok(await age({ max_members: 80 }));
      expect(await ages()).toEqual({ mn: 18, mx: null });
      expect((await age({ target_age_min: 30, target_age_max: 20 })).statusCode).toBe(400);
      expect((await age({ target_age_min: 12 })).statusCode).toBe(400);
      ok(await age({ target_age_min: '', target_age_max: '' }));
      expect(await ages()).toEqual({ mn: null, mx: null });
    });
  });


  // ── Engagement nudges (Tina's notification concept, decided 08.11.2026) ──
  // jobs/engagementNudges.js against real Postgres with an INJECTED clock —
  // fixtures live in 2027, so nothing here depends on the real NOW().
  describe('engagement nudges (08.11.2026)', () => {
    let en;
    const sent = [];
    const send = (ids, builder, _body, url, opts) => { sent.push({ ids: [...ids].sort((a, b) => a - b), title: builder('de').title, url, opts }); };
    const posted = [];
    const post = async (groupId, text) => { posted.push({ groupId, text }); };
    const mkU = async (tag, extra = {}) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, push_reminders)
       VALUES ($1, $2, '1996-04-04', 'female', $3, TRUE, 'email', $4) RETURNING id`,
      [`en-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.com`, `En ${tag}`, avatar,
        extra.reminders ?? true])).rows[0].id;
    const mkG = async (owner, { name = 'Spieleabend', type = 'group', date, createdAt = '2027-03-01 12:00' } = {}) => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members, created_at)
         VALUES ($1, $2, $3, $4, 'Spiele', 'Wien', 20, $5) RETURNING id`,
        [name, type, date, owner, createdAt])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', $3)`,
        [id, owner, createdAt]);
      return id;
    };
    const join = (g, u, { at = '2027-03-01 13:00', muted = false } = {}) => db.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at, notifications_muted) VALUES ($1, $2, 'member', $3, $4)`,
      [g, u, at, muted]);

    let pushTexts;
    beforeAll(async () => {
      en = await import('../../src/jobs/engagementNudges.js');
      ({ pushTexts } = await import('../../src/utils/pushLocale.js'));
    });
    beforeEach(() => { sent.length = 0; posted.length = 0; });

    // S2 (Tina 16.11.2026): the memory push moved from the same day to D+1
    // from 12:00 — two hours behind the review push, with its own title. These
    // two used to pin the same-day timing; rewritten on purpose, not „greened".
    it('memory push: every participant the day AFTER a timed event — not that evening, not before 12:00, not twice, minus muted/opted-out/already-shared', async () => {
      const o = await mkU('o'); const p1 = await mkU('p1');
      const off = await mkU('off', { reminders: false }); const mute = await mkU('mute'); const shared = await mkU('shared');
      const g = await mkG(o, { name: 'Bowling', date: '2027-03-10 19:00' });
      for (const u of [p1, off, shared]) await join(g, u);
      await join(g, mute, { muted: true });
      await db.query(`INSERT INTO event_photos (group_id, user_id, url) VALUES ($1, $2, $3)`, [g, shared, avatar]);
      const memory = () => sent.find(s => s.title === '📷 Deine Memory von Bowling');

      await en.runMomentPrompts({ now: '2027-03-10T22:30:00+01:00', send });   // start + 3.5 h: the old slot
      expect(memory()).toBeUndefined();
      await en.runMomentPrompts({ now: '2027-03-11T11:45:00+01:00', send });   // D+1 before noon
      expect(memory()).toBeUndefined();
      await en.runMomentPrompts({ now: '2027-03-11T12:00:00+01:00', send });
      expect(memory().ids).toEqual([o, p1].sort((a, b) => a - b));
      expect(memory().url).toBe('/explore?share=1');
      sent.length = 0;
      await en.runMomentPrompts({ now: '2027-03-11T12:15:00+01:00', send });
      expect(memory()).toBeUndefined();
    });

    it('memory push: a date-only meetup the day after from 12:00 too — never its own evening, never two days later', async () => {
      const o = await mkU('do'); const p = await mkU('dp');
      const g = await mkG(o, { name: 'Picknick', date: '2027-03-12 00:00' });
      await join(g, p);
      await en.runMomentPrompts({ now: '2027-03-12T21:15:00+01:00', send });
      expect(sent.find(s => s.title === '📷 Deine Memory von Picknick')).toBeUndefined();
      await en.runMomentPrompts({ now: '2027-03-13T12:00:00+01:00', send });
      expect(sent.find(s => s.title === '📷 Deine Memory von Picknick').ids).toEqual([o, p].sort((a, b) => a - b));
      const g2 = await mkG(o, { name: 'Zu spät', date: '2027-03-12 00:00' });
      await join(g2, p);
      await en.runMomentPrompts({ now: '2027-03-14T12:00:00+01:00', send });
      expect(sent.find(s => s.title === '📷 Deine Memory von Zu spät')).toBeUndefined();
    });

    // S2 (Tina 16.11.2026): ONE push WHILE a timed event runs — start+120 to
    // start+180 min („lieber nach 2h"; the first build said +60), one of her
    // three lines per event. The claim is global, so every assert picks its
    // push by title (the line names the event and depends on its id —
    // pickLiveVariant). June fixtures (CEST, +02:00), so no other test's
    // clock lands in their windows.
    const live = (g, name) => pushTexts('livePhotoPrompt', { groupName: name, variant: en.pickLiveVariant(g) })('de').title;

    it('live push: once per event from start+120 min, to the participants minus muted/opted-out/already-shared — urgent, gone after an hour', async () => {
      const o = await mkU('lo'); const p = await mkU('lp');
      const off = await mkU('loff', { reminders: false }); const mute = await mkU('lmute'); const shared = await mkU('lshared');
      const g = await mkG(o, { name: 'Quizabend', date: '2027-06-10 19:00' });
      for (const u of [p, off, shared]) await join(g, u);
      await join(g, mute, { muted: true });
      await db.query(`INSERT INTO event_photos (group_id, user_id, url) VALUES ($1, $2, $3)`, [g, shared, avatar]);
      const mine = () => sent.filter(s => s.title === live(g, 'Quizabend'));

      await en.runLivePhotoPrompts({ now: '2027-06-10T20:00:00+02:00', send });   // start + 60 min: the old slot
      await en.runLivePhotoPrompts({ now: '2027-06-10T20:45:00+02:00', send });   // start + 105 min
      expect(mine()).toHaveLength(0);
      await en.runLivePhotoPrompts({ now: '2027-06-10T21:00:00+02:00', send });   // start + 120 min
      expect(mine()).toHaveLength(1);
      expect(mine()[0]).toMatchObject({
        ids: [o, p].sort((a, b) => a - b), url: '/explore?share=1', opts: { urgency: 'high', ttl: 3600 },
      });
      await en.runLivePhotoPrompts({ now: '2027-06-10T21:15:00+02:00', send });   // start + 135 min
      expect(mine()).toHaveLength(1);                                              // not twice
      // …and the memory push the next day still comes: its own marker.
      await en.runMomentPrompts({ now: '2027-06-11T12:00:00+02:00', send });
      expect(sent.find(s => s.title === '📷 Deine Memory von Quizabend').ids).toEqual([o, p].sort((a, b) => a - b));
    });

    it('live push: never for a date-only meetup, never from start+180 or at night (a 21:00 start gets none, 20:45 its 22:45 tick); a solo creator\'s event only once someone joined', async () => {
      const o = await mkU('lno'); const p = await mkU('lnp');
      const allDay = await mkG(o, { name: 'Ganztags', date: '2027-06-12 00:00' });
      await join(allDay, p);
      const solo = await mkG(o, { name: 'Allein', date: '2027-06-12 15:00' });
      // Never ticked inside its window — first asked at start+180: too late.
      const missed = await mkG(o, { name: 'Verpasst', date: '2027-06-12 18:00' });
      await join(missed, p);
      // start+120 = 23:00, already the quiet hours — and the window ends at midnight.
      const late = await mkG(o, { name: 'Spät', date: '2027-06-12 21:00' });
      await join(late, p);
      const edge = await mkG(o, { name: 'Grenzfall', date: '2027-06-12 20:45' });
      await join(edge, p);
      for (const now of ['2027-06-12T01:00:00+02:00', '2027-06-12T10:00:00+02:00', '2027-06-12T17:00:00+02:00',
        '2027-06-12T17:30:00+02:00', '2027-06-12T21:00:00+02:00', '2027-06-12T22:45:00+02:00', '2027-06-12T23:00:00+02:00',
        '2027-06-12T23:45:00+02:00', '2027-06-13T00:30:00+02:00', '2027-06-13T09:00:00+02:00']) {
        await en.runLivePhotoPrompts({ now, send });
      }
      for (const [g, name] of [[allDay, 'Ganztags'], [solo, 'Allein'], [missed, 'Verpasst'], [late, 'Spät']]) {
        expect(sent.filter(s => s.title === live(g, name)), name).toHaveLength(0);
      }
      expect(sent.filter(s => s.title === live(edge, 'Grenzfall'))).toHaveLength(1);
      // Not claimed while alone → asked again on the next tick, once someone is in.
      await join(solo, p);
      await en.runLivePhotoPrompts({ now: '2027-06-12T17:45:00+02:00', send });
      expect(sent.filter(s => s.title === live(solo, 'Allein'))).toHaveLength(1);
    });

    it('live push: a moved event is asked about again on its new date', async () => {
      const o = await mkU('lmo'); const p = await mkU('lmp');
      const g = await mkG(o, { name: 'Verschoben', date: '2027-06-14 18:00' });
      await join(g, p);
      await en.runLivePhotoPrompts({ now: '2027-06-14T20:00:00+02:00', send });
      expect(sent.filter(s => s.title === live(g, 'Verschoben'))).toHaveLength(1);
      await db.query(`UPDATE groups SET date = '2027-06-21 18:00' WHERE id = $1`, [g]);
      await en.runLivePhotoPrompts({ now: '2027-06-21T20:15:00+02:00', send });
      expect(sent.filter(s => s.title === live(g, 'Verschoben'))).toHaveLength(2);
      const marker = await db.query(
        `SELECT to_char(live_prompt_sent_for, 'YYYY-MM-DD HH24:MI') AS m FROM groups WHERE id = $1`, [g]);
      expect(marker.rows[0].m).toBe('2027-06-21 18:00');
    });

    it('„Sag kurz Hallo": a member who joined ≥ 3 h ago and never wrote — once; never the creator, the writer or at night', async () => {
      const o = await mkU('ho'); const quiet = await mkU('hq'); const writer = await mkU('hw'); const fresh = await mkU('hf');
      const g = await mkG(o, { name: 'Laufen', date: '2027-03-20 18:00', createdAt: '2027-03-15 09:00' });
      await join(g, quiet, { at: '2027-03-15 10:00' });
      await join(g, writer, { at: '2027-03-15 10:00' });
      await join(g, fresh, { at: '2027-03-15 13:30' });
      await db.query(`INSERT INTO messages (group_id, user_id, content) VALUES ($1, $2, 'Hi!')`, [g, writer]);

      await en.runSayHello({ now: '2027-03-15T23:30:00+01:00', send });       // night → nothing
      expect(sent.filter(s => s.url === `/chat/${g}`)).toHaveLength(0);
      // joined_at is a naive UTC wall clock (session zone) — 10:00 UTC = 11:00 Vienna.
      await en.runSayHello({ now: '2027-03-16T15:00:00+01:00', send });
      const hello = sent.find(s => s.url === `/chat/${g}`);
      expect(hello.title).toBe('Sag kurz Hallo 👋');
      expect(hello.ids).toEqual([quiet, fresh].sort((a, b) => a - b));
      sent.length = 0;
      await en.runSayHello({ now: '2027-03-16T16:00:00+01:00', send });
      expect(sent.filter(s => s.url === `/chat/${g}`)).toHaveLength(0);
    });

    it('silent chat: stage 1 a day after creation, stage 2 on the eve — each once, never once someone wrote', async () => {
      const o = await mkU('so'); const m = await mkU('sm');
      const g = await mkG(o, { name: 'Brunch', date: '2027-04-10 11:00', createdAt: '2027-04-01 10:00' });
      await join(g, m, { at: '2027-04-01 11:00' });
      const talky = await mkG(o, { name: 'Talky', date: '2027-04-10 11:00', createdAt: '2027-04-01 10:00' });
      await join(talky, m, { at: '2027-04-01 11:00' });
      await db.query(`INSERT INTO messages (group_id, user_id, content) VALUES ($1, $2, 'Wer kommt?')`, [talky, m]);
      // The welcome line is a system message — it must not count as "someone wrote".
      await db.query(`INSERT INTO messages (group_id, user_id, content, message_type) VALUES ($1, NULL, 'Willkommen', 'system')`, [g]);

      await en.runSilenceNudges({ now: '2027-04-01T20:00:00+02:00', post });  // < 24 h old
      expect(posted.filter(p => p.groupId === g)).toHaveLength(0);
      await en.runSilenceNudges({ now: '2027-04-03T12:00:00+02:00', post });
      expect(posted.filter(p => p.groupId === g).map(p => p.text)).toEqual([en.pickLine(1, g)]);
      expect(posted.filter(p => p.groupId === talky)).toHaveLength(0);
      await en.runSilenceNudges({ now: '2027-04-04T12:00:00+02:00', post });
      expect(posted.filter(p => p.groupId === g)).toHaveLength(1);
      // The eve (D-1 from 10:00, Vienna — CEST here).
      await en.runSilenceNudges({ now: '2027-04-09T12:00:00+02:00', post });
      const lines = posted.filter(p => p.groupId === g).map(p => p.text);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe(en.pickLine(2, g, true));
      expect(['Morgen ist es so weit! Oder?', 'Hallooo, das Treffen ist bald! Wollt ihr nicht schon mal klären, wo ihr euch findet? 📍']).toContain(lines[1]);
      await en.runSilenceNudges({ now: '2027-04-09T15:00:00+02:00', post });
      expect(posted.filter(p => p.groupId === g)).toHaveLength(2);
    });

    it('cover reminder: a community with 5 members and no picture — first, then 7 days later the second, then never; not for clubs or with a cover', async () => {
      const o = await mkU('co'); const co = await mkU('cm');
      const mkClub = async (name, { clubType = null, image = null } = {}) => {
        const id = (await db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members, approval_status, club_type, image_url)
           VALUES ($1, 'club', $2, 'Sport', 'Wien', 100, 'approved', $3, $4) RETURNING id`,
          [name, o, clubType, image])).rows[0].id;
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'admin')`, [id, o, co]);
        for (let i = 0; i < 3; i++) await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [id, await mkU(`c${i}`)]);
        return id;
      };
      const plain = await mkClub('Laufrunde');
      const withCover = await mkClub('Mit Bild', { image: avatar });
      const official = await mkClub('Offizieller Club', { clubType: 'official' });
      const titles = () => sent.map(s => s.title);

      await en.runCoverNags({ now: '2027-05-01T12:00:00+02:00', send });
      const first = sent.find(s => s.title === 'Laufrunde');
      expect(first.ids).toEqual([o, co].sort((a, b) => a - b));
      expect(first.url).toBe(`/club/${plain}/edit`);
      expect(titles()).not.toContain('Mit Bild');
      expect(titles()).not.toContain('Offizieller Club');
      const bell = await db.query(
        `SELECT message FROM notifications WHERE user_id = $1 AND type = 'community_cover' AND reference_id = $2`, [o, plain]);
      expect(bell.rows[0].message).toMatch(/^Hey! Deine Community hat schon 5 Mitglieder!/);

      sent.length = 0;
      await en.runCoverNags({ now: '2027-05-05T12:00:00+02:00', send });
      expect(titles()).not.toContain('Laufrunde');
      await en.runCoverNags({ now: '2027-05-08T12:30:00+02:00', send });
      expect(sent.filter(s => s.title === 'Laufrunde')).toHaveLength(1);
      const second = await db.query(
        `SELECT message FROM notifications WHERE user_id = $1 AND type = 'community_cover' AND reference_id = $2 ORDER BY id DESC LIMIT 1`, [o, plain]);
      expect(second.rows[0].message).toMatch(/^Huch! Deine Community hat noch kein Coverbild/);
      sent.length = 0;
      await en.runCoverNags({ now: '2027-05-20T12:00:00+02:00', send });
      expect(titles()).not.toContain('Laufrunde');
      expect(withCover && official).toBeTruthy();
    });
  });


  // ── Onboarding-Umbau (Tina's checklist, 2026-10) ─────────────────────────
  // Gender moved to the sign-up, "Was trifft zu?" (users.motivations) became
  // onboarding step 1, and admins curate the clubs new users see right after
  // (featured_clubs). Real Postgres, because the new pieces are exactly what a
  // mocked db.query cannot judge: a jsonb parameter that must be stringified,
  // the to_jsonb read that must survive a missing column, unnest WITH
  // ORDINALITY into a SMALLINT, an FK cascade, and jsonb operators behind CASE.
  // Dedicated users and clubs only — A/B/D stay untouched for the suites above.
  // KEEP THIS BLOCK LAST: its final tests rename schema objects (restored in
  // finally), and nothing may run after them.
  describe('onboarding rework (2026-10)', () => {
    const regBody = (email, extra = {}) => ({
      email, password: 'Smoke1!pass', name: 'Reg', date_of_birth: '1996-02-02', ...extra });
    const motivationsOf = async (id) =>
      (await db.query('SELECT motivations FROM users WHERE id = $1', [id])).rows[0].motivations;
    let R;                                   // registered through the real register()
    let FO, FM, K1, K2, K3, K4, KP, PLAIN;   // featured: owner, member, clubs, a plain group

    describe('gender at sign-up + "Was trifft zu?"', () => {
      it('both migration steps ran clean on the schema.sql → migrations path', async () => {
        const { getMigrationHealth } = await import('../../src/config/migrations.js');
        expect(getMigrationHealth().stepFailures.map(f => f.label || String(f))
          .filter(l => /motivations|featured_clubs/.test(l))).toEqual([]);
        const col = await db.query(`SELECT data_type, column_default FROM information_schema.columns
                                     WHERE table_name = 'users' AND column_name = 'motivations'`);
        expect(col.rows[0]).toEqual({ data_type: 'jsonb', column_default: null }); // NULL = never asked
        const t = await db.query(`SELECT to_regclass('featured_clubs')::text AS t`);
        expect(t.rows[0].t).toBe('featured_clubs');
      });

      it('register stores the gender picked at sign-up; none or \'\' stays NULL; an unknown one creates nothing', async () => {
        const res = await call(C.register, { body: regBody('smoke-reg-male@x.com', { gender: 'male' }) });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        expect(res.body.user).toMatchObject({ gender: 'male', motivations: null, onboarding_completed: false });
        expect(res.body.token).toEqual(expect.any(String));
        R = res.body.user.id;

        for (const [email, extra] of [['smoke-reg-none@x.com', {}], ['smoke-reg-empty@x.com', { gender: '' }]]) {
          const r = await call(C.register, { body: regBody(email, extra) });
          expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
          expect(r.body.user.gender).toBe(null);
        }

        const bad = await call(C.register, { body: regBody('smoke-reg-bad@x.com', { gender: 'robot' }) });
        expect(bad.statusCode).toBe(400);
        expect(bad.body.code).toBe('GENDER_INVALID');
        expect((await db.query(`SELECT 1 FROM users WHERE email = 'smoke-reg-bad@x.com'`)).rowCount).toBe(0);
      });

      it('the new wizard omits gender: onboarding keeps the sign-up value, sets the flag, stores the answer normalised', async () => {
        const res = await call(C.completeOnboarding, { userId: R, body: {
          interests: ['Laufen', 'Tennis', 'Golf'], location: 'Wien', bio: '', photos: [],
          motivations: ['more_active', 'bogus', 'new_in_town', 'more_active'] } });
        ok(res);
        expect(res.body).toMatchObject({ gender: 'male', onboarding_completed: true });
        // allowlist order, deduped, unknown key dropped — and the response carries it
        expect(res.body.motivations).toEqual(['new_in_town', 'more_active']);
        expect(await motivationsOf(R)).toEqual(['new_in_town', 'more_active']);
      });

      it('old clients keep the answer: an onboarding redo and a profile save without the field', async () => {
        ok(await call(C.completeOnboarding, { userId: R, body: {
          gender: 'male', interests: ['Laufen', 'Tennis', 'Golf'], location: 'Wien', bio: '', photos: [] } }));
        ok(await call(C.updateProfile, { userId: R, body: { bio: 'Hallo', location: 'Wien', motivations: null } }));
        expect(await motivationsOf(R)).toEqual(['new_in_town', 'more_active']);
      });

      it('an onboarding body without interests (or gender) no longer wipes them', async () => {
        ok(await call(C.completeOnboarding, { userId: R, body: { location: 'Wien' } }));
        const r = (await db.query('SELECT interests, gender FROM users WHERE id = $1', [R])).rows[0];
        expect(r).toEqual({ interests: ['Laufen', 'Tennis', 'Golf'], gender: 'male' });
      });

      it('updateProfile: [] clears, a new answer replaces, a malformed one is refused', async () => {
        const cleared = await call(C.updateProfile, { userId: R, body: { motivations: [] } });
        ok(cleared);
        expect(cleared.body.motivations).toEqual([]);
        expect(await motivationsOf(R)).toEqual([]);

        const set = await call(C.updateProfile, { userId: R, body: { motivations: ['discover_places'] } });
        expect(set.body.motivations).toEqual(['discover_places']);

        const bad = await call(C.updateProfile, { userId: R, body: { motivations: 'discover_places', bio: 'nope' } });
        expect(bad.statusCode).toBe(400);
        expect(bad.body.code).toBe('MOTIVATIONS_INVALID');
        const row = (await db.query('SELECT motivations, bio FROM users WHERE id = $1', [R])).rows[0];
        expect(row).toEqual({ motivations: ['discover_places'], bio: 'Hallo' });   // nothing written
      });

      it('a user who was never asked reads as null', async () => {
        const res = await call(C.getProfile, { userId: B });
        ok(res);
        expect(res.body).toHaveProperty('motivations', null);
      });

      it('the GDPR export carries the answer', async () => {
        const exp = await call(C.exportData, { userId: R });
        ok(exp);
        expect(exp.body.profile.motivations).toEqual(['discover_places']);
      });

      it('getStats: answered + one int count per key, in key order; a non-array value never counts or throws', async () => {
        const odd = (await db.query(
          `INSERT INTO users (email, name, motivations) VALUES ('smoke-mot-odd@x.com', 'Odd', '"new_friends"'::jsonb) RETURNING id`
        )).rows[0].id;
        const two = await call(C.register, { body: regBody('smoke-reg-two@x.com', { gender: 'female' }) });
        ok(await call(C.updateProfile, { userId: two.body.user.id, body: { motivations: ['new_friends', 'discover_places'] } }));

        const res = await call(C.getStats, {});
        ok(res);
        const m = res.body.motivations;
        expect(Object.keys(m.counts)).toEqual([...MOTIVATION_KEYS]);
        for (const v of [m.answered, ...Object.values(m.counts)]) expect(Number.isInteger(v)).toBe(true);
        const arrays = (await db.query(
          `SELECT motivations FROM users WHERE jsonb_typeof(motivations) = 'array'`)).rows.map(r => r.motivations);
        expect(m.answered).toBe(arrays.filter(a => a.length > 0).length);
        for (const k of MOTIVATION_KEYS) expect(m.counts[k], k).toBe(arrays.filter(a => a.includes(k)).length);
        expect(m.counts.discover_places).toBeGreaterThanOrEqual(2);
        // the scalar "new_friends" would match jsonb ? — the CASE keeps it out
        expect(m.counts.new_friends).toBe(arrays.filter(a => a.includes('new_friends')).length);
        await db.query('DELETE FROM users WHERE id = $1', [odd]);
      });
    });

    // A returning user (Home banner) or one who filled Profil bearbeiten first
    // runs the wizard again: it neither shows nor re-sends what is stored.
    describe('redoing the wizard keeps the gallery and the birth date', () => {
      const img = (n) => `https://app.jamie-app.com/media/uploads/${n}.webp`;
      const mkReturning = async (email, { photos, dobChanged = false }) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, date_of_birth_changed, gender, avatar_url, photos,
                            interests, onboarding_completed, auth_provider)
         VALUES ($1,'Ret','1993-03-03',$2,'female',$3,$4::jsonb,'["Laufen","Tennis","Golf"]'::jsonb, TRUE,'email')
         RETURNING id`, [email, dobChanged, img('a'), JSON.stringify(photos)])).rows[0].id;
      const row = async (id) => (await db.query(
        `SELECT avatar_url, photos, to_char(date_of_birth,'YYYY-MM-DD') AS dob, date_of_birth_changed
           FROM users WHERE id = $1`, [id])).rows[0];

      it('a photo added in the wizard joins the stored gallery instead of replacing it', async () => {
        const u = await mkReturning('smoke-redo-1@x.com', { photos: [img('a'), img('b'), img('c')] });
        ok(await call(C.completeOnboarding, { userId: u, body: {
          interests: ['Laufen', 'Tennis', 'Golf'], photos: [img('d')] } }));
        expect(await row(u)).toMatchObject({ avatar_url: img('a'), photos: [img('d'), img('a'), img('b'), img('c')] });
      });

      it('a new ring picture becomes the avatar, keeps the others, and the cap keeps the NEW uploads', async () => {
        const u = await mkReturning('smoke-redo-2@x.com', { photos: [img('a'), img('b'), img('c'), img('e'), img('f'), img('g')] });
        ok(await call(C.completeOnboarding, { userId: u, body: {
          avatar_url: img('n'), photos: [img('n'), img('m'), img('b')] } }));
        // new first (b re-sent once, not twice), then the stored rest up to six
        expect(await row(u)).toMatchObject({
          avatar_url: img('n'), photos: [img('n'), img('m'), img('b'), img('a'), img('c'), img('e')] });
      });

      it('no photos in the body leaves the stored gallery exactly as it was', async () => {
        const u = await mkReturning('smoke-redo-3@x.com', { photos: [img('a'), img('b')] });
        ok(await call(C.completeOnboarding, { userId: u, body: { interests: ['Laufen', 'Tennis', 'Golf'], photos: [] } }));
        expect((await row(u)).photos).toEqual([img('a'), img('b')]);
      });

      it('a stored birth date wins over a sent one — the edit-once lock cannot be bypassed', async () => {
        const u = await mkReturning('smoke-redo-4@x.com', { photos: [], dobChanged: true });
        const res = await call(C.completeOnboarding, { userId: u, body: {
          interests: ['Laufen', 'Tennis', 'Golf'], date_of_birth: '2000-01-01' } });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
        expect(await row(u)).toMatchObject({ dob: '1993-03-03', date_of_birth_changed: true });
        // ...and an unlocked account cannot use it as a free extra edit either
        const v = await mkReturning('smoke-redo-5@x.com', { photos: [] });
        ok(await call(C.completeOnboarding, { userId: v, body: { date_of_birth: '1980-08-08' } }));
        expect(await row(v)).toMatchObject({ dob: '1993-03-03', date_of_birth_changed: false });
      });
    });

    describe('featured clubs (the onboarding club page)', () => {
      const mkUser = async (email, name) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ($1,$2,'1994-04-04','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
      const mkClub = async (name, { approval = 'approved', isPrivate = false, type = 'club' } = {}) => {
        const id = (await db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, lat, lng)
           VALUES ($1,$2,$3,'Sport','Wien',100,$4,$5,48.2,16.37) RETURNING id`,
          [name, type, FO, isPrivate, approval])).rows[0].id;
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [id, FO]);
        return id;
      };
      const put = (clubIds) => call(C.setFeaturedClubs, { userId: A, body: { clubIds } });
      const pub = (userId) => call(C.getFeaturedClubs, { userId });
      const ids = (res) => res.body.map(c => c.id);
      const stored = async () =>
        (await db.query('SELECT club_id, position FROM featured_clubs ORDER BY position')).rows
          .map(r => [r.club_id, r.position]);
      let log;

      beforeAll(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}); });
      afterAll(() => log.mockRestore());

      it('seed: three approved clubs (one public, two private), a pending one, a plain group', async () => {
        FO = await mkUser('smoke-feat-owner@x.com', 'Fiona');
        FM = await mkUser('smoke-feat-member@x.com', 'Fritz');
        K1 = await mkClub('JAMIE Groups Official');
        K2 = await mkClub('Feat Private Pending-Request', { isPrivate: true });
        K3 = await mkClub('Feat Private Blocked', { isPrivate: true });
        K4 = await mkClub('Feat Spare');
        KP = await mkClub('Feat Pending', { approval: 'pending' });
        PLAIN = await mkClub('Feat Plain Group', { type: 'group' });
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [K1, FM]);
        await db.query(`INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1,$2,'pending')`, [K2, FM]);
        await db.query(`INSERT INTO group_join_requests (group_id, user_id, status, rejected_count)
                        VALUES ($1,$2,'rejected',2)`, [K3, FM]);
      });

      it('nothing curated yet: public [] and an empty admin list', async () => {
        const p = await pub(undefined);
        ok(p);
        expect(p.body).toEqual([]);
        const a = await call(C.getFeaturedClubsAdmin, { userId: A });
        ok(a);
        expect(a.body).toEqual({ clubs: [], max: 20 });
      });

      it('PUT [K3, K1, K2] stores positions 1..3 and answers with the admin list', async () => {
        const res = await put([K3, String(K1), K2]);
        ok(res);
        expect(await stored()).toEqual([[K3, 1], [K1, 2], [K2, 3]]);
        expect(res.body.max).toBe(20);
        expect(res.body.clubs.map(c => [c.id, c.position, c.alive])).toEqual([[K3, 1, true], [K1, 2, true], [K2, 3, true]]);
        expect(res.body.clubs[1]).toMatchObject({ name: 'JAMIE Groups Official', is_deleted: false, approval_status: 'approved' });
      });

      it('public, anonymous: the curated order with card columns and no per-caller flags', async () => {
        const res = await pub(undefined);
        ok(res);
        expect(ids(res)).toEqual([K3, K1, K2]);
        expect(res.body.map(c => c.featured_position)).toEqual([1, 2, 3]);
        const k1 = res.body[1];
        expect(k1).toMatchObject({ name: 'JAMIE Groups Official', owner_name: 'Fiona', is_boosted: false, members_count: 2 });
        expect(k1.member_previews.map(m => m.name)).toEqual(['Fiona', 'Fritz']);
        expect(k1).not.toHaveProperty('is_member');
      });

      it('public, signed in: membership, pending request and exhausted budget per card', async () => {
        const res = await pub(FM);
        ok(res);
        expect(res.body.map(c => [c.id, c.is_member, c.join_request_status, c.join_request_blocked])).toEqual([
          [K3, false, 'rejected', true],
          [K1, true, null, false],
          [K2, false, 'pending', false],
        ]);
        // ...and the next caller does not inherit any of it from the shared cache
        const other = await pub(FO);
        expect(other.body.map(c => [c.is_member, c.join_request_status, c.join_request_blocked]))
          .toEqual([[true, null, false], [true, null, false], [true, null, false]]);  // FO owns all three
        expect((await pub(undefined)).body[0]).not.toHaveProperty('is_member');
      });

      it('the join refusals the club page maps onto its buttons carry codes', async () => {
        const join = (userId, id) => call(C.joinClub, { userId, params: { id: String(id) }, body: {} });
        const member = await join(FM, K1);
        expect([member.statusCode, member.body.code]).toEqual([400, 'ALREADY_MEMBER']);
        const pending = await join(FM, K2);
        expect([pending.statusCode, pending.body.code]).toEqual([400, 'JOIN_REQUEST_PENDING']);
        const blocked = await join(FM, K3);
        expect([blocked.statusCode, blocked.body.code]).toEqual([403, 'JOIN_REQUEST_BLOCKED']);
        await db.query('UPDATE groups SET max_members = members_count WHERE id = $1', [K4]);
        try {
          const full = await join(FM, K4);
          expect([full.statusCode, full.body.code]).toEqual([400, 'CLUB_FULL']);
        } finally {
          await db.query('UPDATE groups SET max_members = 100 WHERE id = $1', [K4]);
        }
        await db.query(`INSERT INTO group_join_counts (group_id, user_id, join_count) VALUES ($1,$2,2)`, [K4, FM]);
        try {
          const cap = await join(FM, K4);
          expect([cap.statusCode, cap.body.code]).toEqual([403, 'JOIN_CAP_REACHED']);
        } finally {
          await db.query('DELETE FROM group_join_counts WHERE group_id = $1 AND user_id = $2', [K4, FM]);
        }
        // Nothing was written by any of the refusals.
        const rows = await db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [K4, FM]);
        expect(rows.rows.length).toBe(0);
      });

      it('a pending club, a plain group or an unknown id: 400 with exactly those ids, list unchanged', async () => {
        const res = await put([K1, KP, PLAIN, 2147483000]);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ code: 'FEATURED_INVALID_CLUBS', invalidIds: [KP, PLAIN, 2147483000] });
        expect(await stored()).toEqual([[K3, 1], [K1, 2], [K2, 3]]);
        const dup = await put([K1, K1]);
        expect(dup.statusCode).toBe(400);
        expect(dup.body.code).toBe('FEATURED_INVALID');
      });

      it('a reorder shows immediately (the PUT drops the cached list)', async () => {
        expect(ids(await pub(undefined))).toEqual([K3, K1, K2]);   // cached
        ok(await put([K1, K2, K3]));
        expect(ids(await pub(undefined))).toEqual([K1, K2, K3]);
        expect(await stored()).toEqual([[K1, 1], [K2, 2], [K3, 3]]);
      });

      it('two admins saving at the same moment: both succeed, one order wins (LOCK, no 23505)', async () => {
        const [x, y] = await Promise.all([put([K4, K1, K2, K3]), put([K1, K4, K3])]);
        ok(x); ok(y);
        const final = (await stored()).map(([id]) => id);
        expect([[K4, K1, K2, K3], [K1, K4, K3]]).toContainEqual(final);
        ok(await put([K1, K2, K3]));
      });

      it('rejecting a curated club takes it off the page at once; the admin list flags it and a re-save is refused', async () => {
        ok(await call(C.rejectClub, { userId: A, params: { id: String(K3) } }));
        expect(ids(await pub(undefined))).toEqual([K1, K2]);           // clubs: prefix busted by rejectClub
        const adm = await call(C.getFeaturedClubsAdmin, { userId: A });
        expect(adm.body.clubs.map(c => [c.id, c.alive])).toEqual([[K1, true], [K2, true], [K3, false]]);
        expect(adm.body.clubs[2]).toMatchObject({ approval_status: 'rejected', is_active: false });
        const again = await put([K1, K2, K3]);
        expect(again.statusCode).toBe(400);
        expect(again.body.invalidIds).toEqual([K3]);
        ok(await put([K1, K2]));                                      // what the dashboard does: drop it
        expect(await stored()).toEqual([[K1, 1], [K2, 2]]);
      });

      it('a hard-deleted club takes its row with it (FK cascade)', async () => {
        await db.query('DELETE FROM groups WHERE id = $1', [K2]);
        expect(await stored()).toEqual([[K1, 1]]);
      });

      it('[] empties the list and the page is skipped', async () => {
        const res = await put([]);
        ok(res);
        expect(res.body).toEqual({ clubs: [], max: 20 });
        expect(await stored()).toEqual([]);
        expect((await pub(FM)).body).toEqual([]);
        ok(await put([K1]));                                           // for the boot-window case below
      });
    });

    // ── Boot window (LAST — renames schema objects, restored in finally) ──
    // The server serves before startup migrations finish. On the deploy that
    // adds these pieces, and for good if a step failed, every read must
    // degrade and no old client may break.
    describe('boot window (LAST)', () => {
      it('without users.motivations: reads give null, old AND new clients finish onboarding, stats load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          await db.query('ALTER TABLE users RENAME COLUMN motivations TO motivations_bootwin');
          const prof = await call(C.getProfile, { userId: R });
          ok(prof);
          expect(prof.body.motivations).toBe(null);
          // an old bundle's onboarding body
          ok(await call(C.completeOnboarding, { userId: R, body: {
            gender: 'male', interests: ['Laufen', 'Tennis', 'Golf'], location: 'Wien', bio: '', photos: [] } }));
          // the new wizard's — the answer is dropped (logged), the onboarding is not
          const neu = await call(C.completeOnboarding, { userId: R, body: {
            interests: ['Laufen', 'Tennis', 'Golf'], motivations: ['new_friends'] } });
          ok(neu);
          expect(neu.body.motivations).toBe(null);
          ok(await call(C.updateProfile, { userId: R, body: { motivations: ['new_friends'] } }));
          const reg = await call(C.register, { body: regBody('smoke-reg-boot@x.com', { gender: 'female' }) });
          expect(reg.statusCode, JSON.stringify(reg.body)).toBe(201);
          const exp = await call(C.exportData, { userId: R });
          ok(exp);
          expect(exp.body.profile.motivations).toBe(null);
          const stats = await call(C.getStats, {});
          ok(stats);
          expect(stats.body.motivations).toBe(null);
          expect(stats.body.users).toBeTruthy();
        } finally {
          await db.query('ALTER TABLE users RENAME COLUMN motivations_bootwin TO motivations').catch(() => {});
          warn.mockRestore();
        }
        expect(await motivationsOf(R)).toEqual(['discover_places']);   // the stored answer survived
      });

      it('without featured_clubs: the public list is empty, the admin endpoints answer 503', async () => {
        const { deleteCached } = await import('../../src/utils/cache.js');
        try {
          await db.query('ALTER TABLE featured_clubs RENAME TO featured_clubs_bootwin');
          deleteCached('clubs:featured');
          const p = await call(C.getFeaturedClubs, { userId: FM });
          expect(p.statusCode).toBe(200);
          expect(p.body).toEqual([]);
          const a = await call(C.getFeaturedClubsAdmin, { userId: A });
          expect(a.statusCode).toBe(503);
          expect(a.body.code).toBe('FEATURED_UNAVAILABLE');
          const s = await call(C.setFeaturedClubs, { userId: A, body: { clubIds: [K1] } });
          expect(s.statusCode).toBe(503);
        } finally {
          await db.query('ALTER TABLE IF EXISTS featured_clubs_bootwin RENAME TO featured_clubs');
        }
        deleteCached('clubs:featured');
        expect((await call(C.getFeaturedClubs, { userId: undefined })).body.map(c => c.id)).toEqual([K1]);
      });
    });
  });


  // Tina + Tobi 28.10.2026 (supersedes the weekly rule from 12.10.): free
  // accounts join at most 3 groups OR CLUB EVENTS per VIENNA calendar day —
  // clubs/communities never count — and create at most 1 plain group per day
  // (utils/dailyLimits.js). Real Postgres because the rules live in the count
  // queries (Vienna day window, distinct groups, rejected requests excluded,
  // soft-deleted creations still counted) and in the join path's ordering.
  describe('daily free-account limits (28.10.2026)', () => {
    const mkUser = async (email, isAdmin = false) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, is_admin)
       VALUES ($1, 'Wk', '1995-01-01', 'female', $2, TRUE, 'email', $3) RETURNING id`,
      [email, avatar, isAdmin])).rows[0].id;
    const mkGroup = async (name, { isPrivate = false, type = 'group', parent = null } = {}) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, parent_club_id, date, approval_status)
       VALUES ($1, $2, $3, 'Sport', 'Wien', 20, $4, $5, NOW() + INTERVAL '3 days', 'approved') RETURNING id`,
      [name, type, A, isPrivate, parent])).rows[0].id;
    const join = (u, g) => call(C.joinGroup, { userId: u, params: { id: String(g) }, body: {} });
    const futureDay = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const create = (u, name) => call(C.createGroup, { userId: u, body: {
      name, description: 'desc', type: 'group', category: 'Sport',
      date: futureDay(), time: '18:00', location: 'Wien', max_members: 10 } });

    it('3 joins (a club event counts), then DAILY_JOIN_LIMIT; a rejoin and a club cost nothing; Vienna DAY window', async () => {
      const U = await mkUser('smoke-daily-u@x.com');
      const club = await mkGroup('Dl Club', { type: 'club' });
      const ev = await mkGroup('Dl Event', { type: 'event', parent: club });
      const [g1, g2, g3] = [await mkGroup('Dl 1'), await mkGroup('Dl 2'), await mkGroup('Dl 3')];
      ok(await join(U, g1));
      ok(await join(U, g2));
      ok(await join(U, ev));                                   // slot 3 — club events count now (Tina 28.10.)
      const blocked = await join(U, g3);
      expect(blocked.statusCode).toBe(403);
      expect(blocked.body.code).toBe('DAILY_JOIN_LIMIT');
      expect(blocked.body.limit).toBe(3);
      expect(blocked.body.resets_at).toBeTruthy();
      expect(blocked.body.error).not.toMatch(/Pro/);          // old iOS bundles show it verbatim (3.1.1)
      expect((await db.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g3, U])).rows).toHaveLength(0);

      // Left and joining the same group again: already counted, no second slot.
      await db.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [g1, U]);
      ok(await join(U, g1));

      // Clubs (and communities) stay free even at the limit.
      ok(await join(U, club));

      // A Vienna DAY window, not a rolling week: age the log one day → free again.
      await db.query(`UPDATE group_join_log SET created_at = created_at - INTERVAL '1 day' WHERE user_id = $1`, [U]);
      ok(await join(U, g3));
    });

    it('a rejected request gives the slot back', async () => {
      const V = await mkUser('smoke-daily-v@x.com');
      const [a, b, c] = [await mkGroup('Dl V1'), await mkGroup('Dl V2'), await mkGroup('Dl V3')];
      const priv = await mkGroup('Dl V private', { isPrivate: true });
      ok(await join(V, a));
      ok(await join(V, b));
      const sent = await join(V, priv);                        // the request is slot 3
      ok(sent);
      expect(sent.body.status).toBe('pending');
      expect((await join(V, c)).body.code).toBe('DAILY_JOIN_LIMIT');
      const reqId = (await db.query('SELECT id FROM group_join_requests WHERE group_id=$1 AND user_id=$2', [priv, V])).rows[0].id;
      ok(await call(C.handleJoinRequest, { userId: A, params: { id: String(priv), requestId: String(reqId) }, body: { action: 'reject' } }));
      ok(await join(V, c));
    });

    it('JAMIE Pro and app admins are unlimited; FREE_DAILY_GROUP_JOINS=0 switches it off', async () => {
      const P = await mkUser('smoke-daily-pro@x.com');
      await db.query(
        `INSERT INTO subscriptions (user_id, status, current_period_end) VALUES ($1, 'active', NOW() + INTERVAL '30 days')`, [P]);
      const Adm = await mkUser('smoke-daily-admin@x.com', true);
      const W = await mkUser('smoke-daily-off@x.com');
      const gs = [];
      for (let i = 0; i < 4; i += 1) gs.push(await mkGroup(`Dl X${i}`));
      for (const g of gs) ok(await join(P, g));
      for (const g of gs) ok(await join(Adm, g));
      process.env.FREE_DAILY_GROUP_JOINS = '0';
      try {
        for (const g of gs) ok(await join(W, g));
      } finally {
        delete process.env.FREE_DAILY_GROUP_JOINS;
      }
    });

    it('free accounts create 1 group per Vienna day; soft-delete keeps the slot used', async () => {
      const Cu = await mkUser('smoke-daily-create@x.com');
      const first = await create(Cu, 'Dl Create 1');
      expect(first.statusCode, JSON.stringify(first.body)).toBe(201);
      const second = await create(Cu, 'Dl Create 2');
      expect(second.statusCode).toBe(403);
      expect(second.body.code).toBe('DAILY_CREATE_LIMIT');
      expect(second.body.limit).toBe(1);
      expect(second.body.error).not.toMatch(/Pro/);           // old iOS bundles show it verbatim (3.1.1)

      // create → delete → create must not refill the budget.
      await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [first.body.id]);
      expect((await create(Cu, 'Dl Create 3')).body.code).toBe('DAILY_CREATE_LIMIT');

      // Yesterday's creation does not count against today (Vienna day window).
      await db.query(`UPDATE groups SET created_at = created_at - INTERVAL '1 day' WHERE owner_id = $1 AND type = 'group'`, [Cu]);
      const again = await create(Cu, 'Dl Create 4');
      expect(again.statusCode, JSON.stringify(again.body)).toBe(201);
    });

    it('Pro and app admins create freely; FREE_DAILY_GROUP_CREATES=0 switches it off', async () => {
      const P = await mkUser('smoke-daily-create-pro@x.com');
      await db.query(
        `INSERT INTO subscriptions (user_id, status, current_period_end) VALUES ($1, 'active', NOW() + INTERVAL '30 days')`, [P]);
      const Adm = await mkUser('smoke-daily-create-admin@x.com', true);
      expect((await create(P, 'Dl P1')).statusCode).toBe(201);
      expect((await create(P, 'Dl P2')).statusCode).toBe(201);
      expect((await create(Adm, 'Dl A1')).statusCode).toBe(201);
      expect((await create(Adm, 'Dl A2')).statusCode).toBe(201);
      const W = await mkUser('smoke-daily-create-off@x.com');
      process.env.FREE_DAILY_GROUP_CREATES = '0';
      try {
        expect((await create(W, 'Dl W1')).statusCode).toBe(201);
        expect((await create(W, 'Dl W2')).statusCode).toBe(201);
      } finally {
        delete process.env.FREE_DAILY_GROUP_CREATES;
      }
    });
  });

  // ── Stream B: Glocke + „News an alle" (Lea / Robert, 18.10.2026) ─────────
  // The mocked unit tests pin the flow; this pins the SQL: the keyset-paged
  // INSERT … SELECT fan-out, the advisory-locked double-send guard, the bell's
  // list JOINs and the push_news opt-in, all against the real migrations.
  describe('news to everyone + the bell (18.10.2026)', () => {
    let N, NC, P;
    let E;                                            // a fresh account: its bell holds only this block's rows
    const title = 'Smoke-News: neue Deals';
    beforeAll(async () => {
      N = await import('../../src/controllers/newsController.js');
      NC = await import('../../src/controllers/notificationController.js');
      P = await import('../../src/controllers/pushController.js');
      E = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-news-e@x.com', 'Ella', '1995-01-01', 'female', $1, TRUE, 'email') RETURNING id`,
        [avatar])).rows[0].id;
    });

    it('push_news defaults OFF and round-trips through the preferences endpoints', async () => {
      expect((await call(P.getPushPreferences, { userId: E })).body).toEqual({ push_news: false });
      const on = await call(P.updatePushPreferences, { userId: E, body: { push_news: true } });
      ok(on);
      expect(on.body.push_news).toBe(true);
      expect((await call(P.getPushPreferences, { userId: E })).body).toEqual({ push_news: true });
    });

    it('sendNews writes one row per active account, emits each, pushes only the opted-in', async () => {
      const active = (await db.query(
        'SELECT COUNT(*)::int AS n FROM users WHERE is_active IS DISTINCT FROM FALSE')).rows[0].n;
      const optedIn = (await db.query(
        'SELECT COUNT(*)::int AS n FROM users WHERE is_active IS DISTINCT FROM FALSE AND push_news = TRUE')).rows[0].n;
      expect(optedIn).toBeGreaterThanOrEqual(1);      // E, from the test above

      const audience = await call(N.getNewsAudience, {});
      ok(audience);
      expect(audience.body).toEqual({ total: active, pushOptIn: optedIn });

      const before = emitted.length;
      const sent = await call(N.sendNews, { userId: A, body: { title, message: 'Schau rein!', link: '/deal/1', push: true } });
      expect(sent.statusCode, JSON.stringify(sent.body)).toBe(201);
      expect(sent.body).toMatchObject({ recipients: active, pushRecipients: optedIn, push: true });

      const rows = (await db.query(
        `SELECT user_id, sender_id, link, is_read FROM notifications WHERE type = 'news' AND title = $1`, [title])).rows;
      expect(rows).toHaveLength(active);
      expect(rows.every((r) => r.sender_id === null && r.link === '/deal/1' && r.is_read === false)).toBe(true);
      expect(rows.some((r) => r.user_id === E)).toBe(true);
      const live = emitted.slice(before).filter((e) => e.ev === 'new_notification' && e.payload?.type === 'news');
      expect(live).toHaveLength(active);

      const list = await call(N.listNews, {});
      ok(list);
      expect(list.body.news[0]).toMatchObject({
        title, status: 'sent', recipients: active, push_recipients: optedIn, with_push: true, link: '/deal/1',
      });
    });

    it('the same title again (any case) within 10 minutes is refused, nothing is written', async () => {
      const count = async () => (await db.query(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'news'`)).rows[0].n;
      const before = await count();
      const again = await call(N.sendNews, { userId: A, body: { title: title.toUpperCase(), message: 'Nochmal' } });
      expect(again.statusCode).toBe(409);
      expect(again.body.code).toBe('NEWS_DUPLICATE');
      expect(await count()).toBe(before);
    });

    it('the bell: list carries sender + reference name, the badge counts, markRead(upToId) clears it', async () => {
      const gid = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date)
         VALUES ('Bell Moment', 'group', $1, 'Sport', 'Wien', 10, NOW() - INTERVAL '1 day') RETURNING id`,
        [A])).rows[0].id;
      // The row shape Stream A's Hall-of-Fame likes use.
      await db.query(
        `INSERT INTO notifications (user_id, sender_id, type, title, reference_type, reference_id)
         VALUES ($1, $2, 'hof_like', 'Ann gefällt „Bell Moment“', 'group', $3)`,
        [E, A, gid]);

      const list = await call(NC.getNotifications, { userId: E });
      ok(list);
      const like = list.body.find((n) => n.type === 'hof_like');
      expect(like.sender).toMatchObject({ id: A });
      expect(like.reference_name).toBe('Bell Moment');
      expect(like.reference_gone).toBe(false);
      const newsRow = list.body.find((n) => n.type === 'news');
      expect(newsRow.sender).toBeNull();
      expect(newsRow.link).toBe('/deal/1');

      expect((await call(NC.getUnreadCount, { userId: E })).body.count).toBe(2);
      // A row that arrives after the list was fetched stays unread.
      const late = (await db.query(
        `INSERT INTO notifications (user_id, type, title) VALUES ($1, 'news', 'Später') RETURNING id`, [E])).rows[0].id;
      const newest = Math.max(...list.body.map((n) => n.id));
      expect(late).toBeGreaterThan(newest);
      ok(await call(NC.markRead, { userId: E, body: { upToId: newest } }));
      expect((await call(NC.getUnreadCount, { userId: E })).body.count).toBe(1);

      // Soft-deleting the group flips the row to "gone" (no tap target any more).
      await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [gid]);
      const after = await call(NC.getNotifications, { userId: E });
      expect(after.body.find((n) => n.type === 'hof_like').reference_gone).toBe(true);
    });
  });


  // ── Hall of Fame (Lea, 18.10.2026) ─────────────────────────────────────────
  // The SQL here is the risky part — Vienna-day comparisons, an uncorrelated
  // participation subquery, a CTE in the wall, json_agg — which the unit tests
  // only ever see as strings. A = owner/admin, L leaves after the meetup,
  // M stays, Q is an outsider.
  describe('Hall of Fame (Lea, 18.10.2026)', () => {
    let H, G;
    let L, M, Q;
    let ev, privEv, deletedAfter, deletedBefore, cancelled, future, reviewedOnly;
    const photo = (n) => `https://app.jamie-app.com/media/uploads/hof-${n}.webp`;
    const until = async (fn, ms = 3000) => {
      const t0 = Date.now();
      for (;;) {
        const v = await fn();
        if (v || Date.now() - t0 > ms) return v;
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    beforeAll(async () => {
      H = await import('../../src/controllers/hallOfFameController.js');
      G = await import('../../src/controllers/groupController.js');
      const mk = async (email, name) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ($1, $2, '1995-01-01', 'female', $3, TRUE, 'email') RETURNING id`,
        [email, name, avatar])).rows[0].id;
      L = await mk('smoke-hof-l@x.com', 'Lea');
      M = await mk('smoke-hof-m@x.com', 'Mia');
      Q = await mk('smoke-hof-q@x.com', 'Quinn');
      const mkGroup = async (name, { daysAgo = 3, isPrivate = false, members = [L, M] } = {}) => {
        const id = (await db.query(
          `INSERT INTO groups (name, type, date, owner_id, category, location, max_members, is_private, image_url)
           VALUES ($1, 'group', NOW() - ($2 || ' days')::interval, $3, 'Sport', 'Wien', 10, $4, $5) RETURNING id`,
          [name, String(daysAgo), A, isPrivate, avatar])).rows[0].id;
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', NOW() - INTERVAL '20 days')`,
          [id, A]);
        for (const uid of members) {
          await db.query(
            `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW() - INTERVAL '20 days')`,
            [id, uid]);
        }
        return id;
      };
      ev = await mkGroup('HoF Wandern');
      privEv = await mkGroup('HoF Privat', { isPrivate: true });
      deletedAfter = await mkGroup('HoF später gelöscht');
      deletedBefore = await mkGroup('HoF vorher gelöscht');
      cancelled = await mkGroup('HoF abgesagt');
      future = await mkGroup('HoF Zukunft', { daysAgo: -3 });
      reviewedOnly = await mkGroup('HoF nur Review', { members: [M] });
      // Deleted today, the event was three days ago → stays. Deleted the day
      // before its date → never happened. Cancelled → gone.
      await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [deletedAfter]);
      await db.query(`UPDATE groups SET deleted_at = date - INTERVAL '1 day' WHERE id = $1`, [deletedBefore]);
      await db.query('UPDATE groups SET is_active = FALSE WHERE id = $1', [cancelled]);
      // L left "HoF nur Review" before hall_of_fame_entries existed: no
      // membership row, no entry — only their own answer in the review round.
      await db.query(
        `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present)
         VALUES ($1, $2, $2, TRUE)`,
        [reviewedOnly, L]);
    });

    it('leaving after the meetup keeps it; cancelled, future and deleted-before events stay out', async () => {
      ok(await call(G.leaveGroup, { userId: L, params: { id: String(ev) } }));
      const kept = await db.query('SELECT 1 FROM hall_of_fame_entries WHERE user_id = $1 AND group_id = $2', [L, ev]);
      expect(kept.rowCount).toBe(1);

      const own = await call(H.getUserHallOfFame, { userId: L, params: { id: 'me' } });
      ok(own);
      expect(own.body.map((e) => e.name).sort()).toEqual(
        ['HoF Privat', 'HoF Wandern', 'HoF nur Review', 'HoF später gelöscht'].sort());
      expect(own.body.find((e) => e.id === deletedAfter).is_deleted).toBe(true);
      expect(own.body.find((e) => e.id === ev).cover_url).toBe(avatar);
      expect(own.body.some((e) => [deletedBefore, cancelled, future].includes(e.id))).toBe(false);
      expect(own.body.some((e) => e.id === privEv)).toBe(true);
    });

    it('somebody else sees only the public events, and nothing across a block', async () => {
      const other = await call(H.getUserHallOfFame, { userId: Q, params: { id: String(L) } });
      ok(other);
      expect(other.body.map((e) => e.name).sort()).toEqual(
        ['HoF Wandern', 'HoF nur Review', 'HoF später gelöscht'].sort());
      expect(other.body.some((e) => e.id === privEv)).toBe(false);

      await db.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'blocked')`, [Q, L]);
      const blocked = await call(H.getUserHallOfFame, { userId: Q, params: { id: String(L) } });
      expect(blocked.statusCode).toBe(404);
      await db.query('DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2', [Q, L]);
    });

    it('participants — also one who left afterwards — add photos; an outsider cannot', async () => {
      const byM = await call(H.addEventPhoto, { userId: M, params: { id: String(ev) }, body: { url: photo('m1') } });
      expect(byM.statusCode, JSON.stringify(byM.body)).toBe(201);
      const byL = await call(H.addEventPhoto, { userId: L, params: { id: String(ev) }, body: { url: photo('l1') } });
      expect(byL.statusCode, JSON.stringify(byL.body)).toBe(201);
      const byQ = await call(H.addEventPhoto, { userId: Q, params: { id: String(ev) }, body: { url: photo('q1') } });
      expect(byQ.statusCode).toBe(403);
      const onFuture = await call(H.addEventPhoto, { userId: M, params: { id: String(future) }, body: { url: photo('f') } });
      expect(onFuture.statusCode).toBe(404);

      // Own Hall of Fame: the own photo becomes the cover.
      const own = await call(H.getUserHallOfFame, { userId: M, params: { id: 'me' } });
      expect(own.body.find((e) => e.id === ev).cover_url).toBe(photo('m1'));
    });

    it('the Explore wall carries the photos and who may add one', async () => {
      const wall = await call(G.getHallOfFame, { userId: M, query: { limit: '60' } });
      ok(wall);
      const card = wall.body.find((c) => c.id === ev);
      expect(card).toBeTruthy();
      expect(card.photo_count).toBe(2);
      expect(card.photos.map((p) => p.url)).toEqual([photo('l1'), photo('m1')]);
      expect(card.photos[0].user_name).toBe('Lea');
      expect(card).toMatchObject({ is_participant: true, my_photo_count: 1, can_add_photo: true });

      const guest = await call(G.getHallOfFame, { query: { limit: '60' } });
      ok(guest);
      expect(guest.body.find((c) => c.id === ev)).toMatchObject({ is_participant: false, can_add_photo: false });
    });

    it('the gallery lists every photo with delete rights; only uploader, owner or admin may delete', async () => {
      const asOwner = await call(H.getEventPhotos, { userId: A, params: { id: String(ev) } });
      ok(asOwner);
      expect(asOwner.body).toHaveLength(2);
      expect(asOwner.body.every((p) => p.can_delete)).toBe(true);
      const asQ = await call(H.getEventPhotos, { userId: Q, params: { id: String(ev) } });
      expect(asQ.body.every((p) => !p.can_delete)).toBe(true);

      const mine = asOwner.body.find((p) => p.url === photo('m1'));
      expect((await call(H.deleteEventPhoto, { userId: Q, params: { id: String(ev), photoId: String(mine.id) } })).statusCode).toBe(403);
      ok(await call(H.deleteEventPhoto, { userId: M, params: { id: String(ev), photoId: String(mine.id) } }));
      ok(await call(H.addEventPhoto, { userId: M, params: { id: String(ev) }, body: { url: photo('m2') } }));
    });

    it('a like puts a bell row at the owner and every photo contributor, once a day', async () => {
      const rowsFor = async () => (await db.query(
        `SELECT user_id FROM notifications WHERE type = 'hof_like' AND sender_id = $1 AND reference_id = $2 ORDER BY user_id`,
        [Q, ev])).rows.map((r) => r.user_id);
      const expected = [A, L, M].sort((x, y) => x - y);

      ok(await call(G.toggleLike, { userId: Q, params: { id: String(ev) } }));
      const got = await until(async () => { const r = await rowsFor(); return r.length === 3 ? r : null; });
      expect(got).toEqual(expected);

      ok(await call(G.toggleLike, { userId: Q, params: { id: String(ev) } }));   // unlike
      ok(await call(G.toggleLike, { userId: Q, params: { id: String(ev) } }));   // like again
      await new Promise((r) => setTimeout(r, 300));
      expect(await rowsFor()).toEqual(expected);
    });

    it('the data export carries the own event photos and the events kept after leaving', async () => {
      const exp = await call(C.exportData, { userId: L });
      ok(exp);
      expect(exp.body.event_photos.map((p) => p.url)).toEqual([photo('l1')]);
      expect(exp.body.hall_of_fame_kept_events.map((e) => e.event_name)).toEqual(['HoF Wandern']);
      expect(exp.body.profile.push_news).toBe(false);
    });
  });

  // ── Memories + Friends (Tina, 22.10.2026) ─────────────────────────────────
  // What a db-mocking test cannot see: photos_only against the real wall, the
  // 21-day Vienna window and the own-photo rules of „Warst du dabei..", the
  // friends feed's four participation sources with its private / block /
  // picture filters, and the people search's lateral, filters and ranking.
  describe('Memories + Friends (Tina, 22.10.2026)', () => {
    let H, G, U;
    let O, P, V, Fr, Wx, X, Z, Half;
    let photoless, withCover, old, future, cancelled, privCover, blockedOwner, friendNoPicture, friendLeft, friendReviewed;
    let incomingReq;
    const photo = (n) => `https://app.jamie-app.com/media/uploads/mem-${n}.webp`;
    const ids = (res) => res.body.map((r) => r.id);
    const sorted = (arr) => [...arr].sort((x, y) => x - y);

    beforeAll(async () => {
      H = await import('../../src/controllers/hallOfFameController.js');
      G = await import('../../src/controllers/groupController.js');
      U = await import('../../src/controllers/userController.js');
      // Complete profiles (18+, gender, three interests, photo) unless noted.
      const mk = async (email, name, { av = avatar, bio = null } = {}) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, interests, bio)
         VALUES ($1, $2, '1995-01-01', 'female', $3, TRUE, 'email', '["Wandern","Kaffee","Kino"]'::jsonb, $4) RETURNING id`,
        [email, name, av, bio])).rows[0].id;
      O = await mk('smoke-mem-o@x.com', 'Memoria Owner');
      P = await mk('smoke-mem-p@x.com', 'Memoria Teilnehmer');
      V = await mk('smoke-mem-v@x.com', 'Viewer Vau');
      Fr = await mk('smoke-mem-f@x.com', 'Memoria Freundin');
      Wx = await mk('smoke-mem-w@x.com', 'Memoria Abgelehnt');
      X = await mk('smoke-mem-x@x.com', 'Memoria Blockiert');
      Z = await mk('smoke-mem-z@x.com', 'Memoria Eingefroren');
      await mk('smoke-mem-full@x.com', 'Memoria Komplett', { bio: 'x'.repeat(200) });
      Half = await mk('smoke-mem-half@x.com', 'Memoria Aaa Halb', { av: null });
      await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [Z]);

      // Relative dates only (never coupled to the real calendar); everybody
      // joined well before the event, so joinedInTimeSql holds.
      const mkGroup = async (name, { daysAgo = 2, owner = O, image = avatar, isPrivate = false, members = [] } = {}) => {
        const id = (await db.query(
          `INSERT INTO groups (name, type, date, owner_id, category, location, max_members, is_private, image_url)
           VALUES ($1, 'group', NOW() - ($2 || ' days')::interval, $3, 'Sport', 'Wien', 10, $4, $5) RETURNING id`,
          [name, String(daysAgo), owner, isPrivate, image])).rows[0].id;
        for (const [uid, role] of [[owner, 'owner'], ...members.map((m) => [m, 'member'])]) {
          await db.query(
            `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW() - INTERVAL '40 days')`,
            [id, uid, role]);
        }
        return id;
      };
      photoless = await mkGroup('Mem fotolos', { daysAgo: 3, image: null, members: [P] });
      withCover = await mkGroup('Mem mit Cover', { members: [P, Fr] });
      old = await mkGroup('Mem zu alt', { daysAgo: 25, image: null, members: [P] });
      future = await mkGroup('Mem Zukunft', { daysAgo: -3, image: null, members: [P] });
      cancelled = await mkGroup('Mem abgesagt', { daysAgo: 3, image: null, members: [P] });
      await db.query('UPDATE groups SET is_active = FALSE WHERE id = $1', [cancelled]);
      privCover = await mkGroup('Mem privat', { isPrivate: true, members: [Fr] });
      blockedOwner = await mkGroup('Mem Block-Owner', { owner: X, members: [Fr] });
      friendNoPicture = await mkGroup('Mem Freundin ohne Bild', { image: null, members: [Fr] });
      // The friend left after the meetup (entry only) / only answered the
      // review round — both still count as having been there.
      friendLeft = await mkGroup('Mem Freundin ausgetreten', { daysAgo: 4 });
      friendReviewed = await mkGroup('Mem Freundin per Review', { daysAgo: 5 });
      await db.query('INSERT INTO hall_of_fame_entries (user_id, group_id) VALUES ($1, $2)', [Fr, friendLeft]);
      await db.query(
        'INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present) VALUES ($1, $2, $3, TRUE)',
        [friendReviewed, Fr, O]);

      const friendship = (a, b, status) => db.query(
        'INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, $3) RETURNING id', [a, b, status]);
      await friendship(V, Fr, 'accepted');
      await friendship(V, P, 'pending');
      incomingReq = (await friendship(O, V, 'pending')).rows[0].id;
      await friendship(Wx, V, 'rejected');
      await friendship(X, V, 'blocked');
    });

    it('photos_only keeps the cards with a picture; the default wall keeps the upload entry points', async () => {
      const dflt = await call(G.getHallOfFame, { userId: O, query: { limit: '60' } });
      ok(dflt);
      expect(ids(dflt)).toContain(photoless);
      const only = await call(G.getHallOfFame, { userId: O, query: { limit: '60', photos_only: '1' } });
      ok(only);
      expect(ids(only)).toContain(withCover);
      expect(ids(only)).not.toContain(photoless);
      expect(ids(only)).not.toContain(friendNoPicture);
      // Plain date order — no own-photoless-first prefix.
      const dates = only.body.map((c) => new Date(c.date).getTime());
      expect([...dates].sort((x, y) => y - x)).toEqual(dates);

      // The participant: the 30-day arm only in the default wall; the feed
      // card still lets them add a photo.
      expect(ids(await call(G.getHallOfFame, { userId: P, query: { limit: '60' } }))).toContain(photoless);
      const pOnly = await call(G.getHallOfFame, { userId: P, query: { limit: '60', photos_only: '1' } });
      expect(ids(pOnly)).not.toContain(photoless);
      expect(pOnly.body.find((c) => c.id === withCover)).toMatchObject({ is_participant: true, can_add_photo: true });
    });

    it('„Warst du dabei.." lists own events of the last three weeks without the caller\'s photo', async () => {
      const o = await call(H.getMemoryPrompts, { userId: O });
      ok(o);
      expect(ids(o)).toEqual(expect.arrayContaining([photoless, withCover]));
      for (const gone of [old, future, cancelled]) expect(ids(o)).not.toContain(gone);

      const p = await call(H.getMemoryPrompts, { userId: P });
      ok(p);
      expect(sorted(ids(p))).toEqual(sorted([photoless, withCover]));
      expect(p.body.find((r) => r.id === photoless)).toMatchObject({ owner_id: O, image_url: null, moment_photo_url: null });

      expect((await call(H.getMemoryPrompts, { userId: V })).body).toEqual([]);
    });

    it('the owner\'s moment ends the owner\'s prompt, not the participant\'s; an own photo ends either', async () => {
      await db.query('UPDATE groups SET moment_photo_url = $1 WHERE id = $2', [photo('moment'), photoless]);
      expect(ids(await call(H.getMemoryPrompts, { userId: O }))).not.toContain(photoless);
      expect(ids(await call(H.getMemoryPrompts, { userId: P }))).toContain(photoless);

      const byP = await call(H.addEventPhoto, { userId: P, params: { id: String(photoless) }, body: { url: photo('p1') } });
      expect(byP.statusCode, JSON.stringify(byP.body)).toBe(201);
      expect(ids(await call(H.getMemoryPrompts, { userId: P }))).not.toContain(photoless);

      const byO = await call(H.addEventPhoto, { userId: O, params: { id: String(withCover) }, body: { url: photo('o1') } });
      expect(byO.statusCode, JSON.stringify(byO.body)).toBe(201);
      expect(ids(await call(H.getMemoryPrompts, { userId: O }))).not.toContain(withCover);
    });

    it('the friends feed: public events a friend took part in — every source — with a picture', async () => {
      const res = await call(H.getHallOfFameFriends, { userId: V, query: {} });
      ok(res);
      // Not the private one, not across the block, not without a picture,
      // not one the friend never attended.
      expect(sorted(ids(res))).toEqual(sorted([withCover, friendLeft, friendReviewed]));
      const c = res.body.find((r) => r.id === withCover);
      expect(c).toMatchObject({ owner_name: 'Memoria Owner', is_participant: false, can_add_photo: false, photo_count: 1 });
      expect(c.photos.map((x) => x.url)).toEqual([photo('o1')]);

      // A participant viewing through a friend may still add a photo.
      await db.query(`UPDATE friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2`, [V, P]);
      const asP = await call(H.getHallOfFameFriends, { userId: P, query: {} });
      expect(asP.body).toEqual([]); // V, P's new friend, took part in nothing
      await db.query(`UPDATE friendships SET status = 'pending' WHERE requester_id = $1 AND addressee_id = $2`, [V, P]);
    });

    it('no accepted friends → an empty feed (a rejected request is no friendship)', async () => {
      expect((await call(H.getHallOfFameFriends, { userId: Wx, query: {} })).body).toEqual([]);
    });

    it('the people search: state per direction, frozen and blocked hidden, a bio excerpt, incomplete last', async () => {
      const res = await call(U.searchUsers, { userId: V, query: { q: 'Memoria' } });
      ok(res);
      const by = Object.fromEntries(res.body.map((u) => [u.name, u]));
      expect(by['Memoria Freundin']).toMatchObject({ friend_status: 'accepted', age: expect.any(Number) });
      expect(by['Memoria Teilnehmer']).toMatchObject({ friend_status: 'pending_out' });
      expect(by['Memoria Owner']).toMatchObject({ friend_status: 'pending_in', friendship_id: incomingReq });
      expect(by['Memoria Abgelehnt']).toMatchObject({ friend_status: 'none', friendship_id: null });
      expect(by['Memoria Komplett']).toMatchObject({ friend_status: 'none', friendship_id: null });
      expect(by['Memoria Komplett'].bio).toHaveLength(160);
      expect(by['Memoria Eingefroren']).toBeUndefined();
      expect(by['Memoria Blockiert']).toBeUndefined();
      // Alphabetically first, ranked last: no profile photo.
      expect(res.body.at(-1).id).toBe(Half);

      // The block hides the blocker from the blocked side too.
      const fromX = await call(U.searchUsers, { userId: X, query: { q: 'Viewer' } });
      ok(fromX);
      expect(fromX.body.some((u) => u.id === V)).toBe(false);
    });

    it('the reviewer arm has its index', async () => {
      const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_event_reviews_reviewer'`);
      expect(idx.rowCount).toBe(1);
    });
  });

  // ── Community / Club split (Tina, 22.10.2026) ─────────────────────────────
  // The pieces a db-mocking test cannot see: the real column and its CHECK, the
  // one-shot backfill, the segment filter against NULL rows, the featured_clubs
  // join in the ORDER BY, the daily cap counting real rows, and the two
  // approval gates that used to let a rejected club be joined by link.
  describe('Community/Club split (22.10.2026)', () => {
    let owner, outsider, adminUser;
    let communityClub, officialClub, legacyClub, pendingOfficial, rejectedClub;

    const mkUser = async (email, name, isAdmin = false) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, is_admin)
       VALUES ($1,$2,'1990-01-01','female',$3, TRUE, 'email', $4) RETURNING id`,
      [email, name, avatar, isAdmin])).rows[0].id;

    it('seed: users', async () => {
      owner = await mkUser('smoke-ct-owner@x.com', 'Carla');
      outsider = await mkUser('smoke-ct-out@x.com', 'Olaf');
      adminUser = await mkUser('smoke-ct-admin@x.com', 'Alma', true);
    });

    describe('schema', () => {
      it('club_type and category_label exist, nullable, with a CHECK and an index', async () => {
        const cols = await db.query(
          `SELECT column_name, is_nullable, character_maximum_length AS len
             FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'groups'
              AND column_name IN ('club_type','category_label')
            ORDER BY column_name`);
        expect(cols.rows.map((r) => r.column_name)).toEqual(['category_label', 'club_type']);
        // Nullable on purpose: a NOT NULL DEFAULT would have stamped every
        // group and event row with a meaningless club_type too.
        expect(cols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);
        expect(cols.rows.find((r) => r.column_name === 'club_type').len).toBe(12);
        expect(cols.rows.find((r) => r.column_name === 'category_label').len).toBe(60);

        const idx = await db.query(
          `SELECT 1 FROM pg_indexes WHERE tablename='groups' AND indexname='idx_groups_club_type'`);
        expect(idx.rowCount).toBe(1);
      });

      it('the CHECK refuses anything but community/official (NULL stays allowed)', async () => {
        await expect(db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members, club_type)
           VALUES ('Bad Type','club',$1,'Sport','Wien',10,'VEREIN')`, [owner])
        ).rejects.toMatchObject({ code: '23514' });

        // NULL must still insert — that is the fail-open side every read relies on.
        const nulled = await db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members, approval_status, lat, lng)
           VALUES ('Legacy Club','club',$1,'Sport','Wien',50,'approved',48.2,16.37) RETURNING id, club_type`,
          [owner]);
        legacyClub = nulled.rows[0].id;
        expect(nulled.rows[0].club_type).toBe(null);
      });

      it('the backfill is marked and never runs a second time', async () => {
        const marker = await db.query(
          `SELECT 1 FROM one_shot_migrations WHERE name = '2026-10-22_backfill_club_type'`);
        expect(marker.rowCount).toBe(1);

        // legacyClub was inserted AFTER the first migration run, with no
        // club_type. Running the migrations again must leave it alone — that is
        // what the marker buys, and why a later boot cannot re-stamp a club an
        // admin has since reclassified. (A NULL row is not stranded either way:
        // every read treats it as a community, which the segment tests below
        // prove against the real query.)
        const { runStartupMigrations } = await import('../../src/config/migrations.js');
        await runStartupMigrations();
        expect((await db.query('SELECT club_type FROM groups WHERE id=$1', [legacyClub]))
          .rows[0].club_type).toBe(null);
      });
    });

    describe('createClub', () => {
      it("club_type:'community' is live at once", async () => {
        const res = await call(C.createClub, { userId: owner, body: {
          name: 'Smoke Community', description: 'live sofort', category: 'Sport',
          location: 'Wien', max_members: 50, club_type: 'community' } });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        communityClub = res.body.id;
        const r = await db.query('SELECT club_type, approval_status FROM groups WHERE id=$1', [communityClub]);
        expect(r.rows[0]).toEqual({ club_type: 'community', approval_status: 'approved' });
      });

      it("club_type:'official' waits for a moderator", async () => {
        const res = await call(C.createClub, { userId: owner, body: {
          name: 'Smoke Official', description: 'wartet', category: 'Sport',
          location: 'Wien', max_members: 50, club_type: 'official' } });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        pendingOfficial = res.body.id;
        const r = await db.query('SELECT club_type, approval_status FROM groups WHERE id=$1', [pendingOfficial]);
        expect(r.rows[0]).toEqual({ club_type: 'official', approval_status: 'pending' });
      });

      // The whole reason club_type is read explicitly: an iOS 1.4.1 bundle has
      // no such field and must keep the moderation gate it shipped with.
      it('a request WITHOUT club_type still goes to the queue', async () => {
        const res = await call(C.createClub, { userId: outsider, body: {
          name: 'Old Bundle Club', description: 'kein club_type', category: 'Sport',
          location: 'Wien', max_members: 50 } });
        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        const r = await db.query('SELECT club_type, approval_status FROM groups WHERE id=$1', [res.body.id]);
        expect(r.rows[0]).toEqual({ club_type: 'community', approval_status: 'pending' });
      });

      // Tina 16.11.2026: „im Admin auch als Club … und Community als
      // Community“ — the queue carries the type its label is made from.
      it('the admin queue says which one is a club and which a community', async () => {
        const res = await call(C.getPendingClubs, { userId: adminUser });
        ok(res);
        const typeOf = (name) => res.body.find((c) => c.name === name)?.club_type;
        expect(typeOf('Smoke Official')).toBe('official');
        expect(typeOf('Old Bundle Club')).toBe('community');
      });

      it('the 4th community within 24 h is refused with 429', async () => {
        const capUser = await mkUser('smoke-ct-cap@x.com', 'Cappy');
        for (let i = 1; i <= 3; i++) {
          const res = await call(C.createClub, { userId: capUser, body: {
            name: `Cap Community ${i}`, description: 'x', category: 'Sport',
            location: 'Wien', max_members: 20, club_type: 'community' } });
          expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        }
        const over = await call(C.createClub, { userId: capUser, body: {
          name: 'Cap Community 4', description: 'x', category: 'Sport',
          location: 'Wien', max_members: 20, club_type: 'community' } });
        expect(over.statusCode).toBe(429);
        expect(over.body.code).toBe('COMMUNITY_DAILY_LIMIT');
        expect((await db.query(
          `SELECT COUNT(*)::int n FROM groups WHERE owner_id=$1 AND type='club'`, [capUser])).rows[0].n).toBe(3);

        // An official club is NOT capped here — it waits for a human anyway.
        const official = await call(C.createClub, { userId: capUser, body: {
          name: 'Cap Official', description: 'x', category: 'Sport',
          location: 'Wien', max_members: 20, club_type: 'official' } });
        expect(official.statusCode, JSON.stringify(official.body)).toBe(201);
      });
    });

    describe('getClubs segments', () => {
      it('seed: an approved official club with two upcoming events', async () => {
        officialClub = (await db.query(
          `INSERT INTO groups (name, type, owner_id, category, category_label, location, max_members,
                               approval_status, club_type, lat, lng, members_count)
           VALUES ('Smoke Clubhaus','club',$1,'Bar','Bar · Nightlife','Wien',200,'approved','official',48.2,16.37,300)
           RETURNING id`, [owner])).rows[0].id;
        const mkEv = async (name, when) => db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, lat, lng)
           VALUES ($1,'event',$2,'Bar','Wien',20,$3,$4,48.2,16.37)`,
          [name, owner, when, officialClub]);
        await mkEv('Smoke Event morgen', new Date(Date.now() + 864e5));
        await mkEv('Smoke Event naechste Woche', new Date(Date.now() + 7 * 864e5));
        await mkEv('Smoke Event vorbei', new Date(Date.now() - 10 * 864e5));
      });

      const ids = (res) => (res.body || []).map((c) => Number(c.id));

      it('?club_type=official returns only official clubs', async () => {
        const res = await call(C.getClubs, { userId: outsider, query: { club_type: 'official', limit: '100' } });
        ok(res);
        expect(ids(res)).toContain(officialClub);
        expect(ids(res)).not.toContain(communityClub);
        expect(ids(res)).not.toContain(legacyClub);
      });

      it('?club_type=community returns communities INCLUDING the NULL legacy row', async () => {
        const res = await call(C.getClubs, { userId: outsider, query: { club_type: 'community', limit: '100' } });
        ok(res);
        expect(ids(res)).toContain(communityClub);
        expect(ids(res)).toContain(legacyClub);
        expect(ids(res)).not.toContain(officialClub);
      });

      it('no club_type (old bundle) returns both kinds', async () => {
        const res = await call(C.getClubs, { userId: outsider, query: { limit: '100' } });
        ok(res);
        expect(ids(res)).toContain(communityClub);
        expect(ids(res)).toContain(officialClub);
      });

      it('a pending club is in nobody else’s list', async () => {
        const res = await call(C.getClubs, { userId: outsider, query: { club_type: 'official', limit: '100' } });
        expect(ids(res)).not.toContain(pendingOfficial);
      });

      // withOwnPendingClubs prepends the caller's own — but only in the segment
      // it belongs to, or the owner's pending CLUB shows up under Communities.
      it('the owner sees their own pending club in the Clubs segment only', async () => {
        const inClubs = await call(C.getClubs, { userId: owner, query: { club_type: 'official', limit: '100' } });
        expect(ids(inClubs)).toContain(pendingOfficial);
        const inCommunities = await call(C.getClubs, { userId: owner, query: { club_type: 'community', limit: '100' } });
        expect(ids(inCommunities)).not.toContain(pendingOfficial);
      });

      it('upcoming_events_count counts only what is still ahead', async () => {
        const res = await call(C.getClubs, { userId: outsider, query: { club_type: 'official', limit: '100' } });
        const row = (res.body || []).find((c) => Number(c.id) === officialClub);
        expect(Number(row.upcoming_events_count)).toBe(2);
        expect(row.category_label).toBe('Bar · Nightlife');
      });

      it('the admin-curated order applies, but a paid boost still outranks it', async () => {
        const second = (await db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members,
                               approval_status, club_type, lat, lng, members_count)
           VALUES ('Smoke Clubhaus Zwei','club',$1,'Bar','Wien',200,'approved','official',48.2,16.37,10)
           RETURNING id`, [owner])).rows[0].id;

        // Curate the SECOND club first — the order the admin saved. This read
        // reflects it only because setFeaturedClubs busts the 'clubs:' prefix
        // (added 22.10.2026, when getClubs started sorting by featured order);
        // without that the list would serve the old order for a full TTL.
        ok(await call(C.setFeaturedClubs, { userId: adminUser, body: { clubIds: [second, officialClub] } }));
        const curated = await call(C.getClubs, { userId: outsider, query: { club_type: 'official', limit: '100' } });
        const order = (curated.body || []).map((c) => Number(c.id)).filter((id) => [second, officialClub].includes(id));
        expect(order).toEqual([second, officialClub]);

        // Pro sells position 1 ("Immer ganz oben in der Entdecken-Liste"), so a
        // boost on the club the admin put SECOND has to jump the queue.
        await db.query(
          `INSERT INTO boosts (user_id, target_type, target_id, credits_spent, boosted_until)
           VALUES ($1,'club',$2,0, NOW() + INTERVAL '1 hour')`, [owner, officialClub]);
        // The listing is cached for 30 s and a raw INSERT busts nothing; a real
        // boost runs through applyBoost, which invalidates 'clubs:' itself.
        (await import('../../src/utils/cache.js')).invalidatePrefix('clubs:');
        const boosted = await call(C.getClubs, { userId: outsider, query: { club_type: 'official', limit: '100' } });
        expect(Number((boosted.body || [])[0].id)).toBe(officialClub);

        await db.query(`DELETE FROM boosts WHERE target_id = $1`, [officialClub]);
        ok(await call(C.setFeaturedClubs, { userId: adminUser, body: { clubIds: [] } }));
      });
    });

    describe('the direct link no longer leaks a club that is not live', () => {
      it('seed: a rejected club with a member', async () => {
        rejectedClub = (await db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members,
                               approval_status, club_type, is_active, lat, lng)
           VALUES ('Smoke Rejected','club',$1,'Sport','Wien',50,'rejected','official',FALSE,48.2,16.37)
           RETURNING id`, [owner])).rows[0].id;
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
          [rejectedClub, outsider]);
      });

      it('a guest gets 404 for a pending club', async () => {
        const res = await call(C.getClubById, { userId: null, params: { id: String(pendingOfficial) } });
        expect(res.statusCode).toBe(404);
      });

      it('a logged-in stranger gets 404 for a pending club', async () => {
        const stranger = await mkUser('smoke-ct-stranger@x.com', 'Sven');
        const res = await call(C.getClubById, { userId: stranger, params: { id: String(pendingOfficial) } });
        expect(res.statusCode).toBe(404);
      });

      it('the owner still sees their own pending club', async () => {
        const res = await call(C.getClubById, { userId: owner, params: { id: String(pendingOfficial) } });
        ok(res);
        expect(Number(res.body.id)).toBe(pendingOfficial);
      });

      // A page must not vanish mid-conversation for the people already in it.
      it('a member still reads a club that was rejected after they joined', async () => {
        const res = await call(C.getClubById, { userId: outsider, params: { id: String(rejectedClub) } });
        ok(res);
        expect(res.body.is_member).toBe(true);
      });

      it('an app admin sees it for moderation', async () => {
        ok(await call(C.getClubById, { userId: adminUser, params: { id: String(rejectedClub) } }));
      });

      it('joinClub refuses a pending and a rejected club with 404', async () => {
        for (const id of [pendingOfficial, rejectedClub]) {
          const joiner = await mkUser(`smoke-ct-join-${id}@x.com`, 'Jens');
          const res = await call(C.joinClub, { userId: joiner, params: { id: String(id) }, body: {} });
          expect(res.statusCode, JSON.stringify(res.body)).toBe(404);
          expect((await db.query(
            `SELECT COUNT(*)::int n FROM group_members WHERE group_id=$1 AND user_id=$2`,
            [id, joiner])).rows[0].n).toBe(0);
        }
      });

      it('an approved community is still joinable', async () => {
        const joiner = await mkUser('smoke-ct-join-ok@x.com', 'Jana');
        ok(await call(C.joinClub, { userId: joiner, params: { id: String(communityClub) }, body: {} }));
      });
    });

    describe('admin reclassifying', () => {
      it('promotes a community to an official club without touching its approval', async () => {
        const res = await call(C.classifyClub, {
          userId: adminUser, params: { id: String(legacyClub) }, body: { club_type: 'official' } });
        ok(res);
        const r = await db.query('SELECT club_type, approval_status FROM groups WHERE id=$1', [legacyClub]);
        expect(r.rows[0]).toEqual({ club_type: 'official', approval_status: 'approved' });
        // ...and it moves segment.
        const inClubs = await call(C.getClubs, { userId: outsider, query: { club_type: 'official', limit: '100' } });
        expect((inClubs.body || []).map((c) => Number(c.id))).toContain(legacyClub);
      });

      it('sets and clears the free-text category line', async () => {
        ok(await call(C.classifyClub, {
          userId: adminUser, params: { id: String(legacyClub) }, body: { category_label: '  Sport · Laufclub  ' } }));
        expect((await db.query('SELECT category_label FROM groups WHERE id=$1', [legacyClub]))
          .rows[0].category_label).toBe('Sport · Laufclub');

        ok(await call(C.classifyClub, {
          userId: adminUser, params: { id: String(legacyClub) }, body: { category_label: '' } }));
        expect((await db.query('SELECT category_label FROM groups WHERE id=$1', [legacyClub]))
          .rows[0].category_label).toBe(null);
      });

      it('refuses an unknown type and an empty body', async () => {
        for (const body of [{ club_type: 'VEREIN' }, {}]) {
          const res = await call(C.classifyClub, {
            userId: adminUser, params: { id: String(legacyClub) }, body });
          expect(res.statusCode).toBe(400);
        }
        expect((await db.query('SELECT club_type FROM groups WHERE id=$1', [legacyClub]))
          .rows[0].club_type).toBe('official');
      });

      it('404s a club that does not exist', async () => {
        const res = await call(C.classifyClub, {
          userId: adminUser, params: { id: '99999999' }, body: { club_type: 'official' } });
        expect(res.statusCode).toBe(404);
      });

      it('the admin list carries type and category for every club', async () => {
        const res = await call(C.getClubsForAdmin, { userId: adminUser, query: { search: 'Smoke Clubhaus' } });
        ok(res);
        const row = (res.body || []).find((c) => Number(c.id) === officialClub);
        expect(row.club_type).toBe('official');
        expect(row.category_label).toBe('Bar · Nightlife');
      });
    });

    describe('the owner maintains the category line', () => {
      it('updateClub saves it, trims it, and refuses more than 60 characters', async () => {
        ok(await call(C.updateClub, { userId: owner, params: { id: String(communityClub) },
          body: { category_label: '  Sport · Laufgruppe  ' } }));
        expect((await db.query('SELECT category_label FROM groups WHERE id=$1', [communityClub]))
          .rows[0].category_label).toBe('Sport · Laufgruppe');

        const tooLong = await call(C.updateClub, { userId: owner, params: { id: String(communityClub) },
          body: { category_label: 'x'.repeat(61) } });
        expect(tooLong.statusCode).toBe(400);

        // '' clears, and NOT sending the field keeps what is stored.
        ok(await call(C.updateClub, { userId: owner, params: { id: String(communityClub) },
          body: { name: 'Smoke Community' } }));
        expect((await db.query('SELECT category_label FROM groups WHERE id=$1', [communityClub]))
          .rows[0].category_label).toBe('Sport · Laufgruppe');
        ok(await call(C.updateClub, { userId: owner, params: { id: String(communityClub) },
          body: { category_label: '' } }));
        expect((await db.query('SELECT category_label FROM groups WHERE id=$1', [communityClub]))
          .rows[0].category_label).toBe(null);
      });

      it('a stranger cannot touch it', async () => {
        const res = await call(C.updateClub, { userId: outsider, params: { id: String(communityClub) },
          body: { category_label: 'Fremd · Kategorie' } });
        expect(res.statusCode).toBe(403);
      });
    });
  });

  // ── Roster gate: members see everyone again (Tobi, 22.10.2026) ──────────
  // getClubMembers had no test at all and getGroupMembers' gate only mocked
  // ones. Real membership rows, real SQL: a joined non-Pro member gets the
  // full roster, an outsider the 3-preview, a private club 403s outsiders —
  // on both routes (/clubs/:id/members and its /groups/:id/members mirror).
  describe('roster gate: members see everyone (22.10.2026)', () => {
    let Own, Mem, Out, pubClub, privClub, plainGroup;
    const mkUser = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, bio)
       VALUES ($1, $2, '1994-05-05', 'female', $3, TRUE, 'email', 'Hallo!') RETURNING id`,
      [email, name, avatar])).rows[0].id;
    const roster = (fn, userId, gid) => call(fn, { userId, params: { id: String(gid) } });

    beforeAll(async () => {
      Own = await mkUser('smoke-roster-own@x.com', 'Roster Owner');
      Mem = await mkUser('smoke-roster-mem@x.com', 'Roster Mitglied');
      Out = await mkUser('smoke-roster-out@x.com', 'Roster Aussen');
      const extra = [];
      for (let i = 0; i < 3; i += 1) extra.push(await mkUser(`smoke-roster-x${i}@x.com`, `Roster Extra ${i}`));

      const mkClub = async (name, isPrivate) => (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, lat, lng)
         VALUES ($1, 'club', $2, 'Sport', 'Wien', 100, $3, 'approved', 48.2, 16.37) RETURNING id`,
        [name, Own, isPrivate])).rows[0].id;
      pubClub = await mkClub('Roster Public Club', false);
      privClub = await mkClub('Roster Private Club', true);
      plainGroup = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
         VALUES ('Roster Gruppe', 'group', NOW() + INTERVAL '4 days', $1, 'Sport', 'Wien', 10) RETURNING id`,
        [Own])).rows[0].id;

      // Five members each: the owner, the plain member and three more.
      for (const gid of [pubClub, privClub, plainGroup]) {
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [gid, Own]);
        for (const uid of [Mem, ...extra]) {
          await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [gid, uid]);
        }
      }
    });

    it('a joined non-Pro member gets the full club roster with the member fields', async () => {
      const res = await roster(C.getClubMembers, Mem, pubClub);
      ok(res);
      expect(res.body.gated).toBe(false);
      expect(res.body.total_count).toBe(5);
      expect(res.body.members).toHaveLength(5);
      for (const m of res.body.members) {
        expect(m).toHaveProperty('bio');
        expect(m).toHaveProperty('role');
        expect(m).toHaveProperty('joined_at');
      }
    });

    it('an outsider without Pro still gets the 3-preview with total_count and no member fields', async () => {
      const res = await roster(C.getClubMembers, Out, pubClub);
      ok(res);
      expect(res.body.gated).toBe(true);
      expect(res.body.total_count).toBe(5);
      expect(res.body.members).toHaveLength(3);
      expect(res.body.members[0]).not.toHaveProperty('bio');
      expect(res.body.members[0]).not.toHaveProperty('joined_at');
    });

    it('a private club 403s the outsider and shows its member everyone', async () => {
      expect((await roster(C.getClubMembers, Out, privClub)).statusCode).toBe(403);
      const res = await roster(C.getClubMembers, Mem, privClub);
      ok(res);
      expect(res.body.gated).toBe(false);
      expect(res.body.members).toHaveLength(5);
    });

    it('the /groups/:id/members mirror answers a club id the same way', async () => {
      const mem = await roster(C.getGroupMembers, Mem, pubClub);
      ok(mem);
      expect(mem.body.gated).toBe(false);
      expect(mem.body.members).toHaveLength(5);
      const out = await roster(C.getGroupMembers, Out, pubClub);
      ok(out);
      expect(out.body.gated).toBe(true);
      expect(out.body.members).toHaveLength(3);
      expect((await roster(C.getGroupMembers, Out, privClub)).statusCode).toBe(403);
      expect((await roster(C.getGroupMembers, Mem, privClub)).body.gated).toBe(false);
    });

    it('a plain group: the joined member sees everyone, the outsider the preview', async () => {
      const mem = await roster(C.getGroupMembers, Mem, plainGroup);
      ok(mem);
      expect(mem.body.gated).toBe(false);
      expect(mem.body.members).toHaveLength(5);
      expect(mem.body.members[0]).toHaveProperty('bio');
      const out = await roster(C.getGroupMembers, Out, plainGroup);
      ok(out);
      expect(out.body.gated).toBe(true);
      expect(out.body.members).toHaveLength(3);
    });
  });

  // ── Welcome lines from ONE source (SYSTEM_TEXTS, 26.10.2026) ────────────
  // New since then: a club EVENT greets its chat too. postSystemMessage runs
  // fire-and-forget after the response, so the rows are polled for briefly.
  describe('welcome lines (26.10.2026)', () => {
    let SYS, host;
    const systemRows = async (gid) => (await db.query(
      `SELECT content, user_id FROM messages WHERE group_id = $1 AND message_type = 'system' ORDER BY id`,
      [gid])).rows;
    const settledRows = async (gid) => {
      for (let i = 0; i < 40; i += 1) {
        const rows = await systemRows(gid);
        if (rows.length > 0) return rows;
        await new Promise((r) => setTimeout(r, 25));
      }
      return systemRows(gid);
    };

    beforeAll(async () => {
      SYS = (await import('../../src/utils/systemMessage.js')).SYSTEM_TEXTS;
      host = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-welcome@x.com', 'Wanda', '1993-02-02', 'female', $1, TRUE, 'email') RETURNING id`,
        [avatar])).rows[0].id;
    });

    it('a new group, club and club event each start with exactly one welcome line', async () => {
      const day = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
      const group = await call(C.createGroup, { userId: host, body: {
        name: 'Willkommensgruppe', description: 'x', type: 'group', category: 'Sport',
        date: day, time: '18:00', location: 'Wien', max_members: 8 } });
      expect(group.statusCode, JSON.stringify(group.body)).toBe(201);
      expect(await settledRows(group.body.id))
        .toEqual([{ content: SYS.welcomeGroup('Willkommensgruppe'), user_id: null }]);

      const club = await call(C.createClub, { userId: host, body: {
        name: 'Willkommensclub', description: 'x', category: 'Sport', location: 'Wien',
        max_members: 50, club_type: 'community' } });
      expect(club.statusCode, JSON.stringify(club.body)).toBe(201);
      expect(await settledRows(club.body.id))
        .toEqual([{ content: SYS.welcomeClub('Willkommensclub'), user_id: null }]);

      const event = await call(C.createClubEvent, { userId: host, params: { id: String(club.body.id) },
        body: { name: 'Willkommensabend', date: day, time: '19:00' } });
      expect(event.statusCode, JSON.stringify(event.body)).toBe(201);
      expect(await settledRows(event.body.id))
        .toEqual([{ content: SYS.welcomeEvent('Willkommensabend'), user_id: null }]);
    });
  });

  // ── Profile: stats row + Memories edit mode (Tina 22.10., built 26.10.) ──
  // Real SQL for what the mocks cannot see: the badge aggregate next to the
  // club-event count, the friend count, the shared Memories predicate with its
  // anti-join, own_photo_id, and the hide/unhide writes. Relative dates only.
  describe('profile stats + hidden memories (26.10.2026)', () => {
    let H, Me, Fr1, Fr2, Pend, Viewer, Rv1, Rv2;
    let confirmedGroup, clubEvent, plainPast, privatePast, notMine;
    const ids = (res) => res.body.map((r) => r.id);
    const stats = async () => (await call(H.getMyProfileStats, { userId: Me })).body;
    const ownList = async () => call(H.getUserHallOfFame, { userId: Me, params: { id: 'me' } });

    beforeAll(async () => {
      H = await import('../../src/controllers/hallOfFameController.js');
      const mk = async (email, name) => (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ($1, $2, '1995-04-04', 'female', $3, TRUE, 'email') RETURNING id`,
        [email, name, avatar])).rows[0].id;
      Me = await mk('smoke-stats-me@x.com', 'Stats Ich');
      Fr1 = await mk('smoke-stats-f1@x.com', 'Stats Freundin');
      Fr2 = await mk('smoke-stats-f2@x.com', 'Stats Freund');
      Pend = await mk('smoke-stats-p@x.com', 'Stats Anfrage');
      Viewer = await mk('smoke-stats-v@x.com', 'Stats Besuch');
      Rv1 = await mk('smoke-stats-r1@x.com', 'Stats Zeugin');
      Rv2 = await mk('smoke-stats-r2@x.com', 'Stats Zeuge');

      await db.query(
        `INSERT INTO friendships (requester_id, addressee_id, status) VALUES
           ($1, $2, 'accepted'), ($3, $1, 'accepted'), ($4, $1, 'pending')`,
        [Me, Fr1, Fr2, Pend]);

      const mkGroup = async (name, { type = 'group', daysAgo, isPrivate = false, owner = Rv1, parent = null }) =>
        (await db.query(
          `INSERT INTO groups (name, type, date, owner_id, category, location, max_members, is_private, parent_club_id)
           VALUES ($1, $2, NOW() - make_interval(days => $3::int), $4, 'Sport', 'Wien', 20, $5, $6) RETURNING id`,
          [name, type, daysAgo, owner, isPrivate, parent])).rows[0].id;
      const join = (gid, uid) => db.query(
        `INSERT INTO group_members (group_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW() - INTERVAL '40 days')`, [gid, uid]);

      // 1) a group meetup two others confirmed, review window long closed
      confirmedGroup = await mkGroup('Stats Bestätigt', { daysAgo: 20 });
      for (const u of [Me, Rv2]) await join(confirmedGroup, u);
      for (const r of [Rv1, Rv2]) {
        await db.query(
          `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present, created_at)
           VALUES ($1, $2, $3, TRUE, NOW() - INTERVAL '19 days')`, [confirmedGroup, r, Me]);
      }
      // 2) a club event — counts without anybody confirming
      const club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, approval_status)
         VALUES ('Stats Club', 'club', $1, 'Sport', 'Wien', 100, 'approved') RETURNING id`, [Rv1])).rows[0].id;
      clubEvent = await mkGroup('Stats Club-Abend', { type: 'event', daysAgo: 5, parent: club });
      await join(clubEvent, Me);
      // 3) a plain past group nobody reviewed — a memory, not a meetup
      plainPast = await mkGroup('Stats Ohne Review', { daysAgo: 3 });
      await join(plainPast, Me);
      // 4) a private past group — in the own grid, never in a stranger's view
      privatePast = await mkGroup('Stats Privat', { daysAgo: 4, isPrivate: true });
      await join(privatePast, Me);
      // 5) somebody else's meetup
      notMine = await mkGroup('Stats Fremd', { daysAgo: 6 });
    });

    it('meetups = 1 confirmed group meetup + 1 club event; friends 2 (pending not); memories 4', async () => {
      expect(await stats()).toEqual({
        available: true, meetups: 2, meetups_confirmed: 1, meetups_club_events: 1, friends: 2, memories: 4,
      });
    });

    it('own_photo_id names the photo behind the cover — own list only', async () => {
      const photo = (await db.query(
        `INSERT INTO event_photos (group_id, user_id, url) VALUES ($1, $2, $3) RETURNING id`,
        [clubEvent, Me, 'https://app.jamie-app.com/media/uploads/stats-own.webp'])).rows[0].id;
      const own = await ownList();
      ok(own);
      const row = own.body.find((r) => r.id === clubEvent);
      expect(row.own_photo_id).toBe(photo);
      expect(row.cover_url).toBe('https://app.jamie-app.com/media/uploads/stats-own.webp');
      expect(own.body.find((r) => r.id === plainPast).own_photo_id).toBe(null);
      const foreign = await call(H.getUserHallOfFame, { userId: Viewer, params: { id: String(Me) } });
      ok(foreign);
      expect(foreign.body.every((r) => !('own_photo_id' in r))).toBe(true);
    });

    it('hide takes a memory out of the grid for every viewer and lowers the count; unhide brings it back', async () => {
      const hide = await call(H.hideMemory, { userId: Me, params: { groupId: String(plainPast) } });
      expect(hide.statusCode, JSON.stringify(hide.body)).toBe(200);
      expect(ids(await ownList())).not.toContain(plainPast);
      expect((await stats()).memories).toBe(3);
      expect((await stats()).meetups).toBe(2);                  // meetups never shrink by hiding
      const foreign = await call(H.getUserHallOfFame, { userId: Viewer, params: { id: String(Me) } });
      expect(ids(foreign).sort((a, b) => a - b)).toEqual([confirmedGroup, clubEvent].sort((a, b) => a - b));

      // idempotent, and only real own memories can be hidden
      expect((await call(H.hideMemory, { userId: Me, params: { groupId: String(plainPast) } })).statusCode).toBe(200);
      expect((await call(H.hideMemory, { userId: Me, params: { groupId: String(notMine) } })).statusCode).toBe(404);

      const undo = await call(H.unhideMemory, { userId: Me, params: { groupId: String(plainPast) } });
      expect(undo.body).toEqual({ hidden: false });
      expect(ids(await ownList())).toContain(plainPast);
      expect((await stats()).memories).toBe(4);
    });

    it('deleting the account clears its hidden rows (CASCADE)', async () => {
      const tmp = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-stats-tmp@x.com', 'Stats Weg', '1995-04-04', 'female', $1, TRUE, 'email') RETURNING id`,
        [avatar])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role, joined_at)
                      VALUES ($1, $2, 'member', NOW() - INTERVAL '40 days')`, [plainPast, tmp]);
      ok(await call(H.hideMemory, { userId: tmp, params: { groupId: String(plainPast) } }));
      await db.query('DELETE FROM users WHERE id = $1', [tmp]);
      const left = await db.query('SELECT COUNT(*)::int AS n FROM hall_of_fame_hidden WHERE user_id = $1', [tmp]);
      expect(left.rows[0].n).toBe(0);
    });
  });

  // ── Admin: JAMIE Pro at the top of the dashboard (Tobi, 16.11.2026) ──────
  // The mocked unit test pins the rules written into the query; this runs it:
  // the LATERAL receipt lookup per chain key, DISTINCT users across channels,
  // the team and sandbox split, and „neu“ by the FIRST row that granted Pro.
  // Deltas against a baseline: earlier blocks leave Pro rows of their own.
  describe('admin stats: JAMIE Pro (16.11.2026)', () => {
    const mkUser = async (email, isAdmin = false) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, is_admin)
       VALUES ($1, 'Pro', '1995-05-05', 'female', $2, TRUE, 'email', $3) RETURNING id`,
      [email, avatar, isAdmin])).rows[0].id;
    // A subscriptions row in the shape its writer leaves; days relative to NOW().
    const sub = (userId, { status, endDays = null, createdDays = 0, subId, customer }) => db.query(
      `INSERT INTO subscriptions (user_id, status, current_period_end, stripe_subscription_id, stripe_customer_id, created_at)
       VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $3::int) END,
               $4, $5, NOW() - make_interval(days => $6::int))`,
      [userId, status, endDays, subId, customer, createdDays]);
    const receipt = (userId, { platform = 'apple', txId, origTxId, environment }) => db.query(
      `INSERT INTO iap_receipts (user_id, platform, product_id, product_type, transaction_id,
                                 original_transaction_id, environment, raw_receipt, payload)
       VALUES ($1, $2, 'pro_monthly', 'subscription', $3, $4, $5, '', '{}'::jsonb)`,
      [userId, platform, txId, origTxId, environment]);
    const pro = async () => {
      const res = await call(C.getStats, {});
      ok(res);
      expect(res.body.pro).not.toBeNull();
      return res.body.pro;
    };

    it('DISTINCT users per channel; team and sandbox apart; „jemals“ keeps lapsed subs, „neu“ goes by the first Pro row', async () => {
      const before = await pro();

      // RevenueCat (Apple), live, bought today, production receipt
      const apple = await mkUser('smoke-pro-apple@x.com');
      await sub(apple, { status: 'active', endDays: 30, subId: `revenuecat:${apple}`, customer: `apple:${apple}` });
      await receipt(apple, { txId: 'smoke-pro-tx-a', origTxId: `revenuecat:${apple}`, environment: 'Production' });
      // Play (direct path, key without 'google:'), canceled but paid up, bought 20 days ago
      const play = await mkUser('smoke-pro-play@x.com');
      await sub(play, { status: 'canceling', endDays: 10, createdDays: 20,
        subId: 'google:smoke-pro-token-play-0001', customer: `google:${play}` });
      await receipt(play, { platform: 'google', txId: 'GPA.smoke-pro-1', origTxId: 'smoke-pro-token-play-0001', environment: 'Production' });
      // web trial (Stripe), started today
      const trial = await mkUser('smoke-pro-trial@x.com');
      await sub(trial, { status: 'trialing', endDays: 14, subId: 'sub_smoke_pro_trial', customer: 'cus_smoke_pro_trial' });
      // lapsed: an Apple sub in the store end state, and an 'active' row whose period ran out
      const lapsed = await mkUser('smoke-pro-lapsed@x.com');
      await sub(lapsed, { status: 'expired', endDays: -3, createdDays: 90, subId: `revenuecat:${lapsed}`, customer: `apple:${lapsed}` });
      const ranOut = await mkUser('smoke-pro-ranout@x.com');
      await sub(ranOut, { status: 'active', endDays: -1, createdDays: 100, subId: 'sub_smoke_pro_ranout', customer: 'cus_smoke_pro_ranout' });
      // abandoned checkout: never Pro, never „jemals“
      const pending = await mkUser('smoke-pro-pending@x.com');
      await sub(pending, { status: 'pending', subId: 'sub_smoke_pro_pending', customer: 'cus_smoke_pro_pending' });
      // came back: a canceled web sub from 60 days ago + a live Apple one → one user, and not „neu“
      const back = await mkUser('smoke-pro-back@x.com');
      await sub(back, { status: 'canceled', endDays: -30, createdDays: 60, subId: 'sub_smoke_pro_back', customer: 'cus_smoke_pro_back' });
      await sub(back, { status: 'active', endDays: 30, createdDays: 2, subId: `revenuecat:${back}`, customer: `apple:${back}` });
      // direct Apple path (key without 'apple:'): tried in the sandbox, then bought → the NEWEST receipt decides
      const direct = await mkUser('smoke-pro-direct@x.com');
      await sub(direct, { status: 'active', endDays: 30, subId: 'apple:2000000999000001', customer: `apple:${direct}` });
      await receipt(direct, { txId: 'smoke-pro-tx-d1', origTxId: '2000000999000001', environment: 'Sandbox' });
      await receipt(direct, { txId: 'smoke-pro-tx-d2', origTxId: '2000000999000001', environment: 'Production' });
      // a team account with a live sub
      const team = await mkUser('smoke-pro-team@x.com', true);
      await sub(team, { status: 'active', endDays: 30, subId: 'sub_smoke_pro_team', customer: 'cus_smoke_pro_team' });
      // TestFlight / App Review (RevenueCat sandbox) and a Play license tester ('Test')
      const testflight = await mkUser('smoke-pro-testflight@x.com');
      await sub(testflight, { status: 'active', endDays: 1, subId: `revenuecat:${testflight}`, customer: `apple:${testflight}` });
      await receipt(testflight, { txId: 'smoke-pro-tx-tf', origTxId: `revenuecat:${testflight}`, environment: 'Sandbox' });
      const tester = await mkUser('smoke-pro-tester@x.com');
      await sub(tester, { status: 'active', endDays: 5, subId: 'google:smoke-pro-token-test-0001', customer: `google:${tester}` });
      await receipt(tester, { platform: 'google', txId: 'GPA.smoke-pro-t', origTxId: 'smoke-pro-token-test-0001', environment: 'Test' });

      const after = await pro();
      const delta = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, a[k] - b[k]]));
      const { by_store: storesAfter, ...flatAfter } = after;
      const { by_store: storesBefore, ...flatBefore } = before;
      expect(delta(flatAfter, flatBefore)).toEqual({
        active: 5,          // apple, play, trial, back, direct
        trialing: 1,        // trial
        canceling: 1,       // play
        ever: 7,            // + lapsed, ranOut — never pending, team or the two test buyers
        new_7d: 3,          // apple, trial, direct (back's first Pro row is 60 days old)
        new_30d: 4,         // + play
        team_active: 1,
        sandbox_active: 2,  // testflight, tester
      });
      expect(delta(storesAfter, storesBefore)).toEqual({ apple: 3, google: 1, web: 1 });
      for (const v of [...Object.values(flatAfter), ...Object.values(storesAfter)]) expect(Number.isInteger(v)).toBe(true);
      // one live row per user (subscriptions_one_active_per_user) → the channels add up to the headline
      expect(storesAfter.apple + storesAfter.google + storesAfter.web).toBe(after.active);
    });

    it('without the subscriptions table (boot window): pro is null, quietly, and the rest of the stats load', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await db.query('ALTER TABLE subscriptions RENAME TO subscriptions_bootwin');
        const res = await call(C.getStats, {});
        ok(res);
        expect(res.body.pro).toBe(null);
        expect(res.body.users).toBeTruthy();
        expect(err).not.toHaveBeenCalled();
      } finally {
        await db.query('ALTER TABLE IF EXISTS subscriptions_bootwin RENAME TO subscriptions');
        err.mockRestore();
      }
      expect((await pro()).active).toBeGreaterThan(0);
    });
  });

  // ── „Wer war dabei?“ only for small meetups (Tina, 16.11.2026) ──────────
  // At most 8 people INCLUDING the owner, counted on the event DAY: members by
  // its end (joinedInTimeSql) ∪ whoever left once it had begun
  // (hall_of_fame_entries). Prompt, re-open pill and write gate share it via
  // reviewableEventSql; the D+1 push also needs 2 people and daytime. A
  // correlated UNION subquery inside four different statements — real SQL.
  describe('„Wer war dabei?“ only up to 8 participants (S4, 16.11.2026)', () => {
    let O, P; // the owner + eight others
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1994-04-04','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    // A past one-off meetup at 19:00 Vienna three days ago (its day is over on
    // any clock, its round still open), everybody a member since long before.
    const mkMeetup = async (others, name = 'Größen-Treffen') => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
         VALUES ($1, 'group',
                 date_trunc('day', NOW() AT TIME ZONE 'Europe/Vienna') - INTERVAL '3 days' + INTERVAL '19 hours',
                 $2, 'Sport', 'Wien', 20) RETURNING id`, [name, O])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role, joined_at)
         SELECT $1, u, CASE WHEN u = $2 THEN 'owner' ELSE 'member' END, NOW() - INTERVAL '40 days'
           FROM unnest($3::int[]) AS u`, [id, O, [O, ...others]]);
      return id;
    };
    const pendingIds = async (uid) => {
      const res = await call(C.getPendingReviews, { userId: uid });
      ok(res);
      return res.body.map((r) => r.group_id);
    };

    beforeAll(async () => {
      O = await mkU('smoke-s4-owner@x.com', 'Olga');
      P = [];
      for (let i = 1; i <= 8; i++) P.push(await mkU(`smoke-s4-p${i}@x.com`, `Pia ${i}`));
    });

    it('8 people including the owner: asked, everyone listed, answers count', async () => {
      const gid = await mkMeetup(P.slice(0, 7));
      expect(await pendingIds(P[0])).toContain(gid);
      const reopen = await call(C.getReviewForGroup, { userId: P[0], params: { groupId: String(gid) } });
      ok(reopen);
      expect(reopen.body.members).toHaveLength(7); // everyone but the asker
      const res = await call(C.submitReview, { userId: P[0], body: {
        group_id: gid, attendances: [{ user_id: P[1], was_present: true }] } });
      expect(res.body).toEqual({ success: true, counted: true });
    });

    it('9 people: no popup, the re-open pill 404s, a crafted answer records only the sentinel', async () => {
      const gid = await mkMeetup(P);
      expect(await pendingIds(P[0])).not.toContain(gid);
      expect(await pendingIds(O)).not.toContain(gid);
      const reopen = await call(C.getReviewForGroup, { userId: P[0], params: { groupId: String(gid) } });
      expect(reopen.statusCode).toBe(404);
      const res = await call(C.submitReview, { userId: P[0], body: {
        group_id: gid, attendances: [{ user_id: P[1], was_present: true }] } });
      expect(res.body).toEqual({ success: true, counted: false });
      expect((await db.query('SELECT reviewed_user_id, was_present FROM event_reviews WHERE group_id = $1', [gid])).rows)
        .toEqual([{ reviewed_user_id: P[0], was_present: false }]);
      // …and its owner can still say it never happened: not_held runs before the gate.
      ok(await call(C.submitReview, { userId: O, body: { group_id: gid, not_held: true } }));
      expect((await db.query('SELECT did_not_take_place FROM groups WHERE id = $1', [gid])).rows[0].did_not_take_place).toBe(true);
    });

    // Review 16.11.2026: the owner's „Hat nicht stattgefunden“ pill needs to
    // know whether their answer is already on record — not_held after one is
    // turned away (409) before its own branch.
    it('the event page tells its owner (only) whether their answer is on record', async () => {
      const gid = await mkMeetup(P.slice(0, 7));
      const page = async (uid) => {
        const res = await call(C.getGroupById, { userId: uid, params: { id: String(gid) } });
        ok(res);
        return res.body;
      };
      expect((await page(O)).has_reviewed).toBe(false);
      expect((await page(P[0])).has_reviewed).toBeUndefined();
      ok(await call(C.submitReview, { userId: O, body: {
        group_id: gid, attendances: [{ user_id: P[0], was_present: true }] } }));
      expect((await page(O)).has_reviewed).toBe(true);
      expect((await call(C.submitReview, { userId: O, body: { group_id: gid, not_held: true } })).statusCode).toBe(409);
    });

    // Review 16.11.2026: the pill went by members_count — 9 at the event, 2
    // of them left afterwards, made 7: no pill; the popup counted 9: no popup
    // either. The page now gets the popup's own count, for its owner only.
    it('the event page tells its owner (only) the popup\'s head count — also whoever left after the day', async () => {
      const gid = await mkMeetup(P, 'Gegangen-Treffen');   // the owner + 8 = 9
      ok(await call(C.leaveGroup, { userId: P[7], params: { id: String(gid) } }));
      ok(await call(C.leaveGroup, { userId: P[6], params: { id: String(gid) } }));
      const page = async (uid) => {
        const res = await call(C.getGroupById, { userId: uid, params: { id: String(gid) } });
        ok(res);
        return res.body;
      };
      const own = await page(O);
      expect(own.members_count).toBe(7);
      expect(own.review_participants).toBe(9);
      expect(await pendingIds(O)).not.toContain(gid);           // the popup's 9: not asked
      expect((await page(P[0])).review_participants).toBeUndefined();
      // a kick leaves no history: 6 members + the two who left = 8 — asked, and the page says 8
      ok(await call(C.kickMember, { userId: O, params: { id: String(gid), userId: String(P[5]) } }));
      expect((await page(O)).review_participants).toBe(8);
      expect(await pendingIds(O)).toContain(gid);
    });

    it('a late joiner does not count: 8 in time plus one afterwards is still asked', async () => {
      const gid = await mkMeetup(P.slice(0, 7));
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [gid, P[7]]); // joined NOW
      expect(await pendingIds(P[0])).toContain(gid);
      expect(await pendingIds(P[7])).not.toContain(gid);
    });

    it('leaving once the event day has begun still counts (9 stay 9); a kick leaves no history', async () => {
      const gid = await mkMeetup(P);
      ok(await call(C.leaveGroup, { userId: P[7], params: { id: String(gid) } }));
      expect((await db.query('SELECT 1 FROM hall_of_fame_entries WHERE group_id = $1 AND user_id = $2', [gid, P[7]])).rowCount).toBe(1);
      expect(await pendingIds(P[0])).not.toContain(gid); // 8 members + the one who left
      ok(await call(C.kickMember, { userId: O, params: { id: String(gid), userId: String(P[6]) } }));
      expect(await pendingIds(P[0])).toContain(gid);     // 7 members + the one who left = 8
    });

    it('a solo owner keeps the prompt — the modal is their way to „Hat nicht stattgefunden“', async () => {
      const gid = await mkMeetup([]);
      const res = await call(C.getPendingReviews, { userId: O });
      ok(res);
      expect(res.body.find((r) => r.group_id === gid).members).toEqual([]);
    });

    it('the push: 2–8 people only, 09:00–22:59 Vienna only, never to a late joiner', async () => {
      // Pre-claim every dated row so far, so only the four meetups below can fire.
      await db.query(`UPDATE groups SET reminder_day_sent_for = date, reminder_hour_sent_for = date,
                                        owner_nudge_sent_for = date, review_nudge_sent_for = date WHERE date IS NOT NULL`);
      const eight = await mkMeetup(P.slice(0, 7), 'Push Acht');
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [eight, P[7]]); // late
      const nine = await mkMeetup(P, 'Push Neun');
      const solo = await mkMeetup([], 'Push Solo');
      // Owner + one who left after the meetup: 2 participants, but the owner's
      // list is empty — no push about it (review 16.11.2026).
      const deserted = await mkMeetup([P[0]], 'Push Verlassen');
      ok(await call(C.leaveGroup, { userId: P[0], params: { id: String(deserted) } }));
      expect((await db.query('SELECT 1 FROM hall_of_fame_entries WHERE group_id = $1 AND user_id = $2', [deserted, P[0]])).rowCount).toBe(1);
      // The day after the meetups, as a true instant (Vienna wall-clock).
      const dayAfter = async (hhmm) => (await db.query(
        `SELECT (((date::date + 1)::timestamp + $2::time) AT TIME ZONE 'Europe/Vienna') AS t FROM groups WHERE id = $1`,
        [eight, hhmm])).rows[0].t;
      const claimed = async (id) => (await db.query(
        'SELECT review_nudge_sent_for IS NOT NULL AS c FROM groups WHERE id = $1', [id])).rows[0].c;

      // 23:30: inside the D+1 window, outside the day — nothing.
      expect(await C.runEventReminders({ now: await dayAfter('23:30') }))
        .toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 0, pushes: 0 });
      // 11:00: the 8-person meetup only, to its 8 — the late joiner not among them.
      expect(await C.runEventReminders({ now: await dayAfter('11:00') }))
        .toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 1, pushes: 8 });
      expect([await claimed(eight), await claimed(nine), await claimed(solo), await claimed(deserted)])
        .toEqual([true, false, false, false]);
      // …while its owner still gets the prompt itself, with nobody to tick.
      const prompt = (await call(C.getPendingReviews, { userId: O })).body.find((r) => r.group_id === deserted);
      expect(prompt.members).toEqual([]);
    });

    // Review 16.11.2026: owner + one other in a block are two heads, but two
    // empty lists — the meetup is claimed, nobody gets a push about nobody.
    it('the push: nobody whose list would be empty — the owner and the only other, in a block', async () => {
      await db.query(`UPDATE groups SET reminder_day_sent_for = date, reminder_hour_sent_for = date,
                                        owner_nudge_sent_for = date, review_nudge_sent_for = date WHERE date IS NOT NULL`);
      const pair = await mkMeetup([P[0]], 'Push Blockiert');
      await db.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'blocked')`, [P[0], O]);
      try {
        const at11 = (await db.query(
          `SELECT (((date::date + 1)::timestamp + TIME '11:00') AT TIME ZONE 'Europe/Vienna') AS t FROM groups WHERE id = $1`,
          [pair])).rows[0].t;
        expect(await C.runEventReminders({ now: at11 }))
          .toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, reviewNudge: 1, pushes: 0 });
        const prompt = (await call(C.getPendingReviews, { userId: O })).body.find((r) => r.group_id === pair);
        expect(prompt.members).toEqual([]);
      } finally {
        await db.query('DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2', [P[0], O]);
      }
    });
  });

  // ── „☆ Partner“: an official club's own events (Tina/Tobi, 16.11.2026) ─
  // utils/clubGate.js partnerSql: the parent is a live OFFICIAL club and the
  // event's creator is its owner or a co-manager. One predicate for the feed
  // (decoration SELECT) and the event page (main SELECT, guests included).
  describe('„☆ Partner“ events (16.11.2026)', () => {
    // A category nobody else uses: the feed returns exactly these rows — and
    // still through the 30 s cache, which a reclassification has to bust.
    const CAT = 'SmokePartner';
    let host, coMgr, member, commHost, viewer;
    let byHost, byCoMgr, byMember, inCommunity, plainGroup;
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1994-04-04','male',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    const mkClub = async (name, owner, clubType) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, club_type)
       VALUES ($1,'club',$2,'Bar','Wien',100,FALSE,'approved',$3) RETURNING id`, [name, owner, clubType])).rows[0].id;
    const mkEvent = async (name, clubId, owner) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, is_private)
       VALUES ($1,$2,$3,$4,'Wien',20, NOW() + INTERVAL '3 days', $5, FALSE) RETURNING id`,
      [name, clubId ? 'event' : 'group', owner, CAT, clubId])).rows[0].id;
    const feed = async () => {
      const res = await call(C.getGroups, { userId: viewer,
        query: { type: 'group', upcoming: 'true', include_club_events: 'true', category: CAT } });
      ok(res);
      return Object.fromEntries(res.body.map((r) => [r.id, r.is_partner]));
    };

    it('seed: an official club with owner, co-manager and member, a community, a plain group', async () => {
      host = await mkU('smoke-partner-host@x.com', 'Paco');
      coMgr = await mkU('smoke-partner-mgr@x.com', 'Mats');
      member = await mkU('smoke-partner-member@x.com', 'Mo');
      commHost = await mkU('smoke-partner-comm@x.com', 'Cem');
      viewer = await mkU('smoke-partner-viewer@x.com', 'Vito');
      const official = await mkClub('Smoke Café Partner', host, 'official');
      // ☆ Partner is for paying partners only since 17.11.2026 (partnerSql): this one pays.
      await db.query('UPDATE groups SET is_paid_partner = TRUE WHERE id = $1', [official]);
      const community = await mkClub('Smoke Community Partner', commHost, 'community');
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member')`,
        [official, host, coMgr, member]);
      byHost = await mkEvent('Punsch Night', official, host);
      byCoMgr = await mkEvent('Quiz vom Team', official, coMgr);
      byMember = await mkEvent('Mitglieder-Abend', official, member); // events_owner_only off
      inCommunity = await mkEvent('Community-Lauf', community, commHost);
      plainGroup = await mkEvent('Normales Treffen', null, host);
    });

    it('the feed marks what the official club put up itself — nothing else', async () => {
      expect(await feed()).toEqual({
        [byHost]: true, [byCoMgr]: true, [byMember]: false, [inCommunity]: false, [plainGroup]: false,
      });
    });

    it('the event page carries the same flag — for a guest (share link) too', async () => {
      for (const [id, want] of [[byHost, true], [byCoMgr, true], [byMember, false], [inCommunity, false], [plainGroup, false]]) {
        for (const userId of [0, viewer]) {
          const res = await call(C.getGroupById, { userId, params: { id: String(id) } });
          ok(res);
          expect(res.body.is_partner, `group ${id} as user ${userId}`).toBe(want);
        }
      }
    });

    it('a club that is no longer live makes nobody a partner', async () => {
      const gone = await mkClub('Smoke Partner zu', host, 'official');
      await db.query('UPDATE groups SET is_paid_partner = TRUE WHERE id = $1', [gone]); // a paying partner
      const ev = await mkEvent('Letzter Abend', gone, host);
      expect((await call(C.getGroupById, { userId: viewer, params: { id: String(ev) } })).body.is_partner).toBe(true);
      await db.query('UPDATE groups SET deleted_at = NOW(), is_active = FALSE WHERE id = $1', [gone]);
      expect((await call(C.getGroupById, { userId: viewer, params: { id: String(ev) } })).body.is_partner).toBe(false);
    });

    // Since 17.11.2026 the club's TYPE alone makes nobody a partner: the mark
    // „Zahlender Partner“ does, on an official club. Each step must show in the
    // feed at once — classify busts the 30 s cache.
    it('classifying a club shows in the feed at once — official alone is no partner, the paying mark is', async () => {
      const later = await mkClub('Smoke Bald Partner', host, 'community');
      const ev = await mkEvent('Bald Partner-Event', later, host);
      const paid = async () => (await db.query('SELECT is_paid_partner FROM groups WHERE id = $1', [later])).rows[0].is_paid_partner;
      const classify = (body) => call(C.classifyClub, { userId: A, params: { id: String(later) }, body });
      // Raw INSERTs bust nothing (the real create paths do) — start from a fresh read.
      (await import('../../src/utils/cache.js')).invalidatePrefix('groups:');
      expect((await feed())[ev]).toBe(false); // …which is cached now

      // an official club that does not pay: still no partner
      ok(await classify({ club_type: 'official' }));
      expect((await feed())[ev]).toBe(false);
      // the mark: a partner at once
      const marked = await classify({ is_paid_partner: true });
      ok(marked);
      expect(marked.body.club).toMatchObject({ id: later, club_type: 'official', is_paid_partner: true });
      expect((await feed())[ev]).toBe(true);
      // a community again: no partner — the mark stays where it is…
      ok(await classify({ club_type: 'community' }));
      expect((await feed())[ev]).toBe(false);
      expect(await paid()).toBe(true);
      // …and is back with the type
      ok(await classify({ club_type: 'official' }));
      expect((await feed())[ev]).toBe(true);
      // taken off again
      const unmarked = await classify({ is_paid_partner: false });
      ok(unmarked);
      expect(unmarked.body.club.is_paid_partner).toBe(false);
      expect((await feed())[ev]).toBe(false);
    });

    it('an official club that does not pay: a partner nowhere', async () => {
      const free = await mkClub('Smoke Café Gratis', host, 'official');
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [free, host]);
      const ev = await mkEvent('Gratis-Abend', free, host);
      (await import('../../src/utils/cache.js')).invalidatePrefix('groups:');
      expect((await feed())[ev]).toBe(false);
      for (const userId of [0, viewer]) {
        const res = await call(C.getGroupById, { userId, params: { id: String(ev) } });
        ok(res);
        expect(res.body.is_partner, `as user ${userId}`).toBe(false);
      }
    });

    it('the mark is for official clubs only — a community is refused, both in one request goes', async () => {
      const comm = await mkClub('Smoke Community Zahlt Nicht', commHost, 'community');
      const paid = async () => (await db.query('SELECT is_paid_partner, club_type FROM groups WHERE id = $1', [comm])).rows[0];
      const classify = (body, id = comm) => call(C.classifyClub, { userId: A, params: { id: String(id) }, body });

      const refused = await classify({ is_paid_partner: true });
      expect(refused.statusCode).toBe(400);
      expect(refused.body.code).toBe('PAID_PARTNER_OFFICIAL_ONLY');
      expect(await paid()).toEqual({ is_paid_partner: false, club_type: 'community' });
      // `false` always goes, also here
      ok(await classify({ is_paid_partner: false }));
      // not a boolean: refused before any write
      expect((await classify({ is_paid_partner: 'true' })).statusCode).toBe(400);
      expect(await paid()).toEqual({ is_paid_partner: false, club_type: 'community' });
      // type and mark together
      const both = await classify({ club_type: 'official', is_paid_partner: true });
      ok(both);
      expect(both.body.club).toMatchObject({ club_type: 'official', is_paid_partner: true });
      expect(await paid()).toEqual({ is_paid_partner: true, club_type: 'official' });
      // an event or a group is no club: 404, never marked
      const notAClub = await classify({ is_paid_partner: true }, byHost);
      expect(notAClub.statusCode).toBe(404);
      expect((await db.query('SELECT is_paid_partner FROM groups WHERE id = $1', [byHost])).rows[0].is_paid_partner).toBe(false);
      // a club that does not exist
      expect((await classify({ is_paid_partner: true }, 2147483000)).statusCode).toBe(404);
    });

    it('the admin list carries the mark', async () => {
      const res = await call(C.getClubsForAdmin, { userId: A, query: { search: 'Smoke Café' } });
      ok(res);
      const marks = Object.fromEntries(res.body.map((c) => [c.name, c.is_paid_partner]));
      expect(marks['Smoke Café Partner']).toBe(true);
      expect(marks['Smoke Café Gratis']).toBe(false);
    });
  });

  // ── Anfragen-Deck (Ziel 4, Tina 16.11.2026) ─────────────────────────────
  // The card gets what it needs to say what it is while it is swiped, and the
  // deck holds only requests that can still be answered. Accepting into an
  // event that no longer happens is refused on every path.
  describe('Anfragen deck: what the card needs, only what can still be answered (16.11.2026)', () => {
    const vienna = `(NOW() AT TIME ZONE 'Europe/Vienna')`;
    const clubImage = 'https://app.jamie-app.com/media/uploads/club.webp';
    let host, asker;
    const G = {};   // the entities, by case
    const R = {};   // the request ids, by case
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1993-03-03','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    const mk = async ({ name, type = 'group', dateSql = 'NULL', recurring = false, active = true,
      isPrivate = true, clubType = null, parent = null, image = null }) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, is_recurring_weekly,
                           is_active, is_private, approval_status, club_type, parent_club_id, image_url)
       VALUES ($1,$2,$3,'Sport','Wien',20, ${dateSql}, $4, $5, $6, 'approved', $7, $8, $9) RETURNING id`,
      [name, type, host, recurring, active, isPrivate, clubType, parent, image])).rows[0].id;
    const ask = async (gid, rejected = 0) => (await db.query(
      `INSERT INTO group_join_requests (group_id, user_id, status, rejected_count)
       VALUES ($1,$2,'pending',$3) RETURNING id`, [gid, asker, rejected])).rows[0].id;
    const deck = async () => {
      const res = await call(C.getAllJoinRequests, { userId: host });
      ok(res);
      return res.body;
    };
    const isMember = async (gid) => (await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [gid, asker])).rowCount === 1;

    it('seed: one host, one asker, one request per case', async () => {
      host = await mkU('smoke-deck-host@x.com', 'Hanna');
      asker = await mkU('smoke-deck-asker@x.com', 'Ari');
      G.live = await mk({ name: 'Deck Live', dateSql: `${vienna} + INTERVAL '5 days'` });
      G.cancelled = await mk({ name: 'Deck Abgesagt', dateSql: `${vienna} + INTERVAL '5 days'`, active: false });
      G.past = await mk({ name: 'Deck Vorbei', dateSql: `${vienna} - INTERVAL '2 days'` });
      G.weekly = await mk({ name: 'Deck Wöchentlich', dateSql: `${vienna} - INTERVAL '20 days'`, recurring: true });
      // Started at 00:01 today — the deck keeps it until the Vienna day is over.
      G.today = await mk({ name: 'Deck Heute', dateSql: `date_trunc('day', ${vienna}) + INTERVAL '1 minute'` });
      // A club's date is a "next meetup", long past here — and nothing to do with the request.
      G.club = await mk({ name: 'Deck Club', type: 'club', dateSql: `${vienna} - INTERVAL '30 days'`, clubType: 'official' });
      G.pubClub = await mk({ name: 'Deck Partner-Club', type: 'club', isPrivate: false, clubType: 'official', image: clubImage });
      // „☆ Partner“ is for paying partners only since Tobi 17.11.2026 (partnerSql):
      // this seed pays, so card('clubEvent') keeps is_partner: true.
      await db.query('UPDATE groups SET is_paid_partner = TRUE WHERE id = $1', [G.pubClub]);
      G.clubEvent = await mk({ name: 'Deck Club-Event', type: 'event', dateSql: `${vienna} + INTERVAL '4 days'`, parent: G.pubClub });
      G.deadClub = await mk({ name: 'Deck Club weg', type: 'club', isPrivate: false, clubType: 'community' });
      G.deadEvent = await mk({ name: 'Deck Event ohne Club', type: 'event', dateSql: `${vienna} + INTERVAL '4 days'`, parent: G.deadClub });
      await db.query('UPDATE groups SET deleted_at = NOW(), is_active = FALSE WHERE id = $1', [G.deadClub]);
      G.closedClub = await mk({ name: 'Deck Club geschlossen', type: 'club', active: false, clubType: 'community' });
      // A live community's event: its card must not read as „☆ Partner".
      G.commClub = await mk({ name: 'Deck Community', type: 'club', isPrivate: false, clubType: 'community' });
      G.commEvent = await mk({ name: 'Deck Community-Event', type: 'event', dateSql: `${vienna} + INTERVAL '4 days'`, parent: G.commClub });
      for (const k of ['cancelled', 'past', 'weekly', 'today', 'club', 'clubEvent', 'deadEvent', 'closedClub', 'commEvent']) {
        R[k] = await ask(G[k]);
      }
      R.live = await ask(G.live, 1); // turned down once before
    });

    it('lists only requests that can still be answered', async () => {
      const ids = (await deck()).map((r) => r.id);
      for (const k of ['live', 'weekly', 'today', 'club', 'clubEvent', 'commEvent']) expect(ids, k).toContain(R[k]);
      for (const k of ['cancelled', 'past', 'deadEvent', 'closedClub']) expect(ids, k).not.toContain(R[k]);
    });

    it('the card carries the date, the type and the club behind an event — and earlier refusals', async () => {
      const cards = await deck();
      const card = (k) => cards.find((r) => r.id === R[k]);
      expect(card('clubEvent')).toMatchObject({
        group_type: 'event', group_name: 'Deck Club-Event', group_recurring: false, group_club_type: null,
        parent_club_id: G.pubClub, parent_club_name: 'Deck Partner-Club', parent_club_image: clubImage,
        rejected_count: 0,
      });
      expect(card('clubEvent').group_date).toBeInstanceOf(Date);
      expect(card('club')).toMatchObject({ group_type: 'club', group_club_type: 'official', parent_club_id: null, parent_club_name: null });
      expect(card('weekly').group_recurring).toBe(true);
      expect(card('live').rejected_count).toBe(1);
    });

    // WHOSE event (review 16.11.2026): the club's own type, and „☆ Partner"
    // by partnerSql — the official club's event its owner put up.
    it('an event card knows its club\'s type and whether it is a partner event', async () => {
      const cards = await deck();
      const card = (k) => cards.find((r) => r.id === R[k]);
      expect(card('clubEvent')).toMatchObject({ group_club_type: null, parent_club_type: 'official', is_partner: true });
      expect(card('commEvent')).toMatchObject({ group_club_type: null, parent_club_type: 'community', is_partner: false });
      expect(card('club')).toMatchObject({ parent_club_type: null, is_partner: false });
      expect(card('live')).toMatchObject({ parent_club_type: null, is_partner: false });
    });

    it('accepting into a cancelled event, an event of a dead club or a closed club: 410, nobody joins, still pending', async () => {
      const single = await call(C.handleJoinRequest, { userId: host,
        params: { id: String(G.cancelled), requestId: String(R.cancelled) }, body: { action: 'accept' } });
      expect(single.statusCode).toBe(410);
      expect(single.body.code).toBe('GROUP_GONE');
      const bulk = await call(C.bulkAcceptJoinRequests, { userId: host, params: { id: String(G.cancelled) }, body: {} });
      expect(bulk.statusCode).toBe(410);
      const orphan = await call(C.handleJoinRequest, { userId: host,
        params: { id: String(G.deadEvent), requestId: String(R.deadEvent) }, body: { action: 'accept' } });
      expect(orphan.statusCode).toBe(410);
      expect(orphan.body.code).toBe('CLUB_GONE');
      const closed = await call(C.handleClubJoinRequest, { userId: host,
        params: { id: String(G.closedClub), requestId: String(R.closedClub) }, body: { action: 'accept' } });
      expect(closed.statusCode).toBe(410);
      expect(closed.body.code).toBe('GROUP_GONE');
      for (const k of ['cancelled', 'deadEvent', 'closedClub']) {
        expect(await isMember(G[k]), k).toBe(false);
        expect((await db.query('SELECT status FROM group_join_requests WHERE id = $1', [R[k]])).rows[0].status, k).toBe('pending');
      }
    });

    it('where it still happens, accepting works as before', async () => {
      ok(await call(C.handleJoinRequest, { userId: host,
        params: { id: String(G.clubEvent), requestId: String(R.clubEvent) }, body: { action: 'accept' } }));
      expect(await isMember(G.clubEvent)).toBe(true);
      ok(await call(C.handleClubJoinRequest, { userId: host,
        params: { id: String(G.club), requestId: String(R.club) }, body: { action: 'accept' } }));
      expect(await isMember(G.club)).toBe(true);
    });
  });

  // ── Profil „Clubs & Communities“ (Tina 16.11.2026, PR3) ─────────────────
  // GET /clubs/user/joined carries the bubble fields (additive, Home keeps its
  // order), PUT /users/me/clubs/order numbers the clubs the caller joined.
  // Real Postgres for what a mock cannot judge: UPDATE … FROM unnest WITH
  // ORDINALITY into a SMALLINT, the owner exclusion, the per-row counter.
  describe('profile clubs: the bubbles and their order (PR3, 16.11.2026)', () => {
    let me, other;
    const K = {};   // clubs by case
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1995-02-02','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    const mkClub = async (name, owner, { clubType = 'community', approval = 'approved', active = true } = {}) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, approval_status, club_type, is_active)
       VALUES ($1,'club',$2,'Sport','Wien',100,$3,$4,$5) RETURNING id`, [name, owner, approval, clubType, active])).rows[0].id;
    const member = (club, user, role, daysAgo) => db.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES ($1,$2,$3, NOW() - make_interval(days => $4::int))`, [club, user, role, daysAgo]);
    const list = async () => {
      const res = await call(C.getUserClubs, { userId: me });
      ok(res);
      return res.body;
    };
    const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

    it('seed: two own clubs, three joined (one co-managed, one official), one rejected own, one foreign', async () => {
      me = await mkU('smoke-bubbles-me@x.com', 'Mia');
      other = await mkU('smoke-bubbles-other@x.com', 'Olli');
      const asker = await mkU('smoke-bubbles-asker@x.com', 'Ari');
      K.own = await mkClub('Bubble Meine Community', me);
      await member(K.own, me, 'owner', 30);
      K.ownOfficial = await mkClub('Bubble Mein Club', me, { clubType: 'official' });
      await member(K.ownOfficial, me, 'owner', 20);
      for (const [key, name, clubType, role, days] of [
        ['a', 'Bubble Laufrunde', 'community', 'member', 10],
        ['b', 'Bubble Café', 'official', 'member', 5],
        ['c', 'Bubble Schach', 'community', 'admin', 2],
      ]) {
        K[key] = await mkClub(name, other, { clubType });
        await member(K[key], other, 'owner', 60);
        await member(K[key], me, role, days);
      }
      K.foreign = await mkClub('Bubble Fremd', other);
      await member(K.foreign, other, 'owner', 60);
      K.rejected = await mkClub('Bubble Abgelehnt', me, { clubType: 'official', approval: 'rejected', active: false });
      await member(K.rejected, me, 'owner', 1);
      // A request to my own club counts; one to a club I only co-manage does not.
      await db.query(`INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1,$3,'pending'),($2,$3,'pending')`,
        [K.own, K.c, asker]);
    });

    it('the read carries what the bubbles need, newest first as Home always had it', async () => {
      const rows = await list();
      expect(rows.map((r) => r.id)).toEqual([K.rejected, K.c, K.b, K.a, K.ownOfficial, K.own]);
      const r = byId(rows);
      expect(r[K.own]).toMatchObject({ is_own: true, role: 'owner', club_type: 'community', profile_position: null, pending_request_count: 1 });
      expect(r[K.ownOfficial]).toMatchObject({ is_own: true, club_type: 'official', pending_request_count: 0 });
      expect(r[K.c]).toMatchObject({ is_own: false, role: 'admin', pending_request_count: 0 });
      expect(r[K.b]).toMatchObject({ is_own: false, role: 'member', club_type: 'official' });
      // still delivered — the profile filters rejected and closed clubs itself
      expect(r[K.rejected]).toMatchObject({ approval_status: 'rejected', is_active: false });
      expect(r[K.a].joined_at).toBeInstanceOf(Date);
    });

    it('sorting numbers the joined clubs in the order sent; own and foreign ids change nothing', async () => {
      const res = await call(C.setMyClubOrder, { userId: me, body: { clubIds: [K.c, K.own, K.a, K.foreign, K.b] } });
      ok(res);
      const r = byId(res.body);
      expect([r[K.c].profile_position, r[K.a].profile_position, r[K.b].profile_position]).toEqual([1, 3, 5]);
      expect([r[K.own].profile_position, r[K.ownOfficial].profile_position]).toEqual([null, null]);
      expect(byId(await list())[K.a].profile_position).toBe(3);                    // GET reads the same back
      const others = await db.query(
        'SELECT profile_position FROM group_members WHERE group_id = $1 AND user_id = $2', [K.a, other]);
      expect(others.rows[0].profile_position).toBeNull();                          // nobody else's order moves
      const foreignRow = await db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [K.foreign, me]);
      expect(foreignRow.rowCount).toBe(0);                                         // and no membership appears
    });

    it('a new order replaces the old one completely, [] forgets it, a bad list is a 400', async () => {
      ok(await call(C.setMyClubOrder, { userId: me, body: { clubIds: [String(K.b)] } }));
      let r = byId(await list());
      expect([r[K.b].profile_position, r[K.a].profile_position, r[K.c].profile_position]).toEqual([1, null, null]);
      ok(await call(C.setMyClubOrder, { userId: me, body: { clubIds: [] } }));
      r = byId(await list());
      expect(Object.values(r).map((x) => x.profile_position).every((p) => p === null)).toBe(true);
      const bad = await call(C.setMyClubOrder, { userId: me, body: { clubIds: [K.a, K.a] } });
      expect(bad.statusCode).toBe(400);
    });
  });

  // ── „Demnächst dabei“ (Tina 16.11.2026, PR4) ────────────────────────────
  // GET /api/groups/user/upcoming against the edge cases of the briefing.
  // The endpoint has no injectable clock, so every date is anchored to the
  // real Vienna day and sits clearly inside or outside it.
  describe('„Demnächst dabei“: the own coming meetups and club events (PR4, 16.11.2026)', () => {
    const today = `date_trunc('day', NOW() AT TIME ZONE 'Europe/Vienna')`;
    let me, host, peer;
    const E = {};   // entities by case
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1994-06-06','female',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    const mk = async ({ name, owner, type = 'group', at = null, recurring = false, active = true, parent = null,
      clubType = null, approval = 'approved', notHeld = false }) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, is_recurring_weekly,
                           is_active, parent_club_id, club_type, approval_status, did_not_take_place)
       VALUES ($1,$2,$3,'Sport','Wien',20, ${at ? `${today} + INTERVAL '${at}'` : 'NULL'}, $4,$5,$6,$7,$8,$9) RETURNING id`,
      [name, type, owner, recurring, active, parent, clubType, approval, notHeld])).rows[0].id;
    const add = (gid, uid, role = 'member') => db.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3)`, [gid, uid, role]);
    // An entity of `owner` with `me` let in.
    const theirs = async (spec) => {
      const id = await mk({ owner: host, ...spec });
      await add(id, spec.owner ?? host, 'owner');
      if ((spec.owner ?? host) !== me) await add(id, me);
      return id;
    };
    const upcoming = async () => {
      const res = await call(C.getMyUpcomingEvents, { userId: me });
      ok(res);
      return res.body;
    };

    it('seed: one person and every case', async () => {
      me = await mkU('smoke-up-me@x.com', 'Uma');
      host = await mkU('smoke-up-host@x.com', 'Hugo');
      peer = await mkU('smoke-up-peer@x.com', 'Pia');
      const asker = await mkU('smoke-up-asker@x.com', 'Ari');
      // listed, in this order
      E.allDayToday = await theirs({ name: 'Up Heute ganztags', at: '0 minutes' });
      E.timedToday = await theirs({ name: 'Up Heute 00:01', at: '1 minute' });
      E.ownTomorrow = await theirs({ name: 'Up Mein Treffen', owner: me, at: '1 day' });
      // First occurrence 20 days ago at 19:00 → next: tomorrow 19:00, whatever the time of day.
      E.weekly = await theirs({ name: 'Up Wöchentlich', at: '-19 days -5 hours', recurring: true });
      const official = await theirs({ name: 'Up Partner-Club', type: 'club', clubType: 'official' });
      // a paying partner (Tobi 17.11.2026) — otherwise E.partner is no „☆ Partner“ once partnerSql asks for it
      await db.query('UPDATE groups SET is_paid_partner = TRUE WHERE id = $1', [official]);
      E.partner = await theirs({ name: 'Up Punsch Night', type: 'event', parent: official, at: '2 days 19 hours' });
      await add(official, peer);
      E.memberEvent = await mk({ name: 'Up Mitglieder-Abend', owner: peer, type: 'event', parent: official, at: '3 days 18 hours' });
      await add(E.memberEvent, peer, 'owner');
      await add(E.memberEvent, me);
      const community = await mk({ name: 'Up Community', owner: host, type: 'club', clubType: 'community' });
      await add(community, host, 'owner');
      await add(community, me, 'admin');                 // co-manager
      E.community = await theirs({ name: 'Up Community-Lauf', type: 'event', parent: community, at: '3 days 20 hours' });
      const pending = await mk({ name: 'Up Club in Prüfung', owner: me, type: 'club', clubType: 'official', approval: 'pending' });
      await add(pending, me, 'owner');
      E.inPending = await theirs({ name: 'Up Event im Prüf-Club', owner: me, type: 'event', parent: pending, at: '4 days 12 hours' });
      E.inFiveDays = await theirs({ name: 'Up In fünf Tagen', at: '5 days 19 hours' });
      E.undated = await theirs({ name: 'Up Ohne Datum' });
      // not listed
      E.yesterday = await theirs({ name: 'Up Gestern', at: '-4 hours' });
      E.cancelled = await theirs({ name: 'Up Abgesagt', at: '2 days', active: false });
      E.deleted = await theirs({ name: 'Up Gelöscht', at: '2 days' });
      await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [E.deleted]);
      E.notHeld = await theirs({ name: 'Up Nicht stattgefunden', at: '1 minute', notHeld: true });
      const dead = await mk({ name: 'Up Club weg', owner: host, type: 'club', clubType: 'community' });
      await add(dead, host, 'owner');
      E.deadEvent = await theirs({ name: 'Up Event ohne Club', type: 'event', parent: dead, at: '2 days' });
      await db.query('UPDATE groups SET deleted_at = NOW(), is_active = FALSE WHERE id = $1', [dead]);
      E.requested = await mk({ name: 'Up Nur angefragt', owner: host, at: '2 days' });
      await add(E.requested, host, 'owner');
      await db.query(`INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1,$2,'pending')`, [E.requested, me]);
      E.waitlisted = await mk({ name: 'Up Warteliste', owner: host, at: '2 days' });
      await add(E.waitlisted, host, 'owner');
      await db.query(`INSERT INTO group_waitlist (group_id, user_id, position) VALUES ($1,$2,1)`, [E.waitlisted, me]);
      E.official = official;
      // someone asks to join my own meetup
      await db.query(`INSERT INTO group_join_requests (group_id, user_id, status) VALUES ($1,$2,'pending')`, [E.ownTomorrow, asker]);
    });

    it('only what still happens, until the end of its Vienna day, next first, undated last', async () => {
      const ids = (await upcoming()).map((r) => r.id);
      expect(ids).toEqual([E.allDayToday, E.timedToday, E.ownTomorrow, E.weekly, E.partner, E.memberEvent,
        E.community, E.inPending, E.inFiveDays, E.undated]);
      for (const k of ['yesterday', 'cancelled', 'deleted', 'notHeld', 'deadEvent', 'requested', 'waitlisted', 'official']) {
        expect(ids, k).not.toContain(E[k]);
      }
    });

    it('a weekly series by its next occurrence', async () => {
      const row = (await upcoming()).find((r) => r.id === E.weekly);
      const want = (await db.query(`SELECT ${today} + INTERVAL '1 day 19 hours' AS t`)).rows[0].t;
      expect(row.is_recurring_weekly).toBe(true);
      expect(new Date(row.next_at).getTime()).toBe(want.getTime());
      expect(new Date(row.date).getTime()).toBeLessThan(want.getTime());
    });

    it('own, editable, partner and the subline kind — per row', async () => {
      const rows = Object.fromEntries((await upcoming()).map((r) => [r.id, r]));
      expect(rows[E.ownTomorrow]).toMatchObject({ is_own: true, can_edit: true, pending_request_count: 1, kind: 'group', is_partner: false });
      expect(rows[E.timedToday]).toMatchObject({ is_own: false, can_edit: false, pending_request_count: 0, kind: 'group' });
      expect(rows[E.partner]).toMatchObject({
        is_partner: true, kind: 'partner', can_edit: false, club_name: 'Up Partner-Club',
        members_count: 2, max_members: 20, parent_club_id: E.official,
      });
      // a regular member's event in an official club is not the club's own
      expect(rows[E.memberEvent]).toMatchObject({ is_partner: false, kind: 'community', can_edit: false });
      // co-manager of the club → may edit its events (updateClubEvent's rule)
      expect(rows[E.community]).toMatchObject({ is_own: false, can_edit: true, kind: 'community' });
      // a founder's pending club hides nothing from them
      expect(rows[E.inPending]).toMatchObject({ is_own: true, can_edit: true });
      expect(rows[E.undated].next_at).toBeNull();
    });
  });

  // ── Deals at events (P4 v1, Tina 16.11.2026) ────────────────────────────
  // An admin hangs a deal on an event (PUT /api/deals/event/:groupId — since
  // P4 v2 the handler itself tells admins from club managers, the route has
  // no requireAdmin any more); the event page and the club's event list embed
  // it while redeemDeal would still let you redeem it; the admin list names
  // the events. Deals are seeded directly: no geocoding, no city push.
  describe('deals at events (P4 v1, 16.11.2026)', () => {
    let host, guest, club, event, sibling, meetup;
    const DL = {};  // deals by case
    const photo = 'https://app.jamie-app.com/media/uploads/deal.webp';
    const mkU = async (email, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1992-02-02','male',$3, TRUE, 'email') RETURNING id`, [email, name, avatar])).rows[0].id;
    const mkDeal = async (name, { interval = 'once', max = 100, untilSql = 'NULL', active = true } = {}) => (await db.query(
      `INSERT INTO deals (name, deal_label, photos, redeem_interval, max_redemptions, visible_until, is_active)
       VALUES ($1, '2 für 1', $2::jsonb, $3, $4, ${untilSql}, $5) RETURNING id`,
      [name, JSON.stringify([photo]), interval, max, active])).rows[0].id;
    const mkGroup = async (name, type, parent = null) => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, club_type, approval_status)
         VALUES ($1,$2,$3,'Bar','Wien',50, ${type === 'club' ? 'NULL' : "NOW() + INTERVAL '3 days'"}, $4, $5, 'approved') RETURNING id`,
        [name, type, host, parent, type === 'club' ? 'official' : null])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')`, [id, host, guest]);
      return id;
    };
    // The route is just authenticate → setEventDeal (P4 v2).
    const attach = async (userId, groupId, dealId) => call(C.setEventDeal,
      { userId, params: { groupId: String(groupId) }, body: { deal_id: dealId } });
    const shown = async (id) => {
      const res = await call(C.getGroupById, { userId: guest, params: { id: String(id) } });
      ok(res);
      return res.body.deal;
    };
    const linkOf = async (id) => (await db.query('SELECT deal_id FROM event_deals WHERE group_id = $1', [id])).rows;

    it('seed: an official club with two events, a meetup, deals of every kind', async () => {
      host = await mkU('smoke-evdeal-host@x.com', 'Soleá');
      guest = await mkU('smoke-evdeal-guest@x.com', 'Gina');
      club = await mkGroup('Smoke Café Soleá', 'club');
      event = await mkGroup('Smoke Punsch Night', 'event', club);
      sibling = await mkGroup('Smoke Quiz', 'event', club);
      meetup = await mkGroup('Smoke Treffen', 'group');
      DL.once = await mkDeal('Smoke Soleá Deal');
      DL.weekly = await mkDeal('Smoke Wochen-Deal', { interval: 'weekly', max: 1 });
      DL.soldOut = await mkDeal('Smoke Ausverkauft', { max: 1 });
      DL.expired = await mkDeal('Smoke Abgelaufen', { untilSql: "NOW() - INTERVAL '1 day'" });
      DL.inactive = await mkDeal('Smoke Inaktiv', { active: false });
    });

    it('only an admin may hang a deal on an event (a club manager only the club\'s own, see P4 v2)', async () => {
      const denied = await attach(B, event, DL.once);
      expect(denied.statusCode).toBe(403);
      expect(await linkOf(event)).toEqual([]);
      const res = await attach(A, event, DL.once);
      ok(res);
      expect(res.body).toEqual({ group_id: event, deal_id: DL.once, deal: {
        id: DL.once, name: 'Smoke Soleá Deal', deal_label: '2 für 1', photo, verified: true } });
    });

    it('the event page and the club\'s event list embed it — nothing elsewhere', async () => {
      expect(await shown(event)).toEqual({ id: DL.once, name: 'Smoke Soleá Deal', deal_label: '2 für 1', photo, verified: true });
      expect(await shown(sibling)).toBeNull();
      expect(await shown(meetup)).toBeNull();
      const clubPage = await call(C.getGroupById, { userId: guest, params: { id: String(club) } });
      expect(clubPage.body).not.toHaveProperty('deal');
      const list = await call(C.getClubEvents, { userId: host, params: { id: String(club) }, query: {} });
      ok(list);
      const byId = Object.fromEntries(list.body.map((e) => [e.id, e.deal]));
      expect(byId[event]).toMatchObject({ id: DL.once, verified: true });
      expect(byId[sibling]).toBeNull();
    });

    it('the admin list names the events a deal hangs on', async () => {
      const res = await call(C.getDealsForAdmin, {});
      ok(res);
      const row = res.body.find((d) => d.id === DL.once);
      expect(row.events).toEqual([{ id: event, name: 'Smoke Punsch Night', date: expect.any(Date) }]);
      expect(res.body.find((d) => d.id === DL.weekly).events).toEqual([]);
    });

    it('one deal per event: another one replaces it', async () => {
      ok(await attach(A, event, DL.weekly));
      expect(await linkOf(event)).toEqual([{ deal_id: DL.weekly }]);
      expect((await shown(event)).id).toBe(DL.weekly);
    });

    it('a sold-out once-deal, an expired and an inactive one are never shown — a weekly one at its weekly cap still is', async () => {
      // the weekly deal (cap 1) redeemed once THIS week: redeemDeal never caps weekly deals
      await db.query(
        `INSERT INTO deal_redemptions (deal_id, user_id, period_key) VALUES ($1, $2, 'w:' || to_char(now(), 'IYYY-IW'))`,
        [DL.weekly, guest]);
      expect((await shown(event)).id).toBe(DL.weekly);
      // the once-deal with a cap of 1, redeemed once in its current round
      ok(await attach(A, meetup, DL.soldOut));
      expect((await shown(meetup)).id).toBe(DL.soldOut);
      await db.query(`INSERT INTO deal_redemptions (deal_id, user_id, period_key) VALUES ($1, $2, 'once')`, [DL.soldOut, guest]);
      expect(await shown(meetup)).toBeNull();
      const res = await attach(A, meetup, DL.soldOut);
      ok(res);
      expect(res.body.deal).toBeNull();                       // attached, but the dashboard learns it is not shown
      for (const id of [DL.expired, DL.inactive]) {
        ok(await attach(A, sibling, id));
        expect(await shown(sibling)).toBeNull();
      }
    });

    it('refuses a club, an unknown event or deal and a bad body; null takes it off', async () => {
      const onClub = await attach(A, club, DL.once);
      expect(onClub.statusCode).toBe(400);
      expect(onClub.body.code).toBe('NOT_AN_EVENT');
      expect((await attach(A, 2147483000, DL.once)).statusCode).toBe(404);
      expect((await attach(A, event, 2147483000)).statusCode).toBe(404);
      expect((await attach(A, event, 'abc')).statusCode).toBe(400);
      ok(await attach(A, sibling, null));
      expect(await linkOf(sibling)).toEqual([]);
      expect(await shown(sibling)).toBeNull();
    });

    it('deleting the event removes the link: a soft delete everywhere it showed, a hard delete in the table', async () => {
      ok(await call(C.deleteClubEvent, { userId: host, params: { id: String(club), eventId: String(event) } }));
      const page = await call(C.getGroupById, { userId: guest, params: { id: String(event) } });
      expect(page.statusCode).toBe(404);
      const list = await call(C.getClubEvents, { userId: host, params: { id: String(club) }, query: {} });
      expect(list.body.map((e) => e.id)).not.toContain(event);
      const admin = await call(C.getDealsForAdmin, {});
      expect(admin.body.find((d) => d.id === DL.weekly).events).toEqual([]);
      // a real DELETE (e.g. an account deletion cascading a solo club) takes the row along
      expect(await linkOf(meetup)).toEqual([{ deal_id: DL.soldOut }]);
      await db.query('DELETE FROM groups WHERE id = $1', [meetup]);
      expect(await linkOf(meetup)).toEqual([]);
    });
  });

  // ── Clubs put up their own deals (P4 v2, Tina/Tobi 16.11.2026) ──────────
  // The owner or a co-manager of a live OFFICIAL club puts up the club's own
  // deals; a club deal never sends the city push and shows exactly like a
  // JAMIE deal at its event and on its own page while its club is live and
  // official. The same people hang their own deals on their own events;
  // JAMIE's choice stays. Account deletion: created_by goes NULL, a club
  // passed on keeps its deals, a solo club takes them along (the reviewed_by
  // lesson).
  //
  // The model of 17.11.2026 (Tina's new document, decided by Tobi) replaced
  // the Pro gate: the library is a paying partner's (or an app admin's), a
  // deal goes on one of the club's first two free events without it — else
  // 403 PARTNER_REQUIRED / 'deal'. JAMIE Pro buys none of it. A club deal
  // never enters the feed, and its ✓ is for paying partners only.
  describe('club deals (P4 v2, 16.11.2026)', () => {
    let owner, proMgr, adminMgr, member, early, other, solo;
    let club, community, otherClub, soloClub, event, event2, otherEvent, meetup, soloEvent;
    const D = {};  // deal ids by case
    const photo = 'https://app.jamie-app.com/media/uploads/club-deal.webp';
    const ADDRESS = 'Gumpendorfer Straße 1, 1060 Wien';
    const until = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const mkU = async (email, name, { admin = false, pro = false } = {}) => {
      const id = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider, is_admin)
         VALUES ($1,$2,'1991-01-01','female',$3, TRUE, 'email', $4) RETURNING id`, [email, name, avatar, admin])).rows[0].id;
      if (pro) {
        await db.query(
          `INSERT INTO subscriptions (user_id, status, current_period_end) VALUES ($1, 'active', NOW() + INTERVAL '30 days')`, [id]);
      }
      return id;
    };
    // [userId, role, joined N days ago] — the owner joined 30 days ago.
    const mkClub = async (name, ownerId, clubType, members = []) => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, lat, lng, max_members, club_type, approval_status)
         VALUES ($1,'club',$2,'Bar',$3, 48.19, 16.35, 50, $4, 'approved') RETURNING id`,
        [name, ownerId, ADDRESS, clubType])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1,$2,'owner', NOW() - INTERVAL '30 days')`, [id, ownerId]);
      for (const [uid, role, days] of members) {
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1,$2,$3, NOW() - make_interval(days => $4))`,
          [id, uid, role, days]);
      }
      return id;
    };
    const mkEvent = async (name, parent, ownerId) => (await db.query(
      `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id)
       VALUES ($1, $2, $3, 'Bar', 'Wien', 50, NOW() + INTERVAL '3 days', $4) RETURNING id`,
      [name, parent ? 'event' : 'group', ownerId, parent])).rows[0].id;
    const list = (u, c) => call(C.getClubDeals, { userId: u, params: { clubId: String(c) } });
    const create = (u, c, body) => call(C.createClubDeal, { userId: u, params: { clubId: String(c) }, body });
    const edit = (u, c, d, body) => call(C.updateClubDeal, { userId: u, params: { clubId: String(c), dealId: String(d) }, body });
    const remove = (u, c, d) => call(C.deleteClubDeal, { userId: u, params: { clubId: String(c), dealId: String(d) } });
    const attach = (u, g, d) => call(C.setEventDeal, { userId: u, params: { groupId: String(g) }, body: { deal_id: d } });
    const body = (o = {}) => ({ name: 'Smoke Bar Neun', deal_label: '2 für 1', visible_until: until(30), photos: [photo], ...o });
    const feedIds = async () => {
      const res = await call(C.getDeals, { userId: member });
      ok(res);
      return res.body.map((d) => d.id);
    };
    const page = (id) => call(C.getDeal, { userId: member, params: { id: String(id) } });
    const shownAt = async (g) => {
      const res = await call(C.getGroupById, { userId: member, params: { id: String(g) } });
      ok(res);
      return res.body.deal;
    };
    const clubDealCount = async (c) => (await db.query('SELECT COUNT(*)::int AS n FROM deals WHERE club_id = $1', [c])).rows[0].n;
    // „Zahlender Partner“ on or off, the way an admin sets it.
    const pay = async (c, on = true) => ok(await call(C.classifyClub, {
      userId: A, params: { id: String(c) }, body: { is_paid_partner: on } }));
    const partnerOnly = (res) => {
      expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'PARTNER_REQUIRED', reason: 'deal' });
      expect(res.body.error).toBe('Deals gibt es für die ersten 2 Events eures Clubs – danach als JAMIE Partner.');
    };

    it('seed: an official club with an owner, managers (Pro / app admin), members; a community; two more clubs', async () => {
      owner = await mkU('smoke-cd-owner@x.com', 'Olli');
      proMgr = await mkU('smoke-cd-pro@x.com', 'Pia', { pro: true });
      adminMgr = await mkU('smoke-cd-admin@x.com', 'Adi', { admin: true });
      member = await mkU('smoke-cd-member@x.com', 'Mo', { pro: true });
      early = await mkU('smoke-cd-early@x.com', 'Eli');
      other = await mkU('smoke-cd-other@x.com', 'Otto', { pro: true });
      solo = await mkU('smoke-cd-solo@x.com', 'Sol', { pro: true });
      club = await mkClub('Smoke Bar Neun', owner, 'official',
        [[early, 'member', 60], [proMgr, 'admin', 20], [adminMgr, 'admin', 10], [member, 'member', 5]]);
      community = await mkClub('Smoke Laufrunde', other, 'community');
      otherClub = await mkClub('Smoke Café Zwei', other, 'official');
      soloClub = await mkClub('Smoke Solo Bar', solo, 'official');
      event = await mkEvent('Smoke Neun Night', club, owner);
      event2 = await mkEvent('Smoke Neun Quiz', club, proMgr);
      otherEvent = await mkEvent('Smoke Zwei Abend', otherClub, other);
      meetup = await mkEvent('Smoke Treffen Neun', null, proMgr);
      soloEvent = await mkEvent('Smoke Solo Abend', soloClub, solo);
    });

    it('the library without the partnership: 403 PARTNER_REQUIRED, nothing written — Pro does not buy it, the list stays readable', async () => {
      const res = await create(owner, club, body());
      partnerOnly(res);
      expect(res.body.club_name).toBe('Smoke Bar Neun');
      partnerOnly(await create(proMgr, club, body()));          // a co-manager WITH JAMIE Pro
      expect(await clubDealCount(club)).toBe(0);
      const l = await list(owner, club);
      ok(l);
      expect(l.body).toEqual([]);
    });

    it('a paying partner\'s co-manager puts one up: club_id + created_by, the club\'s address and pin — and no city push', async () => {
      await pay(club);
      const spy = vi.spyOn(db, 'query');
      const lookedForRecipients = () => spy.mock.calls.some(([sql]) => String(sql).includes('JOIN push_subscriptions'));
      try {
        const res = await create(proMgr, club, body({ description: 'Sag „Jamie“ an der Bar.' }));
        expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
        D.main = res.body.id;
        await new Promise((r) => setTimeout(r, 50));
        expect(lookedForRecipients()).toBe(false);
        // the control: JAMIE's own deal does look for its city's opted-in people
        const jamie = await call(C.createDeal, { userId: A, body: {
          name: 'Smoke JAMIE Deal', deal_label: 'Gratis Shot', address: ADDRESS, visible_until: '2099-12-31' } });
        expect(jamie.statusCode).toBe(201);
        D.jamie = jamie.body.id;
        expect(lookedForRecipients()).toBe(true);
      } finally {
        spy.mockRestore();
      }
      const row = (await db.query(
        'SELECT club_id, created_by, address, lat, lng, photos, is_active, category FROM deals WHERE id = $1', [D.main])).rows[0];
      expect(row).toEqual({ club_id: club, created_by: proMgr, address: ADDRESS, lat: 48.19, lng: 16.35,
        photos: [photo], is_active: true, category: 'Lokal' });
      // „Sichtbar bis“ is that whole day in Vienna (review 16.11.2026): its
      // last second there, kept as UTC wall clock like every timestamp.
      expect((await db.query(
        `SELECT visible_until = ((($2::date + 1)::timestamp AT TIME ZONE 'Europe/Vienna') - INTERVAL '1 second')
                                AT TIME ZONE 'UTC' AS ok
           FROM deals WHERE id = $1`, [D.main, until(30)])).rows[0].ok).toBe(true);
    });

    it('an app admin who manages the club needs no partnership; a non-manager 403 in a paying club too; a community 403', async () => {
      await pay(club, false);
      const adm = await create(adminMgr, club, body({ name: 'Smoke Admin-Deal' }));
      expect(adm.statusCode, JSON.stringify(adm.body)).toBe(201);
      D.byAdmin = adm.body.id;
      partnerOnly(await create(owner, club, body()));           // …the owner next to them still does
      await pay(club);
      const outsider = await create(member, club, body());
      expect(outsider.statusCode).toBe(403);
      expect(outsider.body.code).toBe('NOT_CLUB_MANAGER');
      expect((await list(member, club)).statusCode).toBe(403);
      // An app admin who does NOT manage the club is no manager of it.
      expect((await create(A, club, body())).body.code).toBe('NOT_CLUB_MANAGER');
      const comm = await create(other, community, body());
      expect(comm.statusCode).toBe(403);
      expect(comm.body.code).toBe('OFFICIAL_CLUB_REQUIRED');
      expect(await clubDealCount(community)).toBe(0);
    });

    it('the end date is required and at most 180 days ahead; texts are moderated; photos only from our storage', async () => {
      for (const visible_until of [undefined, until(-1), until(200)]) {
        expect((await create(proMgr, club, body({ visible_until }))).statusCode, String(visible_until)).toBe(400);
      }
      expect((await create(proMgr, club, body({ deal_label: 'Hurensohn' }))).statusCode).toBe(422);
      expect((await create(proMgr, club, body({ photos: ['https://evil.example/x.jpg'] }))).statusCode).toBe(400);
      expect(await clubDealCount(club)).toBe(2);
    });

    it('it shows like a JAMIE deal at the club\'s event and on its own page — never in the feed — while its club is live and official; the ✓ only for a paying partner', async () => {
      // Tina 17.11.2026: „Der Deal wird in den Gruppen nicht angezeigt.“
      expect(await feedIds()).not.toContain(D.main);
      expect(await feedIds()).not.toContain(D.byAdmin);
      ok(await page(D.main));
      ok(await attach(proMgr, event, D.main));
      const shown = { id: D.main, name: 'Smoke Bar Neun', deal_label: '2 für 1', photo };
      expect(await shownAt(event)).toEqual({ ...shown, verified: true });
      // the same deal of a club that does not pay: the same row, without the ✓
      await pay(club, false);
      expect(await shownAt(event)).toEqual({ ...shown, verified: false });
      ok(await page(D.main));
      await pay(club);
      // reclassified as a community: dark everywhere
      await db.query(`UPDATE groups SET club_type = 'community' WHERE id = $1`, [club]);
      expect(await feedIds()).not.toContain(D.main);
      expect((await page(D.main)).statusCode).toBe(404);
      expect(await shownAt(event)).toBeNull();
      // …and not redeemable, not even from a page opened before
      expect((await call(C.redeemDeal, { userId: member, params: { id: String(D.main) } })).statusCode).toBe(404);
      // closed: the same
      await db.query(`UPDATE groups SET club_type = 'official', is_active = FALSE WHERE id = $1`, [club]);
      expect((await page(D.main)).statusCode).toBe(404);
      expect(await shownAt(event)).toBeNull();
      await db.query(`UPDATE groups SET is_active = TRUE WHERE id = $1`, [club]);
      ok(await page(D.main));
      expect(await shownAt(event)).toEqual({ ...shown, verified: true });
      // JAMIE's own deal never minded any of it — and it is what the feed shows
      expect(await feedIds()).toContain(D.jamie);
    });

    it('editing needs the partnership, deleting does not; the list has counts and events; the admin list names the club', async () => {
      await pay(club, false);
      partnerOnly(await edit(proMgr, club, D.main, { deal_label: '3 für 2' }));     // Pro or not
      expect((await db.query('SELECT deal_label FROM deals WHERE id = $1', [D.main])).rows[0].deal_label).toBe('2 für 1');
      await pay(club);
      const e = await edit(proMgr, club, D.main, { deal_label: '3 für 2', visible_until: until(90) });
      ok(e);
      expect(e.body.deal_label).toBe('3 für 2');
      expect((await edit(proMgr, club, D.main, { visible_until: null })).statusCode).toBe(400);
      await pay(otherClub);
      const foreign = await create(other, otherClub, body({ name: 'Smoke Café Zwei Deal' }));
      expect(foreign.statusCode).toBe(201);
      D.foreign = foreign.body.id;
      expect((await edit(proMgr, club, D.foreign, { deal_label: 'x' })).statusCode).toBe(404);
      expect((await remove(proMgr, club, D.foreign)).statusCode).toBe(404);
      const l = await list(proMgr, club);
      ok(l);
      expect(l.body.find((d) => d.id === D.main)).toMatchObject({
        deal_label: '3 für 2', redemption_count: 0, round_redemption_count: 0, events: [{ id: event, name: 'Smoke Neun Night' }] });
      const adminList = await call(C.getDealsForAdmin, {});
      ok(adminList);
      const byId = Object.fromEntries(adminList.body.map((d) => [d.id, d.club]));
      expect(byId[D.foreign]).toEqual({ id: otherClub, name: 'Smoke Café Zwei' });
      expect(byId[D.jamie]).toBeNull();
      // deleting: free, soft — off the list and out of the feed, the row stays
      ok(await remove(owner, club, D.byAdmin));
      expect((await list(owner, club)).body.map((d) => d.id)).not.toContain(D.byAdmin);
      expect(await feedIds()).not.toContain(D.byAdmin);
      expect((await db.query('SELECT is_active FROM deals WHERE id = $1', [D.byAdmin])).rows[0].is_active).toBe(false);
      expect((await remove(owner, club, D.byAdmin)).statusCode).toBe(404);
    });

    it('at events: only the club\'s own events and live deals; free on the club\'s first two events, after that the partnership; none to take off; JAMIE\'s choice stays', async () => {
      expect((await attach(proMgr, event2, D.foreign)).body.code).toBe('NOT_OWN_DEAL');
      expect((await attach(proMgr, event2, D.jamie)).body.code).toBe('NOT_OWN_DEAL');
      expect((await attach(proMgr, otherEvent, D.main)).body.code).toBe('NOT_CLUB_MANAGER');
      expect((await attach(proMgr, meetup, D.main)).body.code).toBe('NOT_CLUB_MANAGER');
      expect((await attach(proMgr, event2, D.byAdmin)).statusCode).toBe(404);     // deleted
      // Tina 17.11.2026: „Deals anlegen, für die ersten 2 Events. Danach wäre
      // das Event sowieso nur mit Paid, dann gehen die Deals auch wieder.“
      const event3 = await mkEvent('Smoke Neun Drittes', club, owner);
      await pay(club, false);
      ok(await attach(owner, event2, D.main));                 // the club's second event: free, no Pro
      expect((await shownAt(event2)).id).toBe(D.main);
      partnerOnly(await attach(owner, event3, D.main));        // the third: only as a partner…
      partnerOnly(await attach(proMgr, event3, D.main));       // …Pro does not buy it
      expect(await shownAt(event3)).toBeNull();
      ok(await attach(owner, event2, null));                   // taking off: always free
      await pay(club);
      ok(await attach(owner, event3, D.main));                 // a paying partner: any event
      ok(await attach(owner, event3, null));
      ok(await attach(owner, event, null));
      expect(await shownAt(event)).toBeNull();
      // what JAMIE hung on the club's event stays where it is
      ok(await attach(A, event2, D.jamie));
      const replace = await attach(proMgr, event2, D.main);
      expect(replace.statusCode).toBe(409);
      expect(replace.body.code).toBe('DEAL_SET_BY_JAMIE');
      expect((await attach(owner, event2, null)).statusCode).toBe(409);
      expect((await shownAt(event2)).id).toBe(D.jamie);
      // an admin may still hang a club's deal anywhere
      ok(await attach(A, meetup, D.main));
      expect((await shownAt(meetup)).id).toBe(D.main);
    });

    // Review 16.11.2026: the club's check that JAMIE's deal stays was a SELECT
    // of its own — a deal JAMIE hung on the event between that check and the
    // write was replaced or taken off. The writes carry the condition
    // themselves now. JAMIE's attach is slipped in right after the check.
    it('JAMIE hangs a deal on between the club\'s check and its write: neither replaced nor taken off (409, the row unchanged); the club\'s own is', async () => {
      const second = await create(proMgr, club, body({ name: 'Smoke Bar Neun Zwei', deal_label: 'Happy Hour' }));
      expect(second.statusCode, JSON.stringify(second.body)).toBe(201);
      D.second = second.body.id;
      const linkRow = async (g) => (await db.query(
        'SELECT deal_id, attached_by, created_at FROM event_deals WHERE group_id = $1', [g])).rows[0] ?? null;

      // the club's own deal: hung on, replaced, taken off; taking off nothing is fine
      ok(await attach(proMgr, event, D.main));
      ok(await attach(proMgr, event, D.second));
      expect(await linkRow(event)).toMatchObject({ deal_id: D.second, attached_by: proMgr });
      ok(await attach(owner, event, null));
      expect(await linkRow(event)).toBeNull();
      ok(await attach(owner, event, null));

      // JAMIE's attach lands right after the club's check (the SELECT on event_deals)
      let atCheck;
      const jamieRightAfterCheck = () => vi.spyOn(db, 'query').mockImplementation(async (text, params) => {
        const result = await db.pool.query(text, params);
        if (!atCheck && String(text).startsWith('SELECT d.club_id FROM event_deals')) {
          await db.pool.query(
            `INSERT INTO event_deals (group_id, deal_id, attached_by) VALUES ($1, $2, $3)
             ON CONFLICT (group_id) DO UPDATE
               SET deal_id = EXCLUDED.deal_id, attached_by = EXCLUDED.attached_by, created_at = NOW()`,
            [event, D.jamie, A]);
          atCheck = (await db.pool.query(
            'SELECT deal_id, attached_by, created_at FROM event_deals WHERE group_id = $1', [event])).rows[0];
        }
        return result;
      });
      const raced = async (fn) => {
        atCheck = null;
        const spy = jamieRightAfterCheck();
        try { return await fn(); } finally { spy.mockRestore(); }
      };

      // hanging the club's deal on: the check saw an empty slot, the write finds JAMIE's
      const on = await raced(() => attach(proMgr, event, D.main));
      expect(on.statusCode, JSON.stringify(on.body)).toBe(409);
      expect(on.body.code).toBe('DEAL_SET_BY_JAMIE');
      expect(atCheck).toMatchObject({ deal_id: D.jamie, attached_by: A });
      expect(await linkRow(event)).toEqual(atCheck);

      // taking it off: the check saw the club's own deal, the write finds JAMIE's
      ok(await attach(A, event, null));
      ok(await attach(proMgr, event, D.main));
      const off = await raced(() => attach(owner, event, null));
      expect(off.statusCode, JSON.stringify(off.body)).toBe(409);
      expect(off.body.code).toBe('DEAL_SET_BY_JAMIE');
      expect(atCheck).toMatchObject({ deal_id: D.jamie, attached_by: A });
      expect(await linkRow(event)).toEqual(atCheck);

      // without a race the check answers the same — the row stays as it is
      expect((await attach(proMgr, event, D.second)).body.code).toBe('DEAL_SET_BY_JAMIE');
      expect((await attach(owner, event, null)).body.code).toBe('DEAL_SET_BY_JAMIE');
      expect(await linkRow(event)).toEqual(atCheck);
      expect((await shownAt(event)).id).toBe(D.jamie);

      // as it was for the tests below: nothing on the event, one deal of the club
      ok(await attach(A, event, null));
      ok(await remove(proMgr, club, D.second));
    });

    // Review 16.11.2026: at most 3 of a club's library deals are live at a
    // time. The count runs under a lock on the club's row, so a script's
    // parallel requests cannot all pass it before any has written.
    it('at most 3 live deals per club — also against five at once; one run out makes room, an edit cannot bring it back past the limit', async () => {
      const bar = await mkClub('Smoke Limit Bar', other, 'official');
      await pay(bar);
      const made = await Promise.all([1, 2, 3, 4, 5].map((n) => create(other, bar, body({ name: `Smoke Limit ${n}` }))));
      expect(made.map((r) => r.statusCode).sort()).toEqual([201, 201, 201, 409, 409]);
      expect(made.find((r) => r.statusCode === 409).body.code).toBe('CLUB_DEAL_LIMIT');
      expect(await clubDealCount(bar)).toBe(3);
      const ids = made.filter((r) => r.statusCode === 201).map((r) => r.body.id);
      await db.query(`UPDATE deals SET visible_until = NOW() - INTERVAL '1 hour' WHERE id = $1`, [ids[0]]);
      ok(await create(other, bar, body({ name: 'Smoke Limit 6' })));
      const back = await edit(other, bar, ids[0], { visible_until: until(10) });
      expect(back.statusCode).toBe(409);
      expect(back.body.code).toBe('CLUB_DEAL_LIMIT');
      ok(await edit(other, bar, ids[1], { deal_label: '3 für 2', visible_until: until(10) }));
      ok(await remove(other, bar, ids[2]));
      ok(await edit(other, bar, ids[0], { visible_until: until(10) }));
    });

    it('account deletion: created_by goes NULL, a club passed on keeps its deals and its partnership, a solo club takes them along', async () => {
      await pay(soloClub);
      const soloDeal = await create(solo, soloClub, body({ name: 'Smoke Solo Deal' }));
      expect(soloDeal.statusCode).toBe(201);
      D.solo = soloDeal.body.id;
      ok(await attach(solo, soloEvent, D.solo));
      ok(await call(C.redeemDeal, { userId: member, params: { id: String(D.solo) } }));
      // 1) the co-manager who put the deal up deletes the account: the deal stays the club's
      ok(await call(C.deleteAccount, { userId: proMgr, body: {} }));
      expect((await db.query('SELECT club_id, created_by, is_active FROM deals WHERE id = $1', [D.main])).rows[0])
        .toEqual({ club_id: club, created_by: null, is_active: true });
      ok(await page(D.main));
      // 2) the owner: the club passes to its earliest member, the deals with it
      ok(await call(C.deleteAccount, { userId: owner, body: {} }));
      expect((await db.query('SELECT owner_id FROM groups WHERE id = $1', [club])).rows[0].owner_id).toBe(early);
      expect((await list(early, club)).body.map((d) => d.id)).toContain(D.main);
      // the partnership is the club's, not a person's: the new owner (no Pro) edits on…
      ok(await edit(early, club, D.main, { deal_label: 'neu' }));
      // …and without it only takes down
      await pay(club, false);
      partnerOnly(await edit(early, club, D.main, { deal_label: 'noch neuer' }));
      ok(await remove(early, club, D.main));
      // 3) the solo owner: the club is deleted and takes its deal, the redemption and the event link along
      ok(await call(C.deleteAccount, { userId: solo, body: {} }));
      expect((await db.query('SELECT 1 FROM groups WHERE id = $1', [soloClub])).rows).toEqual([]);
      expect((await db.query('SELECT 1 FROM deals WHERE id = $1', [D.solo])).rows).toEqual([]);
      expect((await db.query('SELECT 1 FROM deal_redemptions WHERE deal_id = $1', [D.solo])).rows).toEqual([]);
      expect((await db.query('SELECT 1 FROM event_deals WHERE deal_id = $1', [D.solo])).rows).toEqual([]);
    });
  });

  // ── Tina-Update 17.11.2026: two build sessions work in parallel ─────────
  // New describe blocks go ONLY inside the session's own block, so the
  // branches merge without conflicts. An existing describe is changed only by
  // the session whose topic it is. Everything below these blocks must stay
  // last: it drops a column and rewrites deal dates.
  // (Scaffolding — the coordinator removes these markers after the merge.)
  //
  // >>> BAU1-SMOKE (Partner, Clubs & Deals)
  // ── Bau 1: the tables behind the partner model (Tina 17.11.2026) ────────
  // partner_leads („JAMIE Anfrage“), club_event_auto_messages („Automatisierte
  // Nachrichten“) and the day the free tier starts counting. Only migrations
  // create them, so this is the path production takes.
  describe('Bau 1: Schema (Tina 17.11.2026)', () => {
    const MARKER = '2026-11-17_club_free_tier_start';
    const failedSteps = async () => {
      const { getMigrationHealth } = await import('../../src/config/migrations.js');
      return getMigrationHealth().stepFailures
        .filter((f) => /free tier|partner_leads|club_event_auto_messages/.test(f.label));
    };
    const lead = (over = {}) => {
      const row = {
        club_id: null, user_id: null, source: 'third', name: 'Smoke Lead', contact: 'mail',
        privacy_accepted_at: '2026-11-17T10:00:00Z', ...over,
      };
      const cols = Object.keys(row);
      return db.query(
        `INSERT INTO partner_leads (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((k) => row[k]));
    };

    it('the boot created both tables without a failed step', async () => {
      expect(await failedSteps()).toEqual([]);
      const { rows } = await db.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name IN ('partner_leads', 'club_event_auto_messages')
          ORDER BY table_name`);
      expect(rows.map((r) => r.table_name)).toEqual(['club_event_auto_messages', 'partner_leads']);
    });

    it('a request only takes the four sources and the two ways of contact', async () => {
      await expect(lead({ source: 'foo' })).rejects.toMatchObject({ code: '23514' });
      await expect(lead({ contact: 'sms' })).rejects.toMatchObject({ code: '23514' });
      for (const source of ['concurrent', 'third', 'ticket', 'deal']) {
        for (const contact of ['mail', 'call']) {
          const { rows } = await lead({ source, contact });
          await db.query('DELETE FROM partner_leads WHERE id = $1', [rows[0].id]);
        }
      }
    });

    it('the day the free tier starts is set once — a second boot leaves it alone', async () => {
      const day = async () => (await db.query(
        `SELECT to_char(applied_at, 'YYYY-MM-DD HH24:MI:SS.US') AS at FROM one_shot_migrations WHERE name = $1`, [MARKER])).rows;
      const first = await day();
      expect(first).toHaveLength(1);
      const { runStartupMigrations } = await import('../../src/config/migrations.js');
      await runStartupMigrations();
      expect(await failedSteps()).toEqual([]);
      expect(await day()).toEqual(first);
    });

    it('an event that is really deleted takes its automated-messages row along', async () => {
      const ev = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members)
         VALUES ('Smoke Auto-Nachrichten', 'event', $1, 'Bar', 'Wien', 20) RETURNING id`, [A])).rows[0].id;
      await db.query('INSERT INTO club_event_auto_messages (group_id, enabled_by) VALUES ($1, $2)', [ev, A]);
      const row = (await db.query('SELECT * FROM club_event_auto_messages WHERE group_id = $1', [ev])).rows[0];
      expect(row).toMatchObject({
        enabled: true, enabled_by: A, welcome_sent_at: null, eve_sent_for: null, soon_sent_for: null, thanks_sent_for: null,
      });
      await db.query('DELETE FROM groups WHERE id = $1', [ev]);
      expect((await db.query('SELECT 1 FROM club_event_auto_messages WHERE group_id = $1', [ev])).rowCount).toBe(0);
    });

    it('deleting the account or the club keeps the request — only the link goes', async () => {
      const who = (await db.query(
        `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
         VALUES ('smoke-lead-user@x.com', 'Lea Lead', '1990-01-01', 'female', $1, TRUE, 'email') RETURNING id`, [avatar])).rows[0].id;
      const club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, club_type)
         VALUES ('Smoke Lead-Club', 'club', $1, 'Bar', 'Wien', 100, 'official') RETURNING id`, [A])).rows[0].id;
      const ev = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, parent_club_id)
         VALUES ('Smoke Lead-Event', 'event', $1, 'Bar', 'Wien', 20, $2) RETURNING id`, [A, club])).rows[0].id;
      await db.query('INSERT INTO club_event_auto_messages (group_id, enabled_by) VALUES ($1, $2)', [ev, who]);
      const id = (await lead({ club_id: club, user_id: who, company: 'Café Lead', email: 'lea@x.com', phone: '+43 1 234' })).rows[0].id;

      await db.query('DELETE FROM users WHERE id = $1', [who]);
      // who switched the messages on is gone, the switch is not
      expect((await db.query('SELECT enabled, enabled_by FROM club_event_auto_messages WHERE group_id = $1', [ev])).rows)
        .toEqual([{ enabled: true, enabled_by: null }]);
      // the club takes its event along (parent_club_id CASCADE), the request stays
      await db.query('DELETE FROM groups WHERE id = $1', [club]);
      const { rows } = await db.query('SELECT club_id, user_id, name, company, email, phone FROM partner_leads WHERE id = $1', [id]);
      expect(rows).toEqual([{ club_id: null, user_id: null, name: 'Smoke Lead', company: 'Café Lead', email: 'lea@x.com', phone: '+43 1 234' }]);
      await db.query('DELETE FROM partner_leads WHERE id = $1', [id]);
      await db.query('DELETE FROM groups WHERE id = $1', [ev]);
    });
  });

  // ── The free tier of clubs (Tina 17.11.2026, decided by Tobi) ───────────
  // utils/clubEventQuota.js: an official club that does not pay gets 2 events
  // for free, 1 at a time; ticket events only as a JAMIE partner. Paying
  // partners, the JAMIE team (app admins) and communities are never limited.
  // Dates are Vienna days relative to today (day(n)), never a time of day.
  describe('Gratis-Grenze für Clubs (Tina 17.11.2026)', () => {
    const MARKER = '2026-11-17_club_free_tier_start';
    let Q, geo;
    let owner, member, pro, plain;
    const mkU = async (tag, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1991-05-05','female',$3, TRUE, 'email') RETURNING id`, [`smoke-quota-${tag}@x.com`, name, avatar])).rows[0].id;
    // A live club of `host` with its owner row; `more` adds plain members,
    // who may put up events too (events_owner_only off — the column default
    // is on).
    const mkClub = async (name, { type = 'official', paid = false, host = owner, more = [], location = 'Wien' } = {}) => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status,
                             club_type, is_paid_partner, lat, lng, events_owner_only)
         VALUES ($1,'club',$2,'Bar',$3,500,FALSE,'approved',$4,$5,48.2,16.37,FALSE) RETURNING id`,
        [name, host, location, type, paid])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [id, host]);
      for (const u of more) await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [id, u]);
      return id;
    };
    // 'YYYY-MM-DD' of the Vienna day `n` days from today.
    const day = async (n) => (await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'Europe/Vienna')::date + $1::int, 'YYYY-MM-DD') AS d`, [n])).rows[0].d;
    const create = async (club, body = {}, userId = owner) => call(C.createClubEvent, {
      userId, params: { id: String(club) },
      body: { name: 'Quota Abend', date: await day(3), time: '19:00', ...body },
    });
    const moveTo = async (eventId, n) => db.query(
      `UPDATE groups SET date = ($2::date + TIME '19:00') WHERE id = $1`, [eventId, await day(n)]);
    const quota = (club, userId = owner) => Q.clubQuota(db, { clubId: club, userId });
    const refused = (res, reason, clubName) => {
      expect(res.statusCode, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'PARTNER_REQUIRED', reason, club_name: clubName });
      expect(res.body.error).toBe(Q.PARTNER_TEXTS[reason]); // the sentence an old bundle shows
    };

    beforeAll(async () => {
      Q = await import('../../src/utils/clubEventQuota.js');
      geo = await import('../../src/utils/geocode.js');
      owner = await mkU('owner', 'Olga');
      member = await mkU('member', 'Mia');
      pro = await mkU('pro', 'Pia');
      plain = await mkU('plain', 'Paul');
      await db.query(
        `INSERT INTO subscriptions (user_id, status, current_period_end) VALUES ($1, 'active', NOW() + INTERVAL '30 days')`, [pro]);
    });

    it('the first event is free, a second while it is still ahead is not — refused before moderation and geocoding', async () => {
      const club = await mkClub('Quota Café Eins');
      const first = await create(club, { name: 'Erster Abend' });
      expect(first.statusCode, JSON.stringify(first.body)).toBe(201);
      // the answer keeps its shape for old bundles: the event row
      expect(first.body).toMatchObject({ name: 'Erster Abend', type: 'event', parent_club_id: club, owner_id: owner });

      vi.mocked(geo.resolveClubEventLocation).mockClear();
      const second = await create(club, { name: 'Zweiter Abend', location: 'Praterstern 1, 1020 Wien' });
      refused(second, 'concurrent', 'Quota Café Eins');
      expect(geo.resolveClubEventLocation).not.toHaveBeenCalled();
      expect(await quota(club)).toMatchObject({ limited: true, used: 1, upcoming: 1, block: 'concurrent' });
      expect((await db.query(`SELECT COUNT(*)::int AS n FROM groups WHERE parent_club_id = $1`, [club])).rows[0].n).toBe(1);
    });

    it('once the first is over the second is free — the third is not, however long ago the second was', async () => {
      const club = await mkClub('Quota Café Zwei');
      const first = await create(club);
      ok(first);
      await moveTo(first.body.id, -2);
      expect(await quota(club)).toMatchObject({ used: 1, upcoming: 0, block: null });
      const second = await create(club);
      expect(second.statusCode, JSON.stringify(second.body)).toBe(201);
      refused(await create(club), 'third', 'Quota Café Zwei');
      await moveTo(second.body.id, -2);
      expect(await quota(club)).toMatchObject({ used: 2, upcoming: 0, block: 'third' });
      refused(await create(club), 'third', 'Quota Café Zwei');
    });

    it('today still counts as ahead: „sobald euer erstes vorbei ist“ is the day after', async () => {
      const club = await mkClub('Quota Café Heute');
      const first = await create(club);
      ok(first);
      await moveTo(first.body.id, 0);
      expect(await quota(club)).toMatchObject({ used: 1, upcoming: 1, block: 'concurrent' });
      await moveTo(first.body.id, -1);
      expect(await quota(club)).toMatchObject({ used: 1, upcoming: 0, block: null });
    });

    it('events from before the deploy do not count', async () => {
      const club = await mkClub('Quota Café Bestand');
      for (let i = 0; i < 3; i += 1) {
        await db.query(
          `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, created_at)
           VALUES ($1,'event',$2,'Bar','Wien',20, $3::date + TIME '19:00', $4,
                   (SELECT applied_at FROM one_shot_migrations WHERE name = $5) - INTERVAL '1 day')`,
          [`Bestand ${i}`, owner, await day(5 + i), club, MARKER]);
      }
      expect(await quota(club)).toMatchObject({ limited: true, used: 0, upcoming: 0, block: null });
      expect((await create(club)).statusCode).toBe(201);
    });

    it('an event taken down before it began gives its place back, one deleted after it ran does not', async () => {
      const club = await mkClub('Quota Café Absage');
      const first = await create(club);
      ok(first);
      refused(await create(club), 'concurrent', 'Quota Café Absage');
      ok(await call(C.deleteClubEvent, { userId: owner, params: { id: String(club), eventId: String(first.body.id) } }));
      expect(await quota(club)).toMatchObject({ used: 0, upcoming: 0, block: null });

      const second = await create(club);
      expect(second.statusCode, JSON.stringify(second.body)).toBe(201);
      await moveTo(second.body.id, -2);      // it ran…
      ok(await call(C.deleteClubEvent, { userId: owner, params: { id: String(club), eventId: String(second.body.id) } })); // …then was deleted
      expect(await quota(club)).toMatchObject({ used: 1, upcoming: 0, block: null });
      expect((await create(club)).statusCode).toBe(201);
      refused(await create(club), 'third', 'Quota Café Absage');
    });

    it('a paying partner is not limited and needs no Pro for a ticket link', async () => {
      const club = await mkClub('Quota Partner', { paid: true });
      for (let i = 0; i < 3; i += 1) expect((await create(club, { name: `Partner ${i}` })).statusCode).toBe(201);
      const ticket = await create(club, { name: 'Partner Ticket', ticket_url: 'shop.example.com/tickets' });
      expect(ticket.statusCode, JSON.stringify(ticket.body)).toBe(201);
      expect(ticket.body.ticket_url).toBe('https://shop.example.com/tickets');
      expect(await quota(club)).toMatchObject({ active: true, limited: false, block: null });
    });

    it('an app admin is free of it — but what they put up counts for the club', async () => {
      const club = await mkClub('Quota Team-Club', { more: [A] });
      for (let i = 0; i < 3; i += 1) expect((await create(club, { name: `Team ${i}` }, A)).statusCode).toBe(201);
      expect(await quota(club, A)).toMatchObject({ limited: false, block: null });
      expect(await quota(club)).toMatchObject({ limited: true, used: 3, upcoming: 3, block: 'third' });
      refused(await create(club), 'third', 'Quota Team-Club');
    });

    it('a community is never limited — and tickets there stay a Pro feature', async () => {
      const club = await mkClub('Quota Community', { type: 'community', host: plain, more: [pro] });
      for (let i = 0; i < 3; i += 1) expect((await create(club, { name: `Lauf ${i}` }, plain)).statusCode).toBe(201);
      expect(await quota(club, plain)).toMatchObject({ official: false, active: false, limited: false, used: 0, block: null });
      const noPro = await create(club, { ticket_url: 'https://shop.example.com/t' }, plain);
      expect(noPro.statusCode).toBe(403);
      expect(noPro.body.code).toBe('PRO_REQUIRED');
      expect((await create(club, { ticket_url: 'https://shop.example.com/t' }, pro)).statusCode).toBe(201);
    });

    it('a ticket event in a club that does not pay: only as a partner — Pro does not buy it, also when editing', async () => {
      const club = await mkClub('Quota Café Ticket', { host: pro });
      refused(await create(club, { ticket_url: 'https://shop.example.com/t' }, pro), 'ticket', 'Quota Café Ticket');
      expect((await db.query('SELECT COUNT(*)::int AS n FROM groups WHERE parent_club_id = $1', [club])).rows[0].n).toBe(0);

      const free = await create(club, {}, pro);
      ok(free);
      const edit = (body) => call(C.updateClubEvent, { userId: pro, params: { id: String(club), eventId: String(free.body.id) }, body });
      refused(await edit({ ticket_url: 'https://shop.example.com/t' }), 'ticket', 'Quota Café Ticket');
      expect((await db.query('SELECT ticket_url FROM groups WHERE id = $1', [free.body.id])).rows[0].ticket_url).toBeNull();
      // every other edit stays free of it
      ok(await edit({ name: 'Umbenannt' }));
      ok(await edit({ ticket_url: '' }));
      // …and as a paying partner the link goes on, without Pro
      await db.query('UPDATE groups SET is_paid_partner = TRUE, owner_id = $2 WHERE id = $1', [club, plain]);
      await db.query(`UPDATE group_members SET user_id = $2 WHERE group_id = $1 AND user_id = $3`, [club, plain, pro]);
      const asPartner = await call(C.updateClubEvent, {
        userId: plain, params: { id: String(club), eventId: String(free.body.id) }, body: { ticket_url: 'https://shop.example.com/t' } });
      ok(asPartner);
      expect(asPartner.body.ticket_url).toBe('https://shop.example.com/t');
    });

    it('a weekly series counts its dates: begun 15 days ago it has used 4, starting tomorrow 1', async () => {
      const old = await mkClub('Quota Café Serie');
      const series = await create(old, { name: 'Jeden Dienstag', date: await day(-15), is_recurring_weekly: true });
      expect(series.statusCode, JSON.stringify(series.body)).toBe(201);
      expect(await quota(old)).toMatchObject({ used: 4, upcoming: 1, block: 'third' });
      refused(await create(old), 'third', 'Quota Café Serie');

      const fresh = await mkClub('Quota Café Serie neu');
      ok(await create(fresh, { name: 'Ab morgen', date: await day(1), is_recurring_weekly: true }));
      expect(await quota(fresh)).toMatchObject({ used: 1, upcoming: 1, block: 'concurrent' });
      refused(await create(fresh), 'concurrent', 'Quota Café Serie neu');
    });

    it('the series arithmetic against a set clock, in Vienna days', async () => {
      const club = await mkClub('Quota Café Uhr');
      const id = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, is_recurring_weekly)
         VALUES ('Uhr-Serie','event',$1,'Bar','Wien',20,'2030-06-04 19:00',$2,TRUE) RETURNING id`, [owner, club])).rows[0].id;
      const at = async (iso) => {
        const { used, upcoming } = await Q.countClubEvents(db, club, new Date(iso));
        return [used, upcoming];
      };
      expect(await at('2030-06-01T12:00:00+02:00')).toEqual([1, 1]);   // before the first date
      expect(await at('2030-06-04T23:59:00+02:00')).toEqual([1, 1]);   // its day
      expect(await at('2030-06-05T00:01:00+02:00')).toEqual([2, 1]);   // the day after: one over, the next planned
      expect(await at('2030-06-04T22:30:00Z')).toEqual([2, 1]);        // the same instant, said in UTC
      expect(await at('2030-06-11T23:59:00+02:00')).toEqual([2, 1]);   // the second date's day
      expect(await at('2030-06-12T00:01:00+02:00')).toEqual([3, 1]);
      expect(await at('2030-06-19T08:00:00+02:00')).toEqual([4, 1]);

      // deleted on the second date's day: the dates begun by then, and it is no longer ahead
      await db.query(`UPDATE groups SET deleted_at = '2030-06-11 10:00', is_active = FALSE WHERE id = $1`, [id]);
      expect(await at('2030-07-01T08:00:00+02:00')).toEqual([2, 0]);
      // deleted before it ever began: it does not count at all
      await db.query(`UPDATE groups SET deleted_at = '2030-06-04 16:59' WHERE id = $1`, [id]); // 18:59 in Vienna
      expect(await at('2030-07-01T08:00:00+02:00')).toEqual([0, 0]);
      await db.query(`UPDATE groups SET deleted_at = '2030-06-04 17:00' WHERE id = $1`, [id]); // 19:00 in Vienna: begun
      expect(await at('2030-07-01T08:00:00+02:00')).toEqual([1, 0]);
    });

    it('the limit is the club’s: a plain member is refused like the owner', async () => {
      const club = await mkClub('Quota Café Mitglied', { more: [member] });
      ok(await create(club));
      refused(await create(club, {}, member), 'concurrent', 'Quota Café Mitglied');
      // …and a member's event uses a place of the club's, too
      const other = await mkClub('Quota Café Mitglied Zwei', { more: [member] });
      ok(await create(other, {}, member));
      refused(await create(other), 'concurrent', 'Quota Café Mitglied Zwei');
    });

    it('a club still in review is limited like a live one', async () => {
      const club = await mkClub('Quota Café Prüfung');
      await db.query(`UPDATE groups SET approval_status = 'pending' WHERE id = $1`, [club]);
      ok(await create(club));
      refused(await create(club), 'concurrent', 'Quota Café Prüfung');
    });

    it('two requests at once: exactly one event — the count runs under a lock on the club', async () => {
      const club = await mkClub('Quota Café Wettlauf');
      const both = await Promise.all([create(club, { name: 'Wettlauf A' }), create(club, { name: 'Wettlauf B' })]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 403]);
      refused(both.find((r) => r.statusCode === 403), 'concurrent', 'Quota Café Wettlauf');
      expect((await db.query('SELECT COUNT(*)::int AS n FROM groups WHERE parent_club_id = $1', [club])).rows[0].n).toBe(1);
    });

    it('CLUB_FREE_TIER=false switches all of it off — tickets follow the Pro rule again', async () => {
      const club = await mkClub('Quota Café Not-Aus');
      ok(await create(club));
      refused(await create(club), 'concurrent', 'Quota Café Not-Aus');
      process.env.CLUB_FREE_TIER = 'false';
      try {
        expect(await quota(club)).toMatchObject({ active: false, limited: false, block: null });
        expect((await create(club)).statusCode).toBe(201);
        expect((await create(club)).statusCode).toBe(201);
        const ticket = await create(club, { ticket_url: 'https://shop.example.com/t' });
        expect(ticket.statusCode).toBe(403);
        expect(ticket.body.code).toBe('PRO_REQUIRED');
      } finally {
        delete process.env.CLUB_FREE_TIER;
      }
      refused(await create(club), 'third', 'Quota Café Not-Aus');
    });

    it('without the start marker (boot window) nothing is limited', async () => {
      const club = await mkClub('Quota Café Boot');
      ok(await create(club));
      refused(await create(club), 'concurrent', 'Quota Café Boot');
      // Renamed, not deleted: applied_at — the day itself — stays exactly as it is.
      const rename = (from, to) => db.query('UPDATE one_shot_migrations SET name = $2 WHERE name = $1', [from, to]);
      expect((await rename(MARKER, `${MARKER}_off`)).rowCount).toBe(1);
      try {
        expect(await quota(club)).toMatchObject({ active: false, limited: false, used: 0, block: null });
        expect((await create(club)).statusCode).toBe(201);
      } finally {
        await rename(`${MARKER}_off`, MARKER);
      }
      expect(await quota(club)).toMatchObject({ limited: true, used: 2, upcoming: 2, block: 'third' });
    });

    // GET /api/clubs/:id/event-quota — what the event form asks before it opens.
    it('the quota endpoint says what creating would answer, to the people who may create', async () => {
      const pc = await import('../../src/controllers/partnerController.js');
      const ask = (club, userId = owner) => call(pc.getEventQuota, { userId, params: { id: String(club) } });

      const club = await mkClub('Quota Café Frage', { more: [member] });
      const empty = await ask(club);
      ok(empty);
      expect(empty.body).toEqual({
        club_id: club, club_name: 'Quota Café Frage', limited: true, free_events: 2,
        used: 0, upcoming: 0, block: null, ticket_allowed: false, is_manager: true,
      });
      const first = await create(club);
      ok(first);
      expect((await ask(club)).body).toMatchObject({ used: 1, upcoming: 1, block: 'concurrent' });
      // a plain member gets the same answer, without the manager flag
      expect((await ask(club, member)).body).toMatchObject({ block: 'concurrent', is_manager: false });
      await moveTo(first.body.id, -2);
      ok(await create(club));
      expect((await ask(club)).body).toMatchObject({ used: 2, upcoming: 1, block: 'third' });

      // an outsider learns nothing, an app admin sees it as not limited
      const outsider = await ask(club, plain);
      expect(outsider.statusCode).toBe(403);
      expect(outsider.body.code).toBe('NOT_MEMBER');
      expect((await ask(club, A)).body).toMatchObject({ limited: false, block: null, ticket_allowed: true, is_manager: false });

      // a paying partner and a community: never limited
      const partner = await mkClub('Quota Partner Frage', { paid: true });
      expect((await ask(partner)).body).toMatchObject({ limited: false, block: null, ticket_allowed: true });
      const community = await mkClub('Quota Community Frage', { type: 'community' });
      expect((await ask(community)).body).toEqual({
        club_id: community, club_name: 'Quota Community Frage', limited: false, free_events: 2,
        used: 0, upcoming: 0, block: null, ticket_allowed: true, is_manager: true,
      });

      // not a club, not a number
      expect((await ask(first.body.id)).statusCode).toBe(404);
      expect((await ask('featured')).statusCode).toBe(404);
    });
  });

  // ── „Ja, meldet euch!“ → „JAMIE Anfrage“ (Tina 17.11.2026) ──────────────
  // controllers/partnerController.js: the request a club's manager sends from
  // the partner message is stored once per club and person a day and listed
  // for the admins. The mail module is mocked for this suite without the new
  // function — the handler must not mind.
  describe('Partner-Anfragen (Tina 17.11.2026)', () => {
    let pc, owner, coMgr, member, club;
    const FORM = {
      name: 'Olga Wirt', company: 'Café Anfrage', email: 'olga@anfrage.at', phone: '+43 660 1234567',
      contact: 'mail', privacy: true, reason: 'third',
    };
    const mkU = async (tag, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1988-08-08','female',$3, TRUE, 'email') RETURNING id`, [`smoke-lead-${tag}@x.com`, name, avatar])).rows[0].id;
    const send = (userId, body = FORM, clubId = club) => call(pc.requestPartner, { userId, params: { id: String(clubId) }, body });
    const rows = async (clubId = club) => (await db.query(
      `SELECT user_id, source, name, company, email, phone, contact, privacy_accepted_at, created_at
         FROM partner_leads WHERE club_id = $1 ORDER BY id`, [clubId])).rows;

    beforeAll(async () => {
      pc = await import('../../src/controllers/partnerController.js');
      owner = await mkU('owner', 'Olga');
      coMgr = await mkU('mgr', 'Marta');
      member = await mkU('member', 'Mona');
      club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status, club_type)
         VALUES ('Café Anfrage','club',$1,'Bar','Wien',500,FALSE,'approved','official') RETURNING id`, [owner])).rows[0].id;
      await db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'admin'),($1,$4,'member')`,
        [club, owner, coMgr, member]);
    });

    it('the owner’s request is stored with how they want to be reached and when they agreed', async () => {
      const res = await send(owner);
      expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toEqual({ ok: true });
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        user_id: owner, source: 'third', name: 'Olga Wirt', company: 'Café Anfrage',
        email: 'olga@anfrage.at', phone: '+43 660 1234567', contact: 'mail',
      });
      expect(stored[0].privacy_accepted_at).toBeInstanceOf(Date);
      expect(Math.abs(stored[0].privacy_accepted_at - stored[0].created_at)).toBeLessThan(1000);
    });

    it('a second request within 24 hours answers like a success — still exactly one row', async () => {
      const again = await send(owner, { ...FORM, reason: 'concurrent' });
      expect(again.statusCode).toBe(200);
      expect(again.body).toEqual({ ok: true, duplicate: true });
      expect(await rows()).toHaveLength(1);
      // a day later the same person may ask again
      await db.query(`UPDATE partner_leads SET created_at = created_at - INTERVAL '25 hours' WHERE club_id = $1`, [club]);
      expect((await send(owner, { ...FORM, reason: 'concurrent' })).statusCode).toBe(201);
      expect((await rows()).map((r) => r.source)).toEqual(['third', 'concurrent']);
    });

    it('a co-manager may ask too, by call and without an e-mail — a plain member may not', async () => {
      const byCall = await send(coMgr, { name: 'Marta', contact: 'call', phone: '0660 7654321', privacy: true, reason: 'ticket' });
      expect(byCall.statusCode, JSON.stringify(byCall.body)).toBe(201);
      const mine = (await rows()).find((r) => r.user_id === coMgr);
      expect(mine).toMatchObject({ source: 'ticket', contact: 'call', phone: '0660 7654321', email: null, company: null });

      const no = await send(member);
      expect(no.statusCode).toBe(403);
      expect(no.body.code).toBe('NOT_CLUB_MANAGER');
      expect((await rows()).some((r) => r.user_id === member)).toBe(false);
    });

    it('without the privacy tick, or with a bad e-mail, nothing is stored', async () => {
      const before = (await rows()).length;
      await db.query(`UPDATE partner_leads SET created_at = created_at - INTERVAL '25 hours' WHERE club_id = $1`, [club]);
      for (const [field, over] of [['privacy', { privacy: false }], ['privacy', { privacy: 'yes' }],
        ['email', { email: 'keine-adresse' }], ['reason', { reason: 'foo' }], ['contact', { contact: 'sms' }]]) {
        const res = await send(owner, { ...FORM, ...over });
        expect(res.statusCode, field).toBe(400);
        expect(res.body).toMatchObject({ code: 'LEAD_INVALID', field });
      }
      expect(await rows()).toHaveLength(before);
    });

    it('not a club, or a club that does not exist: 404', async () => {
      const ev = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, parent_club_id)
         VALUES ('Anfrage-Event','event',$1,'Bar','Wien',20,$2) RETURNING id`, [owner, club])).rows[0].id;
      expect((await send(owner, FORM, ev)).statusCode).toBe(404);
      expect((await send(owner, FORM, 2147483000)).statusCode).toBe(404);
    });

    it('the admin list shows the requests newest first, with the club’s and the person’s name', async () => {
      const res = await call(pc.getPartnerLeadsAdmin, { userId: A });
      ok(res);
      expect(Array.isArray(res.body)).toBe(true);
      const ours = res.body.filter((l) => l.club?.id === club);
      expect(ours).toHaveLength(3);
      for (const l of ours) expect(l.club).toEqual({ id: club, name: 'Café Anfrage' });
      expect(ours.map((l) => l.user.name).sort()).toEqual(['Marta', 'Olga', 'Olga']);
      const times = res.body.map((l) => new Date(l.created_at).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(Object.keys(ours[0]).sort()).toEqual(
        ['club', 'company', 'contact', 'created_at', 'email', 'id', 'name', 'phone', 'source', 'user']);
    });

    it('a deleted account leaves the request in the list, without the person', async () => {
      await db.query('DELETE FROM users WHERE id = $1', [coMgr]);
      const res = await call(pc.getPartnerLeadsAdmin, { userId: A });
      ok(res);
      const hers = res.body.find((l) => l.club?.id === club && l.source === 'ticket');
      expect(hers).toMatchObject({ name: 'Marta', phone: '0660 7654321', user: null });
    });
  });

  // ── Deals in the model of 17.11.2026 (Tina's new document, Tobi) ────────
  // ONE deal per event, put up with the event („Deal anlegen“ in the event
  // form) or on its edit page; free on a club's first two events, after that
  // only as a paying partner; never in the feed; the ✓ only for a paying
  // partner. No JAMIE Pro anywhere.
  describe('Deals im neuen Modell (Tina 17.11.2026)', () => {
    let pc, owner, member, outsider;
    const photo = 'https://app.jamie-app.com/media/uploads/event-deal.webp';
    const until = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const DEAL = { name: 'Café Modell', deal_label: '1 Punsch gratis', visible_until: until(30), photos: [photo] };
    const mkU = async (tag, name) => (await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ($1,$2,'1990-02-02','male',$3, TRUE, 'email') RETURNING id`, [`smoke-newdeal-${tag}@x.com`, name, avatar])).rows[0].id;
    const mkClub = async (name, { type = 'official', paid = false, more = [] } = {}) => {
      const id = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, is_private, approval_status,
                             club_type, is_paid_partner, lat, lng, events_owner_only)
         VALUES ($1,'club',$2,'Bar','Gumpendorfer Straße 1, 1060 Wien',500,FALSE,'approved',$3,$4,48.19,16.35,FALSE) RETURNING id`,
        [name, owner, type, paid])).rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [id, owner]);
      for (const u of more) await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [id, u]);
      return id;
    };
    const day = async (n) => (await db.query(
      `SELECT to_char((NOW() AT TIME ZONE 'Europe/Vienna')::date + $1::int, 'YYYY-MM-DD') AS d`, [n])).rows[0].d;
    const create = async (club, body = {}, userId = owner) => call(C.createClubEvent, {
      userId, params: { id: String(club) }, body: { name: 'Modell Abend', date: await day(3), time: '19:00', ...body } });
    const pass = async (eventId) => db.query(
      `UPDATE groups SET date = ($2::date + TIME '19:00') WHERE id = $1`, [eventId, await day(-2)]);
    const eventCount = async (club) => (await db.query(
      'SELECT COUNT(*)::int AS n FROM groups WHERE parent_club_id = $1', [club])).rows[0].n;
    const dealsOf = async (club) => (await db.query(
      'SELECT id, club_id, created_by, name, deal_label, address, lat, is_active FROM deals WHERE club_id = $1 ORDER BY id', [club])).rows;
    const linkOf = async (eventId) => (await db.query(
      'SELECT deal_id, attached_by FROM event_deals WHERE group_id = $1', [eventId])).rows[0] ?? null;
    const shownAt = async (eventId, userId = outsider) => {
      const res = await call(C.getGroupById, { userId, params: { id: String(eventId) } });
      ok(res);
      return res.body.deal;
    };
    const feedIds = async () => {
      const res = await call(C.getDeals, { userId: outsider });
      ok(res);
      return res.body.map((d) => d.id);
    };
    const at = (fn, club, eventId, body, userId = owner) => call(fn, {
      userId, params: { id: String(club), eventId: String(eventId) }, body });
    const pay = async (club, on = true) => ok(await call(C.classifyClub, {
      userId: A, params: { id: String(club) }, body: { is_paid_partner: on } }));

    beforeAll(async () => {
      pc = await import('../../src/controllers/partnerController.js');
      owner = await mkU('owner', 'Otto');
      member = await mkU('member', 'Mirko');
      outsider = await mkU('guest', 'Gregor');
    });

    it('an event arrives with its deal: both written together — at the event without the ✓, never in the feed', async () => {
      const club = await mkClub('Café Modell');
      const res = await create(club, { name: 'Punsch Night', deal: DEAL });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
      // the answer is still the event row; the deal rides next to it
      expect(res.body).toMatchObject({ name: 'Punsch Night', type: 'event', parent_club_id: club });
      const shown = { id: expect.any(Number), name: 'Café Modell', deal_label: '1 Punsch gratis', photo, verified: false };
      expect(res.body.deal).toEqual(shown);

      const [deal] = await dealsOf(club);
      expect(deal).toMatchObject({
        club_id: club, created_by: owner, name: 'Café Modell', deal_label: '1 Punsch gratis',
        address: 'Gumpendorfer Straße 1, 1060 Wien', lat: 48.19, is_active: true,   // no address typed: the club's, pin included
      });
      expect(await linkOf(res.body.id)).toEqual({ deal_id: deal.id, attached_by: owner });
      expect(await shownAt(res.body.id)).toEqual({ ...shown, id: deal.id });
      // …the club's event list carries it too, and its own page opens
      const list = await call(C.getClubEvents, { userId: owner, params: { id: String(club) } });
      ok(list);
      expect(list.body.find((e) => e.id === res.body.id).deal).toEqual({ ...shown, id: deal.id });
      ok(await call(C.getDeal, { userId: outsider, params: { id: String(deal.id) } }));
      // Tina: „ABER! Der Deal wird in den Gruppen nicht angezeigt.“
      expect(await feedIds()).not.toContain(deal.id);
    });

    it('a paying partner\'s deal carries the ✓ — JAMIE\'s own deal is what the feed shows', async () => {
      const club = await mkClub('Café Modell Partner', { paid: true });
      const res = await create(club, { deal: { ...DEAL, name: 'Café Modell Partner' } });
      expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
      expect(res.body.deal.verified).toBe(true);
      expect((await shownAt(res.body.id)).verified).toBe(true);
      const [deal] = await dealsOf(club);
      expect(await feedIds()).not.toContain(deal.id);       // a partner's deal neither
      const jamie = await call(C.createDeal, { userId: A, body: {
        name: 'Modell JAMIE Deal', deal_label: 'Gratis Shot', address: 'Wien', visible_until: '2099-12-31' } });
      expect(jamie.statusCode).toBe(201);
      expect(await feedIds()).toContain(jamie.body.id);
      // …and at an event JAMIE's deal is always verified
      ok(await call(C.setEventDeal, { userId: A, params: { groupId: String(res.body.id) }, body: { deal_id: jamie.body.id } }));
      expect(await shownAt(res.body.id)).toMatchObject({ id: jamie.body.id, verified: true });
    });

    it('an event without a deal answers deal: null and writes none', async () => {
      const club = await mkClub('Café Modell Ohne');
      const res = await create(club);
      expect(res.statusCode).toBe(201);
      expect(res.body.deal).toBeNull();
      expect(await dealsOf(club)).toEqual([]);
      expect(await linkOf(res.body.id)).toBeNull();
    });

    it('a deal that does not pass means no event either', async () => {
      const club = await mkClub('Café Modell Fehler');
      for (const [bad, status] of [
        [{ ...DEAL, deal_label: undefined }, 400],                 // the headline is required
        [{ ...DEAL, visible_until: undefined }, 400],              // „Sichtbar bis“ is required
        [{ ...DEAL, visible_until: until(400) }, 400],             // at most 180 days
        [{ ...DEAL, photos: ['https://evil.example/x.jpg'] }, 400],
        [{ ...DEAL, deal_label: 'Hurensohn' }, 422],               // moderated like every club deal
        ['2 für 1', 400],                                          // not an object
        [[DEAL], 400],
      ]) {
        const res = await create(club, { deal: bad });
        expect(res.statusCode, JSON.stringify(bad)).toBe(status);
      }
      expect(await eventCount(club)).toBe(0);
      expect(await dealsOf(club)).toEqual([]);
      // the free tier did not count any of them
      expect((await call(pc.getEventQuota, { userId: owner, params: { id: String(club) } })).body).toMatchObject({ used: 0, block: null });
    });

    it('only the people who run the club, only an official club that is live', async () => {
      const club = await mkClub('Café Modell Rechte', { more: [member] });
      const byMember = await create(club, { deal: DEAL }, member);
      expect(byMember.statusCode).toBe(403);
      expect(byMember.body.code).toBe('NOT_CLUB_MANAGER');
      expect((await create(club, {}, member)).statusCode).toBe(201);          // without a deal a member's event is fine
      const community = await mkClub('Modell Laufrunde', { type: 'community' });
      const comm = await create(community, { deal: DEAL });
      expect(comm.statusCode).toBe(403);
      expect(comm.body.code).toBe('OFFICIAL_CLUB_REQUIRED');
      const pending = await mkClub('Café Modell Prüfung');
      await db.query(`UPDATE groups SET approval_status = 'pending' WHERE id = $1`, [pending]);
      const notLive = await create(pending, { deal: DEAL });
      expect(notLive.statusCode).toBe(403);
      expect(notLive.body.code).toBe('CLUB_NOT_LIVE');
      expect(await eventCount(community)).toBe(0);
      expect(await eventCount(pending)).toBe(0);
      expect(await eventCount(club)).toBe(1);
    });

    it('on the edit page: what is there (extras), put one up, edit it in place, take it off', async () => {
      const club = await mkClub('Café Modell Bearbeiten', { more: [member] });
      const ev = (await create(club)).body.id;
      const none = await at(pc.getEventExtras, club, ev);
      ok(none);
      expect(none.body).toEqual({
        is_official: true, club_name: 'Café Modell Bearbeiten', auto_messages: false,
        deal: null, deal_shown: null, jamie_deal: null, deal_allowed: true,
      });

      const put = await at(pc.saveEventDeal, club, ev, { ...DEAL, description: 'Sag „JAMIE“ an der Bar.' });
      expect(put.statusCode, JSON.stringify(put.body)).toBe(200);
      const dealId = put.body.deal.id;
      expect(put.body.deal).toMatchObject({
        name: 'Café Modell', deal_label: '1 Punsch gratis', description: 'Sag „JAMIE“ an der Bar.', photos: [photo],
        address: 'Gumpendorfer Straße 1, 1060 Wien', redeem_interval: 'once', max_redemptions: 100,
      });
      expect(put.body.deal_shown).toEqual({ id: dealId, name: 'Café Modell', deal_label: '1 Punsch gratis', photo, verified: false });
      expect(await linkOf(ev)).toEqual({ deal_id: dealId, attached_by: owner });

      // a second PUT edits that one deal — one deal per event, never a second row
      const edit = await at(pc.saveEventDeal, club, ev, { deal_label: '2 Punsch gratis' });
      expect(edit.statusCode, JSON.stringify(edit.body)).toBe(200);
      expect(edit.body.deal).toMatchObject({ id: dealId, deal_label: '2 Punsch gratis', description: 'Sag „JAMIE“ an der Bar.' });
      expect(await dealsOf(club)).toHaveLength(1);
      const extras = await at(pc.getEventExtras, club, ev);
      expect(extras.body.deal).toMatchObject({ id: dealId, deal_label: '2 Punsch gratis' });
      expect(extras.body.deal_shown.deal_label).toBe('2 Punsch gratis');
      expect(new Date(extras.body.deal.visible_until).getTime()).toBeGreaterThan(Date.now());

      // a plain member and an outsider get none of it
      for (const u of [member, outsider]) {
        expect((await at(pc.getEventExtras, club, ev, {}, u)).statusCode).toBe(403);
        expect((await at(pc.saveEventDeal, club, ev, { deal_label: 'x' }, u)).body.code).toBe('NOT_CLUB_MANAGER');
        expect((await at(pc.removeEventDeal, club, ev, {}, u)).body.code).toBe('NOT_CLUB_MANAGER');
      }
      expect((await dealsOf(club))[0].deal_label).toBe('2 Punsch gratis');

      // taking it off: gone from the event, and retired — it hangs nowhere else
      const off = await at(pc.removeEventDeal, club, ev);
      ok(off);
      expect(off.body).toEqual({ ok: true });
      expect(await linkOf(ev)).toBeNull();
      expect(await shownAt(ev)).toBeNull();
      expect((await dealsOf(club))[0].is_active).toBe(false);
      expect((await at(pc.removeEventDeal, club, ev)).body).toEqual({ ok: true });   // nothing there: a no-op
      expect((await at(pc.getEventExtras, club, ev)).body).toMatchObject({ deal: null, deal_shown: null });
    });

    it('a deal that hangs on two events stays live when it is taken off one of them', async () => {
      const club = await mkClub('Café Modell Zwei Events', { paid: true });
      const first = (await create(club, { deal: DEAL })).body.id;
      const second = (await create(club)).body.id;
      const [deal] = await dealsOf(club);
      // the old way: the same deal hung on a second event
      ok(await call(C.setEventDeal, { userId: owner, params: { groupId: String(second) }, body: { deal_id: deal.id } }));
      ok(await at(pc.removeEventDeal, club, first));
      expect(await linkOf(first)).toBeNull();
      expect((await linkOf(second)).deal_id).toBe(deal.id);
      expect((await dealsOf(club))[0].is_active).toBe(true);
      ok(await at(pc.removeEventDeal, club, second));
      expect((await dealsOf(club))[0].is_active).toBe(false);
    });

    it('free on the club\'s first two events — the third only as a paying partner, and a deal there outlives the partnership', async () => {
      const club = await mkClub('Café Modell Drei');
      const e1 = (await create(club, { name: 'Erstes' })).body.id;
      await pass(e1);
      const e2 = (await create(club, { name: 'Zweites' })).body.id;
      await pass(e2);
      await pay(club);
      const e3res = await create(club, { name: 'Drittes', deal: { ...DEAL, deal_label: 'Partner-Deal' } });
      expect(e3res.statusCode, JSON.stringify(e3res.body)).toBe(201);
      const e3 = e3res.body.id;
      await pay(club, false);                                   // the partnership ends

      ok(await at(pc.saveEventDeal, club, e1, DEAL));           // the first two stay free
      ok(await at(pc.saveEventDeal, club, e2, DEAL));
      expect((await at(pc.getEventExtras, club, e2)).body.deal_allowed).toBe(true);

      const third = await at(pc.saveEventDeal, club, e3, { deal_label: 'neu' });
      expect(third.statusCode).toBe(403);
      expect(third.body).toMatchObject({ code: 'PARTNER_REQUIRED', reason: 'deal', club_name: 'Café Modell Drei' });
      expect(third.body.error).toBe('Deals gibt es für die ersten 2 Events eures Clubs – danach als JAMIE Partner.');
      const extras = await at(pc.getEventExtras, club, e3);
      expect(extras.body.deal_allowed).toBe(false);
      expect(extras.body.deal.deal_label).toBe('Partner-Deal');  // still there, shown as before, without the ✓
      expect(await shownAt(e3)).toMatchObject({ deal_label: 'Partner-Deal', verified: false });
      ok(await at(pc.removeEventDeal, club, e3));               // …and it can always be taken down
      await pay(club);
      ok(await at(pc.saveEventDeal, club, e3, DEAL));           // a partner again: any event
    });

    it('an event from before the deploy is none of the free ones', async () => {
      const club = await mkClub('Café Modell Bestand');
      const old = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date, parent_club_id, created_at)
         VALUES ('Bestand Abend','event',$1,'Bar','Wien',20, $2::date + TIME '19:00', $3,
                 (SELECT applied_at FROM one_shot_migrations WHERE name = '2026-11-17_club_free_tier_start') - INTERVAL '1 day')
         RETURNING id`, [owner, await day(5), club])).rows[0].id;
      expect((await at(pc.saveEventDeal, club, old, DEAL)).body).toMatchObject({ code: 'PARTNER_REQUIRED', reason: 'deal' });
      expect((await at(pc.getEventExtras, club, old)).body.deal_allowed).toBe(false);
      await pay(club);
      ok(await at(pc.saveEventDeal, club, old, DEAL));
    });

    it('what JAMIE hung on the event stays: named in the extras, neither replaced nor taken off (409)', async () => {
      const club = await mkClub('Café Modell JAMIE');
      const ev = (await create(club)).body.id;
      const jamie = await call(C.createDeal, { userId: A, body: {
        name: 'JAMIE am Event', deal_label: 'Welcome Shot', address: 'Wien', visible_until: '2099-12-31' } });
      ok(await call(C.setEventDeal, { userId: A, params: { groupId: String(ev) }, body: { deal_id: jamie.body.id } }));
      const extras = await at(pc.getEventExtras, club, ev);
      expect(extras.body).toMatchObject({ deal: null, jamie_deal: { name: 'JAMIE am Event' } });
      expect(extras.body.deal_shown).toMatchObject({ id: jamie.body.id, verified: true });
      const put = await at(pc.saveEventDeal, club, ev, DEAL);
      expect(put.statusCode).toBe(409);
      expect(put.body.code).toBe('DEAL_SET_BY_JAMIE');
      expect((await at(pc.removeEventDeal, club, ev)).statusCode).toBe(409);
      expect(await dealsOf(club)).toEqual([]);                   // nothing of the club's was written
      expect((await linkOf(ev)).deal_id).toBe(jamie.body.id);
      // …and an event that arrives with a deal has none of JAMIE's on it yet: fine
    });

    it('another club\'s event, ids that do not exist: 404 — nothing written', async () => {
      const mine = await mkClub('Café Modell Meins');
      const theirs = await mkClub('Café Modell Deren');
      const theirEvent = (await create(theirs)).body.id;
      for (const fn of [pc.getEventExtras, pc.saveEventDeal, pc.removeEventDeal]) {
        expect((await at(fn, mine, theirEvent, DEAL)).statusCode).toBe(404);
        expect((await at(fn, mine, 2147483000, DEAL)).statusCode).toBe(404);
        expect((await at(fn, 2147483000, theirEvent, DEAL)).statusCode).toBe(404);
      }
      expect(await dealsOf(mine)).toEqual([]);
      expect(await linkOf(theirEvent)).toBeNull();
    });
  });
  // <<< BAU1-SMOKE
  //
  // ── separator: leave in place ──
  //
  // >>> BAU2-SMOKE (Profil, Community & Nach dem Event)
  // <<< BAU2-SMOKE

  // ── groups.is_paid_partner (partner model, Tina/Tobi 17.11.2026) ────────
  // The column ships one deploy ahead of its readers. The path that matters
  // runs in production exactly once: a database that has the groups table but
  // not the column. A fresh smoke schema already has it (schema.sql), so that
  // path is taken for real here — drop the column, boot again.
  describe('groups.is_paid_partner: the boot migration adds the column to an existing groups table (2026-11-17)', () => {
    const column = async () => (await db.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'groups' AND column_name = 'is_paid_partner'`)).rows[0];
    const SHAPE = { data_type: 'boolean', is_nullable: 'NO', column_default: 'false' };
    const paidOf = async (id) => (await db.query('SELECT is_paid_partner FROM groups WHERE id = $1', [id])).rows[0]?.is_paid_partner;

    // V-01: the ✓ in the Clubs list and the ☆ on the profile bubbles are built
    // on this field. It arrives through SELECT g.* — this pin falls if someone
    // turns one of these lists into an explicit column list and forgets it.
    it('the club endpoints carry is_paid_partner as a boolean (V-01)', async () => {
      const mkOfficial = async (name) => (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, club_type,
                             approval_status, is_active, is_private)
         VALUES ($1, 'club', $2, 'Sonstiges', 'Wien', 500, 'official', 'approved', TRUE, FALSE)
         RETURNING id`, [name, A])).rows[0].id;
      const paid = await mkOfficial('Smoke Fundament Zahlt');
      const free = await mkOfficial('Smoke Fundament Gratis');
      for (const id of [paid, free]) {
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, A]);
      }
      await db.query('UPDATE groups SET is_paid_partner = TRUE WHERE id = $1', [paid]);

      // `search` bypasses the 30-s list cache of getClubs
      const list = await call(C.getClubs, { userId: A, query: { club_type: 'official', search: 'Smoke Fundament', limit: '100' } });
      ok(list);
      const inList = Object.fromEntries(list.body.map((c) => [c.id, c.is_paid_partner]));
      expect(inList[paid]).toBe(true);
      expect(inList[free]).toBe(false);

      const one = await call(C.getClubById, { userId: A, params: { id: String(paid) } });
      ok(one);
      expect(one.body.is_paid_partner).toBe(true);

      const joined = await call(C.getUserClubs, { userId: A });
      ok(joined);
      expect(joined.body.find((c) => c.id === paid)?.is_paid_partner).toBe(true);
      expect(joined.body.find((c) => c.id === free)?.is_paid_partner).toBe(false);

      await db.query('DELETE FROM groups WHERE id = ANY($1::int[])', [[paid, free]]);
    });

    it('a fresh database has it from schema.sql: BOOLEAN NOT NULL DEFAULT FALSE', async () => {
      expect(await column()).toEqual(SHAPE);
    });

    it('a database from before the deploy: the boot adds it, every existing row reads false, a set flag survives the next boot', async () => {
      const club = (await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, club_type)
         VALUES ('Smoke Zahlender Partner', 'club', $1, 'Sonstiges', 'Wien', 500, 'official') RETURNING id`, [A])).rows[0].id;
      await db.query('ALTER TABLE groups DROP COLUMN is_paid_partner');
      expect(await column()).toBeUndefined();

      const { runStartupMigrations, getMigrationHealth } = await import('../../src/config/migrations.js');
      const failed = () => getMigrationHealth().stepFailures.filter((f) => f.label.includes('is_paid_partner'));
      await runStartupMigrations();
      expect(failed()).toEqual([]);
      expect(await column()).toEqual(SHAPE);
      const all = (await db.query(
        'SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_paid_partner)::int AS paid FROM groups')).rows[0];
      expect(all.n).toBeGreaterThan(0);
      expect(all.paid).toBe(0);
      expect(await paidOf(club)).toBe(false);

      // only an admin write ever sets it — and the probe leaves a set flag alone
      await db.query('UPDATE groups SET is_paid_partner = TRUE WHERE id = $1', [club]);
      await runStartupMigrations();
      expect(failed()).toEqual([]);
      expect(await column()).toEqual(SHAPE);
      expect(await paidOf(club)).toBe(true);
      await db.query('DELETE FROM groups WHERE id = $1', [club]);
    });
  });

  // ── „Sichtbar bis“ saved before 16.11.2026 (review 16.11.) ──────────────
  // Until 1746d37 a bare date was stored as midnight UTC: the deal went dark
  // at 01:00 (02:00 in summer) on its last day. A one-shot at boot moves
  // those to 23:59:59 in Vienna, like every date saved since. Last in the
  // suite on purpose: it rewrites every midnight value in deals.
  describe('one-shot: legacy deal end dates move to the end of their Vienna day (2026-11-16)', () => {
    const MARKER = '2026-11-16_deals_visible_until_vienna_eod';
    const ids = {};
    const mkDeal = async (name, until) => (await db.query(
      `INSERT INTO deals (name, deal_label, visible_until) VALUES ($1, '2 für 1', $2::timestamp) RETURNING id`,
      [name, until])).rows[0].id;
    const endOf = async (id) => (await db.query(
      `SELECT to_char(visible_until, 'YYYY-MM-DD HH24:MI:SS') AS v FROM deals WHERE id = $1`, [id])).rows[0]?.v;
    const ends = async () => Object.fromEntries(
      await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await endOf(id)])));
    const marked = async () => (await db.query('SELECT 1 FROM one_shot_migrations WHERE name = $1', [MARKER])).rowCount;

    it('at boot, once: winter and summer days, the clock-change days; new-style ends, a time of day and no end stay; a second run changes nothing', async () => {
      // it ran at the boot of this suite — on a fresh schema, with nothing to move
      expect(await marked()).toBe(1);
      ids.winter = await mkDeal('Smoke Alt Winter', '2026-12-17 00:00:00');         // CET
      ids.summer = await mkDeal('Smoke Alt Sommer', '2027-07-10 00:00:00');         // CEST
      ids.springForward = await mkDeal('Smoke Alt 28.03.', '2027-03-28 00:00:00');  // its end is in CEST
      ids.fallBack = await mkDeal('Smoke Alt 25.10.', '2026-10-25 00:00:00');       // its end is in CET
      ids.newWinter = await mkDeal('Smoke Neu Winter', '2026-12-17 22:59:59');
      ids.newSummer = await mkDeal('Smoke Neu Sommer', '2027-07-10 21:59:59');
      ids.timed = await mkDeal('Smoke Uhrzeit', '2027-01-05 12:30:00');
      ids.open = await mkDeal('Smoke ohne Ende', null);

      // the first boot after the deploy: no marker yet
      await db.query('DELETE FROM one_shot_migrations WHERE name = $1', [MARKER]);
      const { runStartupMigrations, moveLegacyDealEndsToViennaDayEnd } = await import('../../src/config/migrations.js');
      await runStartupMigrations();
      const after = await ends();
      expect(after).toEqual({
        winter: '2026-12-17 22:59:59',
        summer: '2027-07-10 21:59:59',
        springForward: '2027-03-28 21:59:59',
        fallBack: '2026-10-25 22:59:59',
        newWinter: '2026-12-17 22:59:59',
        newSummer: '2027-07-10 21:59:59',
        timed: '2027-01-05 12:30:00',
        open: null,
      });
      expect(await marked()).toBe(1);
      // exactly what dealController stores today for the same bare day (visibleUntilFrom)
      for (const [key, day] of [['winter', '2026-12-17'], ['summer', '2027-07-10']]) {
        const made = await call(C.createDeal, { userId: A, body: { name: `Smoke Heute ${day}`, deal_label: '2 für 1', visible_until: day } });
        expect(made.statusCode, JSON.stringify(made.body)).toBe(201);
        expect(await endOf(made.body.id)).toBe(after[key]);
      }

      // a second boot: marked, so it does not run; and the UPDATE on its own finds nothing left
      await runStartupMigrations();
      expect(await ends()).toEqual(after);
      expect(await moveLegacyDealEndsToViennaDayEnd()).toBe(0);
      expect(await ends()).toEqual(after);
    });
  });

});
