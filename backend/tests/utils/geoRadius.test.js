import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RADIUS_OPTIONS_KM,
  DEFAULT_NOTIFY_RADIUS_KM,
  isValidRadius,
  normalizeRadius,
  distanceKm,
  distanceKmSql,
  withinNotifyRadius,
} from '../../src/utils/geoRadius.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_MIRROR = path.resolve(here, '../../../frontend/src/utils/geo.js');

// Real coordinates, so the expected distances are checkable against reality.
const WIEN      = { lat: 48.2082, lng: 16.3738 };
const GRAZ      = { lat: 47.0707, lng: 15.4395 };  // ~145 km
const BREGENZ   = { lat: 47.5031, lng: 9.7471 };   // ~480 km — the review's case
const BADEN     = { lat: 47.9956, lng: 16.2318 };  // ~25 km

describe('client/server radius option mirror', () => {
  it('frontend/src/utils/geo.js offers exactly the options the server accepts', () => {
    // The server REJECTS anything not in its list, so an extra option here
    // would be a picker entry that 400s the moment someone taps it.
    const src = fs.readFileSync(FRONTEND_MIRROR, 'utf8');
    const body = src.match(/export const RADIUS_OPTIONS_KM = \[([^\]]*)\]/)?.[1];
    expect(body, 'RADIUS_OPTIONS_KM literal not found in the mirror').toBeTruthy();
    const mirror = body.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
    expect(mirror).toEqual(RADIUS_OPTIONS_KM);
  });

  it('the default is one of the offered options', () => {
    expect(RADIUS_OPTIONS_KM).toContain(DEFAULT_NOTIFY_RADIUS_KM);
  });
});

describe('isValidRadius', () => {
  it('accepts every offered option, as number or string', () => {
    for (const km of RADIUS_OPTIONS_KM) {
      expect(isValidRadius(km)).toBe(true);
      expect(isValidRadius(String(km))).toBe(true);
    }
  });

  it('accepts the three ways a client can say "unbegrenzt"', () => {
    expect(isValidRadius(null)).toBe(true);
    expect(isValidRadius(undefined)).toBe(true);
    expect(isValidRadius('')).toBe(true);
  });

  it('rejects arbitrary distances rather than clamping them', () => {
    // A free-form radius would let someone binary-search where another user
    // lives by watching which pushes arrive. Only the offered steps.
    for (const bad of [1, 7, 11, 49, 99, 101, 5000, -10, 0]) {
      expect(isValidRadius(bad), String(bad)).toBe(false);
    }
  });

  it('rejects junk', () => {
    for (const bad of ['viel', '10km', NaN, {}, [], true]) {
      expect(isValidRadius(bad)).toBe(false);
    }
  });
});

describe('normalizeRadius', () => {
  it('turns every "unbegrenzt" spelling into NULL for the column', () => {
    expect(normalizeRadius(null)).toBeNull();
    expect(normalizeRadius(undefined)).toBeNull();
    expect(normalizeRadius('')).toBeNull();
  });
  it('coerces a numeric string to a number', () => {
    expect(normalizeRadius('25')).toBe(25);
    expect(normalizeRadius(25)).toBe(25);
  });
});

describe('distanceKm', () => {
  it('measures real distances within a percent or so', () => {
    expect(distanceKm(WIEN.lat, WIEN.lng, GRAZ.lat, GRAZ.lng)).toBeGreaterThan(140);
    expect(distanceKm(WIEN.lat, WIEN.lng, GRAZ.lat, GRAZ.lng)).toBeLessThan(150);
    expect(distanceKm(WIEN.lat, WIEN.lng, BADEN.lat, BADEN.lng)).toBeLessThan(30);
  });

  it('measures the case from the review: Wien → Bregenz is far outside any option', () => {
    const d = distanceKm(WIEN.lat, WIEN.lng, BREGENZ.lat, BREGENZ.lng);
    expect(d).toBeGreaterThan(450);
    expect(Math.max(...RADIUS_OPTIONS_KM)).toBeLessThan(d);
  });

  it('is 0 for the same point and does not produce NaN', () => {
    // acos() of a term that floating point nudged to 1.0000000000000002 is
    // NaN — the clamp is what stops "distance to yourself" breaking the filter.
    const d = distanceKm(WIEN.lat, WIEN.lng, WIEN.lat, WIEN.lng);
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeLessThan(0.001);
  });

  it('is symmetric', () => {
    const a = distanceKm(WIEN.lat, WIEN.lng, GRAZ.lat, GRAZ.lng);
    const b = distanceKm(GRAZ.lat, GRAZ.lng, WIEN.lat, WIEN.lng);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });

  it('returns null — not 0, not Infinity — when a point is unknown', () => {
    // Callers branch on null to fail open. Returning 0 would mean "right
    // here" and silently notify everyone; returning Infinity would mute them.
    expect(distanceKm(null, null, GRAZ.lat, GRAZ.lng)).toBeNull();
    expect(distanceKm(WIEN.lat, WIEN.lng, undefined, undefined)).toBeNull();
    expect(distanceKm(WIEN.lat, 'nope', GRAZ.lat, GRAZ.lng)).toBeNull();
  });
});

