import fs from 'fs';

/**
 * Which of Vienna's 23 districts lies under a point. Used for the website's
 * "meetups per district" numbers (GET /api/map/districts, Tobi 21.11.2026).
 *
 * Boundaries: Stadt Wien – data.wien.gv.at, "Bezirksgrenzen Wien"
 * (ogdwien:BEZIRKSGRENZEOGD, as of 2026-09-01), licence CC BY 4.0.
 * Simplified with Douglas-Peucker (tolerance 0.00015°, about 11–17 m) and
 * rounded to 5 decimals: 35 KB instead of 3 MB. Plenty for counting per
 * district; a meeting point right on a boundary may land in the neighbour.
 *
 * File format: [[districtNumber, name, [ring, …]], …], ring = [[lng, lat], …].
 * Several rings of one district are evaluated even/odd, so holes and
 * exclaves would count correctly (today every district is a single ring).
 */
const RAW = JSON.parse(fs.readFileSync(new URL('../data/viennaDistricts.json', import.meta.url), 'utf8'));

const DISTRICTS = RAW.map(([n, name, rings]) => {
  const lats = rings.flatMap((r) => r.map((p) => p[1]));
  const lngs = rings.flatMap((r) => r.map((p) => p[0]));
  return {
    n, name, rings,
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
  };
});

export const VIENNA_DISTRICT_COUNT = DISTRICTS.length; // 23

/** Bounding box of the whole city, for a cheap SQL pre-filter. */
export const VIENNA_BBOX = {
  minLat: Math.min(...DISTRICTS.map((d) => d.minLat)),
  maxLat: Math.max(...DISTRICTS.map((d) => d.maxLat)),
  minLng: Math.min(...DISTRICTS.map((d) => d.minLng)),
  maxLng: Math.max(...DISTRICTS.map((d) => d.maxLng)),
};

// Ray casting: does a horizontal ray from the point cross the ring an odd number of times?
const inRing = (lng, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** District number 1–23 for a point, or null outside Vienna (or for missing coordinates). */
export function viennaDistrictOf(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const d of DISTRICTS) {
    if (la < d.minLat || la > d.maxLat || ln < d.minLng || ln > d.maxLng) continue;
    let inside = false;
    for (const ring of d.rings) if (inRing(ln, la, ring)) inside = !inside;
    if (inside) return d.n;
  }
  return null;
}
