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
};

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text) => {
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

const { joinGroup, getAllJoinRequests } = await import('../../src/controllers/groupController.js');
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

  it('scopes the query to entities the caller owns or co-manages', async () => {
    const { default: db } = await import('../../src/config/database.js');
    const res = makeRes();
    await getAllJoinRequests({ userId: 7 }, res);
    const call = db.query.mock.calls.find(c => c[0].includes('FROM group_join_requests jr'));
    expect(call[0]).toContain("g.owner_id = $1");
    expect(call[0]).toContain("gm.role = 'admin'");
    expect(call[1]).toEqual([7]);
  });
});
