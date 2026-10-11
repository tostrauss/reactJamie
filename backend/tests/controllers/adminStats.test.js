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
