import rateLimit from 'express-rate-limit';

// Rate limits are always enforced. Set DISABLE_RATE_LIMIT=true only in local dev.
const disabled = process.env.DISABLE_RATE_LIMIT === 'true';

// General API rate limit: 100 req/15min
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: disabled ? 10000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte versuche es in 15 Minuten erneut.' }
});

// Auth rate limit: 10 attempts/15min
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: disabled ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Login-Versuche. Bitte versuche es in 15 Minuten erneut.' }
});

// Strict rate limit: 5 attempts/hour
export const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: disabled ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte versuche es in einer Stunde erneut.' }
});
