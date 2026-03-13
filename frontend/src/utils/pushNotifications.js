/**
 * Web Push (VAPID) subscription helpers.
 * Works in browser + Android TWA. iOS native uses @capacitor/push-notifications instead.
 */
import { push as pushApi } from './api.js';
import { isNative } from './platform.js';

const SW_SCOPE = '/';

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
 * Request permission, subscribe to push, and register with backend.
 * Returns true on success, false otherwise.
 */
export const subscribeToPush = async () => {
  if (!isPushSupported()) return false;

  try {
    // 1. Fetch VAPID public key from backend
    const { data } = await pushApi.getVapidKey();
    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

    // 2. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    // 3. Get service worker registration
    const reg = await navigator.serviceWorker.ready;

    // 4. Subscribe
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // 5. Send subscription to backend
    await pushApi.subscribe(subscription.toJSON());
    return true;
  } catch (err) {
    console.error('Push subscribe failed:', err);
    return false;
  }
};

/**
 * Unsubscribe from push and remove from backend.
 */
export const unsubscribeFromPush = async () => {
  if (!isPushSupported()) return;

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
