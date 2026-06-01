import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticate, generateToken, optionalAuth } from '../../src/middleware/auth.js';

// Set a test secret before importing anything that uses it
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const next = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateToken', () => {
  it('returns a valid JWT containing the user id', () => {
    const token = generateToken(42);
    const decoded = jwt.verify(token, 'test-secret-key');
    expect(decoded.id).toBe(42);
  });

  it('signs with iss=jamie-api + aud=jamie-app + alg=HS256', () => {
    const token = generateToken(42);
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.iss).toBe('jamie-api');
    expect(decoded.payload.aud).toBe('jamie-app');
  });
});

describe('authenticate alg-confusion protection', () => {
  it('rejects an alg:none token even if signed with the secret', () => {
    // Hand-craft an alg:none token claiming user id 1 — the dangerous
    // jsonwebtoken vulnerability before alg pinning.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 1, iss: 'jamie-api', aud: 'jamie-app' })).toString('base64url');
    const noneToken = `${header}.${payload}.`;
    const req = { headers: { authorization: `Bearer ${noneToken}` } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token with wrong audience', () => {
    const evilToken = jwt.sign({ id: 99 }, 'test-secret-key', { algorithm: 'HS256', issuer: 'jamie-api', audience: 'other-app' });
    const req = { headers: { authorization: `Bearer ${evilToken}` } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token with wrong issuer', () => {
    const evilToken = jwt.sign({ id: 99 }, 'test-secret-key', { algorithm: 'HS256', issuer: 'evil', audience: 'jamie-app' });
    const req = { headers: { authorization: `Bearer ${evilToken}` } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('authenticate middleware', () => {
  it('returns 401 when no Authorization header is present', () => {
    const req = { headers: {} };
    const res = makeRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is missing from header', () => {
    const req = { headers: { authorization: 'Bearer' } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for an invalid token', () => {
    const req = { headers: { authorization: 'Bearer invalid.token.here' } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and sets req.userId for a valid token', () => {
    const token = generateToken(99);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe(99);
    expect(req.isGuest).toBe(false);
  });

  it('grants guest access when ALLOW_GUEST_TOKEN is enabled', () => {
    process.env.ALLOW_GUEST_TOKEN = 'true';
    const req = { headers: { authorization: 'Bearer guest_token' } };
    const res = makeRes();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe(0);
    expect(req.isGuest).toBe(true);
    delete process.env.ALLOW_GUEST_TOKEN;
  });
});

describe('optionalAuth middleware', () => {
  it('proceeds with userId null when no header is present', () => {
    const req = { headers: {} };
    const res = makeRes();
    optionalAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeNull();
  });

  it('sets userId from a valid token', () => {
    const token = generateToken(7);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    optionalAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe(7);
  });

  it('proceeds with null userId on invalid token (does not throw)', () => {
    const req = { headers: { authorization: 'Bearer bad-token' } };
    const res = makeRes();
    optionalAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeNull();
  });
});
