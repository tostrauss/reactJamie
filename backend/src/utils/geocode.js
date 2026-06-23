/**
 * Geocode a location string to lat/lng using Nominatim (OSM).
 * Returns { lat, lng } or null on failure.
 * Nominatim terms: max 1 req/s, must send User-Agent.
 *
 * Cache: results are cached in-memory for 24 hours (TTL_MS).
 * This both respects Nominatim's rate limit under concurrent group/club
 * creates and speeds up repeated lookups for popular cities.
 */
const _cache = new Map(); // key → { result, expiresAt }
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Serialise concurrent requests for the same string — one fetch, multiple waiters
const _inflight = new Map();

export async function geocodeLocation(location) {
  if (!location || typeof location !== 'string' || !location.trim()) return null;

  const key = location.trim().toLowerCase();

  // Cache hit
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  // Deduplicate concurrent requests for the same string
  if (_inflight.has(key)) return _inflight.get(key);

  const promise = _fetchNominatim(location.trim()).then((result) => {
    _cache.set(key, { result, expiresAt: Date.now() + TTL_MS });
    _inflight.delete(key);
    return result;
  }).catch(() => {
    _inflight.delete(key);
    return null;
  });

  _inflight.set(key, promise);
  return promise;
}

/**
 * Austria-restricted geocode (countrycodes=at). A non-empty result is
 * therefore guaranteed to be a real place in Austria — used by the
 * create-group/club location verifier so a typed location can be accepted even
 * when Google Places didn't surface a dropdown to pick from.
 * Returns { lat, lng, label } or null.
 */
export async function geocodeAustria(location) {
  if (!location || typeof location !== 'string' || !location.trim()) return null;

  const key = `at:${location.trim().toLowerCase()}`;
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.result;
  if (_inflight.has(key)) return _inflight.get(key);

  const promise = _fetchNominatim(location.trim(), true).then((result) => {
    _cache.set(key, { result, expiresAt: Date.now() + TTL_MS });
    _inflight.delete(key);
    return result;
  }).catch(() => {
    _inflight.delete(key);
    return null;
  });

  _inflight.set(key, promise);
  return promise;
}

async function _fetchNominatim(location, austriaOnly = false) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`
    + (austriaOnly ? '&countrycodes=at&addressdetails=1' : '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'JAMIE-App/1.0 (contact@jamie-app.com)' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.length === 0) return null;

    const { lat, lon, display_name } = data[0];
    return { lat: parseFloat(lat), lng: parseFloat(lon), label: display_name || location };
  } catch {
    return null;
  }
}
