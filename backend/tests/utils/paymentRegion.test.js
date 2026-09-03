import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// geoip-lite is mocked so the test doesn't depend on the bundled GeoIP DB.
const lookup = vi.fn();
vi.mock('geoip-lite', () => ({ default: { lookup: (ip) => lookup(ip) } }));

// users.country lookup.
const query = vi.fn();
vi.mock('../../src/config/database.js', () => ({ default: { query: (...a) => query(...a) } }));

const { checkSubscriptionCountry } = await import('../../src/utils/paymentRegion.js');

// The helper reads the leftmost X-Forwarded-For via getClientIp — req.ip on
// Railway is an edge address and would place every buyer in the wrong country.
const reqWith = (ip, userId = 1) => ({
  userId,
  headers: { 'x-forwarded-for': ip },
  get(name) { return this.headers[String(name).toLowerCase()]; },
  ip: '10.0.0.1',
});
const profile = (country) => query.mockResolvedValue({ rows: [{ country }] });

describe('checkSubscriptionCountry', () => {
  beforeEach(() => { lookup.mockReset(); query.mockReset(); profile(null); });
  afterEach(() => vi.clearAllMocks());

  it('allows Austria and Germany by GeoIP', async () => {
    for (const c of ['AT', 'DE']) {
      lookup.mockReturnValue({ country: c });
      const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
      expect(r).toMatchObject({ allowed: true, country: c, source: 'geoip' });
    }
  });

  // THE REGRESSION THIS FILE EXISTS FOR: a Vienna customer on 4G was refused
  // minutes after go-live because geoip-lite mis-attributed the mobile range.
  // The profile country must override a wrong GeoIP result.
  it('allows an AT profile even when GeoIP claims another country', async () => {
    profile('AT');
    lookup.mockReturnValue({ country: 'NL' });
    const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
    expect(r).toMatchObject({ allowed: true, country: 'AT', source: 'profile' });
  });

  it('allows an AT profile even when GeoIP knows nothing (IPv6 / stale DB)', async () => {
    profile('at'); // lower-case in the DB must still match
    lookup.mockReturnValue(null);
    const r = await checkSubscriptionCountry(reqWith('2001:db8::1'));
    expect(r).toMatchObject({ allowed: true, country: 'AT' });
  });

  it('allows when GeoIP says AT but the profile says something else', async () => {
    // Travelling / not-yet-geocoded profile: either signal may grant.
    profile('IT');
    lookup.mockReturnValue({ country: 'AT' });
    const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
    expect(r).toMatchObject({ allowed: true, source: 'geoip' });
  });

  it('blocks when BOTH signals name a country we do not sell in', async () => {
    profile('IT');
    lookup.mockReturnValue({ country: 'IT' });
    const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
    expect(r.allowed).toBe(false);
    expect(r.country).toBe('IT');
  });

  it('blocks a non-selling country the app itself ships in', async () => {
    // CH/IT/FR/ES are open for the FREE app but must not be sold to.
    for (const c of ['CH', 'IT', 'FR', 'ES', 'US']) {
      query.mockResolvedValue({ rows: [{ country: c }] });
      lookup.mockReturnValue({ country: c });
      const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
      expect(r.allowed, `${c} must be blocked for subscriptions`).toBe(false);
    }
  });

  it('fails OPEN when neither signal is usable', async () => {
    // A geoip gap plus an un-geocoded profile must not kill a sale.
    lookup.mockReturnValue(null);
    const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
    expect(r).toMatchObject({ allowed: true, country: null, source: 'unknown' });
  });

  it('allows private and loopback IPs (dev / proxied staging)', async () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.5', '172.16.0.9']) {
      const r = await checkSubscriptionCountry(reqWith(ip));
      expect(r.allowed, ip).toBe(true);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uses the leftmost X-Forwarded-For entry, not the proxy hop', async () => {
    lookup.mockReturnValue({ country: 'AT' });
    await checkSubscriptionCountry(reqWith('203.0.113.7, 198.51.100.2'));
    expect(lookup).toHaveBeenCalledWith('203.0.113.7');
  });

  it('survives a DB error on the profile lookup by falling back to GeoIP', async () => {
    query.mockRejectedValue(new Error('boom'));
    lookup.mockReturnValue({ country: 'AT' });
    const r = await checkSubscriptionCountry(reqWith('203.0.113.7'));
    expect(r.allowed).toBe(true);
  });
});
