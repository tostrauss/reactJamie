import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock geoip-lite so tests don't depend on the bundled MaxMind DB.
vi.mock('geoip-lite', () => ({ default: { lookup: vi.fn() } }));

const geoip = (await import('geoip-lite')).default;
const { geofenceRegistration } = await import('../../src/middleware/geofence.js');

const OLD_ENV = process.env.NODE_ENV;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'production'; // geofence only runs in production
  delete process.env.GEOFENCING;
});
afterAll(() => { process.env.NODE_ENV = OLD_ENV; });

const run = (headers = {}, ip = '198.51.100.7') => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { headers: lower, ip, get: (k) => lower[k.toLowerCase()] };
  const res = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res);
  const next = vi.fn();
  geofenceRegistration(req, res, next);
  return { res, next };
};

describe('geofenceRegistration', () => {
  it('geolocates the REAL client (leftmost XFF), not the Railway edge (req.ip)', () => {
    // XFF = "<AT client>, <NL edge>"; req.ip is the NL edge. Must use the client.
    geoip.lookup.mockImplementation((ip) => (ip === '84.112.0.1' ? { country: 'AT' } : { country: 'NL' }));
    const { res, next } = run({ 'x-forwarded-for': '84.112.0.1, 5.6.7.8' }, '5.6.7.8');
    expect(geoip.lookup).toHaveBeenCalledWith('84.112.0.1'); // NOT the edge
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('blocks a real client outside the launch markets', () => {
    geoip.lookup.mockReturnValue({ country: 'US' });
    const { res, next } = run({ 'x-forwarded-for': '203.0.113.9' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REGION_NOT_SUPPORTED', country: 'US' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('lets native apps (X-Client-Platform) bypass without a geo lookup', () => {
    const { res, next } = run({ 'x-client-platform': 'android', 'x-forwarded-for': '203.0.113.9' });
    expect(geoip.lookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('allows a private/loopback client IP (dev/proxy) without geo lookup', () => {
    const { next } = run({ 'x-forwarded-for': '10.0.0.4' });
    expect(geoip.lookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('is disabled outside production', () => {
    process.env.NODE_ENV = 'development';
    const { res, next } = run({ 'x-forwarded-for': '203.0.113.9' });
    expect(geoip.lookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});
