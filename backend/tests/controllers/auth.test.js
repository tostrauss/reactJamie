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
