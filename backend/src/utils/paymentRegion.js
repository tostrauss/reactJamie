import geoip from 'geoip-lite';
import db from '../config/database.js';
import { getClientIp } from './clientIp.js';

// Countries we SELL subscriptions and boosts in — deliberately narrower than
// the countries the APP is available in (middleware/geofence.js: AT,DE,CH,IT,
// FR,ES).
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

const allowedList = (c) => !!c && SUBSCRIPTION_COUNTRIES.includes(c.toUpperCase());

/**
 * Country check for money-taking routes.
 *
 * TWO signals, and ANY match allows. This is deliberate — the first version
 * used GeoIP alone and refused a real Vienna customer on 4G within minutes of
 * go-live (Tobi, 2026-09-03):
 *
 *  1. users.country — ISO-3166-1 alpha-2 geocoded from the user's PROFILE city.
 *     This is the better signal by far: VAT follows a customer's residence, not
 *     the egress of the network they happen to be on. It is also stable while
 *     travelling.
 *  2. GeoIP on the leftmost X-Forwarded-For (never req.ip — on Railway that is
 *     an edge address and would place every buyer in the wrong country, the
 *     2026-08-07 incident). Kept as a fallback for users whose profile city
 *     hasn't been geocoded yet.
 *
 * geoip-lite ships a bundled DB that goes stale, and mobile CGNAT ranges are
 * routinely mis-attributed or absent (IPv6 especially). So GeoIP may only ever
 * ADD permission here, never remove it: we block strictly when we have at least
 * one usable signal and NONE of them names an allowed country. Unknown on both
 * sides fails OPEN — a rare unmapped sale is much cheaper than turning away a
 * paying customer, and Stripe Tax independently declines to itemize VAT for a
 * country we hold no registration in (that path is logged as 'tax-fallback').
 *
 * No native-app exemption, unlike the signup geofence: checkout is already
 * blocked in every app shell (isAppShellRequest), so this only ever sees real
 * browsers. An exemption here would be a tax hole, not a courtesy.
 */
export const checkSubscriptionCountry = async (req, userId = req?.userId) => {
  // 1. Profile country (authoritative-ish, travel-proof).
  let profileCountry = null;
  if (userId) {
    try {
      const r = await db.query('SELECT country FROM users WHERE id = $1', [userId]);
      profileCountry = r.rows[0]?.country || null;
    } catch {
      // Column missing or DB hiccup — fall through to GeoIP rather than
      // blocking a purchase over a diagnostic lookup.
    }
  }
  if (allowedList(profileCountry)) {
    return { allowed: true, country: profileCountry.toUpperCase(), source: 'profile' };
  }

  // 2. GeoIP — may only ever GRANT, never block.
  const ip = getClientIp(req);
  const geoCountry = isPrivateIp(ip) ? null : (geoip.lookup(ip)?.country || null);
  if (allowedList(geoCountry)) {
    return { allowed: true, country: geoCountry, source: 'geoip' };
  }

  // Only a KNOWN profile country may block. If the profile has no country yet
  // (not geocoded), we allow — even when GeoIP names a country we don't sell
  // in. Letting GeoIP block on its own is what refused a Vienna customer on 4G
  // (2026-09-03), and geoip-lite is simply not trustworthy enough for that: a
  // mis-attributed mobile range would silently cost a real sale, while the
  // opposite error (an occasional out-of-market sale) is caught downstream —
  // Stripe Tax declines to itemize VAT for an unregistered country and logs it
  // as 'tax-fallback'. Cheap error vs. expensive error.
  if (profileCountry) {
    return { allowed: false, country: profileCountry.toUpperCase(), source: 'profile' };
  }
  return { allowed: true, country: geoCountry, source: geoCountry ? 'geoip-unblocked' : 'unknown' };
};

// Synchronous GeoIP-only view, for diagnostics that must not touch the DB.
export const geoipCountryOf = (req) => {
  const ip = getClientIp(req);
  if (isPrivateIp(ip)) return null;
  return geoip.lookup(ip)?.country || null;
};

export const getSubscriptionCountries = () => [...SUBSCRIPTION_COUNTRIES];
