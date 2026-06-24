// Backend feature flags (server-side counterpart to frontend/src/utils/platform.js).
//
// Empfehlungs-Boosts deaktiviert (Tina, 2026-06-24): "keine Gratis-Boosts".
// Empfehlungscodes werden weiterhin erzeugt und ihr used_count getrackt
// (Wachstums-Attribution bleibt erhalten), sie vergeben aber KEINE
// Boost-Credits mehr — weder beim Einlösen über das Boost-Modal noch beim
// Registrieren mit Empfehlungscode. Auf true setzen, um Gratis-Boosts via
// Empfehlung wieder zu aktivieren.
export const REFERRAL_CREDITS_ENABLED = false;
