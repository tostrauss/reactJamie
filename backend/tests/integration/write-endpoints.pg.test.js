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
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import { distanceKmSql, distanceKm } from '../../src/utils/geoRadius.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_URL = process.env.SMOKE_DATABASE_URL;

// Point the pool at the smoke DB BEFORE any module that imports database.js.
if (SMOKE_URL) {
  process.env.DATABASE_URL = SMOKE_URL;
  process.env.NODE_ENV = 'test'; // ssl off; no moderation keys → fail-open blocklist only
  // Declare the image-origin allowlist this suite's fixtures assume
  // (utils/safeUrl.js), instead of inheriting whatever the developer's local
  // .env happens to hold — which points at localhost and would reject the
  // production-shaped avatar URL below.
  process.env.FRONTEND_URL = 'https://app.jamie-app.com';
  process.env.STORAGE_PUBLIC_URL = 'https://app.jamie-app.com/media';
}

// Mock external geocoding so the create/update paths never hit the network.
vi.mock('../../src/utils/geocode.js', () => ({
  resolveCreateLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.37 } })),
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
const emitChain = { emit: () => {}, except: () => emitChain };
const fakeIo = {
  to: () => emitChain,
  in: () => ({ fetchSockets: async () => [] }),
};
const fakeApp = { get: (k) => (k === 'io' ? fakeIo : undefined) };

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
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
    await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
      [pastGroupId, A, B]);

    // A second past group for the "did not take place" flow (A owner, B member).
    const pg2 = await db.query(
      `INSERT INTO groups (name, type, date, owner_id, category, location, max_members)
       VALUES ('No-Show Event','group', NOW() - INTERVAL '2 days', $1, 'Sport', 'Wien', 10) RETURNING id`,
      [A]
    );
    pastGroup2Id = pg2.rows[0].id;
    await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
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
    C = {
      updateProfile: a.updateProfile, completeOnboarding: a.completeOnboarding, getProfile: a.getProfile,
      updatePushPreferences: pu.updatePushPreferences, searchUsers: us.searchUsers,
      runEventReminders: er.runEventReminders, notifyFriendsOfActivity: fa.notifyFriendsOfActivity,
      createGroup: g.createGroup, updateGroup: g.updateGroup, createClub: c.createClub,
      inviteMember: g.inviteMember,
      sendFriendRequest: f.sendFriendRequest, respondFriendRequest: f.respondFriendRequest,
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
      deleteClub: c.deleteClub, deleteClubEvent: c.deleteClubEvent,
      deleteDM: dm.deleteDM,
      joinGroup: g.joinGroup, handleJoinRequest: g.handleJoinRequest, kickMember: g.kickMember,
      joinWaitlist: g.joinWaitlist, joinClub: c.joinClub,
      handleClubJoinRequest: c.handleClubJoinRequest,
      getGroups: g.getGroups,
      getDiscoverEvents: c.getDiscoverEvents, getMapPins: mp.getMapPins,
      getGroupById: g.getGroupById,
      cancelGroup: g.cancelGroup, deleteGroup: g.deleteGroup,
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
    ok(await call(C.submitReview, { userId: A, body: {
      group_id: pastGroupId, attendances: [{ user_id: B, was_present: true }] } }));
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
    // occurrence is today — the card badges it "Heute", so the feed must too.
    const weekly    = await mk('Smoke Weekly Today', `date_trunc('day', ${vienna}) - INTERVAL '21 days' + INTERVAL '20 hours'`, true);
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
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')`, [RG, A, B]);
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

});
