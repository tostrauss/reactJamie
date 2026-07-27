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

// ── TWA detection ─────────────────────────────────────────────────────────
// The Android Play app is a Trusted Web Activity: a Play-distributed wrapper
// that loads the LIVE web PWA (app.jamie-app.com). It runs as ordinary web —
// window.Capacitor is absent — so without explicit detection it looks like a
// browser. We MUST know we're inside it, because selling digital goods
// (Pro/Boosts) via Stripe inside a Play-distributed app violates Google Play's
// billing policy and can get JAMIE removed from Play. The TWA launch navigation
// carries an `android-app://<package>` referrer; SPA route changes don't reload
// the document so document.referrer stays put, but a hard reload can drop it —
// hence we also latch the result in sessionStorage.
let _twaCached = null;
export const isTWA = () => {
  if (_twaCached !== null) return _twaCached;
  if (typeof window === 'undefined') return false;
  try {
    const fromReferrer = document.referrer.startsWith('android-app://');
    const latched = sessionStorage.getItem('jamie_twa') === '1';
    if (fromReferrer) sessionStorage.setItem('jamie_twa', '1');
    _twaCached = fromReferrer || latched;
  } catch {
    _twaCached = typeof document !== 'undefined' && document.referrer.startsWith('android-app://');
  }
  return _twaCached;
};

// Any installed app wrapper (iOS/Android Capacitor OR the Android TWA) — i.e.
// NOT a plain web browser. In-app digital purchases via Stripe are only
// compliant in a real browser; every app shell must route through the store's
// billing (Play Billing / StoreKit), which isn't built yet.
export const isAppShell = () => isNative() || isTWA();

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
// Master-Schalter für ECHTE Stripe-Zahlungen. Seit 2026-07-27 LIVE — aber
// NUR im echten Web-Browser (siehe purchasesEnabled). In den installierten
// Apps (iOS-Capacitor + Android-TWA) bleiben Käufe aus: dort schreibt der
// Store seine eigene Bezahl-Abwicklung vor (Play Billing / StoreKit), die noch
// nicht gebaut ist. Stripe im Play-/App-Store-Wrapper = Richtlinienverstoß.
export const PAYMENTS_ENABLED = true;

// ── iOS In-App-Käufe ────────────────────────────────────────────────────
// StoreKit IAP ist noch nicht fertig (Plugin + Apple-Quittungsprüfung offen —
// siehe store/IAP-iOS-OPTIONEN.md). Bis dahin blenden wir auf iOS ALLE
// Kauf-Einstiege aus, damit der App-Store-Build keine kaputten/laut Apple
// unzulässigen Bezahl-Flächen zeigt. Auf true setzen, sobald IAP gebaut +
// getestet ist — die Kauf-Logik ist bereits plattformabhängig verdrahtet.
export const IOS_IAP_ENABLED = false;

// Echte Stripe-Käufe nur im echten Web-Browser. Jede installierte App-Hülle
// (iOS/Android-Capacitor + Android-TWA) ist ausgenommen — dort ist Stripe für
// digitale Güter laut Store-Richtlinien unzulässig, bis Play Billing/StoreKit
// steht. (IOS_IAP_ENABLED bleibt der spätere Schalter für den iOS-IAP-Weg.)
export const purchasesEnabled = () => PAYMENTS_ENABLED && !isAppShell();

// In den App-Hüllen (außer iOS) zeigen wir statt einer echten Zahlung einen
// „Bald verfügbar"-Teaser mit Interesse-Button — kein Kauf, kein Verweis auf
// externe Bezahlung (Apple/Google Anti-Steering). iOS bleibt komplett neutral.
export const paymentsComingSoon = () => !purchasesEnabled() && !isNativeIOS();
