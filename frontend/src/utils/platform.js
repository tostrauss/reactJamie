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

// ── Native API origin ───────────────────────────────────────────────────
// In nativen Builds wird die WebView-Origin (https://app.jamie-app.com)
// KOMPLETT vom lokalen Capacitor-Scheme-Handler bedient — jeder XHR an diese
// Origin bekommt den SPA-Fallback (index.html, HTTP 200) statt des echten
// Backends. Die App-Review-Ablehnung vom 2026-07-03 (2.1a: „after tapping
// sign in the app returns to the login screen", Build 1.0(4)) war genau das:
// POST /api/auth/login „gelang" mit HTML als Body, data.user war undefined,
// ProtectedRoute warf zurück auf /login. Native spricht deshalb dieselbe
// Railway-Instanz über eine ZWEITE Domain an. api.jamie-app.com ist same-site
// zur WebView-Origin (jamie-app.com) → der httpOnly-Auth-Cookie fließt weiter
// (SameSite=Lax) und Sessions überleben App-Neustarts.
export const NATIVE_API_ORIGIN = 'https://api.jamie-app.com';

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
