import { describe, it, expect } from 'vitest';
import { RADIUS_OPTIONS_KM, distanceKm, withinRadius, formatDistance } from '../utils/geo';

const WIEN    = { lat: 48.2082, lng: 16.3738 };
const BADEN   = { lat: 47.9956, lng: 16.2318 };  // ~25 km
const GRAZ    = { lat: 47.0707, lng: 15.4395 };  // ~145 km
const BREGENZ = { lat: 47.5031, lng: 9.7471 };   // ~480 km

const me = { ...WIEN };

describe('RADIUS_OPTIONS_KM', () => {
  it('is ascending and free of duplicates', () => {
    expect([...RADIUS_OPTIONS_KM].sort((a, b) => a - b)).toEqual(RADIUS_OPTIONS_KM);
    expect(new Set(RADIUS_OPTIONS_KM).size).toBe(RADIUS_OPTIONS_KM.length);
  });
});

describe('distanceKm', () => {
  it('measures real distances', () => {
    expect(distanceKm(WIEN.lat, WIEN.lng, BADEN.lat, BADEN.lng)).toBeLessThan(30);
    expect(distanceKm(WIEN.lat, WIEN.lng, GRAZ.lat, GRAZ.lng)).toBeGreaterThan(140);
  });

  it('does not treat a missing coordinate as (0, 0)', () => {
    // Number(null) is 0 — a real point off West Africa, ~5400 km from Austria.
    // Left unguarded, every group without a map pin would measure as absurdly
    // far away and disappear from the feed as soon as any radius was picked.
    expect(distanceKm(null, null, WIEN.lat, WIEN.lng)).toBeNull();
    expect(distanceKm(WIEN.lat, WIEN.lng, undefined, undefined)).toBeNull();
    expect(distanceKm('', '', WIEN.lat, WIEN.lng)).toBeNull();
  });

  it('never returns NaN for two identical points', () => {
    expect(distanceKm(WIEN.lat, WIEN.lng, WIEN.lat, WIEN.lng)).toBeLessThan(0.001);
  });
});

describe('withinRadius', () => {
  it('keeps what is near and drops what is far', () => {
    expect(withinRadius(BADEN, me, 50)).toBe(true);
    expect(withinRadius(GRAZ, me, 50)).toBe(false);
    expect(withinRadius(BREGENZ, me, 100)).toBe(false);
  });

  it('keeps everything when no radius is chosen', () => {
    expect(withinRadius(BREGENZ, me, null)).toBe(true);
    expect(withinRadius(BREGENZ, me, undefined)).toBe(true);
  });

  // ── Fail-open ───────────────────────────────────────────────────────────
  // A filter that silently empties the feed reads as a broken app, not as a
  // strict filter — so anything we cannot measure stays visible.
  it('keeps a group that has no map pin', () => {
    expect(withinRadius({ lat: null, lng: null }, me, 10)).toBe(true);
    expect(withinRadius({}, me, 10)).toBe(true);
  });

  it('keeps everything when the viewer has no coordinates', () => {
    expect(withinRadius(BREGENZ, { lat: null, lng: null }, 10)).toBe(true);
    expect(withinRadius(BREGENZ, undefined, 10)).toBe(true);
  });

  it('treats the boundary as inclusive', () => {
    const d = distanceKm(WIEN.lat, WIEN.lng, BADEN.lat, BADEN.lng);
    expect(withinRadius(BADEN, me, Math.ceil(d))).toBe(true);
  });
});

describe('formatDistance', () => {
  it('uses a decimal below 10 km and a whole number above, German-style', () => {
    expect(formatDistance(1.24)).toBe('1,2 km');
    expect(formatDistance(2.5)).toBe('2,5 km');
    expect(formatDistance(9.4)).toBe('9,4 km');
    expect(formatDistance(10)).toBe('10 km');
    expect(formatDistance(24.6)).toBe('25 km');
  });

  it('returns null for an unknown distance', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(NaN)).toBeNull();
  });
});
