/**
 * Geocode a location string to lat/lng using Nominatim (OSM).
 * Returns { lat, lng } or null on failure.
 * Nominatim terms: max 1 req/s, must send User-Agent.
 *
 * Cache: results are cached in-memory for 24 hours (TTL_MS).
 * This both respects Nominatim's rate limit under concurrent group/club
 * creates and speeds up repeated lookups for popular cities.
 */
import { createSemaphore } from './semaphore.js';

const _cache = new Map(); // key → { result, expiresAt }
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Evict expired entries hourly — entries had a TTL but nothing ever removed
// them (every unique free-text city grew the Map forever). unref(): never
// keeps the process alive.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) { if (now >= v.expiresAt) _cache.delete(k); }
}, 60 * 60 * 1000).unref();

// Serialise concurrent requests for the same string — one fetch, multiple waiters
const _inflight = new Map();

// Nominatim's usage policy is 1 req/s — cold lookups for DISTINCT strings
// serialize behind one slot (a concurrency cap, which approximates the rate
// given each call's network latency) instead of fanning out; an egress
// throttle/ban would degrade every create AND fail the region gate open.
// The 24h cache and the _inflight dedup sit in front, so only genuinely cold
// lookups ever queue — and the queue is CAPPED: caller #10+ during a burst
// fails fast to the null path (entity created without a map pin, the
// documented fail-open behavior) instead of holding its Express handler and
// pool connection for minutes (review 2026-09-02).
const nominatimSlot = createSemaphore(1, { maxQueue: 8 });

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

// Countries where creating groups/clubs is allowed. Derived from the same env
// var the registration geofence uses (backend/src/middleware/geofence.js) so
// one Railway setting controls both. Lower-cased for Nominatim's countrycodes.
// 2026-07-23 (Tobi/Tina): expanded from AT-only to the launch markets.
// 2026-08-04: FR+ES added (France & Spain rollout). A Railway ALLOWED_COUNTRIES
// env var overrides this default — keep it in sync or unset it.
const allowedCountrycodes = () =>
  (process.env.ALLOWED_COUNTRIES || 'AT,DE,CH,IT,FR,ES')
    .split(',').map(c => c.trim().toLowerCase()).filter(Boolean).join(',');

/**
 * Region-restricted geocode (countrycodes=<allowed markets>). A non-empty
 * result is therefore guaranteed to be a real place in one of JAMIE's launch
 * countries — used by the create-group/club location verifier so a typed
 * location can be accepted even when Google Places didn't surface a dropdown
 * to pick from. (Formerly geocodeAustria, when creation was AT-only.)
 * Returns { lat, lng, label } or null.
 */
export async function geocodeAllowedRegion(location) {
  if (!location || typeof location !== 'string' || !location.trim()) return null;

  const codes = allowedCountrycodes();
  const key = `${codes}:${location.trim().toLowerCase()}`;
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.result;
  if (_inflight.has(key)) return _inflight.get(key);

  const promise = _fetchNominatim(location.trim(), codes).then((result) => {
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

async function _fetchNominatim(location, countrycodes = null) {
  // addressdetails=1 is always requested (not just for the country-restricted
  // variant) so the resolved `country_code` is available to the region gate in
  // resolveCreateLocation() even on an unrestricted lookup.
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1&addressdetails=1`
    + (countrycodes ? `&countrycodes=${countrycodes}` : '');

  return nominatimSlot.run(async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'JAMIE-App/1.0 (contact@jamie-app.com)' },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.length === 0) return null;

    const { lat, lon, display_name, address } = data[0];
    return {
      lat: parseFloat(lat),
      lng: parseFloat(lon),
      label: display_name || location,
      // ISO-3166-1 alpha-2, lower-cased (matches allowedCountrycodes()); null if
      // Nominatim didn't return address details. Extra field — existing callers
      // that only read lat/lng/label are unaffected.
      countryCode: (address?.country_code || '').toLowerCase() || null,
    };
  } catch {
    return null;
  } finally {
    // In a finally so an aborted/thrown fetch can't leak a live 5s timer.
    clearTimeout(timeout);
  }
  });
}

/**
 * Server-side region gate for the create/update-location flows (groups, clubs,
 * deals). The frontend already restricts the Google Places picker to the launch
 * markets and re-checks the picked country, but a crafted API call can bypass
 * that and POST any location string — this is the fail-closed backstop so we
 * never persist coordinates outside the allowed markets.
 *
 * Returns exactly one of:
 *   { ok: true,  coords: {lat,lng,label} } — resolved inside an allowed country
 *   { ok: true,  coords: null }            — empty or unresolvable location; the
 *                                            entity is still created, just without
 *                                            a map pin (unchanged legacy behaviour)
 *   { ok: false, country }                 — resolved to a country OUTSIDE the
 *                                            allowed markets → caller must reject
 *
 * Strategy: try the countrycodes-filtered geocode first (best in-region
 * ranking); if that misses, fall back to an unrestricted lookup but honour the
 * region gate by inspecting the resolved country. This never resolves fewer
 * legitimate in-region places than the old `geocodeAllowedRegion || geocodeLocation`
 * chain, while refusing places that actually sit outside the region.
 */
export async function resolveCreateLocation(location) {
  if (!location || typeof location !== 'string' || !location.trim()) {
    return { ok: true, coords: null };
  }

  // 1) Strict, country-filtered match — a non-empty result is guaranteed in-region.
  const strict = await geocodeAllowedRegion(location);
  if (strict) return { ok: true, coords: strict };

  // 2) Unrestricted fallback — but enforce the region on the resolved country.
  const loose = await geocodeLocation(location);
  if (!loose) return { ok: true, coords: null }; // unresolvable → create without a pin

  const allowed = allowedCountrycodes().split(',');
  if (loose.countryCode && allowed.includes(loose.countryCode)) {
    return { ok: true, coords: loose };
  }
  return { ok: false, country: loose.countryCode || null };
}
