import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// „Demnächst dabei“ (Tina 16.11.2026, PR4): GET /api/groups/user/upcoming.
// The rules live in one SQL statement, so this pins its contract; the
// real-Postgres smoke test runs it against every edge case (today, yesterday,
// weekly, cancelled, dead club, requests, waitlist, partner, co-manager).
const scenario = { rows: [], fail: null };
const queries = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (scenario.fail) throw scenario.fail;
      return { rows: scenario.rows };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/subscriptionController.js', () => ({ isUserPro: vi.fn(async () => false) }));

const { getMyUpcomingEvents, upcomingKind } = await import('../../src/controllers/groupController.js');
const { partnerSql } = await import('../../src/utils/clubGate.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};

beforeEach(() => {
  scenario.rows = [];
  scenario.fail = null;
  queries.length = 0;
});

describe('upcomingKind (the subline: „☆ Partner“ | „Community“ | „Gruppe“)', () => {
  it('partner wins, any other club event is a community one, a meetup a group', () => {
    expect(upcomingKind({ type: 'event', is_partner: true })).toBe('partner');
    expect(upcomingKind({ type: 'event', is_partner: false })).toBe('community');
    expect(upcomingKind({ type: 'group', is_partner: false })).toBe('group');
  });
});

describe('GET /api/groups/user/upcoming (getMyUpcomingEvents)', () => {
  it('one query for the caller, every row with its kind', async () => {
    scenario.rows = [
      { id: 1, type: 'event', is_partner: true },
      { id: 2, type: 'event', is_partner: false },
      { id: 3, type: 'group', is_partner: false },
    ];
    const res = makeRes();
    await getMyUpcomingEvents({ userId: 7 }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.map((r) => r.kind)).toEqual(['partner', 'community', 'group']);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([7]);
  });

  it('memberships only, still happening, its parent club alive — but its approval is no condition', async () => {
    await getMyUpcomingEvents({ userId: 7 }, makeRes());
    // The candidate set — everything after it only decorates the page.
    const mine = queries[0].text.match(/WITH mine AS \(([\s\S]*?)\),\s+page AS/)[1];
    expect(mine).toMatch(/FROM group_members gm\s+JOIN groups g ON g\.id = gm\.group_id/);
    expect(mine).toContain('gm.user_id = $1');
    expect(mine).not.toContain('group_join_requests'); // an open request is no membership
    expect(mine).not.toContain('group_waitlist');      // nor is a waitlist seat
    expect(mine).toContain("g.type IN ('group', 'event')");
    expect(mine).toContain('g.is_active = TRUE');
    expect(mine).toContain('g.deleted_at IS NULL');
    expect(mine).toContain('g.did_not_take_place IS NOT TRUE');
    expect(mine).toContain('(g.parent_club_id IS NULL OR (pc.is_active = TRUE AND pc.deleted_at IS NULL))');
    expect(mine).not.toContain('approval_status');     // a founder's pending club keeps its events
  });

  it('until the end of the Vienna day, weekly by the next occurrence, next first, at most 30', async () => {
    await getMyUpcomingEvents({ userId: 7 }, makeRes());
    const sql = queries[0].text;
    expect(sql).toContain('604800.0');                 // NEXT_AT_SQL rolls weekly series on
    expect(sql).toContain("m.next_at::date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date");
    expect(sql).toContain('m.next_at IS NULL');        // undated legacy rows are ongoing
    expect(sql).toContain('LIMIT 30');
    expect(sql).toMatch(/ORDER BY page\.next_at ASC NULLS LAST, g\.id\s*$/);
  });

  it('is_own, can_edit like the edit endpoints, the one partner rule, requests for own entries only', async () => {
    await getMyUpcomingEvents({ userId: 7 }, makeRes());
    const sql = queries[0].text;
    expect(sql).toContain('(g.owner_id = $1) AS is_own');
    expect(sql).toMatch(/\(g\.owner_id = \$1\s+OR \(g\.type = 'event' AND g\.parent_club_id IS NOT NULL\s+AND \(pc\.owner_id = \$1 OR EXISTS/);
    expect(sql).toContain("cm.group_id = g.parent_club_id AND cm.user_id = $1 AND cm.role = 'admin'");
    expect(sql).toContain(`${partnerSql('g')} AS is_partner`);
    expect(sql).toMatch(/CASE WHEN g\.owner_id = \$1\s+THEN \(SELECT COUNT\(\*\)::int FROM group_join_requests jr/);
  });

  it('a failure is a 500, never a half list', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.fail = new Error('boom');
    const res = makeRes();
    await getMyUpcomingEvents({ userId: 7 }, res);
    expect(res.statusCode).toBe(500);
    err.mockRestore();
  });
});
