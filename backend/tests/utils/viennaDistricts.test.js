import { describe, it, expect } from 'vitest';
import { viennaDistrictOf, VIENNA_BBOX, VIENNA_DISTRICT_COUNT } from '../../src/utils/viennaDistricts.js';

// Website numbers per district (Tobi 21.11.2026). Landmarks well inside a
// district, plus the outskirts the real map pins had on 21.11.2026 (two near
// Perchtoldsdorf, one north of the city), which must not count for Vienna.
describe('viennaDistrictOf', () => {
  it.each([
    ['Stephansdom', 48.2085, 16.3731, 1],
    ['Praterstern', 48.2185, 16.3925, 2],
    ['Rochusmarkt', 48.2029, 16.3925, 3],
    ['Karlsplatz (TU)', 48.1990, 16.3700, 4],
    ['Westbahnhof', 48.1966, 16.3378, 15],
    ['Hauptbahnhof', 48.1851, 16.3768, 10],
    ['Schönbrunn', 48.1845, 16.3122, 13],
    ['Yppenplatz', 48.2121, 16.3366, 16],
    ['Floridsdorf Bahnhof', 48.2565, 16.4005, 21],
    ['Donauturm', 48.2403, 16.4103, 22],
    ['Liesing Bahnhof', 48.1347, 16.2836, 23],
  ])('%s → %i. Bezirk', (_name, lat, lng, want) => {
    expect(viennaDistrictOf(lat, lng)).toBe(want);
  });

  it('is null outside Vienna, also inside the bounding box', () => {
    expect(viennaDistrictOf(48.1194, 16.2654)).toBeNull(); // Perchtoldsdorf
    expect(viennaDistrictOf(48.083, 16.314)).toBeNull(); // real pin, south of Liesing
    expect(viennaDistrictOf(48.383, 16.204)).toBeNull(); // real pin, north of the city
    expect(viennaDistrictOf(47.0707, 15.4395)).toBeNull(); // Graz
    // Inside the bbox's north-east corner, but no district there.
    expect(viennaDistrictOf(VIENNA_BBOX.maxLat - 0.001, VIENNA_BBOX.maxLng - 0.001)).toBeNull();
  });

  it('takes strings (pg numeric) and refuses missing coordinates', () => {
    expect(viennaDistrictOf('48.2085', '16.3731')).toBe(1);
    expect(viennaDistrictOf(null, 16.37)).toBeNull();
    expect(viennaDistrictOf(48.2, undefined)).toBeNull();
    expect(viennaDistrictOf('', '')).toBeNull();
    expect(viennaDistrictOf(NaN, 16.37)).toBeNull();
  });

  it('knows all 23 districts and a bounding box around the city', () => {
    expect(VIENNA_DISTRICT_COUNT).toBe(23);
    expect(VIENNA_BBOX.minLat).toBeGreaterThan(48.1);
    expect(VIENNA_BBOX.maxLat).toBeLessThan(48.33);
    expect(VIENNA_BBOX.minLng).toBeGreaterThan(16.18);
    expect(VIENNA_BBOX.maxLng).toBeLessThan(16.58);
  });
});
