import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// The profile's „Clubs & Communities“ (Tina 16.11.2026, PR3): GET
// /clubs/user/joined gains the bubble fields additively, PUT
// /users/me/clubs/order stores the caller's order. The PUT runs on a
// dedicated client whose statements are recorded in order — the transaction
// shape is the thing under test (pattern of featuredClubs.test.js). The real
// UPDATE … FROM unnest WITH ORDINALITY runs in the Postgres smoke test.
const scenario = {
  rows: [],             // rows the club list SELECT returns
  listFail: null,       // error the FIRST list SELECT on the pool throws
  clientFailOn: null,   // { match: RegExp, err } — make a tx statement throw
};
const poolLog = [];
const txLog = [];

vi.mock('../../src/config/database.js', () => {
  const client = {
    query: vi.fn(async (sql, params) => {
      txLog.push({ sql, params });
      if (scenario.clientFailOn && scenario.clientFailOn.match.test(sql)) throw scenario.clientFailOn.err;
      if (/FROM group_members gm\s+JOIN groups g/.test(sql)) return { rows: scenario.rows };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(async (sql, params) => {
        poolLog.push({ sql, params });
        if (scenario.listFail && poolLog.length === 1) throw scenario.listFail;
        return { rows: scenario.rows };
      }),
      pool: { connect: vi.fn(async () => client) },
      __client: client,
    },
  };
});
vi.mock('../../src/config/sentry.js', () => ({ Sentry: {}, initSentry: vi.fn() }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/groupController.js', () => ({
  notifyJoinRequest: vi.fn(), notifyGroupJoin: vi.fn(), evictFromRoom: vi.fn(),
  creatorHasAvatar: vi.fn(async () => true), promoteFromWaitlist: vi.fn(),
  promoteWaitlistSeats: vi.fn(), formatEventWhen: vi.fn(() => ''),
}));
vi.mock('../../src/controllers/subscriptionController.js', () => ({ isUserPro: vi.fn(async () => false) }));
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUser: vi.fn(), sendPushToUsers: vi.fn(), sendPushToAdmins: vi.fn(),
}));

