/**
 * Platform detection utilities.
 * Safe to call on web — Capacitor injects `window.Capacitor` only in native builds.
 */
import { getPaymentsConfig } from './paymentsConfig';

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
    // Match OUR package exactly: Chrome also sets android-app://<other.app>
    // when a link is opened FROM another app (WhatsApp share → real browser),
    // and those users must not be treated as in-TWA (they'd lose checkout).
    const fromReferrer = document.referrer.startsWith('android-app://jamie.app');
    const latched = sessionStorage.getItem('jamie_twa') === '1';
    if (fromReferrer) sessionStorage.setItem('jamie_twa', '1');
    _twaCached = fromReferrer || latched;
  } catch {
    _twaCached = typeof document !== 'undefined' && document.referrer.startsWith('android-app://jamie.app');
  }
  return _twaCached;
};

// Any installed app wrapper (iOS/Android Capacitor OR the Android TWA) — i.e.
// NOT a plain web browser. In-app digital purchases via Stripe are only
// compliant in a real browser; every app shell must route through the store's
// billing (Play Billing / StoreKit via RevenueCat), see purchasesEnabled below.
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
// Seit 23.09.2026 entscheidet der SERVER zur Laufzeit (GET /api/iap/config,
// utils/paymentsConfig.js), nicht mehr eine Konstante hier. Grund: die
// iOS-App bündelt das Web-Build. Eine Konstante wäre bis zum nächsten
// App-Store-Release eingefroren gewesen. Schalter jetzt in Railway:
//   PAYMENTS_ENABLED=true      Master (Stripe im Web-Browser)
//   IOS_IAP_ENABLED=true       iPhone-App verkauft über RevenueCat/StoreKit
//   PLAY_BILLING_ENABLED=true  Play-App (TWA) verkauft über Google Play Billing
// ROLLBACK: den jeweiligen Schalter in Railway auf false. Wirkt beim nächsten
// App-Start auf ALLEN Clients, und der Server 403t neue Käufe sofort.
//
// Historie der alten Konstante: 03.09. live und am selben Tag wieder aus,
// weil ~70 % der Nutzer auf iOS sind und dort ohne StoreKit-IAP nichts
// verkauft werden durfte. Verkauf im Web serverseitig auf AT+DE begrenzt
// (backend utils/paymentRegion.js). Apple und Google führen die USt selbst ab.
export const paymentsEnabled = () => getPaymentsConfig().payments_enabled;

// ── iOS In-App-Käufe (RevenueCat) ───────────────────────────────────────
// Aktiv nur in der nativen iOS-App UND wenn der Server es freigibt. Der Server
// gibt es nur frei, wenn er Käufe auch prüfen kann (REVENUECAT_SECRET_API_KEY),
// damit Apple nie abbucht, ohne dass wir Pro vergeben können.
export const isIosIapActive = () => isNativeIOS() && getPaymentsConfig().ios_iap_enabled;

// ── Google Play Billing (Android-TWA) ───────────────────────────────────
// Runbook store/PLAY-BILLING-SETUP.md. Boosts bleiben dort OHNE Kauf-Tab
// (keine Einzelkäufe, Tina 21.09.).

// Chrome stellt Digital-Goods- + Payment-Request-API nur in einer TWA bereit,
// deren Android-Shell das billing-Extension mitbringt. Ein ALTER Play-Build
// (versionCode ≤ 10) hat `getDigitalGoodsService` nicht → dort bleibt alles
// beim „Bald verfügbar"-Teaser, statt in einen kaputten Kauf zu laufen.
export const isPlayBillingSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.getDigitalGoodsService === 'function' &&
  typeof window.PaymentRequest === 'function';

// Play Billing ist der aktive Kaufweg: in der TWA, freigeschaltet, und die
// Shell kann es.
export const isPlayBillingActive = () =>
  getPaymentsConfig().play_billing_enabled && isTWA() && isPlayBillingSupported();

// Ein Store-Kaufweg (StoreKit oder Play) ist aktiv: dann gibt es auch
// „Käufe wiederherstellen" und die Abo-Bedingungen am Kaufpunkt.
export const isStoreBillingActive = () => isIosIapActive() || isPlayBillingActive();

// Echte Käufe möglich? Stripe nur im echten Web-Browser. In jeder App-Hülle
// (iOS/Android-Capacitor + Android-TWA) ist Stripe für digitale Güter laut
// Store-Richtlinien unzulässig. Dort nur über den Store-Kaufweg. Der
// ProModal-Kauf verzweigt entsprechend (RevenueCat / Play / Stripe). Der
// Server-Backstop isAppShellRequest blockt Stripe aus den Hüllen weiterhin.
export const purchasesEnabled = () =>
  paymentsEnabled() && (!isAppShell() || isStoreBillingActive());

// Darf die App für Pro werben (Pro-Lock, „Pro holen", Upsell-Modal)? Überall
// außer in der iOS-App ohne Kaufweg: dort verbietet Apple 3.1.1 Hinweise auf
// Käufe, die in der App nicht möglich sind. Im Web und in der Play-App zeigt
// das Modal ohne Kaufweg den „Bald verfügbar"-Teaser.
export const proUpsellAllowed = () => !isNativeIOS() || isIosIapActive();

// Boost-EINZELKÄUFE gibt es seit 21.09.2026 NIRGENDS mehr (Tina + Tobi:
// „Boosts bleiben, nur keine Einzelkäufe") — Boosten ist ein Pro-Feature, das
// BoostModal hat keinen Kauf-Tab mehr. Server: features.js
// BOOST_SINGLE_PURCHASES_ENABLED (createStripeIntent → 410).

// In den App-Hüllen (außer iOS) zeigen wir statt einer echten Zahlung einen
// „Bald verfügbar"-Teaser mit Interesse-Button — kein Kauf, kein Verweis auf
// externe Bezahlung (Apple/Google Anti-Steering). iOS ohne Kaufweg bleibt
// komplett neutral.
export const paymentsComingSoon = () => !purchasesEnabled() && !isNativeIOS();
