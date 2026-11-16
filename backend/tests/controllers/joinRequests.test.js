import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// db.query dispatches on SQL text (same pattern as group.test.js); tests
// program the scenario via the mutable object below.
const scenario = {
  groupRow: null,     // row for the joinGroup groups lookup
  avatarUrl: null,    // users.avatar_url for the join avatar gate
  allRequests: [],    // rows for the aggregated user/requests endpoint
  tierRows: [],       // rows of the Abzeichen-Stufen aggregate
  liveRow: null,      // owner + liveness lookup of handleJoinRequest / bulk accept
  request: null,      // the request row handleJoinRequest reads
};

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text) => {
      // FIRST: the tier aggregate is routed on its marker (utils/attendanceTiers.js).
      if (text.includes('attendance-tiers')) {
        return { rows: scenario.tierRows };
      }
      if (text.includes('AS is_live')) {
        return { rows: scenario.liveRow ? [scenario.liveRow] : [] };
      }
      if (text.includes('SELECT user_id, status FROM group_join_requests')) {
        return { rows: scenario.request ? [scenario.request] : [] };
      }
      if (text.includes('LEFT JOIN group_members gm ON gm.group_id = g.id')) {
        return { rows: scenario.groupRow ? [scenario.groupRow] : [] };
      }
      if (text.includes('SELECT avatar_url FROM users')) {
        return { rows: [{ avatar_url: scenario.avatarUrl }] };
      }
      if (text.includes('FROM group_join_requests jr')) {
        return { rows: scenario.allRequests };
      }
      // join_counts, existing-request check, upsert, notify lookups …
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));

vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn() },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/subscriptionController.js', () => ({
  isUserPro: vi.fn(async () => false),
}));

const {
  joinGroup, getAllJoinRequests, handleJoinRequest, bulkAcceptJoinRequests,
} = await import('../../src/controllers/groupController.js');
const { setCached, getCached } = await import('../../src/utils/cache.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const emitMock = vi.fn();
const ioMock = { to: vi.fn(() => ({ emit: emitMock })) };
const makeReq = (userId = 5) => ({
  params: { id: '1' },
  body: {},
  userId,
  app: { get: vi.fn(() => ioMock) },
});

beforeEach(() => {
  scenario.groupRow = null;
  scenario.avatarUrl = null;
  scenario.allRequests = [];
  scenario.tierRows = [];
  scenario.liveRow = null;
  scenario.request = null;
  emitMock.mockClear();
  ioMock.to.mockClear();
});

// ── Avatar gate on join (Tina/Tobi meeting 2026-08-04) ────────────────────
describe('joinGroup avatar gate', () => {
  it('403s with requiresAvatar when the joiner has no profile photo', async () => {
    scenario.groupRow = { owner_id: 7, name: 'Yoga', members_count: 1, max_members: 10, is_private: false, type: 'group', parent_club_id: null, already_member: null };
    scenario.avatarUrl = null;
    const res = makeRes();
    await joinGroup(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiresAvatar: true }));
  });

  it('does not avatar-gate an already-member (earlier guard wins)', async () => {
    scenario.groupRow = { owner_id: 7, already_member: 5 };
    const res = makeRes();
    await joinGroup(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(400); // "Already a member", not the gate
  });
});

