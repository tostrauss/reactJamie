import { describe, it, expect } from 'vitest';
import { dropVanished, quoteIdOf } from '../utils/chatMerge';

// A hidden chat page is out of its socket room, so deletions only reach it via
// the catch-up refetch — which used to append and patch, never remove.
const row = (id, over = {}) => ({ id, content: `m${id}`, ...over });

describe('dropVanished', () => {
  it('removes a held row inside the fetched window that the server no longer returns', () => {
    const prev = [row(1), row(2), row(3), row(4)];
    expect(dropVanished(prev, [row(1), row(2), row(4)]).map((m) => m.id)).toEqual([1, 2, 4]);
  });

  it('keeps older history below the window and live rows above it', () => {
    const prev = [row(1), row(2), row(10), row(11), row(12), row(20)];
    expect(dropVanished(prev, [row(10), row(12)]).map((m) => m.id)).toEqual([1, 2, 10, 12, 20]);
  });

  it('keeps local bubbles: pending, failed, temp ids', () => {
    const prev = [row(5), row('temp-x', { _pending: true }), row('temp-y', { _failed: true }), row(6, { _pending: true })];
    expect(dropVanished(prev, [row(4), row(7)])).toHaveLength(3); // only 5 is gone
  });

  it('clears quote bars that point at a dropped message, outside the window too', () => {
    const prev = [row(1, { reply_to: { id: 3, content: 'weg' } }), row(3), row(4), row(5, { reply_to: { id: '3' } })];
    const out = dropVanished(prev, [row(2), row(4), row(5, { reply_to: null })]);
    expect(out.map((m) => m.id)).toEqual([1, 4, 5]);
    expect(out[0].reply_to).toBeNull();
    expect(out[2].reply_to).toBeNull();
  });

  it('returns prev itself when nothing vanished, and for an empty or odd fetch', () => {
    const prev = [row(1), row(2)];
    expect(dropVanished(prev, [row(1), row(2), row(3)])).toBe(prev);
    expect(dropVanished(prev, [])).toBe(prev);
    expect(dropVanished(prev, null)).toBe(prev);
    expect(dropVanished(prev, [{ id: 'temp-1' }])).toBe(prev);
  });

  it('accepts numeric-string ids from either side', () => {
    expect(dropVanished([row('7'), row('8')], [row(7), row(9)]).map((m) => m.id)).toEqual(['7']);
  });
});

describe('quoteIdOf', () => {
  it('normalises the quoted id to a string, null without a quote', () => {
    expect(quoteIdOf({ reply_to: { id: 3 } })).toBe('3');
    expect(quoteIdOf({ reply_to: null })).toBeNull();
    expect(quoteIdOf({})).toBeNull();
    expect(quoteIdOf(null)).toBeNull();
  });
});
