import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Pool queries dispatch on SQL text; each test programs the scenario below.
// The PUT runs on a dedicated client (db.pool.connect) whose statements are
// recorded in order — the transaction shape is the thing under test.
const scenario = {
  publicRows: [],          // rows of the shared featured SELECT
  publicFail: null,        // error the featured SELECT throws
  memberOf: [],            // group_ids the caller is a member of
  requests: [],            // group_join_requests rows of the caller
  flagsFail: false,        // per-caller lookups throw
  adminRows: [],           // rows of the admin list SELECT
  adminFail: null,
  aliveIds: null,          // ids the alive check returns (null = all requested)
  clientFailOn: null,      // { match: RegExp, err } — make a tx statement throw
};
const txLog = [];          // [{ sql, params }] of the PUT's client

const featuredSelect = (sql) => /FROM featured_clubs f\s+JOIN groups g ON g\.id = f\.club_id\s+LEFT JOIN users u/.test(sql);
const adminSelect = (sql) => /COALESCE\(\(/.test(sql) && /FROM featured_clubs f/.test(sql);

vi.mock('../../src/config/database.js', () => {
  const client = {
    query: vi.fn(async (sql, params) => {
      txLog.push({ sql, params });
      if (scenario.clientFailOn && scenario.clientFailOn.match.test(sql)) throw scenario.clientFailOn.err;
      if (/SELECT g\.id FROM groups g WHERE g\.id = ANY/.test(sql)) {
        const ids = scenario.aliveIds ?? params[0];
        return { rows: ids.map((id) => ({ id })) };
      }
      if (adminSelect(sql)) return { rows: scenario.adminRows };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(async (sql) => {
        if (featuredSelect(sql)) {
          if (scenario.publicFail) throw scenario.publicFail;
          return { rows: scenario.publicRows };
        }
        if (adminSelect(sql)) {
          if (scenario.adminFail) throw scenario.adminFail;
          return { rows: scenario.adminRows };
        }
        if (/FROM group_members WHERE user_id/.test(sql)) {
          if (scenario.flagsFail) throw new Error('boom');
          return { rows: scenario.memberOf.map((group_id) => ({ group_id })) };
        }
        if (/FROM group_join_requests/.test(sql)) {
          if (scenario.flagsFail) throw new Error('boom');
          return { rows: scenario.requests };
        }
        return { rows: [] };
      }),
      pool: { connect: vi.fn(async () => client) },
      __client: client,
    },
  };
});

const { default: db } = await import('../../src/config/database.js');
const cache = await import('../../src/utils/cache.js');
const {
  getFeaturedClubs, getFeaturedClubsAdmin, setFeaturedClubs, parseClubIds,
  FEATURED_CLUBS_KEY, MAX_FEATURED_CLUBS,
} = await import('../../src/controllers/featuredClubController.js');

const tableMissing = () => Object.assign(new Error('relation "featured_clubs" does not exist'), { code: '42P01' });

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const getPublic = async (userId) => { const res = makeRes(); await getFeaturedClubs({ userId }, res); return res; };
const getAdmin = async () => { const res = makeRes(); await getFeaturedClubsAdmin({ userId: 1 }, res); return res; };
const put = async (clubIds, extra = {}) => {
  const res = makeRes();
  await setFeaturedClubs({ userId: 1, body: { clubIds, ...extra } }, res);
  return res;
};
const kinds = () => txLog.map(({ sql }) => {
  if (/^BEGIN/.test(sql)) return 'BEGIN';
  if (/^COMMIT/.test(sql)) return 'COMMIT';
  if (/^ROLLBACK/.test(sql)) return 'ROLLBACK';
  if (/^LOCK TABLE featured_clubs IN SHARE ROW EXCLUSIVE MODE/.test(sql)) return 'LOCK';
  if (/SELECT g\.id FROM groups g WHERE g\.id = ANY/.test(sql)) return 'ALIVE';
  if (/^DELETE FROM featured_clubs$/.test(sql.trim())) return 'DELETE';
  if (/INSERT INTO featured_clubs/.test(sql)) return 'INSERT';
  if (adminSelect(sql)) return 'READ';
  return sql;
});

const club = (id, extra = {}) => ({ id, name: `Club ${id}`, is_private: false, featured_position: id, ...extra });

beforeEach(() => {
  Object.assign(scenario, {
    publicRows: [], publicFail: null, memberOf: [], requests: [], flagsFail: false,
    adminRows: [], adminFail: null, aliveIds: null, clientFailOn: null,
  });
  txLog.length = 0;
  cache.deleteCached(FEATURED_CLUBS_KEY);
  db.query.mockClear();
  db.pool.connect.mockClear();
  db.__client.release.mockClear();
});

// ── parseClubIds ──────────────────────────────────────────────────────────
describe('parseClubIds', () => {
  it('accepts numbers and digit strings, keeps the order', () => {
    expect(parseClubIds([3, '1', 2])).toEqual([3, 1, 2]);
    expect(parseClubIds([])).toEqual([]);
    expect(parseClubIds(Array.from({ length: MAX_FEATURED_CLUBS }, (_, i) => i + 1))).toHaveLength(20);
  });

  it('refuses anything that is not ≤20 distinct positive int4 ids', () => {
    const bad = [
      undefined, null, '1,2', { 0: 1 }, [0], [-1], [1.5], ['1a'], [''], [' 1'], [null], [true],
      [1, 1], [7, '7'], ['007', 7], [2147483648], ['99999999999'],
      Array.from({ length: MAX_FEATURED_CLUBS + 1 }, (_, i) => i + 1),
    ];
    for (const raw of bad) expect(parseClubIds(raw), JSON.stringify(raw)).toBeNull();
  });
});

// ── PUT /api/admin/clubs/featured ─────────────────────────────────────────
describe('setFeaturedClubs', () => {
  it('validation 400s before any connection is taken', async () => {
    for (const clubIds of [undefined, 'x', [1, 1], [0], Array.from({ length: 21 }, (_, i) => i + 1)]) {
      const res = await put(clubIds);
      expect(res.statusCode, JSON.stringify(clubIds)).toBe(400);
      expect(res.body.code).toBe('FEATURED_INVALID');
    }
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('happy path: BEGIN, LOCK, alive check, DELETE, INSERT, read-back, COMMIT — then the cache goes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    cache.setCached(FEATURED_CLUBS_KEY, [club(9)], 30_000);
    scenario.adminRows = [{ position: 1, id: 3 }, { position: 2, id: 1 }, { position: 3, id: 2 }];
    const res = await put([3, '1', 2]);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(kinds()).toEqual(['BEGIN', 'LOCK', 'ALIVE', 'DELETE', 'INSERT', 'READ', 'COMMIT']);
    const insert = txLog.find(({ sql }) => /INSERT INTO featured_clubs/.test(sql));
    expect(insert.sql).toMatch(/unnest\(\$1::int\[\]\) WITH ORDINALITY AS v\(id, ord\)/);
    expect(insert.params).toEqual([[3, 1, 2]]);
    expect(res.body).toEqual({ clubs: scenario.adminRows, max: 20 });
    expect(cache.getCached(FEATURED_CLUBS_KEY)).toBeNull();
    expect(db.__client.release).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[admin] user 1 set featured clubs [3, 1, 2]');
    log.mockRestore();
  });

  it('[] clears the list: no alive check, no INSERT', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await put([]);
    expect(res.statusCode).toBe(200);
    expect(kinds()).toEqual(['BEGIN', 'LOCK', 'DELETE', 'READ', 'COMMIT']);
    expect(res.body).toEqual({ clubs: [], max: 20 });
    log.mockRestore();
  });

  it('a club that is not live and approved: ROLLBACK, nothing deleted, 400 with the offending ids', async () => {
    cache.setCached(FEATURED_CLUBS_KEY, [club(9)], 30_000);
    scenario.aliveIds = [1];
    const res = await put([4, 1, 5]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'FEATURED_INVALID_CLUBS', invalidIds: [4, 5] });
    expect(kinds()).toEqual(['BEGIN', 'LOCK', 'ALIVE', 'ROLLBACK']);
    expect(cache.getCached(FEATURED_CLUBS_KEY)).toEqual([club(9)]); // unchanged list, cache kept
    expect(db.__client.release).toHaveBeenCalledTimes(1);
  });

  it('table missing (boot window): ROLLBACK + 503, connection released', async () => {
    scenario.clientFailOn = { match: /^LOCK TABLE/, err: tableMissing() };
    const res = await put([1]);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('FEATURED_UNAVAILABLE');
    expect(kinds()).toEqual(['BEGIN', 'LOCK', 'ROLLBACK']);
    expect(db.__client.release).toHaveBeenCalledTimes(1);
  });

  it('a failing read-back rolls the save back instead of reporting half a success', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.clientFailOn = { match: /COALESCE\(\(/, err: new Error('read failed') };
    const res = await put([1, 2]);
    expect(res.statusCode).toBe(500);
    expect(kinds()).toEqual(['BEGIN', 'LOCK', 'ALIVE', 'DELETE', 'INSERT', 'READ', 'ROLLBACK']);
    expect(db.__client.release).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

// ── GET /api/admin/clubs/featured ─────────────────────────────────────────
describe('getFeaturedClubsAdmin', () => {
  it('returns every curated club with its liveness, and the cap', async () => {
    scenario.adminRows = [{ position: 1, id: 3, alive: true }, { position: 2, id: 8, alive: false }];
    const res = await getAdmin();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ clubs: scenario.adminRows, max: 20 });
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY f\.position ASC/);
    expect(sql).toMatch(/g\.deleted_at IS NOT NULL\) AS is_deleted/);
  });

  it('table missing → 503 FEATURED_UNAVAILABLE', async () => {
    scenario.adminFail = tableMissing();
    const res = await getAdmin();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('FEATURED_UNAVAILABLE');
  });
});

// ── GET /api/clubs/featured (public) ──────────────────────────────────────
describe('getFeaturedClubs', () => {
  it('anonymous: a bare array in the curated order, no per-caller lookups, served from cache next time', async () => {
    scenario.publicRows = [club(3), club(1), club(2)];
    const res = await getPublic(null);
    expect(res.statusCode).toBe(200);
    expect(res.body.map((c) => c.id)).toEqual([3, 1, 2]);
    expect(res.body[0]).not.toHaveProperty('is_member');
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY f\.position ASC/);
    expect(sql).toMatch(/LIMIT 20/);
    expect(sql).toMatch(/g\.approval_status = 'approved'/);   // clubAliveSql
    expect(sql).toMatch(/g\.deleted_at IS NULL/);
    expect(sql).toMatch(/AS member_previews/);                 // same card columns as getClubs

    await getPublic(undefined);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('per-caller flags go onto clones — one user\'s membership never reaches another', async () => {
    scenario.publicRows = [club(1), club(2, { is_private: true }), club(3, { is_private: true })];
    scenario.memberOf = [1];
    scenario.requests = [
      { group_id: 2, status: 'pending', rejected_count: 0 },
      { group_id: 3, status: 'rejected', rejected_count: 2 },
    ];
    const a = await getPublic(7);
    expect(a.body.map((c) => [c.id, c.is_member, c.join_request_status, c.join_request_blocked])).toEqual([
      [1, true, null, false],
      [2, false, 'pending', false],
      [3, false, 'rejected', true],
    ]);
    const [members, requests] = db.query.mock.calls.slice(1).map((c) => c[1]);
    expect(members).toEqual([7, [1, 2, 3]]);
    expect(requests).toEqual([7, [1, 2, 3]]);

    // The cached rows were not touched...
    expect(cache.getCached(FEATURED_CLUBS_KEY)[0]).not.toHaveProperty('is_member');
    // ...so user B, with no history, sees neutral buttons.
    scenario.memberOf = [];
    scenario.requests = [];
    const b = await getPublic(8);
    expect(b.body.map((c) => c.is_member)).toEqual([false, false, false]);
    expect(b.body.map((c) => c.join_request_blocked)).toEqual([false, false, false]);
  });

  it('only a PRIVATE club has an attempt budget to exhaust', async () => {
    scenario.publicRows = [club(4, { is_private: false })];
    scenario.requests = [{ group_id: 4, status: 'rejected', rejected_count: 5 }];
    const res = await getPublic(7);
    expect(res.body[0].join_request_blocked).toBe(false);
  });

  it('failing per-caller lookups degrade to the plain rows, never a 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.publicRows = [club(1)];
    scenario.flagsFail = true;
    const res = await getPublic(7);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([club(1)]);
    err.mockRestore();
  });

  it('table or column missing (boot window) → 200 [] and nothing cached', async () => {
    for (const code of ['42P01', '42703']) {
      scenario.publicFail = Object.assign(new Error('missing'), { code });
      const res = await getPublic(7);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([]);
      expect(cache.getCached(FEATURED_CLUBS_KEY)).toBeNull();
    }
    // The table appears → the very next request sees the list.
    scenario.publicFail = null;
    scenario.publicRows = [club(1)];
    expect((await getPublic(null)).body).toEqual([club(1)]);
  });

  it('any other failure is a 500 (the client skips the page on any error)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.publicFail = new Error('connection reset');
    const res = await getPublic(null);
    expect(res.statusCode).toBe(500);
    err.mockRestore();
  });

  it('shares the clubs: cache namespace, so every club write that busts it busts this too', () => {
    expect(FEATURED_CLUBS_KEY.startsWith('clubs:')).toBe(true);
    cache.setCached(FEATURED_CLUBS_KEY, [club(1)], 30_000);
    cache.invalidatePrefix('clubs:');
    expect(cache.getCached(FEATURED_CLUBS_KEY)).toBeNull();
  });
});
