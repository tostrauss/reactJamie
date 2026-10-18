import { describe, it, expect } from 'vitest';
import { normalizeTier, tierEmoji, tierMinEvents, progressOf } from '../utils/attendanceTiers';

// Abzeichen-Stufen display helpers (tester 06.10.2026). The server decides the
// level; these only render it and draw the own progress bar. Five steps since
// Lea's feedback (18.10.2026): 25 🌟 and 50 💎 between 🏆 and 🎆.
describe('normalizeTier', () => {
  it('passes 1–5 and turns everything else into 0', () => {
    for (const v of [1, 2, 3, 4, 5]) expect(normalizeTier(v)).toBe(v);
    for (const v of [0, '2', 6, -1, null, undefined, NaN, 1.5]) expect(normalizeTier(v)).toBe(0);
  });
});

describe('tierEmoji / tierMinEvents', () => {
  it('map 🏅 5 / 🏆 10 / 🌟 25 / 💎 50 / 🎆 100', () => {
    expect([1, 2, 3, 4, 5].map(tierEmoji)).toEqual(['🏅', '🏆', '🌟', '💎', '🎆']);
    expect([1, 2, 3, 4, 5].map(tierMinEvents)).toEqual([5, 10, 25, 50, 100]);
    expect(tierEmoji(0)).toBe('');
    expect(tierMinEvents(0)).toBe(0);
  });
});

describe('progressOf (own card)', () => {
  it('measures the way from the current to the next step', () => {
    const p = progressOf({ confirmed_events: 7, confirmers: 3, tier: 1, next: { tier: 2, events_missing: 3, confirmers_missing: 0 } });
    expect(p).toMatchObject({ level: 2, emoji: '🏆', min: 10, prevMin: 5, remaining: 3, needsPeople: false, pct: 40 });
  });

  it('walks the new steps between 🏆 and 🎆', () => {
    const toStar = progressOf({ confirmed_events: 16, confirmers: 5, tier: 2, next: { tier: 3, events_missing: 9, confirmers_missing: 0 } });
    expect(toStar).toMatchObject({ level: 3, emoji: '🌟', min: 25, prevMin: 10, remaining: 9, minPeople: 5, pct: 40 });
    const toDiamond = progressOf({ confirmed_events: 30, confirmers: 6, tier: 3, next: { tier: 4, events_missing: 20, confirmers_missing: 1 } });
    expect(toDiamond).toMatchObject({ level: 4, emoji: '💎', min: 50, prevMin: 25, remaining: 20, minPeople: 7, pct: 20 });
    const toTop = progressOf({ confirmed_events: 75, confirmers: 9, tier: 4, next: { tier: 5, events_missing: 25, confirmers_missing: 1 } });
    expect(toTop).toMatchObject({ level: 5, emoji: '🎆', min: 100, prevMin: 50, remaining: 25, minPeople: 10, pct: 50 });
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
    expect(progressOf({ confirmed_events: 150, confirmers: 20, tier: 5, next: null })).toBeNull();
    expect(progressOf(null)).toBeNull();
  });
});
