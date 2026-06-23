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

// ── Zahlungen (Stripe + IAP) ────────────────────────────────────────────
// Master-Schalter: Bezahlung wird erst ~1–2 Monate nach dem Launch
// freigeschaltet. Bis dahin zeigen ALLE Kauf-Flächen (Boost-Kauf, JAMIE Pro)
// ein „Bald verfügbar" statt einer echten Zahlung. Auf true setzen, sobald
// die Bezahlung live gehen soll (iOS braucht zusätzlich IOS_IAP_ENABLED).
export const PAYMENTS_ENABLED = false;

// ── iOS In-App-Käufe ────────────────────────────────────────────────────
// StoreKit IAP ist noch nicht fertig (Plugin + Apple-Quittungsprüfung offen —
// siehe store/IAP-iOS-OPTIONEN.md). Bis dahin blenden wir auf iOS ALLE
// Kauf-Einstiege aus, damit der App-Store-Build keine kaputten/laut Apple
// unzulässigen Bezahl-Flächen zeigt. Auf true setzen, sobald IAP gebaut +
// getestet ist — die Kauf-Logik ist bereits plattformabhängig verdrahtet.
export const IOS_IAP_ENABLED = false;

// Echte Käufe sind möglich, wenn Zahlungen aktiv sind UND die Plattform sie
// abwickeln kann (Web & Android via Stripe; iOS erst mit fertigem IAP).
export const purchasesEnabled = () =>
  PAYMENTS_ENABLED && (!isNativeIOS() || IOS_IAP_ENABLED);

// Zahlungen sind absichtlich noch zurückgehalten → „Bald verfügbar"-Teaser
// statt die Funktion ganz zu verstecken. Nur Web/Android: iOS bleibt aus
// Apple-Review-Gründen ohne Bezahl-Fläche, bis IAP steht.
export const paymentsComingSoon = () => !PAYMENTS_ENABLED && !isNativeIOS();
