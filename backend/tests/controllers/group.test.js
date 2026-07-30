import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// db.query dispatches on SQL text; each test programs the scenario via the
// mutable `scenario` object below.
const scenario = {
  group: { type: 'group', is_private: false }, // row returned for the groups lookup
  isMember: false,
  isAdmin: false,
  roster: [],
};

const makeRosterRow = (i) => ({
  id: i,
  name: `User ${i}`,
  avatar_url: `https://cdn.example/u${i}.jpg`,
  bio: `bio ${i}`,
  location: 'Wien',
  is_trusted_user: i === 1,
  role: i === 1 ? 'owner' : 'member',
  joined_at: `2026-01-0${i}`,
  age: 20 + i,
});

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text) => {
      if (text.includes('FROM groups WHERE id')) {
        return { rows: scenario.group ? [scenario.group] : [] };
      }
      if (text.includes('FROM group_members WHERE group_id')) {
        return { rows: scenario.isMember ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('JOIN users u ON gm.user_id = u.id')) {
        return { rows: scenario.roster };
      }
      if (text.includes('SELECT is_admin')) {
        return { rows: [{ is_admin: scenario.isAdmin }] };
      }
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

// Pro flag is controlled per-test through this mock.
const isUserProMock = vi.fn(async () => false);
vi.mock('../../src/controllers/subscriptionController.js', () => ({
  isUserPro: (...args) => isUserProMock(...args),
}));

const { getGroupMembers } = await import('../../src/controllers/groupController.js');

// ── Helpers ───────────────────────────────────────────────────────────────
beforeEach(() => {
  scenario.group = { type: 'group', is_private: false };
  scenario.isMember = false;
  scenario.isAdmin = false;
  scenario.roster = [1, 2, 3, 4, 5].map(makeRosterRow);
  isUserProMock.mockReset();
  isUserProMock.mockResolvedValue(false);
});

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const call = async (userId = 99) => {
  const res = makeRes();
  await getGroupMembers({ params: { id: '1' }, userId }, res);
  return res;
};

// ── Tests ─────────────────────────────────────────────────────────────────
describe('getGroupMembers — Pro gate matrix', () => {
  it('gates a plain non-member to the first 3 members with total_count (NO 403, even for private groups)', async () => {
    scenario.group = { type: 'group', is_private: true };
    const res = await call();

    // Regression guard for the 2026-06-11 change: private GROUPS must not
    // 403 the roster — the Home feed shows previews to everyone anyway.
    expect(res.status).not.toHaveBeenCalledWith(403);
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(true);
    expect(payload.total_count).toBe(5);
    expect(payload.members).toHaveLength(3);
  });

  it('strips members-only fields from the gated slice but keeps the trusted badge field', async () => {
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.members[0]).toEqual({
      id: 1,
      name: 'User 1',
      avatar_url: 'https://cdn.example/u1.jpg',
      age: 21,
      is_trusted_user: true,
    });
    expect(payload.members[0]).not.toHaveProperty('bio');
    expect(payload.members[0]).not.toHaveProperty('location');
    expect(payload.members[0]).not.toHaveProperty('role');
    expect(payload.members[0]).not.toHaveProperty('joined_at');
  });

  // 2026-07-02: the full GROUP roster is Pro-only — a plain (non-Pro) member no
  // longer bypasses the gate. Clubs still let members through (see below).
  it('gates a plain (non-Pro) GROUP member too — the full roster is Pro-only', async () => {
    scenario.isMember = true;
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(true);
    expect(payload.members).toHaveLength(3);
    expect(payload.members[0]).not.toHaveProperty('bio');
  });

  it('returns the full ungated roster to a Pro group member', async () => {
    scenario.isMember = true;
    isUserProMock.mockResolvedValue(true);
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(false);
    expect(payload.members).toHaveLength(5);
    expect(payload.members[0]).toHaveProperty('bio');
  });

  it('returns the full ungated roster to a Pro non-member', async () => {
    isUserProMock.mockResolvedValue(true);
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(false);
    expect(payload.members).toHaveLength(5);
  });

  it('returns the full ungated roster to an admin non-member', async () => {
    scenario.isAdmin = true;
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(false);
    expect(payload.members).toHaveLength(5);
  });

  // 2026-07-30: the OWNER always sees + manages their own full roster, even
  // without Pro — otherwise an organiser can't remove no-shows (Lea's request).
  it('returns the full ungated roster to the non-Pro OWNER of their own group', async () => {
    scenario.group = { type: 'group', is_private: false, owner_id: 99 };
    const res = await call(99);
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(false);
    expect(payload.members).toHaveLength(5);
    expect(payload.members[0]).toHaveProperty('bio');
  });

  it('still 403s non-members on PRIVATE CLUBS (clubs resolve through this route too)', async () => {
    scenario.group = { type: 'club', is_private: true };
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('lets members through to a private club roster', async () => {
    scenario.group = { type: 'club', is_private: true };
    scenario.isMember = true;
    const res = await call();
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].gated).toBe(false);
  });

  it('404s for deleted/nonexistent groups before any member logic', async () => {
    scenario.group = null;
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('treats the guest token (userId 0) as a gated viewer without calling isUserPro', async () => {
    const res = await call(0);
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(true);
    expect(payload.members).toHaveLength(3);
    expect(isUserProMock).not.toHaveBeenCalled();
  });
});
