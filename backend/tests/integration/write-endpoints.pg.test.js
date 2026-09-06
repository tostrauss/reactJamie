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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_URL = process.env.SMOKE_DATABASE_URL;

// Point the pool at the smoke DB BEFORE any module that imports database.js.
if (SMOKE_URL) {
  process.env.DATABASE_URL = SMOKE_URL;
  process.env.NODE_ENV = 'test'; // ssl off; no moderation keys → fail-open blocklist only
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
    const pu = await import('../../src/controllers/pushController.js');
    const er = await import('../../src/jobs/eventReminders.js');
    const fa = await import('../../src/utils/friendActivity.js');
    C = {
      updateProfile: a.updateProfile, completeOnboarding: a.completeOnboarding, getProfile: a.getProfile,
      updatePushPreferences: pu.updatePushPreferences,
      runEventReminders: er.runEventReminders, notifyFriendsOfActivity: fa.notifyFriendsOfActivity,
      createGroup: g.createGroup, updateGroup: g.updateGroup, createClub: c.createClub,
      inviteMember: g.inviteMember,
      sendFriendRequest: f.sendFriendRequest, respondFriendRequest: f.respondFriendRequest,
      removeFriend: f.removeFriend, blockUser: f.blockUser, unblockUser: f.unblockUser,
      sendDM: dm.sendDM, submitReview: rv.submitReview, getPendingReviews: rv.getPendingReviews,
      createDeal: dl.createDeal, redeemDeal: dl.redeemDeal, applyBoost: bo.applyBoost,
      sendMessage: ms.sendMessage, getMessages: ms.getMessages,
      markChatRead: ms.markChatRead, deleteMessage: ms.deleteMessage,
      createReport: rp.createReport, getReports: rp.getReports,
      joinGroup: g.joinGroup, handleJoinRequest: g.handleJoinRequest, kickMember: g.kickMember,
      getGroups: g.getGroups,
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

  // ── reports (reportController — window query + ON CONFLICT dedup) ────────
  it('createReport inserts, and an identical re-report dedups (ON CONFLICT)', async () => {
    ok(await call(C.createReport, { userId: B, body: {
      reported_type: 'user', reported_id: D, reason: 'spam', details: 'smoke' } }));
    noServerError(await call(C.createReport, { userId: B, body: {
      reported_type: 'user', reported_id: D, reason: 'spam', details: 'smoke again' } }));
    const r = await db.query(
      "SELECT COUNT(*)::int AS n FROM reports WHERE reporter_id=$1 AND reported_type='user' AND reported_id=$2",
      [B, D]);
    expect(r.rows[0].n).toBe(1);
  });
  it('getReports serves the admin list (COUNT(*) OVER() window SQL)', async () => {
    const res = await call(C.getReports, { userId: A, query: { status: 'pending', limit: '10', offset: '0' } });
    ok(res);
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
      const r = await db.query(
        `INSERT INTO groups (name, type, owner_id, category, location, max_members, date,
                             is_active, is_recurring_weekly, is_private)
         VALUES ($1,$2,$3,'Sport','Wien',10,$4::timestamp,$5,$6,$7) RETURNING id`,
        [name, type, owner, date, isActive, recurring, isPrivate]);
      const id = r.rows[0].id;
      await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [id, owner]);
      for (const uid of members) {
        await db.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member')`, [id, uid]);
      }
      return id;
    };
    const tick = (iso) => C.runEventReminders({ now: new Date(iso) });

    // ── A. updatePushPreferences (pushController) ────────────────────────────
    it('updatePushPreferences writes only the boolean keys sent and returns all three', async () => {
      const res = await call(C.updatePushPreferences, { userId: A, body: { push_reminders: false } });
      ok(res);
      expect(res.body).toEqual({ push_reminders: false, push_friends: true, push_recommendations: false });
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
                                        owner_nudge_sent_for = date WHERE date IS NOT NULL`);
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
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 1, pushes: 3 });
      expect((await markers(G1)).day).toBe('2026-09-20 19:00:00');
      expect((await markers(G2)).nudge).toBe('2026-09-21 00:00:00');
      for (const id of [G2, K1, G3, G4]) expect((await markers(id)).day, `day marker of ${id}`).toBeNull();
      for (const id of [G1, K1, G3, G4]) expect((await markers(id)).nudge, `nudge marker of ${id}`).toBeNull();
    });
    it('same tick again → nothing (marker = date is the idempotency key)', async () => {
      expect(await tick('2026-09-19T16:30:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, pushes: 0 });
    });
    it('D-day 18:30 Vienna: all-day group gets its day-before (muted member skipped); 30 min before is OUTSIDE the hour window', async () => {
      await db.query('UPDATE group_members SET notifications_muted = TRUE WHERE group_id = $1 AND user_id = $2', [G2, B]);
      // 2026-09-20T16:30Z = 18:30 CEST Sep 20.
      //   G2 day window [Sep 20 18:00, Sep 21 00:00) Vienna = [16:00Z, 22:00Z) → in; recipients A only (B muted).
      //   G1 hour window = start 17:00Z − [60, 30) min = [16:00Z, 16:30Z): the upper bound is a strict `>`,
      //   so exactly 30 min before (16:30Z) is EXCLUDED.
      const r = await tick('2026-09-20T16:30:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, pushes: 1 });
      expect((await markers(G2)).day).toBe('2026-09-21 00:00:00');
      expect((await markers(G1)).hour).toBeNull();
    });
    it('D-day 18:15 Vienna (45 min before): hour-before claims the timed group; recipients A + B', async () => {
      // 2026-09-20T16:15Z = 18:15 CEST → inside [16:00Z, 16:30Z). Ticks are injected, so probing the
      // boundary first and the interior second is fine — the claim only cares about marker <> date.
      const r = await tick('2026-09-20T16:15:00Z');
      expect(r).toEqual({ dayBefore: 0, hourBefore: 1, ownerNudge: 0, pushes: 2 });
      expect((await markers(G1)).hour).toBe('2026-09-20 19:00:00');
      expect((await markers(G2)).hour).toBeNull();
    });
    it('all-day group never gets an hour-before, even 45 min before its midnight', async () => {
      // 2026-09-20T21:15Z = 23:15 CEST Sep 20. If G2's 00:00 were treated as a real start (22:00Z),
      // its hour window would be [21:00Z, 21:30Z) and 21:15Z would be inside — the `date::time <> '00:00'`
      // guard is the only thing keeping it out.
      expect(await tick('2026-09-20T21:15:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, pushes: 0 });
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
      expect(r).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 1, pushes: 1 });
      expect((await markers(G5)).nudge).toBe('2026-09-25 19:00:00');
      expect((await markers(G6)).nudge).toBeNull();
      expect((await markers(G7)).nudge).toBeNull();
      // The G6 exclusion was the owner's toggle and nothing else: flip it back → nudged on the next tick.
      await db.query('UPDATE users SET push_reminders = TRUE WHERE id = $1', [D]);
      expect(await tick('2026-09-23T10:15:00Z')).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 1, pushes: 1 });
      expect((await markers(G6)).nudge).toBe('2026-09-25 19:00:00');
      expect((await markers(G7)).nudge).toBeNull();
    });
    it('re-arms after an edit: marker <> new date → day-before fires again, marker = NEW date', async () => {
      await db.query(`UPDATE groups SET date = '2026-09-27 19:00:00' WHERE id = $1`, [G1]);
      // 2026-09-26T16:30Z = 18:30 CEST Sep 26: G1 day window [Sep 26 18:00, Sep 27 00:00) → in.
      // Hour window (Sep 27 18:00–18:30) not yet; nudge window ([Sep 25 11:00, Sep 26 00:00)) already over.
      const r = await tick('2026-09-26T16:30:00Z');
      expect(r).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, pushes: 2 });
      const m = await markers(G1);
      expect(m.day).toBe('2026-09-27 19:00:00');
      expect(m.hour).toBe('2026-09-20 19:00:00'); // stale → re-armed too, its window just hasn't opened
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
  });
});
