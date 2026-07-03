import geoip from 'geoip-lite';

// Countries where JAMIE is live. Extend as new markets open.
const ALLOWED_COUNTRIES = (process.env.ALLOWED_COUNTRIES || 'AT,DE,CH').split(',').map(c => c.trim());

// Enabled by default in production; set GEOFENCING=false to disable
const enabled = () =>
  process.env.NODE_ENV === 'production' && process.env.GEOFENCING !== 'false';

export const geofenceRegistration = (req, res, next) => {
  if (!enabled()) return next();

  // Native app installs (iOS/Android) are exempt from the geo-block: anyone who
  // installed JAMIE from the App Store / Play Store is a target user regardless
  // of country, and store reviewers sit outside AT/DE/CH — a 403 here reads as a
  // broken app (App Review 2.1, the geo-block rejection). The frontend sets this
  // header only inside the Capacitor native shell (utils/platform.isNative); the
  // web PWA keeps the DACH-only signup gate. This is a soft market gate, not a
  // security control, so a spoofable header is an acceptable trade-off.
  const clientPlatform = (req.get('x-client-platform') || '').toLowerCase();
  if (clientPlatform === 'ios' || clientPlatform === 'android') return next();

  const ip = req.ip;
  // Loopback / private ranges → allow (dev/staging behind a proxy)
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
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
