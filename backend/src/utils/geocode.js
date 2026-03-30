/**
 * Geocode a location string to lat/lng using Nominatim (OSM).
 * Returns { lat, lng } or null on failure.
 * Nominatim terms: max 1 req/s, must send User-Agent.
 */
export async function geocodeLocation(location) {
  if (!location || typeof location !== 'string' || !location.trim()) return null;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location.trim())}&format=json&limit=1`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'JAMIE-App/1.0 (contact@jamie.app)' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.length === 0) return null;

    const { lat, lon } = data[0];
    return { lat: parseFloat(lat), lng: parseFloat(lon) };
  } catch {
    return null;
  }
}
