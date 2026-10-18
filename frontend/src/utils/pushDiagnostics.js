/**
 * Web / Play-app (TWA) push diagnostics — the client half of `[push-diag]`
 * (backend pushController.reportPushDiagnostics).
 *
 * Lea, 18.10.2026: „Bei vielen Android-Nutzern funktionieren die
 * Push-Benachrichtigungen gar nicht." Every web-side failure ended in the
 * browser console (pushNotifications.js), so the server could not tell a
 * denied Android permission from a dead subscription from a push service that
 * refused subscribe(). The iOS app has reported its side since 04.09.
 * ([APNs-diag], useNativePush in App.jsx); this is the same for the web app
 * and the Play app. Fire-and-forget throughout — diagnostics never break push.
 */
import { push as pushApi } from './api.js';
import { isTWA, isAndroidWeb, isIOSWeb, displayMode } from './platform.js';
import { safeStorage } from './safeStorage.js';

// `start` = what an app start found (permission, local subscription). Once a
// day per device is enough to see who is stuck, and keeps the line count far
// below one per app start.
export const START_KEY = 'jamie_push_diag_start';
const START_EVERY_MS = 24 * 60 * 60 * 1000;

// The server allowlists exactly these.
export const webPushPlatform = () => {
  if (isTWA()) return 'twa';
  if (isAndroidWeb()) return 'android-web';
  if (isIOSWeb()) return 'ios-web';
  return 'web';
};

// Chrome's reduced UA reports "Android 10; K" on every phone; the real major
// version only comes from the high-entropy client hints. Android 13 is where
// its own notification dialog (POST_NOTIFICATIONS) comes in, so it matters.
const androidMajor = async () => {
  try {
    const uad = navigator.userAgentData;
    if (uad?.platform === 'Android' && typeof uad.getHighEntropyValues === 'function') {
      const { platformVersion } = await uad.getHighEntropyValues(['platformVersion']);
      const major = parseInt(platformVersion, 10);
      if (major > 0) return String(major);
    }
    const ua = navigator.userAgent || '';
    const m = /Android (\d+)/.exec(ua);
    if (m && !/Android 10; K\)/.test(ua)) return m[1];
  } catch { /* no client hints here */ }
  return undefined;
};

const send = async (event, fields) => {
  try {
    await pushApi.reportDiagnostics({
      platform: webPushPlatform(),
      display_mode: displayMode(),
      android: await androidMajor(),
      event,
      ...fields,
    });
    return true;
  } catch {
    return false;
  }
};

// Once per page load per (event, permission, detail): NotificationPrompt
// mounts again whenever a modal comes and goes, and every mount re-runs the
// silent repair — a repair failing the same way must not report itself on
// each of them.
const reported = new Set();

/** Report one event ('permission' | 'subscribed' | 'subscribe_failed'). */
export const reportPushDiag = (event, fields = {}) => {
  const key = `${event}|${fields.permission ?? ''}|${fields.detail ?? ''}`;
  if (reported.has(key)) return Promise.resolve(false);
  reported.add(key);
  return send(event, fields);
};

/** True when this device has not reported a `start` in the last 24 h. */
export const pushStartDue = () => {
  const last = parseInt(safeStorage.getItem(START_KEY) || '0', 10);
  const age = Date.now() - last;
  return !(last && age >= 0 && age < START_EVERY_MS);
};

/** The daily `start` line. Resolves true when it was sent. */
export const reportPushStart = async ({ permission, hasSubscription }) => {
  if (!pushStartDue()) return false;
  // Claimed before the request: two mounts racing must not both send.
  safeStorage.setItem(START_KEY, String(Date.now()));
  const ok = await send('start', { permission, has_subscription: !!hasSubscription });
  // Offline start (or an older server) — try again on the next one.
  if (!ok) safeStorage.removeItem(START_KEY);
  return ok;
};

/**
 * "<stage>:<error> <message>" for a failed subscribe. The stage says which
 * step broke (pushNotifications.js tags it), the error is the DOMException
 * name — AbortError = the push service refused, NotAllowedError = permission
 * — or our own API's HTTP status.
 */
export const describePushError = (err) => {
  const stage = err?.pushStage || '-';
  let name;
  let message;
  if (err?.isAxiosError || err?.response) {
    name = err.response ? `http${err.response.status}` : (err.code || 'network');
    message = err.response?.data?.error || '';
  } else {
    name = err?.name || 'Error';
    message = err?.message || (typeof err === 'string' ? err : '');
  }
  return `${stage}:${name}${message ? ` ${message}` : ''}`.slice(0, 160);
};

/** Test hook. */
export const _resetPushDiagForTests = () => { reported.clear(); };
