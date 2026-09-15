import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCached, setCached, invalidatePrefix, deleteCached, _cacheSize } from '../../src/utils/cache.js';

// The cache is a module-level singleton; each case uses its own key prefix.
describe('in-process TTL cache', () => {
  afterEach(() => { vi.useRealTimers(); invalidatePrefix('t:'); });

  it('stores and returns a value inside its TTL', () => {
    setCached('t:a', { n: 1 }, 1000);
    expect(getCached('t:a')).toEqual({ n: 1 });
  });

  it('expires on read and drops the entry (does not wait for the 5-min sweep)', () => {
    vi.useFakeTimers();
    setCached('t:b', 'x', 1000);
    const before = _cacheSize();
    vi.advanceTimersByTime(1001);
    expect(getCached('t:b')).toBe(null);
    expect(_cacheSize()).toBe(before - 1);   // evicted, not just hidden
  });

  it('invalidatePrefix and deleteCached remove entries', () => {
    setCached('t:p:1', 1, 1000);
    setCached('t:p:2', 2, 1000);
    setCached('t:q', 3, 1000);
    invalidatePrefix('t:p:');
    expect(getCached('t:p:1')).toBe(null);
    expect(getCached('t:p:2')).toBe(null);
    expect(getCached('t:q')).toBe(3);
    deleteCached('t:q');
    expect(getCached('t:q')).toBe(null);
  });

  // The point of the cap (audit 2026-09-15, finding 2): no caller's key choice
  // may grow the store without bound. Before this, a per-user key meant one
  // 100-row entry per concurrent user, none reclaimable for up to five minutes.
  it('is bounded — writing far past the cap evicts oldest-first', () => {
    const before = _cacheSize();
    for (let i = 0; i < 2600; i++) setCached(`t:bulk:${i}`, `v${i}`, 60_000);
    expect(_cacheSize()).toBeLessThanOrEqual(2000);
    // The newest writes survived...
    expect(getCached('t:bulk:2599')).toBe('v2599');
    // ...and the oldest were evicted.
    expect(getCached('t:bulk:0')).toBe(null);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('re-writing a key refreshes its eviction position', () => {
    for (let i = 0; i < 1900; i++) setCached(`t:lru:${i}`, i, 60_000);
    setCached('t:lru:0', 'refreshed', 60_000);   // oldest → newest
    for (let i = 1900; i < 2400; i++) setCached(`t:lru:${i}`, i, 60_000);
    expect(getCached('t:lru:0')).toBe('refreshed');
  });
});
