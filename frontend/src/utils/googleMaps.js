/**
 * Lazy loader for the Google Maps JS API with the `places` library.
 *
 * Used by location-input pages (CreateGroup, CreateClub) that need
 * google.maps.places.Autocomplete. The MapView component goes through
 * @react-google-maps/api separately because react-google-maps and a
 * hand-rolled <script> can coexist as long as both reference the same
 * key and the script is only injected once.
 *
 * Idempotent: multiple callers can call loadGoogleMaps() in any order;
 * the script is injected once, and any pending onGoogleMapsReady
 * callbacks fire as soon as the SDK signals ready (via a global
 * callback name).
 */

import i18n from '../i18n';

let loading = false;
let loaded  = false;
const pending = [];

const GLOBAL_CB = '__jamieGoogleMapsReady';

export function loadGoogleMaps(apiKey) {
  if (loaded) {
    flush();
    return;
  }
  if (loading) return;

  // The SDK may already be on the page from MapView's useLoadScript —
  // injecting it AGAIN re-initializes google.maps ("included multiple
  // times") and intermittently broke live Autocomplete/marker bindings.
  // Reuse it; if the places library is missing, importLibrary pulls just
  // that module without a second bootstrap.
  if (window.google?.maps) {
    if (window.google.maps.places) {
      loaded = true;
      flush();
    } else if (typeof window.google.maps.importLibrary === 'function') {
      loading = true;
      window.google.maps.importLibrary('places')
        .then(() => { loaded = true; loading = false; flush(); })
        .catch((err) => { loading = false; console.error('[googleMaps] importLibrary(places) failed:', err); });
    }
    return;
  }

  if (!apiKey) return;
  loading = true;

  window[GLOBAL_CB] = () => {
    loaded = true;
    loading = false;
    flush();
  };

  // Language follows the app locale — hard-coded `de` forced German
  // Autocomplete suggestions on FR/ES/IT users.
  const lang = (i18n.resolvedLanguage || i18n.language || 'de').split('-')[0];
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=${lang}&callback=${GLOBAL_CB}`;
  s.async = true;
  s.defer = true;
  // Surface load failures in the console so we can tell (a) the script never
  // reached Google vs. (b) Google rejected the key at runtime. Without this
  // hook a CSP block or DNS failure is silent.
  s.onerror = (e) => {
    loading = false;
    console.error('[googleMaps] script failed to load — check CSP, API key, referrer restrictions:', e);
  };
  // Catch Google's runtime "auth failure" callback. This fires when the key is
  // invalid, billing is off, the Places API isn't enabled, or the current host
  // isn't in the key's HTTP-referrer allowlist. Google's grey overlay appears
  // on top of the page in that case — logging here gives us a clear signal.
  // CHAIN the previous handler — MapView installs a Sentry-wired one
  // (watermark telemetry, 0cb4a57); overwriting it silently dropped that.
  const prevAuthFailure = window.gm_authFailure;
  window.gm_authFailure = () => {
    console.error('[googleMaps] gm_authFailure — Google rejected the key. Check:'
      + '\n  • Places API (Legacy) is enabled in Google Cloud Console'
      + '\n  • Billing is enabled on the project'
      + '\n  • The current host is in the key\'s HTTP referrer restrictions'
      + '\n  • The key itself is correct (VITE_GOOGLE_MAPS_API_KEY in Railway env)');
    try { prevAuthFailure?.(); } catch { /* chained handler failed — ignore */ }
  };
  document.head.appendChild(s);
}

export function onGoogleMapsReady(cb) {
  if (loaded) {
    cb();
    return;
  }
  pending.push(cb);
}

function flush() {
  while (pending.length) {
    const cb = pending.shift();
    try { cb(); } catch (err) { console.error('[googleMaps] callback error:', err); }
  }
}
