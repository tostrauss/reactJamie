/**
 * Lightweight in-process TTL cache.
 *
 * Used for hot read endpoints (group list, map pins, member avatars) where
 * 100s of users fire identical queries within seconds of each other.
 * A single instance is fine on Railway — switch to Redis if horizontal
 * scaling is added later.
 *
 * BOUNDED (audit 2026-09-15, finding 2). This was a plain Map with no size
 * limit whose only eviction was a 5-minute sweep — so peak resident memory was
 * everything written in any 5-minute window, not what was live. Callers keying
 * on caller identity or on unclamped query strings could therefore grow it
 * without bound, and a post-broadcast wave was an OOM rather than a slowdown.
 * Those call sites are fixed, but the store must not depend on every future
 * caller choosing a well-behaved key: the cap is the backstop.
 */
const _store = new Map();

// ~2000 entries. The real entries are list pages of up to 100 rows (order 100 KB
// worst case), so this bounds the cache at a few hundred MB in the pathological
// case and far less in practice — while still being far more than the few dozen
// distinct keys the app's own filter combinations can produce.
const MAX_ENTRIES = 2000;

// Evict expired entries every 5 minutes so memory doesn't grow unbounded.
// This is now the tidy-up pass, not the safety mechanism — the cap below is.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _store) {
    if (now > v.exp) _store.delete(k);
  }
}, 5 * 60_000).unref();

export function getCached(key) {
  const e = _store.get(key);
  if (!e) return null;
  if (Date.now() >= e.exp) {
    // Drop it on read rather than leaving it for the timer: a key that is read
    // is a key that will be written again a moment later, so this keeps the hot
    // set from carrying a stale twin of every entry for up to five minutes.
    _store.delete(key);
    return null;
  }
  return e.data;
}

export function setCached(key, data, ttlMs) {
  // Re-insert at the end so the Map's insertion order stays a usable
  // least-recently-written order for the eviction below.
  _store.delete(key);
  _store.set(key, { data, exp: Date.now() + ttlMs });

  if (_store.size <= MAX_ENTRIES) return;
  // Over the cap: drop expired entries first (free), then evict oldest-written
  // until back under. A Map iterates in insertion order, so `keys().next()` is
  // the oldest — FIFO eviction in O(1) per victim.
  const now = Date.now();
  for (const [k, v] of _store) {
    if (_store.size <= MAX_ENTRIES) break;
    if (now >= v.exp) _store.delete(k);
  }
  while (_store.size > MAX_ENTRIES) {
    const oldest = _store.keys().next().value;
    if (oldest === undefined) break;
    _store.delete(oldest);
  }
}

/**
 * Delete every entry whose key starts with `prefix`.
 * Call this after any write that mutates the cached data set.
 * CAUTION with numeric suffixes: `user_groups:1` also matches
 * `user_groups:12` — when the full key is known, use deleteCached instead.
 */
export function invalidatePrefix(prefix) {
  for (const k of _store.keys()) {
    if (k.startsWith(prefix)) _store.delete(k);
  }
}

/** Exact-key eviction — the right tool when the key is fully known. */
export function deleteCached(key) {
  _store.delete(key);
}

/** Test/diagnostics only. */
export function _cacheSize() {
  return _store.size;
}
