import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import jwt from 'jsonwebtoken';
import { redisClient } from '../config/redis.js';
import { extractToken, JWT_VERIFY_OPTS } from './auth.js';

// Signature-verified userId from the request's JWT, or null for anonymous /
// guest / forged tokens. Runs BEFORE the auth middleware (the general limiter
// is mounted on /api ahead of the routes), so it does its own jwt.verify —
// same pinned alg/iss/aud as auth.js, an unverified decode would let an
// attacker mint fake per-"user" buckets and dodge the IP cap entirely.
// HS256 verify is microseconds; no DB (the later auth middleware still does
// the full revocation check — a revoked-but-unexpired token only mis-keys a
// rate bucket, it never grants access).
export const verifiedUserId = (req) => {
  try {
    const token = extractToken(req);
    if (!token || token === 'guest_token') return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTS);
    return decoded.id > 0 ? decoded.id : null; // guest id 0 → IP bucket
  } catch {
    return null;
  }
};

// Rate limits are always enforced. Set DISABLE_RATE_LIMIT=true only in local dev.
const disabled = process.env.DISABLE_RATE_LIMIT === 'true';

const makeStore = (prefix) =>
  redisClient
    ? new RedisStore({ prefix, sendCommand: (...args) => redisClient.call(...args) })
    : undefined; // undefined = in-memory store (single instance only)

// If Redis goes down mid-flight the store throws. Two postures:
//
//  SHARED (fail-OPEN): pass the request through on store error. Used for
//  availability-first limiters (general API, chat, uploads) where a brief
//  Redis hiccup blocking traffic is worse than the limit not applying.
const SHARED = { passOnStoreError: true };
//
//  SHARED_STRICT (fail-CLOSED): on store error, let the error propagate so the
//  request is REJECTED (500) rather than waved through. Used for the
//  credential-attack surfaces (login, password reset, account deletion): a
//  Redis outage must never silently disable brute-force protection. Rejecting
//  auth during a (rare, short) Redis outage is the safer trade-off than handing
//  an attacker an unlimited-attempts window.
const SHARED_STRICT = { passOnStoreError: false };

// General API rate limit: 2000 req/15min — keyed PER USER for authenticated
// traffic, per IP only for anonymous requests (NAT fix, Tobi 2026-08-04).
// Measured before: 100 users behind one event-WiFi/carrier NAT burned the
// shared per-IP budget in ~20s and everyone got 429s. Now every logged-in
// user has their own bucket, so NAT size is irrelevant; the per-IP bucket
// remains only for the (small) anonymous surface — login/OTP/register have
// their own dedicated limiters below. An attacker can't opt out of the IP
// bucket: forged tokens fail jwt.verify, and real per-user buckets require
// real accounts (registration is itself IP-capped).
export const generalLimiter = rateLimit({
  ...SHARED,
  windowMs: 15 * 60 * 1000,
  max: disabled ? 10000 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = verifiedUserId(req);
    return uid ? `user:${uid}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
  store: makeStore('rl:general:'),
  message: { error: 'Zu viele Anfragen. Bitte versuche es in 15 Minuten erneut.' }
});

// Auth rate limit: 100 attempts/15min per IP. Bumped from 20 — at a launch
// event 100+ users behind one NAT each need to log in + verify their email
// OTP, which alone burns 2 calls per user. 100 is still well below the
// 6+ attempts/sec a botnet would need to be effective.
// NAT fix 2026-08-04: authenticated HOUSEKEEPING requests are skipped —
// /api/auth/refresh fires on EVERY app launch and /auth/profile on every
// session restore, so 100 users behind one NAT exhausted the shared budget
// through routine already-authenticated traffic and then nobody could log
// in. The skip is scoped to an explicit path allowlist: a blanket
// "has valid token → skip" would let an attacker attach ONE throwaway
// account's token to /login requests and dodge the brute-force cap
// entirely (found in review, 2026-08-04). Credential surfaces (/login,
// /google*, /apple, /register, OTP, /send-verification) are NEVER skipped,
// token or not; the skipped housekeeping traffic still counts against the
// per-user generalLimiter bucket above.
// Paths are mount-relative to /api/auth (express strips the app.use prefix).
export const AUTH_HOUSEKEEPING_PATHS = new Set(['/refresh', '/profile', '/onboarding', '/logout']);
export const authLimiterSkip = (req) =>
  AUTH_HOUSEKEEPING_PATHS.has(req.path) && verifiedUserId(req) !== null;

export const authLimiter = rateLimit({
  ...SHARED_STRICT, // fail-closed: never let a Redis error unlock login brute-force
  windowMs: 15 * 60 * 1000,
  max: disabled ? 10000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: authLimiterSkip,
  store: makeStore('rl:auth:'),
  message: { error: 'Zu viele Login-Versuche. Bitte versuche es in 15 Minuten erneut.' }
});

// Strict rate limit: 5 attempts/hour (password reset, account deletion, etc.)
export const strictLimiter = rateLimit({
  ...SHARED_STRICT, // fail-closed: password reset / account deletion must stay capped even if Redis errors
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:strict:'),
  message: { error: 'Zu viele Versuche. Bitte versuche es in einer Stunde erneut.' }
});

// Registration flow: 200 attempts/hour per IP. Bumped from 20 to survive a
// 500-user launch event where most signups come from a single NAT. Still
// protects against the bot scenario (a real attacker would need 200+ Sims
// or proxies to register beyond this).
export const registrationLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:reg:'),
  message: { error: 'Zu viele Registrierungsversuche. Bitte versuche es in einer Stunde erneut.' }
});

// Chat message rate limit: 60 messages/minute per authenticated user.
export const messageLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 1000,
  max: disabled ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `msg:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:msg:'),
  message: { error: 'Du sendest zu schnell. Bitte warte einen Moment.' }
});

// Image upload: 30 uploads/hour per user. Each upload spawns sharp + R2 PUT,
// so unthrottled it's an easy way to burn through Cloudflare egress and CPU.
export const uploadLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `upload:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:upload:'),
  message: { error: 'Zu viele Uploads. Bitte versuche es in einer Stunde erneut.' }
});

// Report submission: 10/hour per user. Without this, a malicious user can flood
// admin queues by submitting reports against many target IDs in rapid succession.
export const reportLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `report:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:report:'),
  message: { error: 'Zu viele Meldungen. Bitte versuche es in einer Stunde erneut.' }
});

// In-app feedback: 5/hour per authenticated user. Feedback rows land straight
// in the admin dashboard, so without a cap one user could flood it.
export const feedbackLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `feedback:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:feedback:'),
  message: { error: 'Zu viel Feedback auf einmal. Bitte versuche es später erneut.' }
});

// DM send: 10 messages/minute per authenticated user. Redis-backed so the cap
// holds across instances (the old standalone limiter in dmRoutes had no store →
// it was 10/min PER instance = 20/min effective at 2 replicas).
export const dmSendLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 1000,
  max: disabled ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `dm_send:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:dmsend:'),
  message: { error: 'Zu viele Nachrichten. Bitte warte eine Minute.' }
});

// Friend request: 20/hour per authenticated user. Without this, one user can
// fire thousands of requests at a single victim (each triggering a push
// notification). The general /api limit is per-IP across all routes, so it's
// not protective here.
export const friendRequestLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `friendreq:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:friendreq:'),
  message: { error: 'Zu viele Freundschaftsanfragen. Bitte versuche es in einer Stunde erneut.' }
});
