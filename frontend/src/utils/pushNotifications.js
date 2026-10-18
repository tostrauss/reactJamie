/**
 * Web Push (VAPID) subscription helpers.
 * Works in browser + Android TWA. iOS native uses @capacitor/push-notifications instead.
 */
import { push as pushApi } from './api.js';
import { isNative } from './platform.js';
import { safeStorage } from './safeStorage.js';
import { reportPushDiag, reportPushStart, pushStartDue, describePushError } from './pushDiagnostics.js';

const SW_SCOPE = '/';

// Snooze key of WebPushDeniedBanner (components/NativePushDeniedBanner.jsx).
// Lives here because a FRESH denial — the user just answered the prompt with
// "Nicht zulassen" — writes it (subscribeToPush), exactly like useNativePush
// does for iOS: the "so schaltest du sie wieder ein" banner must not nag
// three seconds after a deliberate no, only about a denial from before.
export const WEB_PUSH_DENIED_DISMISS_KEY = 'jamie_web_push_denied_dismissed';

// "Push on this device: off" — set when the user switches push off in
// Settings. Without it the switch did not stick: unsubscribing leaves the
// browser permission at 'granted', so the silent repair in
// syncPushSubscription re-created the subscription on the next app start and
// the user got pushes again. Per device on purpose (it describes this browser
// profile, like the permission does) and kept across logout — the Settings
// toggle shows the real subscription state, so the next account here sees
// "off" and can switch it on.
const OPT_OUT_KEY = 'jamie_push_optout';
export const hasOptedOutOfPush = () => safeStorage.getItem(OPT_OUT_KEY) === '1';

/** Convert a base64url VAPID public key to a Uint8Array. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Returns true if the browser supports push notifications. */
export const isPushSupported = () =>
  !isNative() &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** Returns the current Notification permission state. */
export const getPushPermission = () =>
  isPushSupported() ? Notification.permission : 'denied';

// Tags a failure with the step it came from, for the [push-diag] line
// ("subscribe:AbortError …" vs "post:http500 …").
const step = (stage, promise) => Promise.resolve(promise).catch((err) => {
  const e = err && typeof err === 'object' ? err : new Error(String(err));
  if (!e.pushStage) e.pushStage = stage;
  throw e;
});

// navigator.serviceWorker.ready never rejects — when the worker never
// activates it waits forever, and the repair hung without a trace. Not raced
// (a first start may legitimately precache for a while): only a breadcrumb if
// it is still pending after 20 s.
const SW_READY_WARN_MS = 20_000;
const swReady = () => {
  const timer = setTimeout(() => {
    reportPushDiag('subscribe_failed', { permission: getPushPermission(), detail: 'sw:Timeout service worker not ready after 20 s' });
  }, SW_READY_WARN_MS);
  return navigator.serviceWorker.ready.finally(() => clearTimeout(timer));
};

// POST /push/subscribe answers 409 { resubscribe: true } for an endpoint the
// push service already declared dead (404/410 → pruned → remembered, backend
// pushController.subscribe). Checked on the flag, not the status alone.
const isDeadSubscriptionAnswer = (err) =>
  err?.response?.status === 409 && err.response.data?.resubscribe === true;

/**
 * Create (or repair) this browser's PushSubscription and register it with the
 * backend. Needs permission to be 'granted' already. Throws on failure.
 * `mode`: 'optin' (a tap) or 'sync' (silent start-up repair) — only decides
 * what the [push-diag] success line says.
 */
const ensureSubscription = async (mode) => {
  const reg = await step('sw', swReady());
  const { data } = await step('vapid', pushApi.getVapidKey());
  const serverKey = urlBase64ToUint8Array(data.publicKey);
  let sub = await step('subscribe', reg.pushManager.getSubscription());
  // What changed, for the success line. A silent re-post of a healthy
  // subscription (every app start) reports nothing — the daily `start` covers it.
  let change = null;

  // Self-heal after a VAPID key rotation: subscribe() over an existing sub
  // with a DIFFERENT applicationServerKey throws (was caught and swallowed
  // → push permanently dead for the whole installed base with no repair
  // path). Detect the mismatch and re-subscribe under the new key.
  if (sub?.options?.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey);
    const mismatch = current.length !== serverKey.length
      || current.some((b, i) => b !== serverKey[i]);
    if (mismatch) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
      change = 'key-rotated';
    }
  }

  const subscribeFresh = (stage) => step(stage, reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: serverKey,
  }));

  if (!sub) {
    sub = await subscribeFresh('subscribe');
    if (!change) change = 'created';
  }
  try {
    await step('post', pushApi.subscribe(sub.toJSON()));
  } catch (err) {
    if (!isDeadSubscriptionAnswer(err)) throw err;
    // The push service declared THIS endpoint dead, but the browser keeps
    // handing it back until it is unsubscribed — before this, the app
    // re-posted it on every start and the next push pruned it again, forever
    // (Lea, 18.10.2026). Drop it and register a fresh one: the permission is
    // already granted, so no prompt. ONE retry — a second refusal throws.
    await sub.unsubscribe().catch(() => {});
    sub = await subscribeFresh('resubscribe');
    await step('resubscribe', pushApi.subscribe(sub.toJSON()));
    change = 'resubscribed';
  }
  if (mode === 'optin' || change) {
    reportPushDiag('subscribed', {
      permission: getPushPermission(),
      detail: mode === 'optin' ? `optin${change ? ` ${change}` : ''}` : change,
    });
  }
  return true;
};