// ── Frozen "Anfragen (1)" badge fix (meeting 2026-08-04) ──────────────────
describe('joinGroup private path — owner badge freshness', () => {
  it('busts the OWNER\'s user_groups cache and emits join_request_update', async () => {
    scenario.groupRow = { owner_id: 7, name: 'Privatgruppe', members_count: 1, max_members: 10, is_private: true, type: 'group', parent_club_id: null, already_member: null };
    scenario.avatarUrl = 'https://cdn.example/me.jpg';
    // Pre-populate the owner's cache — the join request must evict it.
    setCached('user_groups:7', [{ stale: true }], 60_000);

    const res = makeRes();
    await joinGroup(makeReq(5), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(getCached('user_groups:7')).toBeNull();
    expect(ioMock.to).toHaveBeenCalledWith('user_7');
    expect(emitMock).toHaveBeenCalledWith('join_request_update', expect.objectContaining({ group_id: 1 }));
  });

  it('does not notify/emit when the owner requests to join their own group', async () => {
    scenario.groupRow = { owner_id: 5, name: 'Meine', members_count: 1, max_members: 10, is_private: true, type: 'group', parent_club_id: null, already_member: null };
    scenario.avatarUrl = 'https://cdn.example/me.jpg';
    const res = makeRes();
    await joinGroup(makeReq(5), res);
    expect(emitMock).not.toHaveBeenCalled();
  });
});

// ── Aggregated Anfragen deck endpoint ─────────────────────────────────────
describe('getAllJoinRequests', () => {
  it('returns the pending rows across owned/managed entities', async () => {
    scenario.allRequests = [
      { id: 11, group_id: 1, user_id: 2, user_name: 'Anna', group_name: 'Yoga', group_type: 'group' },
      { id: 12, group_id: 3, user_id: 4, user_name: 'Ben', group_name: 'Läufer', group_type: 'club' },
    ];
    const res = makeRes();
    await getAllJoinRequests({ userId: 7 }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({ user_name: 'Anna', group_type: 'group' }));
  });

  // Abzeichen-Stufen (B2, 06.10.2026): the deck shows the asker's step, with
  // the user_ prefix the request payload already uses for user_trusted.
  it('carries the asker\'s Abzeichen-Stufe as user_attendance_tier', async () => {
    scenario.allRequests = [
      { id: 11, group_id: 1, user_id: 2, user_name: 'Anna', group_name: 'Yoga', group_type: 'group' },
      { id: 12, group_id: 3, user_id: 4, user_name: 'Ben', group_name: 'Läufer', group_type: 'club' },
    ];
    scenario.tierRows = [{ user_id: 2, confirmed_events: 12, confirmers: 3 }];
    const res = makeRes();
    await getAllJoinRequests({ userId: 7 }, res);
    const rows = res.json.mock.calls[0][0];
    expect(Array.isArray(rows)).toBe(true);          // still a bare array
    expect(rows[0].user_attendance_tier).toBe(2);
    expect(rows[1].user_attendance_tier).toBe(0);
    // The five-step level for current clients (25 🌟 / 50 💎, 18.10.2026).
    expect(rows[0].user_attendance_step).toBe(2);
    expect(rows[1].user_attendance_step).toBe(0);
    expect(rows[0]).not.toHaveProperty('attendance_tier');
    expect(rows[0]).not.toHaveProperty('attendance_step');
  });

  it('scopes the query to entities the caller owns or co-manages', async () => {
    const { default: db } = await import('../../src/config/database.js');
    const res = makeRes();
    await getAllJoinRequests({ userId: 7 }, res);
    const call = db.query.mock.calls.find(c => c[0].includes('FROM group_join_requests jr'));
    expect(call[0]).toContain("g.owner_id = $1");
    expect(call[0]).toContain("gm.role = 'admin'");
    expect(call[1]).toEqual([7]);
  });

  // Ziel 4 (Tina, 16.11.2026): the card says what it is while it is swiped.
  it('carries the band fields — additively, the old ones untouched', async () => {
    const { default: db } = await import('../../src/config/database.js');
    await getAllJoinRequests({ userId: 7 }, makeRes());
    const sql = db.query.mock.calls.find(c => c[0].includes('FROM group_join_requests jr'))[0];
    for (const col of [
      'g.date AS group_date', 'g.is_recurring_weekly AS group_recurring', 'g.club_type AS group_club_type',
      'g.parent_club_id', 'pc.name AS parent_club_name', 'pc.image_url AS parent_club_image', 'jr.rejected_count',
      // what old bundles route on and render
      'g.name AS group_name', 'g.type AS group_type', 'u.name AS user_name',
    ]) expect(sql).toContain(col);
    expect(sql).toContain('LEFT JOIN groups pc ON pc.id = g.parent_club_id');
    expect(sql).not.toContain('date_of_birth AS');
  });

  it('lists only requests that can still be answered', async () => {
    const { default: db } = await import('../../src/config/database.js');
    await getAllJoinRequests({ userId: 7 }, makeRes());
    const sql = db.query.mock.calls.find(c => c[0].includes('FROM group_join_requests jr'))[0];
    expect(sql).toContain('g.deleted_at IS NULL');
    expect(sql).toContain('g.is_active = TRUE');                     // cancelled
    // past one-off events by the Vienna DAY; weekly series and clubs (whose
    // date is a "next meetup") never go past
    expect(sql).toContain("g.date::date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date");
    expect(sql).toContain("g.type = 'club' OR g.date IS NULL OR g.is_recurring_weekly = TRUE");
    // an event of a club that is gone
    expect(sql).toContain("pc.approval_status = 'approved'");
    expect(sql).toContain('pc.deleted_at IS NULL');
  });
});

// Nobody is taken into a cancelled/deleted event or one whose club is gone
// (16.11.2026) — the accept is refused before any transaction starts.
describe('accepting into an event that no longer happens', () => {
  const req = (action) => ({
    params: { id: '1', requestId: '50' }, body: { action }, userId: 7,
    app: { get: vi.fn(() => ioMock) },
  });

  it.each([
    [{ owner_id: 7, name: 'Abgesagt', is_live: false, club_live: true }, 'GROUP_GONE'],
    [{ owner_id: 7, name: 'Club weg', is_live: true, club_live: false }, 'CLUB_GONE'],
  ])('handleJoinRequest accept → 410 %j', async (row, code) => {
    const { default: db } = await import('../../src/config/database.js');
    db.pool.connect.mockClear();
    scenario.liveRow = row;
    scenario.request = { user_id: 9, status: 'pending' };
    const res = makeRes();
    await handleJoinRequest(req('accept'), res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
    expect(db.pool.connect).not.toHaveBeenCalled();
    const lookup = db.query.mock.calls.find(c => c[0].includes('AS is_live'))[0];
    expect(lookup).toContain('g.is_active IS TRUE');
    expect(lookup).toContain("pc.approval_status = 'approved'");
  });

  it('bulk "Alle annehmen" follows the same rule', async () => {
    const { default: db } = await import('../../src/config/database.js');
    db.pool.connect.mockClear();
    scenario.liveRow = { owner_id: 7, name: 'Abgesagt', is_live: false, club_live: true };
    const res = makeRes();
    await bulkAcceptJoinRequests({ ...req('accept'), body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'GROUP_GONE' }));
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('only the owner learns about it — a stranger still gets the plain 403', async () => {
    scenario.liveRow = { owner_id: 3, name: 'Abgesagt', is_live: false, club_live: true };
    scenario.request = { user_id: 9, status: 'pending' };
    const res = makeRes();
    await handleJoinRequest(req('accept'), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
