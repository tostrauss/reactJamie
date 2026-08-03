// Backend feature flags (server-side counterpart to frontend/src/utils/platform.js).
//
// Empfehlungs-Boosts deaktiviert (Tina, 2026-06-24): "keine Gratis-Boosts".
// Empfehlungscodes werden weiterhin erzeugt und ihr used_count getrackt
// (Wachstums-Attribution bleibt erhalten), sie vergeben aber KEINE
// Boost-Credits mehr — weder beim Einlösen über das Boost-Modal noch beim
// Registrieren mit Empfehlungscode. Auf true setzen, um Gratis-Boosts via
// Empfehlung wieder zu aktivieren.
export const REFERRAL_CREDITS_ENABLED = false;

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
  return p === 'ios' || p === 'android';
};