/**
 * Request permission, subscribe to push, and register with backend — the
 * explicit opt-in (banner "Aktivieren", Settings toggle on). Must be called
 * straight from the tap. Returns true on success, false otherwise.
 */
export const subscribeToPush = async () => {
  if (!isPushSupported()) return false;

  try {
    // The permission prompt is the FIRST await. WebKit (iPhone home-screen
    // app, Safari) only shows it while the tap's user activation is alive;
    // this used to fetch the VAPID key first, so by the time it asked, the
    // gesture was gone and WebKit answered 'denied' without ever showing a
    // prompt — and the banner then snoozed itself for two weeks.
    const permission = await Notification.requestPermission();
    // What the prompt answered — in the Play app that is Android's own
    // dialog, and a "no" there sticks (the suspected Android opt-in gap).
    reportPushDiag('permission', { permission, detail: 'prompt' });
    if (permission !== 'granted') {
      if (permission === 'denied') safeStorage.setItem(WEB_PUSH_DENIED_DISMISS_KEY, String(Date.now()));
      return false;
    }
    safeStorage.removeItem(OPT_OUT_KEY);
    return await ensureSubscription('optin');
  } catch (err) {
    console.error('Push subscribe failed:', err);
    reportPushDiag('subscribe_failed', { permission: getPushPermission(), detail: describePushError(err) });
    return false;
  }
};

/**
 * Silent create-or-repair of the push subscription — requires permission to
 * ALREADY be 'granted' (no prompt is ever shown; pushManager.subscribe needs
 * no user gesture in that state).
 *
 * Why this exists: permission ≠ subscription. In the Play-TWA, Android's
 * app-level notification prompt (POST_NOTIFICATIONS) sets
 * Notification.permission to 'granted' without any web PushSubscription ever
 * being created — and the NotificationPrompt banner deliberately skips
 * non-'default' states, so nothing ever subscribed: members granted the
 * permission and still got no push (Lea, 2026-07-30). Also re-registers an
 * existing subscription with the backend, healing rows that were pruned
 * after transient endpoint failures.
 */
export const syncPushSubscription = async () => {
  if (!isPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  // Switched off in Settings — a silent repair must not overrule that.
  if (hasOptedOutOfPush()) return false;
  try {
    return await ensureSubscription('sync');
  } catch (err) {
    console.warn('Push subscription sync failed:', err);
    reportPushDiag('subscribe_failed', { permission: 'granted', detail: describePushError(err) });
    return false;
  }
};

// Whether this browser holds a PushSubscription at all, whatever the
// permission says — the leftover case isPushSubscribed() now ignores is
// exactly what the diagnostics line has to show.
const hasLocalSubscription = async () => {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    return !!(reg && await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
};

/**
 * The daily [push-diag] `start` line: permission + local subscription as this
 * app start FOUND them. Resolves once that state is read — call it before the
 * start-up repair touches the subscription; the request itself runs on.
 * Not on native iOS ([APNs-diag] covers it); a browser without the Push API is
 * reported as 'unsupported' — from the outside it looks exactly like "no push".
 */
export const reportPushStartDiagnostics = async () => {
  if (isNative() || !pushStartDue()) return;
  const supported = isPushSupported();
  const permission = supported ? Notification.permission : 'unsupported';
  const hasSubscription = supported && await hasLocalSubscription();
  reportPushStart({ permission, hasSubscription });
};

/**
 * Unsubscribe from push and remove from backend.
 * `optOut: true` = the user switched push off (Settings) — remembered, so the
 * next app start does not silently subscribe again. Logout passes nothing: it
 * only detaches this device from the account.
 */
export const unsubscribeFromPush = async ({ optOut = false } = {}) => {
  if (!isPushSupported()) return;
  if (optOut) safeStorage.setItem(OPT_OUT_KEY, '1');

  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    await pushApi.unsubscribe(sub.endpoint);
    await sub.unsubscribe();
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
  }
};

/**
 * Returns true if pushes can actually reach this browser: a subscription AND
 * the permission. A leftover subscription without 'granted' delivers nothing,
 * yet it used to count — the banner stayed away (NotificationPrompt) and
 * Settings showed "an" while every push was dropped (Lea, 18.10.2026).
 */
export const isPushSubscribed = async () => {
  if (!isPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
};
