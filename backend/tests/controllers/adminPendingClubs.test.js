import { describe, it, expect, vi, beforeEach } from 'vitest';

// The approval queue labels each entry „Club“ or „Community“ (Tina
// 16.11.2026: „Es müsste im Admin auch als Club kommen und Community als
// Community. Derzeit kommt beides gleich.“) — so GET /api/admin/clubs/pending
// carries club_type. The real-Postgres smoke suite runs the same query.
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
const { getPendingClubs } = await import('../../src/controllers/adminController.js');

const run = async () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  await getPendingClubs({}, res);
  return res;
};

// Block body: a hook that RETURNS a function gets it called as its teardown —
// mockReset() returns the mock, and the throwing one below would run again.
beforeEach(() => { vi.mocked(db.query).mockReset(); });

describe('getPendingClubs', () => {
  it('selects club_type next to the old fields — still only pending, undeleted clubs, oldest first', async () => {
    const rows = [
      { id: 1, name: 'Café Soleá', club_type: 'official' },
      { id: 2, name: 'Lauftreff', club_type: 'community' },
    ];
    vi.mocked(db.query).mockResolvedValue({ rows });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(rows);                      // still a bare array
    const sql = vi.mocked(db.query).mock.calls[0][0];
    expect(sql).toContain('g.club_type');
    for (const col of ['g.id', 'g.name', 'g.description', 'g.category', 'g.location', 'g.image_url',
      'g.created_at', 'u.name AS owner_name', 'u.email AS owner_email']) {
      expect(sql).toContain(col);
    }
    expect(sql).toContain("g.approval_status = 'pending'");
    expect(sql).toContain('g.deleted_at IS NULL');
    expect(sql).toContain('ORDER BY g.created_at ASC');
  });

  it('a failing query is a 500, as before', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockImplementation(async () => { throw new Error('boom'); });
    const res = await run();
    expect(res.statusCode).toBe(500);
    err.mockRestore();
  });
});
