// Backend feature flags (server-side counterpart to frontend/src/utils/platform.js).
//
// Empfehlungs-Boosts deaktiviert (Tina, 2026-06-24): "keine Gratis-Boosts".
// Empfehlungscodes werden weiterhin erzeugt und ihr used_count getrackt
// (Wachstums-Attribution bleibt erhalten), sie vergeben aber KEINE
// Boost-Credits mehr — weder beim Einlösen über das Boost-Modal noch beim
// Registrieren mit Empfehlungscode. Auf true setzen, um Gratis-Boosts via
// Empfehlung wieder zu aktivieren.
export const REFERRAL_CREDITS_ENABLED = false;

// Master payments kill-switch — the SERVER-SIDE counterpart of the frontend's
// PAYMENTS_ENABLED const (frontend/src/utils/platform.js). platform.js has
// instructed setting `PAYMENTS_ENABLED=false` in Railway since 2026-08-05
// („härtet die API ab") — but until now NOTHING read it: with the frontend
// flag off, the live Stripe intent/subscription endpoints were still directly
// callable by any authenticated user (audit 2026-09-02). This makes the
// documented env var real. Fail-closed: payments are OFF unless Railway
// explicitly sets PAYMENTS_ENABLED=true (flip it together with the frontend
// const when Pro/Boosts launch). Gates NEW money only — createStripeIntent,
// createSubscription, and the Apple IAP verify path. Webhooks and the Stripe
// Customer Portal stay open on purpose: refunds/disputes must keep processing
// and any existing (test) subscriber must still be able to cancel.
export const paymentsEnabled = () => process.env.PAYMENTS_ENABLED === 'true';

// Stripe checkout must run in a real web browser, never inside the Play-Store
// TWA or the iOS app shell — offering third-party billing for digital goods
// inside a store app violates Google Play / Apple billing policy and risks app
// removal. The frontend already hides the payment UI in those shells
// (isAppShell in utils/platform.js); this is the SERVER-SIDE backstop so a
// crafted request from inside a shell (or plain curl spoofing nothing) still
// can't create a Stripe Checkout/Intent. The shells send
// X-Client-Platform: ios|android (same header the registration geofence uses).
export const isAppShellRequest = (req) => {
  const p = (req.get?.('x-client-platform') || req.headers?.['x-client-platform'] || '')
    .toString().toLowerCase();
  if (p === 'ios' || p === 'android') return true;
  // Play-TWA (the live Android app) is ordinary web and sends no
  // X-Client-Platform — it marks itself via X-Client-Shell instead
  // (frontend api.js; separate header so the native geofence exemption
  // doesn't leak to TWA users). Closed BEFORE the payments flag flips on:
  // Play billing policy applies to the TWA exactly like to Capacitor shells.
  const s = (req.get?.('x-client-shell') || req.headers?.['x-client-shell'] || '')
    .toString().toLowerCase();
  return s === 'twa';
};
