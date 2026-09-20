// ==========================================
// UMKREIS — shared radius rules (Play-Review „Suzkapu", 02.09.2026)
// ==========================================
// „Filter für Benachrichtigungen etc. bezüglich Umkreis wären wichtig."
//
// Until now the only geographic targeting anywhere in the product was the
// COUNTRY: the group feed filters by a country bounding box, and the "neue
// Gruppe in deiner Kategorie" push filtered by `users.country` alone. For a
// country the size of Austria that means someone in Vienna gets pushed about a
// Feierabend-Bier in Bregenz, 600 km away. This module is the one place that
// decides what "nearby" means.
//
// The user's own coordinates come from the profile city, which is ALREADY
// geocoded — `geocodeAllowedRegion` returns { lat, lng, countryCode } and the
// country resolver threw the first two away. So this costs no extra Nominatim
// traffic, which matters: Nominatim is rate-limited and is on the list of
// things to get out of the request path before the TV spot.

// What the picker offers. `null` is the fifth option and means "no limit" —
// deliberately not a huge number, so "unbegrenzt" stays distinguishable from
// "someone picked 500 km".
export const RADIUS_OPTIONS_KM = [10, 25, 50, 100];

// Applied when a user has never touched the setting (column NULL).
//
// NOTE: NULL in the column means "unlimited", NOT "default" — existing users
// keep exactly the behaviour they have today and nothing changes under them.
// New rows get this value as a column DEFAULT instead. To switch everyone over
// it is one statement:
//   UPDATE users SET notify_radius_km = 50 WHERE notify_radius_km IS NULL;
export const DEFAULT_NOTIFY_RADIUS_KM = 50;

// A radius is either one of the offered values or null/'' meaning unlimited.
// Free-form numbers are rejected rather than clamped: the picker cannot
// produce them, so anything else is a crafted request, and silently accepting
// "1" would let someone build a presence oracle out of the push fan-out.
export const isValidRadius = (v) =>
  v === null || v === undefined || v === '' || RADIUS_OPTIONS_KM.includes(Number(v));

// Normalise a request value to what goes in the column.
export const normalizeRadius = (v) =>
  (v === null || v === undefined || v === '') ? null : Number(v);

/**
 * Haversine distance in km as a SQL expression.
 *
 * `GREATEST(-1, LEAST(1, …))` is not cosmetic: for two points that are the same
 * (or within floating-point noise of it) the inner term can come out at
 * 1.0000000000000002 and acos() then raises "input is out of range", which
 * would 500 the caller. Both bounds are clamped to match the JS mirror below —
 * the lower one guards the (near-)antipodal case the same way. Same guard as
 * checkAndAwardPioneer, which is where this formula comes from.
 *
 * All four arguments are SQL fragments the CALLER controls (column refs or
 * bound-parameter placeholders) — never request values.
 */
export const distanceKmSql = (latA, lngA, latB, lngB) => `
  (6371 * acos(
     GREATEST(-1, LEAST(1, cos(radians(${latA})) * cos(radians(${latB}))
              * cos(radians(${lngB}) - radians(${lngA}))
              + sin(radians(${latA})) * sin(radians(${latB}))
     ))
   ))`;

/**
 * Distance in km between two points, in JS. Mirrors distanceKmSql.
 * Returns null when either point is unknown, so callers can tell "far away"
 * apart from "we don't know" — the two must never be treated the same:
 * dropping unknowns would silently mute every user whose city failed to
 * geocode.
 */
export const distanceKm = (aLat, aLng, bLat, bLng) => {
  const raw = [aLat, aLng, bLat, bLng];
  // Reject the empty values BEFORE Number(), which turns null and '' into 0 —
  // a perfectly finite coordinate in the Gulf of Guinea. Everything in Austria
  // is then ~5400 km from that point, so a user whose city never geocoded
  // would have been measured as impossibly far away and silently muted
  // entirely: the exact invisible failure this function's null contract exists
  // to prevent. Caught by the unit test, not by review.
  if (raw.some(v => v === null || v === undefined || v === '')) return null;
  const nums = raw.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  const [lat1, lng1, lat2, lng2] = nums;
  const rad = (d) => (d * Math.PI) / 180;
  const inner =
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2) - rad(lng1)) +
    Math.sin(rad(lat1)) * Math.sin(rad(lat2));
  return 6371 * Math.acos(Math.min(1, Math.max(-1, inner)));
};

/**
 * Should this user be notified about something at (lat, lng)?
 *
 * FAIL-OPEN on every unknown — an unset radius, a user whose city never
 * geocoded, a group with no pin. Muting someone because a background geocode
 * failed months ago would be an invisible bug: no error, no log, the user
 * simply stops hearing from the app and blames the app. Too far away is the
 * only reason to skip.
 */
export const withinNotifyRadius = (user, targetLat, targetLng) => {
  const radius = user?.notify_radius_km;
  if (radius == null) return true;                       // unlimited
  const d = distanceKm(user.lat, user.lng, targetLat, targetLng);
  if (d === null) return true;                           // unknown → notify
  return d <= Number(radius);
};
