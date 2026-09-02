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
    C = {
      updateProfile: a.updateProfile, completeOnboarding: a.completeOnboarding,
      createGroup: g.createGroup, updateGroup: g.updateGroup, createClub: c.createClub,
      inviteMember: g.inviteMember,
      sendFriendRequest: f.sendFriendRequest, respondFriendRequest: f.respondFriendRequest,
      removeFriend: f.removeFriend, blockUser: f.blockUser, unblockUser: f.unblockUser,
      sendDM: dm.sendDM, submitReview: rv.submitReview, getPendingReviews: rv.getPendingReviews,
      createDeal: dl.createDeal, redeemDeal: dl.redeemDeal, applyBoost: bo.applyBoost,
      sendMessage: ms.sendMessage, getMessages: ms.getMessages,
      markChatRead: ms.markChatRead, deleteMessage: ms.deleteMessage,
      createReport: rp.createReport, getReports: rp.getReports,
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
});
