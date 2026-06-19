import jwt from 'jsonwebtoken';
import db from '../config/database.js';

// Guest access only allowed when explicitly enabled via env var
const isGuestAllowed = () => process.env.ALLOW_GUEST_TOKEN === 'true';

// JWT issuer + audience claims. Even though we sign with our own secret,
// pinning iss/aud means a token leaked from this app cannot be replayed
// against a future sibling service that shares the same key — and vice
// versa. Verifier rejects mismatches outright.
const JWT_ISSUER   = 'jamie-api';
const JWT_AUDIENCE = 'jamie-app';
const JWT_VERIFY_OPTS = {
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

const extractToken = (req) => {
  // 1. httpOnly cookie (preferred — XSS-proof)
  if (req.cookies?.auth_token) return req.cookies.auth_token;
  // 2. Authorization header fallback (Capacitor native / API clients)
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
};

export const authenticate = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) return res.status(401).json({ error: 'No authorization header' });

    if (token === 'guest_token') {
      if (!isGuestAllowed()) return res.status(401).json({ error: 'Guest access is disabled' });
      req.userId = 0;
      req.isGuest = true;
      return next();
    }

    // Pin algorithm to HS256 explicitly. Without this, jsonwebtoken accepts
    // any algorithm listed in the header — an attacker could supply
    // alg: 'none' or trick the verifier into using an asymmetric public
    // key as an HMAC secret. iss/aud bind tokens to this service.
    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTS);
    req.userId = decoded.id;
    req.isGuest = false;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) { req.userId = null; return next(); }

    if (token === 'guest_token') {
      req.userId = isGuestAllowed() ? 0 : null;
      req.isGuest = isGuestAllowed();
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTS);
    req.userId = decoded.id;
    req.isGuest = false;
    next();
  } catch {
    req.userId = null;
    next();
  }
};

// 30-day session. Was 7d, which logged users out after a week of not opening
// the app ("no app does that" — Tina). The frontend rolls this forward on every
// launch via POST /auth/refresh, so an at-least-monthly user effectively never
// gets logged out. Trade-off: a leaked token stays valid up to 30d (we have no
// server-side revocation list) — acceptable for a consumer social app given the
// httpOnly cookie + login lockout. Raise to '90d' if you want it longer.
const TOKEN_TTL = '30d';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

// Set httpOnly auth cookie — call this after generating a token
export const setAuthCookie = (res, token) => {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS, // 30 days — matches the JWT TTL above
  });
};

// Clear auth cookie on logout
export const clearAuthCookie = (res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
};

export const requireAdmin = async (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
    if (!result.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const requireCompleteProfile = async (req, res, next) => {
  try {
    if (req.isGuest) return res.status(403).json({ error: 'Guests cannot join groups. Please register.' });

    const result = await db.query('SELECT onboarding_completed FROM users WHERE id = $1', [req.userId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    if (!result.rows[0].onboarding_completed) {
      return res.status(403).json({
        error: 'Bitte vervollständige dein Profil, bevor du Gruppen beitrittst.',
        code: 'PROFILE_INCOMPLETE'
      });
    }
    next();
  } catch (error) {
    console.error('Profile check error:', error);
    next(); // Don't block on error
  }
};
