import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// People search (GET /users/search) for the Friends tab (Tina, 22.10.2026):
// hits carry the friendship state, frozen accounts are not findable, the bio
// is an excerpt, incomplete profiles rank after complete ones. The ranking
// and the lateral run for real in the Postgres smoke; here the contract.

const scenario = { rows: [], fail: null };
const calls = [];
vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (scenario.fail) throw scenario.fail;
      return { rows: scenario.rows };
    }),
  },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { searchUsers } = await import('../../src/controllers/userController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const search = async (q, userId = 9) => {
  const res = makeRes();
  await searchUsers({ query: { q }, userId }, res);
  return res;
};

beforeEach(() => {
  calls.length = 0;
  scenario.rows = [];
  scenario.fail = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('searchUsers', () => {
  it('needs two characters and refuses more than 100', async () => {
    expect((await search('a')).body).toEqual([]);
    expect(calls).toHaveLength(0);
    const long = await search('x'.repeat(101));
    expect(long.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('passes the rows through with their friendship state', async () => {
    scenario.rows = [{ id: 4, name: 'Lena', age: 27, friend_status: 'pending_in', friendship_id: 12 }];
    const res = await search('Len');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(scenario.rows);
    expect(calls[0].params).toEqual(['%Len%', 9, 'Len%']);
  });

  it('carries the rules: active accounts, no block either way, status per direction', async () => {
    await search('Len');
    const { sql } = calls[0];
    expect(sql).toContain('users.is_active IS DISTINCT FROM FALSE');
    expect(sql).toContain("WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2)");
    expect(sql).toContain('users.id <> $2');
    expect(sql).toContain('LEFT(users.bio, 160) AS bio');
    expect(sql).toContain('EXTRACT(YEAR FROM AGE(users.date_of_birth))::int AS age');
    // rejected / expired fall through to 'none'; the id only for live rows.
    expect(sql).toContain("WHEN fs.f_status = 'pending' AND fs.f_requester = $2 THEN 'pending_out'");
    expect(sql).toContain("WHEN fs.f_status = 'pending' THEN 'pending_in'");
    expect(sql).toContain("ELSE 'none' END AS friend_status");
    expect(sql).toContain("CASE WHEN fs.f_status IN ('pending', 'accepted') THEN fs.friendship_id END AS friendship_id");
  });

  it('ranks shared groups, then prefix, then complete profiles, then the name', async () => {
    await search('Len');
    const { sql } = calls[0];
    const at = (s) => sql.indexOf(s);
    expect(at('JOIN group_members gm_them')).toBeGreaterThan(at('ORDER BY'));
    expect(at('(users.name ILIKE $3) DESC')).toBeGreaterThan(at('JOIN group_members gm_them'));
    expect(at("COALESCE(NULLIF(users.avatar_url, '') IS NOT NULL AND")).toBeGreaterThan(at('(users.name ILIKE $3) DESC'));
    expect(at('users.name ASC')).toBeGreaterThan(at('COALESCE(NULLIF(users.avatar_url'));
    expect(sql).toContain('LIMIT 30');
  });

  it('a database error is a 500', async () => {
    scenario.fail = new Error('boom');
    expect((await search('Len')).statusCode).toBe(500);
  });
});
