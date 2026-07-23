/**
 * JAMIE launch markets — single source of truth for the frontend.
 *
 * Used by:
 *  - CreateGroup / CreateClub / ClubDetail event form: Google Places
 *    componentRestrictions + picked-place country verification
 *  - App.jsx web-PWA geofence bounding boxes
 *
 * Keep in sync with the backend's ALLOWED_COUNTRIES env default
 * (backend/src/middleware/geofence.js + utils/geocode.js).
 * 2026-07-23 (Tobi/Tina): creation opened from AT-only to all launch markets;
 * IT store rollout follows once the Italian translation ships.
 */
export const ALLOWED_COUNTRIES = ['AT', 'DE', 'CH', 'IT'];

// Lower-cased for Google Places componentRestrictions.country
export const ALLOWED_COUNTRIES_LOWER = ALLOWED_COUNTRIES.map(c => c.toLowerCase());

// Rough per-country bounding boxes for the web-PWA launch geofence.
// Deliberately generous — this is a soft market gate, not a security control.
export const REGION_BOUNDS = [
  { latMin: 46.37, latMax: 49.02, lngMin: 9.53,  lngMax: 17.16 }, // Austria
  { latMin: 47.27, latMax: 55.06, lngMin: 5.87,  lngMax: 15.04 }, // Germany
  { latMin: 45.82, latMax: 47.81, lngMin: 5.96,  lngMax: 10.49 }, // Switzerland
  { latMin: 35.49, latMax: 47.09, lngMin: 6.62,  lngMax: 18.52 }, // Italy (incl. Sicily/Sardinia)
];
