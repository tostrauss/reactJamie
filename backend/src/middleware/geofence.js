import geoip from 'geoip-lite';

// Countries where JAMIE is live. Extend as new markets open.
const ALLOWED_COUNTRIES = (process.env.ALLOWED_COUNTRIES || 'AT,DE,CH').split(',').map(c => c.trim());

// Enabled by default in production; set GEOFENCING=false to disable
const enabled = () =>
  process.env.NODE_ENV === 'production' && process.env.GEOFENCING !== 'false';

export const geofenceRegistration = (req, res, next) => {
  if (!enabled()) return next();

  const ip = req.ip;
  // Loopback / private ranges → allow (dev/staging behind a proxy)
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return next();
  }

  const geo = geoip.lookup(ip);
  const country = geo?.country || null;

  if (country && !ALLOWED_COUNTRIES.includes(country)) {
    return res.status(403).json({
      error: 'JAMIE ist in deiner Region noch nicht verfügbar.',
      country,
      code: 'REGION_NOT_SUPPORTED'
    });
  }

  next();
};
