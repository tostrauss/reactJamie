import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// geoip-lite is mocked so the test doesn't depend on the bundled GeoIP DB.
const lookup = vi.fn();
vi.mock('geoip-lite', () => ({ default: { lookup: (ip) => lookup(ip) } }));

const { checkSubscriptionCountry } = await import('../../src/utils/paymentRegion.js');

// The helper reads the leftmost X-Forwarded-For via getClientIp — req.ip on
// Railway is an edge address and would put every buyer in the wrong country.
const reqWith = (ip) => ({
  headers: { 'x-forwarded-for': ip },
  get(name) { return this.headers[String(name).toLowerCase()]; },
  ip: '10.0.0.1',
});

describe('checkSubscriptionCountry', () => {
  beforeEach(() => lookup.mockReset());
  afterEach(() => vi.clearAllMocks());

  it('allows Austria and Germany', () => {
    for (const c of ['AT', 'DE']) {
      lookup.mockReturnValue({ country: c });
      expect(checkSubscriptionCountry(reqWith('203.0.113.7'))).toEqual({ allowed: true, country: c });
    }
  });

  it('blocks countries the app ships in but we are not tax-registered in', () => {
    // CH/IT/FR/ES are open for the FREE app but must not be sold to.
    for (const c of ['CH', 'IT', 'FR', 'ES', 'US']) {
      lookup.mockReturnValue({ country: c });
      const r = checkSubscriptionCountry(reqWith('203.0.113.7'));
      expect(r.allowed, `${c} must be blocked for subscriptions`).toBe(false);
      expect(r.country).toBe(c);
    }
  });

  it('fails OPEN when the country cannot be determined', () => {
    // A geoip gap must not silently kill sales.
    lookup.mockReturnValue(null);
    expect(checkSubscriptionCountry(reqWith('203.0.113.7'))).toEqual({ allowed: true, country: null });
  });

  it('allows private and loopback IPs (dev / proxied staging)', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.5', '172.16.0.9']) {
      expect(checkSubscriptionCountry(reqWith(ip)).allowed, ip).toBe(true);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uses the leftmost X-Forwarded-For entry, not the proxy hop', () => {
    lookup.mockReturnValue({ country: 'AT' });
    checkSubscriptionCountry(reqWith('203.0.113.7, 198.51.100.2'));
    expect(lookup).toHaveBeenCalledWith('203.0.113.7');
  });
});
