import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/admin/stats gained the "Was trifft zu?" distribution (onboarding
// 2026-10). The stats are ONE Promise.all, so a single failing query used to
// 500 the whole dashboard — the new query must fail on its own.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureMessage: vi.fn(), captureException: vi.fn() } }));
vi.mock('../../src/socket.js', () => ({ revokeUserSessions: vi.fn() }));
vi.mock('../../src/jobs/backup.js', () => ({
  isBackupConfigured: () => false, missingBackupEnv: () => [], listBackupObjects: vi.fn(), DB_BACKUP_PREFIX: 'db/',
}));
vi.mock('geoip-lite', () => ({ default: { lookup: () => null } }));

const db = (await import('../../src/config/database.js')).default;
const { getStats } = await import('../../src/controllers/adminController.js');
const { MOTIVATION_KEYS } = await import('../../src/utils/motivations.js');

const isMotivationsQuery = (sql) => /json_object_agg/.test(sql);
const arm = (motivations) => vi.mocked(db.query).mockImplementation(async (sql) => {
  if (isMotivationsQuery(sql)) return motivations();
  return { rows: [{}] };
});
const run = async () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  await getStats({}, res);
  return res;
};

beforeEach(() => vi.mocked(db.query).mockReset());

describe('getStats — motivations', () => {
  it('passes the allowlist as $1 and returns { answered, counts }', async () => {
    const row = { answered: 3, counts: { new_in_town: 1, new_friends: 3, activity_partners: 0, discover_places: 2, more_active: 0 } };
    arm(async () => ({ rows: [row] }));
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.motivations).toEqual(row);
    const call = vi.mocked(db.query).mock.calls.find(([sql]) => isMotivationsQuery(sql));
    expect(call[1]).toEqual([MOTIVATION_KEYS]);
    // jsonb_array_length throws on a non-array: it must sit behind the CASE.
    expect(call[0]).toMatch(/CASE WHEN jsonb_typeof\(motivations\) = 'array'\s+THEN jsonb_array_length\(motivations\)/);
  });

  it('a missing column (boot window) → motivations: null, the rest of the dashboard still loads', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    arm(async () => { throw Object.assign(new Error('column "motivations" does not exist'), { code: '42703' }); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.motivations).toBeNull();
    expect(res.body).toHaveProperty('users');
    expect(err).not.toHaveBeenCalled();           // expected in the window — not logged
    err.mockRestore();
  });

  it('any other failure is logged but still does not take the dashboard down', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    arm(async () => { throw new Error('syntax error'); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.motivations).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

// JAMIE Pro at the top of the dashboard (Tobi, 16.11.2026: „wie viele Leute
// eine Pro-Mitgliedschaft abgeschlossen haben (ganz oben)“). The mock cannot
// run the SQL (the real-Postgres smoke suite does): this pins the response
// shape, the rules written into the query, and that it fails on its own.
describe('getStats — pro', () => {
  const isProQuery = (sql) => /FROM subscriptions s\b/.test(sql);
  const armPro = (pro) => vi.mocked(db.query).mockImplementation(async (sql) => {
    if (isProQuery(sql)) return pro();
    return { rows: [{}] };
  });
  const proSql = () => vi.mocked(db.query).mock.calls.map(([sql]) => sql).find(isProQuery);

  it('nests the flat row: by_store groups the three channels, every other figure passes through', async () => {
    armPro(async () => ({ rows: [{
      active: 12, trialing: 3, canceling: 2, apple: 9, google: 1, web: 2,
      ever: 20, new_7d: 4, new_30d: 7, team_active: 3, sandbox_active: 1,
    }] }));
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.pro).toEqual({
      active: 12, trialing: 3, canceling: 2,
      by_store: { apple: 9, google: 1, web: 2 },
      ever: 20, new_7d: 4, new_30d: 7, team_active: 3, sandbox_active: 1,
    });
  });

  it('"Pro now" is isUserPro\'s rule; „jemals“ keeps lapsed store subs, never abandoned checkouts or double payments', async () => {
    armPro(async () => ({ rows: [{}] }));
    await run();
    const sql = proSql();
    expect(sql).toMatch(/s\.status IN \('active','trialing','canceling'\) AND s\.current_period_end > NOW\(\)\s+AS pro_now/);
    const wasPro = sql.match(/s\.status IN \(([^)]*)\)\s+AS was_pro/)[1];
    for (const s of ['active', 'trialing', 'canceling', 'canceled', 'past_due', 'expired', 'revoked', 'paused']) {
      expect(wasPro).toContain(`'${s}'`);
    }
    for (const s of ['pending', 'inactive', 'duplicate']) expect(wasPro).not.toContain(`'${s}'`);
  });

  it('team accounts and store test purchases are left out of the headline, counted per DISTINCT user', async () => {
    armPro(async () => ({ rows: [{}] }));
    await run();
    const sql = proSql();
    expect(sql).toMatch(/u\.is_admin\s+AS team/);
    expect(sql).toMatch(/COALESCE\(rx\.environment <> 'Production', FALSE\)\s+AS sandbox/);
    expect(sql).toMatch(/counted AS \(SELECT \* FROM subs WHERE NOT team AND NOT sandbox\)/);
    for (const k of ['active', 'trialing', 'canceling', 'apple', 'google', 'web']) {
      expect(sql).toMatch(new RegExp(String.raw`COUNT\(DISTINCT user_id\) FILTER \(WHERE pro_now[^)]*\)::int\s+AS ${k}\b`));
    }
  });

  it('no subscriptions table yet (42P01) → pro: null, not logged, the rest of the dashboard loads', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    armPro(async () => { throw Object.assign(new Error('relation "subscriptions" does not exist'), { code: '42P01' }); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.pro).toBeNull();
    expect(res.body).toHaveProperty('users');
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('any other failure is logged, pro: null, and the dashboard still loads', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    armPro(async () => { throw new Error('syntax error'); });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.pro).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
