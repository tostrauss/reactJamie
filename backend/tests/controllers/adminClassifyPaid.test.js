import { describe, it, expect, vi, beforeEach } from 'vitest';

// „Zahlender Partner“ (Tina's document of 17.11.2026, decided by Tobi): ☆
// Partner, the yellow frame and the ✓ are for paying partners only, and
// POST /api/admin/clubs/:id/classify is the one place that sets the mark —
// with { is_paid_partner }, alone or next to club_type / category_label. Only
// an official club can carry it. The real-Postgres smoke suite runs the same
// statement; this pins the request handling around it.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureMessage: vi.fn(), captureException: vi.fn() } }));
vi.mock('../../src/socket.js', () => ({ revokeUserSessions: vi.fn() }));
vi.mock('../../src/jobs/backup.js', () => ({
  isBackupConfigured: () => false, missingBackupEnv: () => [], listBackupObjects: vi.fn(), DB_BACKUP_PREFIX: 'db/',
}));
vi.mock('geoip-lite', () => ({ default: { lookup: () => null } }));
vi.mock('../../src/utils/cache.js', () => ({
  invalidatePrefix: vi.fn(), deleteCached: vi.fn(), getCached: vi.fn(), setCached: vi.fn(),
}));

const db = (await import('../../src/config/database.js')).default;
const cache = await import('../../src/utils/cache.js');
const { classifyClub, getClubsForAdmin } = await import('../../src/controllers/adminController.js');

const run = async (fn, req) => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  await fn({ userId: 1, params: {}, query: {}, ...req }, res);
  return res;
};
const classify = (body, id = '7') => run(classifyClub, { params: { id }, body });

const CLUB = { id: 7, name: 'Café Soleá', club_type: 'official', category_label: null, approval_status: 'approved' };
const updates = () => vi.mocked(db.query).mock.calls.filter(([sql]) => /UPDATE groups/.test(sql));

let log;
beforeEach(() => {
  vi.mocked(db.query).mockReset();
  vi.mocked(cache.invalidatePrefix).mockClear();
  vi.mocked(cache.deleteCached).mockClear();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('classifyClub: „Zahlender Partner“', () => {
  it('nothing sent is a 400 that names all three fields — and writes nothing', async () => {
    const res = await classify({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('club_type, category_label oder is_paid_partner erforderlich');
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([['ja'], ['true'], ['false'], [1], [0], [null]])('is_paid_partner %j is not a boolean: 400, nothing written', async (value) => {
    const res = await classify({ is_paid_partner: value });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('is_paid_partner muss true oder false sein');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('true sets the mark: $4 is true, the answer carries it, every list that shows it is cleared', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ ...CLUB, is_paid_partner: true }] });
    const res = await classify({ is_paid_partner: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, club: { ...CLUB, is_paid_partner: true } });

    const [sql, params] = updates()[0];
    expect(params).toEqual(['7', null, null, true]);      // type and category untouched
    expect(sql).toContain('is_paid_partner = COALESCE($4::boolean, is_paid_partner)');
    expect(sql).toMatch(/RETURNING[^;]*is_paid_partner/);
    // only an official club — judged by the type it has AFTER this request
    expect(sql).toContain("AND ($4::boolean IS NOT TRUE OR COALESCE($2::text, club_type) = 'official')");

    for (const prefix of ['clubs:', 'groups:', 'discover_events']) {
      expect(cache.invalidatePrefix).toHaveBeenCalledWith(prefix);
    }
    expect(cache.deleteCached).toHaveBeenCalledWith('clubs:featured');
    expect(log.mock.calls.flat().join(' ')).toContain('paid=true');
  });

  it('false takes it off — and goes for any club', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ ...CLUB, club_type: 'community', is_paid_partner: false }] });
    const res = await classify({ is_paid_partner: false });
    expect(res.statusCode).toBe(200);
    expect(res.body.club.is_paid_partner).toBe(false);
    expect(updates()[0][1]).toEqual(['7', null, null, false]);
    expect(db.query).toHaveBeenCalledTimes(1);            // no second look needed
  });

  it('an unsent mark keeps what is stored: $4 is null', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ ...CLUB, is_paid_partner: true }] });
    const res = await classify({ club_type: 'official' });
    expect(res.statusCode).toBe(200);
    expect(updates()[0][1]).toEqual(['7', 'official', null, null]);
    expect(res.body.club.is_paid_partner).toBe(true);
  });

  it('true for a community: 400 PAID_PARTNER_OFFICIAL_ONLY, nothing cleared', async () => {
    vi.mocked(db.query).mockImplementation(async (sql) => (/UPDATE groups/.test(sql)
      ? { rowCount: 0, rows: [] }          // the official-only condition held the write back
      : { rowCount: 1, rows: [{}] }));     // …but the club exists
    const res = await classify({ is_paid_partner: true });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Nur offizielle Clubs können zahlende Partner sein',
      code: 'PAID_PARTNER_OFFICIAL_ONLY',
    });
    expect(cache.invalidatePrefix).not.toHaveBeenCalled();
  });

  it('true together with club_type official goes through in one request', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ ...CLUB, is_paid_partner: true }] });
    const res = await classify({ club_type: 'official', is_paid_partner: true });
    expect(res.statusCode).toBe(200);
    expect(updates()[0][1]).toEqual(['7', 'official', null, true]);
  });

  it('true for a club that does not exist stays a 404', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] });
    const res = await classify({ is_paid_partner: true }, '999');
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Club nicht gefunden');
  });

  it('a club that does not exist, without the mark: 404 after the one write', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] });
    const res = await classify({ club_type: 'official' }, '999');
    expect(res.statusCode).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getClubsForAdmin', () => {
  it('lists is_paid_partner next to the type, so the switch shows what it is about to change', async () => {
    const rows = [{ id: 7, name: 'Café Soleá', club_type: 'official', is_paid_partner: true }];
    vi.mocked(db.query).mockResolvedValue({ rows });
    const res = await run(getClubsForAdmin, { query: { search: 'Café' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(rows);
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('g.is_paid_partner');
    expect(sql).toContain('g.club_type');
    expect(params).toEqual(['%Café%']);
  });
});
