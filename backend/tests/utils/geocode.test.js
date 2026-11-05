import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resolveCreateLocation, resolveClubEventLocation } from '../../src/utils/geocode.js';

// Nominatim returns an array; _fetchNominatim reads data[0].{lat,lon,display_name,address.country_code}
const okJson = (data) => ({ ok: true, json: async () => data });
const hit = (lat, lon, cc, name = 'Somewhere') =>
  okJson([{ lat: String(lat), lon: String(lon), display_name: name, address: { country_code: cc } }]);
const miss = () => okJson([]);

const realFetch = global.fetch;
afterAll(() => { global.fetch = realFetch; });

describe('resolveCreateLocation — server-side region gate (fail-closed)', () => {
  beforeEach(() => {
    process.env.ALLOWED_COUNTRIES = 'AT,DE,CH,IT';
    global.fetch = vi.fn();
  });

  it('accepts an empty/blank location without a lookup (create allowed, no pin)', async () => {
    expect(await resolveCreateLocation('')).toEqual({ ok: true, coords: null });
    expect(await resolveCreateLocation('   ')).toEqual({ ok: true, coords: null });
    expect(await resolveCreateLocation(null)).toEqual({ ok: true, coords: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts an in-region location via the strict (country-filtered) match', async () => {
    global.fetch.mockImplementation(async () => hit(48.21, 16.37, 'at', 'Wien'));
    const r = await resolveCreateLocation('Wien strict-hit-A');
    expect(r.ok).toBe(true);
    expect(r.coords).toMatchObject({ lat: 48.21, lng: 16.37 });
    // Strict match found → only the country-filtered lookup runs.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('REJECTS a location that resolves outside the allowed markets', async () => {
    global.fetch.mockImplementation(async (url) =>
      String(url).includes('countrycodes=') ? miss() : hit(48.85, 2.35, 'fr', 'Paris'));
    const r = await resolveCreateLocation('Paris out-of-region-A');
    expect(r).toEqual({ ok: false, country: 'fr' });
  });

  it('rescues an in-region place the strict filter missed (loose lookup, allowed country)', async () => {
    global.fetch.mockImplementation(async (url) =>
      String(url).includes('countrycodes=') ? miss() : hit(52.52, 13.40, 'de', 'Berlin'));
    const r = await resolveCreateLocation('Berlin loose-rescue-A');
    expect(r.ok).toBe(true);
    expect(r.coords).toMatchObject({ lat: 52.52, lng: 13.40 });
  });

  it('allows creation without a pin when the location does not resolve at all', async () => {
    global.fetch.mockImplementation(async () => miss());
    expect(await resolveCreateLocation('Nowhere unresolvable-A')).toEqual({ ok: true, coords: null });
  });

  it('honours a widened ALLOWED_COUNTRIES (env drives the gate)', async () => {
    process.env.ALLOWED_COUNTRIES = 'AT,DE,CH,IT,FR';
    global.fetch.mockImplementation(async (url) =>
      String(url).includes('countrycodes=') ? miss() : hit(48.85, 2.35, 'fr', 'Paris'));
    const r = await resolveCreateLocation('Paris now-allowed-A');
    expect(r.ok).toBe(true);
    expect(r.coords).toMatchObject({ lat: 48.85, lng: 2.35 });
  });
});

// "6. Bezirk" on a Vienna club resolved to Tehran's District 6 and the event
// vanished from every logged-in Gruppen feed (Tina, 05.11.2026): a club event's
// custom location must resolve near its club first, then through the market gate.
describe('resolveClubEventLocation — near-club-first lookup', () => {
  const VIENNA = { lat: 48.19, lng: 16.37 };

  beforeEach(() => {
    process.env.ALLOWED_COUNTRIES = 'AT,DE,CH,IT';
    global.fetch = vi.fn();
  });

  it('accepts an empty location without a lookup', async () => {
    expect(await resolveClubEventLocation('', VIENNA.lat, VIENNA.lng)).toEqual({ ok: true, coords: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefers a hit inside the bounded box around the club pin', async () => {
    global.fetch.mockImplementation(async (url) =>
      String(url).includes('viewbox=') ? hit(48.20, 16.35, 'at', 'Mariahilf') : miss());
    const r = await resolveClubEventLocation('6. Bezirk bounded-hit-B', VIENNA.lat, VIENNA.lng);
    expect(r.ok).toBe(true);
    expect(r.coords).toMatchObject({ lat: 48.20, lng: 16.35 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toContain('bounded=1');
  });

  it('falls through to the market gate when nothing matches near the club', async () => {
    global.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('viewbox=')) return miss();
      if (u.includes('countrycodes=')) return hit(47.07, 15.44, 'at', 'Graz');
      return miss();
    });
    const r = await resolveClubEventLocation('Graz Hauptplatz fallthrough-B', VIENNA.lat, VIENNA.lng);
    expect(r.ok).toBe(true);
    expect(r.coords).toMatchObject({ lat: 47.07, lng: 15.44 });
  });

  it('REJECTS a location that only resolves outside the markets (the Tehran case)', async () => {
    global.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('viewbox=') || u.includes('countrycodes=')) return miss();
      return hit(35.72, 51.40, 'ir', 'District 6, Tehran');
    });
    const r = await resolveClubEventLocation('6. Bezirk tehran-case-B', VIENNA.lat, VIENNA.lng);
    expect(r).toEqual({ ok: false, country: 'ir' });
  });

  it('skips the bounded step when the club has no pin', async () => {
    global.fetch.mockImplementation(async (url) =>
      String(url).includes('countrycodes=') ? hit(48.21, 16.37, 'at', 'Wien') : miss());
    const r = await resolveClubEventLocation('Wien no-club-pin-B', null, null);
    expect(r.ok).toBe(true);
    expect(r.coords).toMatchObject({ lat: 48.21, lng: 16.37 });
    expect(String(global.fetch.mock.calls[0][0])).not.toContain('viewbox=');
  });

  it('still creates without a pin when nothing resolves anywhere', async () => {
    global.fetch.mockImplementation(async () => miss());
    expect(await resolveClubEventLocation('Nowhere unresolvable-B', VIENNA.lat, VIENNA.lng))
      .toEqual({ ok: true, coords: null });
  });
});
