import * as Sentry from '@sentry/node';

// Fields that must never leave the server. Sentry's default body capture
// could otherwise ship cleartext passwords, tokens, and OAuth secrets to
// its servers along with the error trace.
const SENSITIVE_KEYS = new Set([
  'password', 'newPassword', 'currentPassword',
  'token', 'access_token', 'refresh_token', 'code', 'credential',
  'authorization', 'cookie', 'set-cookie',
  'stripe-signature',
  'p256dh', 'auth_key',
  'spotify_access_token', 'spotify_refresh_token',
]);

function scrub(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[Filtered]' : scrub(v, depth + 1);
  }
  return out;
}

export const initSentry = () => {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
    // Sentry on by default captures req.body, req.cookies, req.headers.
    // Without scrubbing, every auth-error report exfiltrates the user's
    // password and auth_token cookie to Sentry's servers.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        if (event.request.cookies) event.request.cookies = '[Filtered]';
        if (event.request.headers) {
          for (const k of Object.keys(event.request.headers)) {
            if (SENSITIVE_KEYS.has(k.toLowerCase())) event.request.headers[k] = '[Filtered]';
          }
        }
        if (event.request.data && typeof event.request.data === 'object') {
          event.request.data = scrub(event.request.data);
        }
      }
      if (event.extra) event.extra = scrub(event.extra);
      return event;
    },
  });
  console.log('[Sentry] Initialized');
};

export { Sentry };
