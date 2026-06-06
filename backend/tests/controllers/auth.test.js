import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── DB mock ────────────────────────────────────────────────────────────────
vi.mock('../../src/config/database.js', () => ({
  default: { query: vi.fn() }
}));

// ── Sentry mock (no-op in tests) ───────────────────────────────────────────
vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn(), setupExpressErrorHandler: vi.fn() }
}));

// ── Redis mock (no Redis in tests) ────────────────────────────────────────
vi.mock('../../src/config/redis.js', () => ({
  redisClient: null,
  redisSubscriber: null
}));

const { default: db } = await import('../../src/config/database.js');
const { register, login, refreshToken } = await import('../../src/controllers/authController.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res;
};

// resetAllMocks clears both call history AND the mockResolvedValueOnce queue
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.resetAllMocks());

// ── register ───────────────────────────────────────────────────────────────
describe('register', () => {
  it('rejects missing date_of_birth', async () => {
    const req = { body: { email: 'a@b.com', password: 'Test1!abc', name: 'Test' } };
    const res = makeRes();
    await register(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Geburtsdatum') }));
  });

  it('rejects users under 18', async () => {
    const req = { body: { email: 'a@b.com', password: 'Test1!abc', name: 'Test', date_of_birth: '2015-01-01' } };
    const res = makeRes();
    await register(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('18') }));
  });

  it('rejects weak password (no uppercase)', async () => {
    const req = { body: { email: 'a@b.com', password: 'test1!abc', name: 'Test', date_of_birth: '1990-01-01' } };
    const res = makeRes();
    await register(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Großbuchstabe') }));
  });

  it('rejects weak password (no special char)', async () => {
    const req = { body: { email: 'a@b.com', password: 'Test1abcd', name: 'Test', date_of_birth: '1990-01-01' } };
    const res = makeRes();
    await register(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Sonderzeichen') }));
  });

  it('rejects duplicate email', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // email exists
    const req = { body: { email: 'exists@b.com', password: 'Test1!abc', name: 'Test', date_of_birth: '1990-01-01' } };
    const res = makeRes();
    await register(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('registriert') }));
  });

  it('creates user and returns token on valid input', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })               // email not taken
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })     // INSERT user
      .mockResolvedValueOnce({ rows: [] })               // INSERT boost_credits
      .mockResolvedValueOnce({ rows: [] })               // INSERT referral code
      .mockResolvedValueOnce({ rows: [{ id: 42, email: 'new@b.com', name: 'New', onboarding_completed: false }] }); // SELECT user

    const req = { body: { email: 'new@b.com', password: 'Test1!abc', name: 'New', date_of_birth: '1990-01-01' } };
    const res = makeRes();
    await register(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });

  // ── Regression: OTP must be bound to /register in production ───────────────
  // Without this gate, /api/auth/register can be called directly with any email
  // (the OTP flow lives only on the frontend), enabling account squatting.
  describe('OTP binding (production)', () => {
    let prevEnv;
    beforeEach(() => { prevEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = prevEnv; });

    it('rejects when no recent verified OTP exists for the email', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })   // email not taken
        .mockResolvedValueOnce({ rows: [] });  // no verified OTP row

      const req = { body: { email: 'attacker@b.com', password: 'Test1!abc', name: 'Anon', date_of_birth: '1990-01-01' } };
      const res = makeRes();
      await register(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }));
    });

    it('returns 503 when email_verification_codes table is missing (fail-closed)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }); // email not taken
      // OTP check throws 42P01 (undefined_table)
      const tableMissing = Object.assign(new Error('relation does not exist'), { code: '42P01' });
      db.query.mockRejectedValueOnce(tableMissing);

      const req = { body: { email: 'first@b.com', password: 'Test1!abc', name: 'First', date_of_birth: '1990-01-01' } };
      const res = makeRes();
      await register(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('proceeds and consumes the OTP row when a recent verified row exists', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })                        // email not taken
        .mockResolvedValueOnce({ rows: [{ id: 77 }] })              // OTP row found
        .mockResolvedValueOnce({ rows: [] })                        // DELETE OTP row
        .mockResolvedValueOnce({ rows: [{ id: 42 }] })              // INSERT user
        .mockResolvedValueOnce({ rows: [] })                        // INSERT boost_credits
        .mockResolvedValueOnce({ rows: [] })                        // INSERT referral
        .mockResolvedValueOnce({ rows: [{ id: 42, email: 'ok@b.com', name: 'Ok', onboarding_completed: false }] }); // SELECT user

      const req = { body: { email: 'ok@b.com', password: 'Test1!abc', name: 'Ok', date_of_birth: '1990-01-01' } };
      const res = makeRes();
      await register(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
      // DELETE call must have happened with the OTP row id — confirms single-use.
      const deleteCall = db.query.mock.calls.find(c =>
        /DELETE FROM email_verification_codes WHERE id/.test(c[0])
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[1]).toEqual([77]);
    });
  });
});