const { default: db } = await import('../../src/config/database.js');
const {
  getUserClubs, setMyClubOrder, parseProfileClubOrder, MAX_PROFILE_CLUB_ORDER,
} = await import('../../src/controllers/clubController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const columnMissing = () => Object.assign(new Error('column gm.profile_position does not exist'), { code: '42703' });

beforeEach(() => {
  scenario.rows = [];
  scenario.listFail = null;
  scenario.clientFailOn = null;
  poolLog.length = 0;
  txLog.length = 0;
  db.__client.release.mockClear();
});

describe('parseProfileClubOrder', () => {
  it('takes positive integer ids (numbers or digit strings) in the order sent', () => {
    expect(parseProfileClubOrder([3, '12', 7])).toEqual([3, 12, 7]);
    expect(parseProfileClubOrder([])).toEqual([]);
  });

  it('refuses anything off instead of „fixing“ it — the order is the point', () => {
    for (const bad of [undefined, null, 'x', { 0: 1 }, [1, 1], [0], [-2], [1.5], ['1a'], [null], [2147483648]]) {
      expect(parseProfileClubOrder(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(MAX_PROFILE_CLUB_ORDER).toBe(200);
    expect(parseProfileClubOrder(Array.from({ length: 200 }, (_, i) => i + 1))).toHaveLength(200);
    expect(parseProfileClubOrder(Array.from({ length: 201 }, (_, i) => i + 1))).toBeNull();
  });
});

describe('GET /clubs/user/joined (getUserClubs)', () => {
  it('adds the bubble fields and keeps Home\'s newest-first order', async () => {
    scenario.rows = [{ id: 1, is_own: true, profile_position: null }];
    const res = makeRes();
    await getUserClubs({ userId: 5 }, res);
    expect(res.body).toEqual(scenario.rows);
    const { sql, params } = poolLog[0];
    expect(params).toEqual([5, 'club']);
    expect(sql).toContain('SELECT g.*, u.name as owner_name, gm.role');
    expect(sql).toContain('gm.joined_at');
    expect(sql).toContain('gm.profile_position');
    expect(sql).toContain('(g.owner_id = $1) AS is_own');
    expect(sql).toMatch(/CASE WHEN g\.owner_id = \$1\s+THEN \(SELECT COUNT\(\*\)::int FROM group_join_requests jr/);
    expect(sql).toContain("jr.status = 'pending'");
    expect(sql).toContain('ORDER BY gm.joined_at DESC');
  });

  it('before the migration (42703) the same list, profile_position NULL', async () => {
    scenario.listFail = columnMissing();
    const res = makeRes();
    await getUserClubs({ userId: 5 }, res);
    expect(res.statusCode).toBe(200);
    expect(poolLog).toHaveLength(2);
    expect(poolLog[1].sql).toContain('NULL::smallint AS profile_position');
    expect(poolLog[1].sql).not.toContain('gm.profile_position');
  });

  it('any other error is a 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.listFail = new Error('boom');
    const res = makeRes();
    await getUserClubs({ userId: 5 }, res);
    expect(res.statusCode).toBe(500);
    expect(poolLog).toHaveLength(1);
    err.mockRestore();
  });
});

describe('PUT /users/me/clubs/order (setMyClubOrder)', () => {
  it('a bad list is a 400 and touches nothing', async () => {
    const res = makeRes();
    await setMyClubOrder({ userId: 5, body: { clubIds: [4, 4] } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('CLUB_ORDER_INVALID');
    expect(txLog).toHaveLength(0);
  });

  it('one transaction: forget the old order, number the joined clubs, never the own ones, read back, commit', async () => {
    scenario.rows = [{ id: 4, profile_position: 1 }];
    const res = makeRes();
    await setMyClubOrder({ userId: 5, body: { clubIds: [4, '9', 2] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(scenario.rows);

    expect(txLog.map((s) => s.sql.trim().split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'BEGIN', 'UPDATE group_members', 'UPDATE group_members', 'SELECT g.*,', 'COMMIT',
    ]);
    const [, reset, order, readBack] = txLog;
    expect(reset.sql).toContain('SET profile_position = NULL WHERE user_id = $1');
    expect(reset.params).toEqual([5]);
    expect(order.params).toEqual([5, [4, 9, 2]]);
    expect(order.sql).toContain('unnest($2::int[]) WITH ORDINALITY AS v(id, ord)');
    expect(order.sql).toContain('SET profile_position = v.ord');
    expect(order.sql).toContain("g.type = 'club'");
    expect(order.sql).toContain('g.owner_id <> $1');
    expect(readBack.params).toEqual([5, 'club']);
    expect(readBack.sql).toContain('gm.profile_position');
    expect(db.__client.release).toHaveBeenCalledTimes(1);
  });

  it('[] forgets the order without a numbering UPDATE', async () => {
    const res = makeRes();
    await setMyClubOrder({ userId: 5, body: { clubIds: [] } }, res);
    expect(res.statusCode).toBe(200);
    expect(txLog.filter((s) => s.sql.includes('WITH ORDINALITY'))).toHaveLength(0);
    expect(txLog.at(-1).sql).toBe('COMMIT');
  });

  it('before the migration (42703): ROLLBACK and a 503, never a 500', async () => {
    scenario.clientFailOn = { match: /SET profile_position = NULL/, err: columnMissing() };
    const res = makeRes();
    await setMyClubOrder({ userId: 5, body: { clubIds: [4] } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CLUB_ORDER_UNAVAILABLE');
    expect(txLog.map((s) => s.sql)).toContain('ROLLBACK');
    expect(txLog.map((s) => s.sql)).not.toContain('COMMIT');
    expect(db.__client.release).toHaveBeenCalledTimes(1);
  });

  it('any other failure rolls back with a 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.clientFailOn = { match: /WITH ORDINALITY/, err: new Error('boom') };
    const res = makeRes();
    await setMyClubOrder({ userId: 5, body: { clubIds: [4] } }, res);
    expect(res.statusCode).toBe(500);
    expect(txLog.map((s) => s.sql)).toContain('ROLLBACK');
    expect(db.__client.release).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
