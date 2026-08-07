// Real client IP behind Railway's reverse proxy.
//
// `req.ip` (Express, with `trust proxy: 1`) can resolve to a RAILWAY EDGE
// address rather than the visitor — depending on how many proxy hops Railway
// actually inserts vs the trusted-hop count. That edge then geolocates to the
// edge's country (e.g. NL for the Amsterdam "ams1" edge), which silently
// geo-blocked real users in the launch markets at the registration geofence.
//
// The leftmost X-Forwarded-For entry is the original client as seen by the
// first proxy, so it's the address to geolocate. It is SPOOFABLE (a client can
// prepend a fake XFF and Railway appends the real IP after it) — perfectly fine
// for the soft market geofence (already documented as "not a security control"),
// but do NOT use this for anything security-sensitive.
export const getClientIp = (req) =>
  (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
