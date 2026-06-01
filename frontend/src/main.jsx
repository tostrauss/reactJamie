import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

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

if (import.meta.env.VITE_SENTRY_DSN) {
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
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
