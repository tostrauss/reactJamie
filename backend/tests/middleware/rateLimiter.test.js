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

const { generalLimiter, authLimiter, strictLimiter, verifiedUserId, authLimiterSkip } = await import('../../src/middleware/rateLimiter.js');
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
});
