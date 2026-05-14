/**
 * Lightweight in-process TTL cache.
 *
 * Used for hot read endpoints (group list, map pins, member avatars) where
 * 100s of users fire identical queries within seconds of each other.
 * A single instance is fine on Railway — switch to Redis if horizontal
 * scaling is added later.
 */
const _store = new Map();

// Evict expired entries every 5 minutes so memory doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _store) {
    if (now > v.exp) _store.delete(k);
  }
}, 5 * 60_000).unref();

export function getCached(key) {
  const e = _store.get(key);
  return e && Date.now() < e.exp ? e.data : null;
}

export function setCached(key, data, ttlMs) {
  _store.set(key, { data, exp: Date.now() + ttlMs });
}

/**
 * Delete every entry whose key starts with `prefix`.
 * Call this after any write that mutates the cached data set.
 */
export function invalidatePrefix(prefix) {
  for (const k of _store.keys()) {
    if (k.startsWith(prefix)) _store.delete(k);
  }
}
