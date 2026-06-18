/**
 * Platform detection utilities.
 * Safe to call on web — Capacitor injects `window.Capacitor` only in native builds.
 */

export const isNative = () =>
  typeof window !== 'undefined' &&
  window.Capacitor?.isNativePlatform?.() === true;

export const isNativeIOS = () =>
  isNative() && window.Capacitor?.getPlatform?.() === 'ios';

export const isNativeAndroid = () =>
  isNative() && window.Capacitor?.getPlatform?.() === 'android';

// ── iOS In-App-Käufe ────────────────────────────────────────────────────
// StoreKit IAP ist noch nicht fertig (Plugin + Apple-Quittungsprüfung offen —
// siehe store/IAP-iOS-OPTIONEN.md). Bis dahin blenden wir auf iOS ALLE
// Kauf-Einstiege aus, damit der App-Store-Build keine kaputten/laut Apple
// unzulässigen Bezahl-Flächen zeigt. Auf true setzen, sobald IAP gebaut +
// getestet ist — die Kauf-Logik ist bereits plattformabhängig verdrahtet.
export const IOS_IAP_ENABLED = false;

// Käufe sollen angeboten werden, wenn:
//   - Web & Android: immer (Stripe)
//   - iOS: nur wenn IAP aktiviert
export const purchasesEnabled = () => !isNativeIOS() || IOS_IAP_ENABLED;
