import geoip from 'geoip-lite';
import { getClientIp } from './clientIp.js';

// Countries we SELL subscriptions in — deliberately narrower than the countries
// the APP is available in (middleware/geofence.js: AT,DE,CH,IT,FR,ES).
//
// Why narrower: every country we take money in is a country we may owe VAT in.
// Restricting the paid product to AT+DE keeps that to one tax registration
// (under the 10k EUR EU-wide B2C threshold, German customers are still charged
// Austrian VAT), while the free app stays open in all launch markets.
// Widen via the SUBSCRIPTION_COUNTRIES env var once the corresponding tax
// registrations exist — NOT before.
const SUBSCRIPTION_COUNTRIES = (process.env.SUBSCRIPTION_COUNTRIES || 'AT,DE')
  .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

// Private/loopback ranges — dev, staging behind a proxy, health checks.
const isPrivateIp = (ip) =>
  !ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') ||
  ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/**
 * Country check for money-taking routes.
 *
 * Uses the REAL client IP (leftmost X-Forwarded-For), never req.ip — on Railway
 * that resolves to the edge (e.g. Amsterdam -> 'NL') and would reject every
 * legitimate buyer. Same lesson as the 2026-08-07 geofence incident.
 *
 * Fail-open when the country is UNKNOWN (private IP, geoip miss), fail-closed
 * only when it is known and not on the list — mirroring geofenceRegistration.
 * Blocking on "we couldn't tell" would break local dev and silently kill sales
 * whenever the geoip DB has a gap; a rare unmapped sale is the cheaper error,
 * and Stripe Tax independently refuses to itemize VAT for a country we hold no
 * registration in (the subscription then falls back to un-taxed, which is
 * visible in Sentry).
 *
 * No native-app exemption on purpose: unlike the signup geofence, checkout is
 * already blocked in every app shell (isAppShellRequest), so this only ever
 * sees real browsers. An exemption here would be a tax hole, not a courtesy.
 */
export const checkSubscriptionCountry = (req) => {
  const ip = getClientIp(req);
  if (isPrivateIp(ip)) return { allowed: true, country: null };
  const country = geoip.lookup(ip)?.country || null;
  if (!country) return { allowed: true, country: null };
  return { allowed: SUBSCRIPTION_COUNTRIES.includes(country), country };
};

export const getSubscriptionCountries = () => [...SUBSCRIPTION_COUNTRIES];