describe('withinNotifyRadius', () => {
  const user = (radius, at = WIEN) => ({ notify_radius_km: radius, lat: at.lat, lng: at.lng });

  it('is the whole point: 50 km in Vienna does not get pushed about Bregenz', () => {
    expect(withinNotifyRadius(user(50), BREGENZ.lat, BREGENZ.lng)).toBe(false);
  });

  it('still gets pushed about things nearby', () => {
    expect(withinNotifyRadius(user(50), BADEN.lat, BADEN.lng)).toBe(true);
  });

  it('a bigger radius reaches further', () => {
    expect(withinNotifyRadius(user(100), GRAZ.lat, GRAZ.lng)).toBe(false); // ~145 km
    expect(withinNotifyRadius(user(null), GRAZ.lat, GRAZ.lng)).toBe(true);
  });

  // ── Fail-open: every unknown must still notify ──────────────────────────
  // Muting someone because a background geocode failed months ago is an
  // invisible bug — no error, no log, the user just stops hearing from the app.
  it('notifies when the user never set a radius', () => {
    expect(withinNotifyRadius(user(null), BREGENZ.lat, BREGENZ.lng)).toBe(true);
    expect(withinNotifyRadius({ lat: WIEN.lat, lng: WIEN.lng }, BREGENZ.lat, BREGENZ.lng)).toBe(true);
  });

  it('notifies when the user has a radius but no coordinates', () => {
    expect(withinNotifyRadius({ notify_radius_km: 10, lat: null, lng: null }, BADEN.lat, BADEN.lng)).toBe(true);
  });

  it('notifies when the group has no map pin', () => {
    expect(withinNotifyRadius(user(10), null, null)).toBe(true);
  });

  it('survives a missing user object', () => {
    expect(withinNotifyRadius(undefined, BADEN.lat, BADEN.lng)).toBe(true);
    expect(withinNotifyRadius(null, BADEN.lat, BADEN.lng)).toBe(true);
  });
});

describe('distanceKmSql', () => {
  it('clamps BOTH acos bounds — identical points hit +1, (near-)antipodal hit -1', () => {
    // Mirrors distanceKm()'s Math.min(1, Math.max(-1, inner)). Without either
    // side Postgres acos() raises "input is out of range" and 500s the caller.
    const sql = distanceKmSql('u.lat', 'u.lng', '$1', '$2');
    expect(sql).toMatch(/LEAST\(1,/);
    expect(sql).toMatch(/GREATEST\(-1,/);
  });

  it('places each argument on the right side of the formula', () => {
    const sql = distanceKmSql('A_LAT', 'A_LNG', 'B_LAT', 'B_LNG');
    // cos(lngB - lngA) — swapping the two longitudes yields a plausible-looking
    // wrong distance rather than an error, so pin the orientation.
    expect(sql).toContain('cos(radians(B_LNG) - radians(A_LNG))');
    expect(sql).toContain('cos(radians(A_LAT)) * cos(radians(B_LAT))');
    expect(sql).toContain('sin(radians(A_LAT)) * sin(radians(B_LAT))');
    expect(sql).toContain('6371');
  });

  // The numeric cross-check between this SQL and distanceKm() runs against a
  // REAL Postgres in tests/integration/write-endpoints.pg.test.js — evaluating
  // the SQL string in JS here would only prove the regex rewrite works, not
  // that Postgres computes the same number.
});
