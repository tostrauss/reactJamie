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
// TV-spike readiness (2M2M, 2026-08-04): the signup funnel has its own,
// tighter guards — registrationLimiter per IP plus per-EMAIL throttles
// (send cooldown/hourly cap in sendEmailCode, 5-attempt in-DB cap in
// verifyEmailCode). Exempting these three from the shared 100/15min/IP
// budget means a carrier-NAT full of new viewers can't starve /login —
// and vice versa. /login, /google*, /apple, /forgot-password etc. keep
// the strict shared budget.
export const AUTH_SIGNUP_PATHS = new Set(['/send-email-code', '/verify-email-code', '/register']);
export const authLimiterSkip = (req) =>
  AUTH_SIGNUP_PATHS.has(req.path)
  || (AUTH_HOUSEKEEPING_PATHS.has(req.path) && verifiedUserId(req) !== null);

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

// ── The former one-size strictLimiter, split three ways ────────────────────
//
// It was ONE instance with no keyGenerator — so one 5/hour bucket per IP,
// shared across /password, /account, /export, /forgot-password,
// /reset-password, /verify-email, the Stripe withdrawal, the two IAP routes,
// the public contact form and the waitlist. A single successful password reset
// burned 2 of the 5 and the verification link a third, so on a carrier NAT the
// third user to tap "Passwort vergessen" got a 429 on their FIRST attempt, for
// an hour, on the one screen where a returning user has no alternative.
//
// This is exactly the diagnosis already written one file over (authRoutes.js:16
// — "5/h shared across an entire NAT (CGNAT carriers, event WiFi) locked out
// real users"); it was applied to social login and never carried across to
// account recovery. Separate `store` prefixes are what stops the budgets
// cross-contaminating. Audit 2026-09-15, finding 5.

// Authenticated sensitive operations: password change, account deletion, GDPR
// export, subscription withdrawal, IAP verify/restore. These all run AFTER
// `authenticate`, so there is no reason to key them by IP at all — today one
// user's GDPR export burns a NAT-mate's password change. Per user, fail-closed.
export const strictLimiter = rateLimit({
  ...SHARED_STRICT,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `strict:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:strict:'),
  message: { error: 'Zu viele Versuche. Bitte versuche es in einer Stunde erneut.' }
});

// Password reset (public, pre-auth). NAT-survivable per-IP ceiling: this is the
// mass-abuse brake only. The real protection is the per-EMAIL throttle inside
// forgotPassword, which holds across replicas and protects the victim's inbox
// no matter how many IPs an attacker has — something an IP cap never did.
export const passwordResetLimiter = rateLimit({
  ...SHARED_STRICT,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:pwreset:'),
  message: { error: 'Zu viele Versuche. Bitte versuche es in einer Stunde erneut.' }
});

// Public marketing endpoints (website contact form, waitlist signup). Their own
// bucket so a contact-form submission can never 429 somebody's password reset.
export const publicFormLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:pubform:'),
  message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' }
});

// Registration flow: 600 attempts/hour per IP (raised from 200 for the 2M2M
// TV-spike scenario, 2026-08-04: thousands of viewers behind a handful of
// carrier-NAT IPv4s signing up in the ~30min after airing; a full signup
// burns 3-4 calls → ~150-200 complete signups/h per NAT IP). The per-IP cap
// is no longer the primary abuse brake — that's now the per-EMAIL layer:
// send cooldown 60s + 6 codes/h per email (sendEmailCode, in-DB → holds
// across replicas) and the 5-attempt per-code verify cap. This cap remains
// as the mass-mail ceiling for a single bot IP.
export const registrationLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 600,
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

// Image upload: 60 uploads/hour per user. Each upload spawns sharp + a
// Sightengine call + an R2 PUT, so unthrottled it's an easy way to burn through
// Cloudflare egress and CPU.
//
// Was 30, sized for avatars, banners and event photos — one-off actions. Chat
// photos (2026-09-15) put a conversational feature on the same counter, where
// one message equals one upload, so the ceiling had to move. Concurrency is
// still bounded by the admission queue in uploadRoutes, which is what actually
// protects the box; this counter is the per-user abuse ceiling.
export const uploadLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `upload:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:upload:'),
  message: { error: 'Zu viele Uploads. Bitte versuche es in einer Stunde erneut.' }
});

// Voice notes: 120/hour per user, on their OWN counter.
//
// They were on uploadLimiter's 30/hour avatar budget, which two friends
// trading voice notes exhaust in well under an hour of talking — the cap is 2
// minutes per note, so 30 notes is not heavy use, it is a normal evening. Worse,
// it was one SHARED counter: running out of voice notes also blocked changing
// your avatar, adding an event photo or creating a group with an image, with a
// message telling you to come back in an hour.
//
// Higher than the image budget because a voice note is much cheaper: no sharp
// pipeline and no Sightengine call (recorded speech can't be text-moderated —
// voice relies on the reactive report path).
export const voiceUploadLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `voice:${req.userId}`,
  validate: { keyGeneratorIpFallback: false },
  store: makeStore('rl:voice:'),
  message: { error: 'Zu viele Sprachnachrichten. Bitte versuche es später erneut.' }
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
