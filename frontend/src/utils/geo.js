// ==========================================
// UMKREIS — Client-Spiegel von backend/src/utils/geoRadius.js
// ==========================================
// Play review „Suzkapu" (02.09.2026): „Filter für Benachrichtigungen etc.
// bezüglich Umkreis wären wichtig."
//
// Two uses, both reading the SAME numbers:
//   • Settings → „Umkreis für Benachrichtigungen" (persisted server-side,
//     validated there against its own copy of this list),
//   • the Gruppen-Feed filter sheet (client-side, like every other filter
//     there — the server already clamps the page at 100 rows).
//
// ⚠️ RADIUS_OPTIONS_KM is mirrored in backend/src/utils/geoRadius.js and the
// server REJECTS a radius that isn't in its copy. An extra value here is a
// picker entry that 400s. backend/tests/utils/geoRadius.test.js reads both
// files and fails on divergence.
export const RADIUS_OPTIONS_KM = [10, 25, 50, 100];

/**
 * Great-circle distance in km. Mirrors distanceKmSql / distanceKm on the
 * server, so the feed filter and the push fan-out agree on what "50 km" means.
 *
 * Returns null when either point is unknown — callers must treat that as
 * "can't tell", never as "far away": a group without a map pin (geocoding
 * failed, or it was created before coordinates existed) would otherwise
 * silently vanish from the feed the moment someone picks any radius.
 */
export const distanceKm = (aLat, aLng, bLat, bLng) => {
  const raw = [aLat, aLng, bLat, bLng];
  // Reject empty values BEFORE Number(): Number(null) and Number('') are 0,
  // a real coordinate off the coast of Africa. A group without a pin would
  // then measure ~5400 km away and vanish from the feed the moment any radius
  // is picked, instead of being kept the way the fail-open rule promises.
  if (raw.some(v => v === null || v === undefined || v === '')) return null;
  const nums = raw.map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  const [lat1, lng1, lat2, lng2] = nums;
  const rad = (d) => (d * Math.PI) / 180;
  const inner =
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2) - rad(lng1)) +
    Math.sin(rad(lat1)) * Math.sin(rad(lat2));
  // Clamp before acos: for two identical points floating point can produce
  // 1.0000000000000002, and Math.acos of that is NaN.
  return 6371 * Math.acos(Math.min(1, Math.max(-1, inner)));
};

/**
 * Feed filter predicate: keep this entity for the chosen radius?
 *
 * FAIL-OPEN, deliberately — an entity with no coordinates, or a user whose
 * profile city never geocoded, is KEPT. The alternative is a filter that looks
 * broken: pick "10 km" in a town whose name Nominatim didn't resolve and the
 * feed goes empty with no explanation. `radiusKm = null` means no filter.
 */
export const withinRadius = (entity, user, radiusKm) => {
  if (radiusKm == null) return true;
  const d = distanceKm(user?.lat, user?.lng, entity?.lat, entity?.lng);
  return d === null || d <= Number(radiusKm);
};

/** "12 km" / "1,2 km" — short label for a card. Null when unknown. */
export const formatDistance = (km) => {
  if (km == null || !Number.isFinite(km)) return null;
  return km < 10
    ? `${km.toFixed(1).replace('.', ',')} km`
    : `${Math.round(km)} km`;
};
