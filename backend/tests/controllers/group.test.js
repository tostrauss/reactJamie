import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// db.query dispatches on SQL text; each test programs the scenario via the
// mutable `scenario` object below.
const scenario = {
  group: { type: 'group', is_private: false }, // row returned for the groups lookup
  isMember: false,
  memberRole: 'member',   // group_members.role of the caller when isMember ('admin' = co-manager)
  isAdmin: false,
  roster: [],
  tierRows: [],           // rows of the Abzeichen-Stufen aggregate (utils/attendanceTiers.js)
  tierFail: false,        // make that aggregate throw (boot window / fresh DB)
  tierCalls: [],          // params it was called with
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
    query: vi.fn(async (text, params) => {
      // FIRST: the tier aggregate is routed on its marker, never on table names.
      if (text.includes('attendance-tiers')) {
        if (scenario.tierFail) throw Object.assign(new Error('relation "event_reviews" does not exist'), { code: '42P01' });
        scenario.tierCalls.push(params);
        return { rows: scenario.tierRows };
      }
      if (text.includes('FROM groups WHERE id')) {
        return { rows: scenario.group ? [scenario.group] : [] };
      }
      if (text.includes('FROM group_members WHERE group_id')) {
        return { rows: scenario.isMember ? [{ role: scenario.memberRole }] : [] };
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

const { getGroupMembers, formatEventWhen, isSameStoredDate } = await import('../../src/controllers/groupController.js');

// ── Helpers ───────────────────────────────────────────────────────────────
beforeEach(() => {
  scenario.group = { type: 'group', is_private: false };
  scenario.isMember = false;
  scenario.memberRole = 'member';
  scenario.isAdmin = false;
  scenario.roster = [1, 2, 3, 4, 5].map(makeRosterRow);
  scenario.tierRows = [];
  scenario.tierFail = false;
  scenario.tierCalls = [];
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
      attendance_tier: 0,
    });
    expect(payload.members[0]).not.toHaveProperty('bio');
    expect(payload.members[0]).not.toHaveProperty('location');
    expect(payload.members[0]).not.toHaveProperty('role');
    expect(payload.members[0]).not.toHaveProperty('joined_at');
  });

  // Abzeichen-Stufen (B2, 06.10.2026): the 3 visible members carry their step,
  // computed ONLY for those rows — the gate must not leak anything about the
  // members behind it.
  it('the gated slice carries the Abzeichen-Stufe of exactly the 3 visible members', async () => {
    scenario.tierRows = [
      { user_id: 2, confirmed_events: 12, confirmers: 4 },   // 🏆
      { user_id: 5, confirmed_events: 120, confirmers: 30 }, // 🎆 — but behind the gate
    ];
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.members.map(m => m.attendance_tier)).toEqual([0, 2, 0]);
    // Whitelist first, then attach: the hidden members are never even queried.
    expect(scenario.tierCalls).toEqual([[[1, 2, 3]]]);
  });

  it('ungated (owner): every member row carries the field', async () => {
    scenario.isMember = true;
    scenario.group = { type: 'group', is_private: false, owner_id: 99 };
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(false);
    expect(payload.members).toHaveLength(5);
    for (const m of payload.members) expect(m).toHaveProperty('attendance_tier', 0);
  });

  it('a failing tier lookup still answers 200 with the pre-feature shape', async () => {
    scenario.tierFail = true;
    const res = await call();
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.members[0]).not.toHaveProperty('attendance_tier');
    expect(payload.members[0]).toHaveProperty('is_trusted_user');
  });

  // 2026-09-21 (Tobi): "Alle Mitglieder sehen" is a PRO FEATURE — being a
  // member no longer lifts the gate (reverses the 2026-09-07 rule). A plain
  // member gets the same 3-preview slice as an outsider.
  it('gates a plain (non-Pro) GROUP member to the 3-preview slice', async () => {
    scenario.isMember = true;
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(true);
    expect(payload.total_count).toBe(5);
    expect(payload.members).toHaveLength(3);
    expect(payload.members[0]).not.toHaveProperty('bio');
  });

  it('returns the full ungated roster to a non-Pro CO-MANAGER (role=admin)', async () => {
    scenario.isMember = true;
    scenario.memberRole = 'admin';
    const res = await call();
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(false);
    expect(payload.members).toHaveLength(5);
    expect(payload.members[0]).toHaveProperty('bio');
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

  it('lets members past the PRIVACY 403 of a private club, but a non-Pro member still hits the Pro gate', async () => {
    scenario.group = { type: 'club', is_private: true };
    scenario.isMember = true;
    const res = await call();
    expect(res.status).not.toHaveBeenCalledWith(403);
    const payload = res.json.mock.calls[0][0];
    expect(payload.gated).toBe(true);
    expect(payload.members).toHaveLength(3);
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

// Batch 2 (2026-09-07): the wall-clock formatter behind the event-edit push.
describe('formatEventWhen', () => {
  it('formats a timed event as DD.MM. HH:MM (local-constructed Date reads back the stored wall-clock)', () => {
    expect(formatEventWhen(new Date(2026, 8, 12, 19, 5))).toBe('12.09. 19:05');
  });
  it('formats an all-day (midnight) event as DD.MM. only', () => {
    expect(formatEventWhen(new Date(2026, 8, 12, 0, 0))).toBe('12.09.');
  });
  it('returns null for a missing or invalid date', () => {
    expect(formatEventWhen(null)).toBeNull();
    expect(formatEventWhen(undefined)).toBeNull();
    expect(formatEventWhen('not-a-date')).toBeNull();
  });
});

// B2 review: GroupEdit always re-sends the stored date, so an unrelated edit of
// a PAST group must not trip the "must be in the future" check (owners used to
// move the date or tick „wöchentlich“ to get past it — and that took the
// meetup out of every attendee's Abzeichen count).
describe('isSameStoredDate', () => {
  const stored = new Date(2026, 9, 1, 0, 0); // local-constructed = the stored wall-clock
  it('a date-only payload on the stored day is the same date', () => {
    expect(isSameStoredDate('2026-10-01', stored)).toBe(true);
  });
  it('another day is a change', () => {
    expect(isSameStoredDate('2026-10-02', stored)).toBe(false);
    expect(isSameStoredDate('2026-09-30', stored)).toBe(false);
  });
  it('a timed payload must hit the stored instant exactly', () => {
    expect(isSameStoredDate(new Date(2026, 9, 1, 0, 0).toISOString(), stored)).toBe(true);
    expect(isSameStoredDate(new Date(2026, 9, 1, 18, 0).toISOString(), stored)).toBe(false);
  });
  it('nothing stored, nothing sent or garbage is never "the same"', () => {
    expect(isSameStoredDate('2026-10-01', null)).toBe(false);
    expect(isSameStoredDate('', stored)).toBe(false);
    expect(isSameStoredDate(null, stored)).toBe(false);
    expect(isSameStoredDate('kein Datum', stored)).toBe(false);
  });
});