// ── login ──────────────────────────────────────────────────────────────────
describe('login', () => {
  it('returns 400 when email or password missing', async () => {
    const res = makeRes();
    await login({ body: { email: 'a@b.com' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 for unknown email', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // user not found
    const res = makeRes();
    await login({ body: { email: 'x@x.com', password: 'Test1!abc' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10);
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, password: hash, login_attempts: 0, locked_until: null, is_active: true }] });
    const res = makeRes();
    await login({ body: { email: 'a@b.com', password: 'wrong' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns token on valid credentials', async () => {
    const hash = await bcrypt.hash('Test1!abc', 10);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 5, password: hash, login_attempts: 0, locked_until: null, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] })  // reset login_attempts
      .mockResolvedValueOnce({ rows: [{ id: 5, email: 'a@b.com', name: 'A', onboarding_completed: true }] }); // SELECT full user
    const res = makeRes();
    await login({ body: { email: 'a@b.com', password: 'Test1!abc' } }, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });

  // Regression — email lookup must be case-insensitive so "User@x.com"
  // and "user@x.com" hit the same account.
  it('normalizes email to lowercase before lookup', async () => {
    const hash = await bcrypt.hash('Test1!abc', 10);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 5, password: hash, login_attempts: 0, locked_until: null, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 5, email: 'mixed@x.com', name: 'A', onboarding_completed: true }] });
    const res = makeRes();
    await login({ body: { email: 'MiXeD@X.COM', password: 'Test1!abc' } }, res, vi.fn());
    // First query param must be the lowercased form
    expect(db.query.mock.calls[0][1]).toEqual(['mixed@x.com']);
    expect(db.query.mock.calls[0][0]).toContain('LOWER(email)');
  });

  // Regression — unknown emails must run a dummy bcrypt compare so the
  // response time matches a real password-mismatch path. Without this an
  // attacker can sweep email lists by timing.
  it('runs a dummy bcrypt compare on missing user (timing constant)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // user not found
    const t0 = Date.now();
    const res = makeRes();
    await login({ body: { email: 'unknown@x.com', password: 'Test1!abc' } }, res, vi.fn());
    const elapsed = Date.now() - t0;
    expect(res.status).toHaveBeenCalledWith(401);
    // Dummy bcrypt at cost 12 takes 50ms+ even on fast CI hardware.
    // If this drops to a few ms, the timing-attack mitigation was reverted.
    expect(elapsed).toBeGreaterThan(20);
  });

  it('caps password length to block bcrypt DoS', async () => {
    const res = makeRes();
    await login({ body: { email: 'a@x.com', password: 'A'.repeat(10000) } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── refreshToken ───────────────────────────────────────────────────────────
describe('refreshToken', () => {
  it('returns 401 when user not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await refreshToken({ userId: 999 }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when account is inactive', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, is_active: false }] });
    const res = makeRes();
    await refreshToken({ userId: 1 }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns a fresh token for an active user', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    const res = makeRes();
    await refreshToken({ userId: 1 }, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });
});
