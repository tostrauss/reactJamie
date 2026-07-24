// Deferred Sentry loader.
//
// The @sentry/react SDK is ~90 KB gzipped (tracing + session replay). Importing
// it statically at the entry point forced it into the cold-start critical path:
// the browser had to download, parse and execute all of it BEFORE React could
// mount and paint. This module instead dynamically imports the SDK, so the app
// paints first and Sentry loads afterwards (main.jsx schedules initSentry() on
// an idle callback). Trade-off: errors in the first few ms before load are
// captured slightly late (captureException below kicks off the load on demand),
// and the initial page-load performance trace is skipped — acceptable for the
// large first-paint win on mid-range mobile devices.

let sentryModule = null; // resolved @sentry/react namespace once loaded
let loadPromise = null; // de-dupes concurrent load requests

// Body fields Sentry must NEVER ship along with a frontend error. axios
// retries on 5xx serialize the failing request into the breadcrumb stack,
// which would otherwise carry the user's plaintext password to Sentry.
const SENSITIVE_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'confirmpassword',
  'token', 'access_token', 'refresh_token', 'code', 'credential',
  'authorization', 'cookie',
]);

function scrubObject(obj, depth = 0) {
  if (depth > 6 || obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(v => scrubObject(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[Filtered]' : scrubObject(v, depth + 1);
  }
  return out;
}

// Strip query parameters that carry tokens (?token=xyz on /reset-password,
// /verify-email, /spotify/callback). Sentry's default URL capture would
// otherwise upload these as plaintext error context.
function scrubUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  try {
    const u = new URL(rawUrl, window.location.origin);
    for (const key of ['token', 'code', 'state', 'access_token', 'refresh_token']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '[Filtered]');
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

// Load + initialise the Sentry SDK. Idempotent and safe to call repeatedly:
// concurrent callers share one load, and a load failure never throws (telemetry
// must never break the app). Returns the SDK namespace, or null when disabled.
export function initSentry() {
  if (!import.meta.env.VITE_SENTRY_DSN) return Promise.resolve(null);
  if (loadPromise) return loadPromise;

  loadPromise = import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        integrations: [
          Sentry.browserTracingIntegration(),
          // Replay is privacy-sensitive: mask all text and inputs so a recorded
          // session never includes a typed password or chat content. Specific
          // selectors are also blocked outright so DM bubbles, group messages,
          // and the avatar grid (PII) never enter the recording at all.
          Sentry.replayIntegration({
            maskAllText: true,
            maskAllInputs: true,
            blockAllMedia: true,
            block: ['.chat-message', '.dm-bubble', '.avatar-slot', '.nav-avatar', '.profile-photo'],
            mask: ['[data-sentry-mask]', 'input[type="password"]', 'input[type="email"]'],
          }),
        ],
        tracesSampleRate: import.meta.env.PROD ? 0.05 : 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: import.meta.env.PROD ? 0.1 : 0,
        sendDefaultPii: false,
        beforeSend(event) {
          if (event.request) {
            if (event.request.url)    event.request.url    = scrubUrl(event.request.url);
            if (event.request.cookies) event.request.cookies = '[Filtered]';
            if (event.request.headers) {
              for (const k of Object.keys(event.request.headers)) {
                if (SENSITIVE_KEYS.has(k.toLowerCase())) event.request.headers[k] = '[Filtered]';
              }
            }
            if (event.request.data && typeof event.request.data === 'object') {
              event.request.data = scrubObject(event.request.data);
            }
          }
          if (event.breadcrumbs) {
            for (const bc of event.breadcrumbs) {
              if (bc?.data?.url) bc.data.url = scrubUrl(bc.data.url);
              if (bc?.data && typeof bc.data === 'object') bc.data = scrubObject(bc.data);
            }
          }
          if (event.extra) event.extra = scrubObject(event.extra);
          return event;
        },
      });
      sentryModule = Sentry;
      return Sentry;
    })
    .catch((err) => {
      // Telemetry loading must never break the app.
      console.warn('Sentry failed to load:', err);
      return null;
    });

  return loadPromise;
}

// Report an exception. If the SDK has already loaded, report immediately;
// otherwise trigger the load and report once it's ready (so an early crash,
// before the idle-callback init, is still captured — just a moment late).
export function captureException(error, context) {
  if (sentryModule) {
    sentryModule.captureException(error, context);
    return;
  }
  initSentry().then((Sentry) => {
    if (Sentry) Sentry.captureException(error, context);
  });
}
