import { describe, it, expect } from 'vitest';
import { normalizeTier, tierEmoji, tierMinEvents, progressOf } from '../utils/attendanceTiers';

// Abzeichen-Stufen display helpers (tester 06.10.2026). The server decides the
// level; these only render it and draw the own progress bar.
describe('normalizeTier', () => {
  it('passes 1–3 and turns everything else into 0', () => {
    for (const v of [1, 2, 3]) expect(normalizeTier(v)).toBe(v);
    for (const v of [0, '2', 4, -1, null, undefined, NaN, 1.5]) expect(normalizeTier(v)).toBe(0);
  });
});

describe('tierEmoji / tierMinEvents', () => {
  it('map 🏅 5 / 🏆 10 / 🎆 100', () => {
    expect([1, 2, 3].map(tierEmoji)).toEqual(['🏅', '🏆', '🎆']);
    expect([1, 2, 3].map(tierMinEvents)).toEqual([5, 10, 100]);
    expect(tierEmoji(0)).toBe('');
    expect(tierMinEvents(0)).toBe(0);
  });
});

describe('progressOf (own card)', () => {
  it('measures the way from the current to the next step', () => {
    const p = progressOf({ confirmed_events: 7, confirmers: 3, tier: 1, next: { tier: 2, events_missing: 3, confirmers_missing: 0 } });
    expect(p).toMatchObject({ level: 2, emoji: '🏆', min: 10, prevMin: 5, remaining: 3, needsPeople: false, pct: 40 });
  });

  it('flags the anti-farming floor: enough meetups, not enough DIFFERENT people', () => {
    const p = progressOf({ confirmed_events: 12, confirmers: 2, tier: 1, next: { tier: 2, events_missing: 0, confirmers_missing: 1 } });
    expect(p).toMatchObject({ needsPeople: true, minPeople: 3, remaining: 0 });
  });

  it('starts at zero towards 🏅', () => {
    const p = progressOf({ confirmed_events: 0, confirmers: 0, tier: 0, next: { tier: 1, events_missing: 5, confirmers_missing: 2 } });
    expect(p).toMatchObject({ level: 1, emoji: '🏅', remaining: 5, pct: 0 });
  });

  it('is null at the top', () => {
    expect(progressOf({ confirmed_events: 150, confirmers: 20, tier: 3, next: null })).toBeNull();
    expect(progressOf(null)).toBeNull();
  });
});
