import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// No Redis in tests
vi.mock('../../src/config/redis.js', () => ({
  redisClient: null,
  redisSubscriber: null
}));
// rateLimiter now imports auth.js (JWT helpers) which imports the DB module.
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));

const { generalLimiter, authLimiter, strictLimiter, passwordResetLimiter, publicFormLimiter, verifiedUserId, authLimiterSkip } = await import('../../src/middleware/rateLimiter.js');
const { generateToken } = await import('../../src/middleware/auth.js');

describe('rate limiters', () => {
  it('exports generalLimiter as a function', () => {
    expect(typeof generalLimiter).toBe('function');
  });

  it('exports authLimiter as a function', () => {
    expect(typeof authLimiter).toBe('function');
  });

  it('exports strictLimiter as a function', () => {
    expect(typeof strictLimiter).toBe('function');
  });

  // Audit 2026-09-15, finding 5: strictLimiter used to be ONE no-keyGenerator
  // instance shared by /password, /account, /export, /forgot-password,
  // /reset-password, /verify-email, the contact form and the waitlist — one
  // 5/hour bucket per IP across all of them, so a carrier NAT locked itself
  // out of password recovery. These pin the split apart.
  describe('strict-bucket split (finding 5)', () => {
    // A blocked request never calls next() — it answers via res.json(). The
    // harness has to settle on EITHER, or the first 429 hangs the test.
    const run = (limiter, userId) => new Promise((resolve) => {
      const req = { ip: '203.0.113.9', headers: {}, method: 'POST', url: '/x', path: '/x', query: {}, userId };
      // express-rate-limit's default handler answers with res.send(), not
      // res.json() — settle on any of them so a 429 cannot hang the test.
      const blocked = () => resolve({ allowed: false, status: res._status });
      const res = {
        set: vi.fn(), setHeader: vi.fn(), getHeader: vi.fn(), end: vi.fn(),
        status: vi.fn(function (c) { res._status = c; return res; }),
        send: vi.fn(blocked), json: vi.fn(blocked),
      };
      limiter(req, res, () => resolve({ allowed: true }));
    });

    it('the reset and public-form limiters exist as their own instances', () => {
      expect(typeof passwordResetLimiter).toBe('function');
      expect(typeof publicFormLimiter).toBe('function');
      expect(passwordResetLimiter).not.toBe(strictLimiter);
      expect(publicFormLimiter).not.toBe(strictLimiter);
    });

    it('strictLimiter keys per USER, so two users on one IP do not share a budget', async () => {
      // Every request below carries the SAME ip and differs only in userId.
      // Under the old ip-keyed limiter, user 1 exhausting the 5/h budget would
      // have 429'd user 2 — one NAT, one bucket.
      const mine = [];
      for (let i = 0; i < 6; i++) mine.push(await run(strictLimiter, 1));
      expect(mine.filter((r) => r.allowed).length).toBe(5);   // cap is real
      expect(mine[5]).toMatchObject({ allowed: false, status: 429 });

      expect(await run(strictLimiter, 2)).toEqual({ allowed: true });
    });

    it('draining strictLimiter leaves the password-reset budget untouched', async () => {
      for (let i = 0; i < 8; i++) await run(strictLimiter, 3);
      expect((await run(strictLimiter, 3)).allowed).toBe(false);  // still capped
      // ...but account recovery is a different bucket now, so it still works.
      expect(await run(passwordResetLimiter, 3)).toEqual({ allowed: true });
    });
  });

  it('falls back to in-memory store when Redis is absent', async () => {
    // Limiter should be callable (not throw) when redisClient is null
    const req = { ip: '127.0.0.1', headers: {}, method: 'GET', url: '/test', path: '/test', query: {} };
    const res = { set: vi.fn(), setHeader: vi.fn(), status: vi.fn(() => res), json: vi.fn(), send: vi.fn(), end: vi.fn(), getHeader: vi.fn() };
    const next = vi.fn();
    await expect(generalLimiter(req, res, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});

// ── NAT fix 2026-08-04: per-user buckets for authenticated traffic ─────────
// generalLimiter keys verified tokens as user:{id} (own bucket, NAT size
// irrelevant) and everything else per IP; authLimiter skips valid tokens.
// Security posture pinned here: only a SIGNATURE-VERIFIED token may leave the
// shared IP bucket — forged/anonymous/guest must never mint their own bucket.
describe('verifiedUserId (rate-limit bucket keying)', () => {
  const reqWith = (token) => ({ cookies: {}, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('returns the user id for a validly signed token', () => {
    expect(verifiedUserId(reqWith(generateToken(42)))).toBe(42);
  });

  it('reads the httpOnly cookie too (web clients)', () => {
    expect(verifiedUserId({ cookies: { auth_token: generateToken(7) }, headers: {} })).toBe(7);
  });

  it('rejects a token signed with the wrong secret (forged-bucket attack)', () => {
    const forged = jwt.sign({ id: 42 }, 'attacker-secret', {
      algorithm: 'HS256', issuer: 'jamie-api', audience: 'jamie-app',
    });
    expect(verifiedUserId(reqWith(forged))).toBeNull();
  });

  it('rejects a token missing the pinned issuer/audience claims', () => {
    const unbound = jwt.sign({ id: 42 }, 'test-secret', { algorithm: 'HS256' });
    expect(verifiedUserId(reqWith(unbound))).toBeNull();
  });

  it('returns null for anonymous requests', () => {
    expect(verifiedUserId(reqWith(null))).toBeNull();
  });

  it('keeps the guest token in the IP bucket', () => {
    expect(verifiedUserId(reqWith('guest_token'))).toBeNull();
  });
});

// authLimiter skip must be scoped to housekeeping paths ONLY — a blanket
// valid-token skip would let one throwaway account's JWT bypass the login
// brute-force cap (P1 review finding, 2026-08-04).
describe('authLimiterSkip (scoped housekeeping skip)', () => {
  const req = (path, token) => ({
    path,
    cookies: {},
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  it('skips /refresh with a valid token (the NAT-burning launch traffic)', () => {
    expect(authLimiterSkip(req('/refresh', generateToken(5)))).toBe(true);
  });

  it('skips /profile with a valid token', () => {
    expect(authLimiterSkip(req('/profile', generateToken(5)))).toBe(true);
  });

  it('NEVER skips /login — even with a valid token attached (bypass attack)', () => {
    expect(authLimiterSkip(req('/login', generateToken(5)))).toBe(false);
  });

  it('NEVER skips /google or /send-verification with a valid token', () => {
    expect(authLimiterSkip(req('/google', generateToken(5)))).toBe(false);
    expect(authLimiterSkip(req('/send-verification', generateToken(5)))).toBe(false);
  });

  it('does not skip housekeeping paths without a valid token', () => {
    expect(authLimiterSkip(req('/refresh', null))).toBe(false);
  });

  // 2M2M TV-spike: the signup funnel is exempt from the shared login budget —
  // it carries its own registrationLimiter + per-email throttles instead.
  it('skips the signup funnel paths WITHOUT any token (anonymous signups)', () => {
    expect(authLimiterSkip(req('/send-email-code', null))).toBe(true);
    expect(authLimiterSkip(req('/verify-email-code', null))).toBe(true);
    expect(authLimiterSkip(req('/register', null))).toBe(true);
  });

  it('still NEVER skips /login or /forgot-password, token or not', () => {
    expect(authLimiterSkip(req('/login', null))).toBe(false);
    expect(authLimiterSkip(req('/login', generateToken(5)))).toBe(false);
    expect(authLimiterSkip(req('/forgot-password', null))).toBe(false);
  });
});
