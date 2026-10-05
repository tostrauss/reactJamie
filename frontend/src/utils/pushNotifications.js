/**
 * Web Push (VAPID) subscription helpers.
 * Works in browser + Android TWA. iOS native uses @capacitor/push-notifications instead.
 */
import { push as pushApi } from './api.js';
import { isNative } from './platform.js';
import { safeStorage } from './safeStorage.js';

const SW_SCOPE = '/';

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

/**
 * Create (or repair) this browser's PushSubscription and register it with the
 * backend. Needs permission to be 'granted' already. Throws on failure.
 */
const ensureSubscription = async () => {
  const reg = await navigator.serviceWorker.ready;
  const { data } = await pushApi.getVapidKey();
  const serverKey = urlBase64ToUint8Array(data.publicKey);
  let sub = await reg.pushManager.getSubscription();

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
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey,
    });
  }
  await pushApi.subscribe(sub.toJSON());
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
    if (permission !== 'granted') return false;
    safeStorage.removeItem(OPT_OUT_KEY);
    return await ensureSubscription();
  } catch (err) {
    console.error('Push subscribe failed:', err);
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
    return await ensureSubscription();
  } catch (err) {
    console.warn('Push subscription sync failed:', err);
    return false;
  }
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
 * Returns true if currently subscribed to push.
 */
export const isPushSubscribed = async () => {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
};
