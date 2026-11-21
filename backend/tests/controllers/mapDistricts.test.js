import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// GET /api/map/districts — the website's „Seit dem Start: N Treffen in M von
// 23 Bezirken“ (Tobi 21.11.2026). This pins the contract of the two queries
// and the tally; the real-Postgres smoke test runs them against the edge
// cases (one member, cancelled, deleted, private, outside Vienna, dead club).
const scenario = { past: [], today: [], fail: null };
const queries = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (scenario.fail) throw scenario.fail;
      return { rows: text.includes('members_count >= 2') ? scenario.past : scenario.today };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { getDistrictStats } = await import('../../src/controllers/mapController.js');
const { parentClubGateSql } = await import('../../src/utils/clubGate.js');
const { deleteCached } = await import('../../src/utils/cache.js');
const { VIENNA_BBOX } = await import('../../src/utils/viennaDistricts.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
};
const call = async () => {
  const res = makeRes();
  await getDistrictStats({}, res);
  return res;
};
const zeros = () => new Array(23).fill(0);
const pastSql = () => queries.find((q) => q.text.includes('members_count >= 2')).text;
const todaySql = () => queries.find((q) => !q.text.includes('members_count >= 2')).text;

beforeEach(() => {
  scenario.past = [];
  scenario.today = [];
  scenario.fail = null;
  queries.length = 0;
  deleteCached('map:districts');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getDistrictStats', () => {
  it('tallies per district, sums grouped points and ignores everything outside Vienna', async () => {
    scenario.past = [
      { lat: 48.2085, lng: 16.3731, n: 3 }, // 1. Innere Stadt
      { lat: 48.2081, lng: 16.3712, n: 2 }, // 1. again, another point
      { lat: 48.1845, lng: 16.3122, n: 1 }, // 13. Hietzing
      { lat: 48.1194, lng: 16.2654, n: 7 }, // Perchtoldsdorf: inside the bbox, not Vienna
    ];
    scenario.today = [{ lat: 48.2403, lng: 16.4103, n: 4 }]; // 22. Donaustadt

    const res = await call();
    expect(res.statusCode).toBe(200);
    const since = zeros(); since[0] = 5; since[12] = 1;
    const today = zeros(); today[21] = 4;
    expect(res.body).toEqual({
      sinceStart: { total: 6, districts: 2, byDistrict: since },
      today: { total: 4, districts: 1, byDistrict: today },
    });
    expect(res.headers['Cache-Control']).toBe('public, max-age=600');
  });

  it('answers zeros when nothing happened yet', async () => {
    const res = await call();
    expect(res.body.sinceStart).toEqual({ total: 0, districts: 0, byDistrict: zeros() });
    expect(res.body.today).toEqual({ total: 0, districts: 0, byDistrict: zeros() });
  });

  it('since the start: taken place, two people, not cancelled or deleted; private ones count', () => call().then(() => {
    const sql = pastSql();
    expect(sql).toContain('g.date < CURRENT_DATE');
    expect(sql).toContain('g.members_count >= 2');
    expect(sql).toContain('g.is_active = TRUE');
    expect(sql).toContain('g.deleted_at IS NULL');
    expect(sql).toContain("g.approval_status = 'approved'");
    expect(sql).toContain("g.type <> 'club'");
    expect(sql).toContain(parentClubGateSql('g'));
    expect(sql).not.toContain('is_private');
  }));

  it('today: the same rows the guest map shows under „Heute“ (public only)', () => call().then(() => {
    const sql = todaySql();
    expect(sql).toContain("g.date >= CURRENT_DATE AND g.date < CURRENT_DATE + INTERVAL '1 day'");
    expect(sql).toContain('g.is_private IS NOT TRUE');
    expect(sql).toContain(parentClubGateSql('g', { requirePublic: true }));
    expect(sql).not.toContain('members_count');
  }));

  it('pre-filters by the city bounding box and groups by rounded point', () => call().then(() => {
    for (const q of queries) {
      expect(q.params).toEqual([VIENNA_BBOX.minLat, VIENNA_BBOX.maxLat, VIENNA_BBOX.minLng, VIENNA_BBOX.maxLng]);
      expect(q.text).toContain('GROUP BY 1, 2');
    }
  }));

  it('serves the cache for 10 minutes: one round of queries for many visitors', async () => {
    scenario.past = [{ lat: 48.2085, lng: 16.3731, n: 1 }];
    await call();
    expect(queries).toHaveLength(2);
    const second = await call();
    expect(queries).toHaveLength(2);
    expect(second.body.sinceStart.total).toBe(1);
  });

  it('a database error is a 500 and nothing is cached', async () => {
    scenario.fail = new Error('connection terminated');
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Zahlen konnten nicht geladen werden' });
    scenario.fail = null;
    await call();
    expect(queries).toHaveLength(4); // asked again, not served from the cache
  });
});
