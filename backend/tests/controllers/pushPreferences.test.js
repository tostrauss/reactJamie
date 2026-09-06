import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

// ── DB / Sentry / Redis mocks (same shape as the other controller tests) ──
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn(), captureMessage: vi.fn(), setupExpressErrorHandler: vi.fn() },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const db = (await import('../../src/config/database.js')).default;
const { updatePushPreferences } = await import('../../src/controllers/pushController.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (body) => ({ userId: 42, body });

// PUT /push/preferences — Settings → Benachrichtigungen. The contract pinned
// here: column names come from the allowlist (never from the body), only REAL
// booleans are written (so a one-key PUT can't reset the other flags), and the
// SET clause follows allowlist order so the $n placeholders line up with params.
describe('updatePushPreferences', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects guests with 403 before touching the DB', async () => {
    const res = mockRes();
    await updatePushPreferences({ userId: 0, isGuest: true, body: { push_reminders: false } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    ['empty body', {}],
    ['strings, numbers and unknown keys', { push_reminders: 'false', push_friends: 1, nope: true }],
  ])('returns 400 without a DB call when no key is a real boolean (%s)', async (_label, body) => {
    const res = mockRes();
    await updatePushPreferences(req(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('writes only the boolean allowlisted keys, in allowlist order, and returns the row', async () => {
    const row = { push_reminders: false, push_friends: true, push_recommendations: true };
    db.query.mockResolvedValueOnce({ rows: [row] });
    const res = mockRes();
    await updatePushPreferences(
      req({ push_reminders: false, push_friends: 'true', push_recommendations: true, evil: false }),
      res,
    );

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    // push_friends is a string → skipped; evil is not allowlisted → skipped.
    expect(sql).toContain('SET push_reminders = $2, push_recommendations = $3, updated_at = CURRENT_TIMESTAMP');
    expect(sql).toContain('WHERE id = $1');
    expect(sql).toContain('RETURNING push_reminders, push_friends, push_recommendations');
    expect(sql).not.toContain('evil');
    expect(params).toEqual([42, false, true]);

    expect(res.json).toHaveBeenCalledWith(row);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it('a single key produces a single SET column and two params', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ push_reminders: true, push_friends: false, push_recommendations: true }] });
    const res = mockRes();
    await updatePushPreferences(req({ push_friends: false }), res);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET push_friends = $2, updated_at');
    expect(params).toEqual([42, false]);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the UPDATE matches no user', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await updatePushPreferences(req({ push_reminders: true }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 with an error string when the DB rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.query.mockRejectedValueOnce(new Error('connection lost'));
    const res = mockRes();
    await updatePushPreferences(req({ push_reminders: true }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(typeof res.json.mock.calls[0][0].error).toBe('string');
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
