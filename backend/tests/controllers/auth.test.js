import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from '@node-rs/bcrypt';

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
const { register, login, refreshToken, updateProfile, sendEmailCode } = await import('../../src/controllers/authController.js');

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

// ── updateProfile: birthday editable exactly once after onboarding ───────────
describe('updateProfile birthday lock', () => {
  const findUpdateCall = () =>
    db.query.mock.calls.find(c => /date_of_birth_changed = CASE/.test(c[0]));

  it('rejects a second birthday change once the flag is set', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ dob: '1990-01-01', date_of_birth_changed: true }] });
    const res = makeRes();
    await updateProfile({ userId: 1, body: { date_of_birth: '1985-05-05' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('einmal') }));
    // Must bail before the UPDATE — nothing gets written.
    expect(findUpdateCall()).toBeUndefined();
  });

  it('allows the first birthday change and locks the field', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ dob: '1990-01-01', date_of_birth_changed: false }] }) // current
      .mockResolvedValueOnce({ rows: [] })                                                     // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 1, date_of_birth: '1990-06-15', date_of_birth_changed: true }] }); // SELECT
    const res = makeRes();
    await updateProfile({ userId: 1, body: { date_of_birth: '1990-06-15' } }, res, vi.fn());
    const update = findUpdateCall();
    expect(update).toBeDefined();
    expect(update[1][9]).toBe('1990-06-15'); // incoming DOB written
    expect(update[1][11]).toBe(true);        // lockDob → sets the flag
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('rejects an under-18 birthday change', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ dob: '1990-01-01', date_of_birth_changed: false }] });
    const res = makeRes();
    await updateProfile({ userId: 1, body: { date_of_birth: '2015-01-01' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('18') }));
    expect(findUpdateCall()).toBeUndefined();
  });

  it('lets a locked user save when the birthday is unchanged', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ dob: '1990-01-01', date_of_birth_changed: true }] }) // current (locked)
      .mockResolvedValueOnce({ rows: [] })                                                    // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });                                          // SELECT
    const res = makeRes();
    await updateProfile({ userId: 1, body: { date_of_birth: '1990-01-01' } }, res, vi.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    const update = findUpdateCall();
    expect(update[1][11]).toBe(false); // no new lock — nothing actually changed
  });

  it('does not lock when setting a NULL birthday for the first time (onboarding baseline)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ dob: null, date_of_birth_changed: false }] }) // never set
      .mockResolvedValueOnce({ rows: [] })                                            // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });                                  // SELECT
    const res = makeRes();
    await updateProfile({ userId: 1, body: { date_of_birth: '1990-01-01' } }, res, vi.fn());
    const update = findUpdateCall();
    expect(update).toBeDefined();
    expect(update[1][11]).toBe(false); // first-ever set is not the one change
  });
});

// ── updateProfile: image URL validation must accept our own relative URLs ────
// Regression: production serves uploads through the same-origin "/media" proxy,
// so avatar/photo/pinnwand URLs are ROOT-RELATIVE ("/media/uploads/x.webp").
// A stricter absolute-http(s)-only check rejected them on save → users who
// added a profile picture could not save their profile at all (real reports,
// Naemi/Lorenz, 2026-08). Same-origin relative URLs must pass; external hosts
// and protocol-relative "//host" must still be rejected.
describe('updateProfile image URL validation', () => {
  const isUpdate = (c) => /UPDATE users/.test(c[0]);
  const ranUpdate = () => db.query.mock.calls.some(isUpdate);

  // Save with an avatar and no birthday. A same-origin avatar now triggers a
  // pre-UPDATE "SELECT avatar_url" (change-detection for the quality backstop);
  // we return the SAME url so it reads as unchanged and the stored-image check
  // is skipped — this suite only exercises URL validation, not image content.
  const saveAvatar = async (avatar_url) => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT avatar_url FROM users/.test(sql)) return { rows: [{ avatar_url }] };
      if (/UPDATE users/.test(sql)) return { rows: [] };
      return { rows: [{ id: 1 }] }; // return SELECT
    });
    const res = makeRes();
    await updateProfile({ userId: 1, body: { avatar_url } }, res, vi.fn());
    return res;
  };

  it('accepts a same-origin /media proxy URL', async () => {
    const res = await saveAvatar('/media/uploads/abc123.webp');
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(ranUpdate()).toBe(true);
  });

  it('accepts a legacy /uploads relative URL', async () => {
    const res = await saveAvatar('/uploads/image-99.webp');
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(ranUpdate()).toBe(true);
  });

  it('still accepts an absolute https URL', async () => {
    const res = await saveAvatar('https://app.jamie-app.com/media/uploads/abc.webp');
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(ranUpdate()).toBe(true);
  });

  it('rejects a protocol-relative //external host', async () => {
    const res = await saveAvatar('//evil.example/x.jpg');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ranUpdate()).toBe(false);
  });

  it('rejects a javascript: payload', async () => {
    const res = await saveAvatar('javascript:alert(1)//.jpg');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ranUpdate()).toBe(false);
  });

  it('rejects a relative path outside /media and /uploads', async () => {
    const res = await saveAvatar('/etc/passwd');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ranUpdate()).toBe(false);
  });
});

