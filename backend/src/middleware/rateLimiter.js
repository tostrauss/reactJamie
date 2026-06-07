import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';

// Rate limits are always enforced. Set DISABLE_RATE_LIMIT=true only in local dev.
const disabled = process.env.DISABLE_RATE_LIMIT === 'true';

const makeStore = (prefix) =>
  redisClient
    ? new RedisStore({ prefix, sendCommand: (...args) => redisClient.call(...args) })
    : undefined; // undefined = in-memory store (single instance only)

// If Redis goes down mid-flight the store throws — degrade gracefully by
// passing the request through instead of returning 500.
const SHARED = { passOnStoreError: true };

// General API rate limit: 500 req/15min
export const generalLimiter = rateLimit({
  ...SHARED,
  windowMs: 15 * 60 * 1000,
  max: disabled ? 10000 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:general:'),
  message: { error: 'Zu viele Anfragen. Bitte versuche es in 15 Minuten erneut.' }
});

// Auth rate limit: 20 attempts/15min
export const authLimiter = rateLimit({
  ...SHARED,
  windowMs: 15 * 60 * 1000,
  max: disabled ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:auth:'),
  message: { error: 'Zu viele Login-Versuche. Bitte versuche es in 15 Minuten erneut.' }
});

// Strict rate limit: 5 attempts/hour (password reset, account deletion, etc.)
export const strictLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:strict:'),
  message: { error: 'Zu viele Versuche. Bitte versuche es in einer Stunde erneut.' }
});

// Registration flow: 20 attempts/hour — separate counter from strictLimiter.
export const registrationLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 20,
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