// ── updateProfile: location/country SQL (regression: Postgres 42P08) ─────────
// The country-reset clause reused the bare untyped $2 placeholder in two SQL
// contexts (the `location = $2` SET and `location IS DISTINCT FROM $2`), so
// Postgres deduced conflicting types (varchar vs text) and aborted EVERY save
// that carried a location key with 42P08 → generic 500. The edit page always
// sends location, so every profile save from it failed. Both usages must carry
// an explicit ::varchar cast. (Unit tests mock the DB and can't see the type
// error itself — this pins the query shape so the cast can't be dropped again.)
describe('updateProfile location/country param typing', () => {
  it('casts $2 in both the SET and the country CASE (no bare $2 reuse)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })           // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // return SELECT
    const res = makeRes();
    await updateProfile({ userId: 1, body: { location: 'Wien' } }, res, vi.fn());
    const update = db.query.mock.calls.find(c => /UPDATE users/.test(c[0]));
    expect(update).toBeDefined();
    const sql = update[0];
    expect(sql).toMatch(/location = \$2::varchar/);
    expect(sql).toMatch(/location IS DISTINCT FROM \$2::varchar/);
    // The bare, type-ambiguous form must be gone.
    expect(sql).not.toMatch(/DISTINCT FROM \$2 THEN/);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});

// ── sendEmailCode: per-email throttle (2M2M TV-spike readiness) ─────────────
// The per-IP registrationLimiter was raised for carrier-NAT bursts; the
// anti-abuse load moved to this in-DB per-email layer (60s cooldown + 6/h).
describe('sendEmailCode per-email throttle', () => {
  const call = async (email = 'neu@x.com') => {
    const res = makeRes();
    await sendEmailCode({ body: { email, name: 'T' } }, res, vi.fn());
    return res;
  };
  // Query order: user-exists, CREATE TABLE, throttle SELECT, then (if allowed)
  // invalidate-UPDATE, cleanup-DELETE (fire-and-forget), INSERT RETURNING.
  const arm = (throttleRow) => {
    db.query
      .mockResolvedValueOnce({ rows: [] })            // email not registered
      .mockResolvedValueOnce({ rows: [] })            // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce({ rows: [throttleRow] }) // throttle history
      .mockResolvedValue({ rows: [{ id: 7 }] });      // everything after
  };

  it('429s within the 60s resend cooldown', async () => {
    arm({ last_sent: new Date(Date.now() - 10_000), hour_count: 1 });
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('warte') }));
  });

  it('429s after 6 codes within an hour (mail-bombing brake)', async () => {
    arm({ last_sent: new Date(Date.now() - 5 * 60_000), hour_count: 6 });
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Zu viele Codes') }));
  });

  it('sends normally when outside cooldown and under the hourly cap', async () => {
    arm({ last_sent: new Date(Date.now() - 2 * 60_000), hour_count: 2 });
    const res = await call();
    // NODE_ENV=test → dev path returns the code without a provider call.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ devCode: expect.any(String) }));
  });

  it('sends normally for a brand-new email (no history)', async () => {
    arm({ last_sent: null, hour_count: 0 });
    const res = await call();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ devCode: expect.any(String) }));
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
