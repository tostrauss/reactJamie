import { describe, it, expect } from 'vitest';
import { pickRandom, goingWhen, firstName } from '../utils/friendsHub';

// Helpers of the new Friends page (Tina, 17.11.2026).

describe('pickRandom — „3 zufällige Freunde, bei jedem Öffnen neu gemischt“', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];

  it('draws n different entries of the list and leaves the list alone', () => {
    for (let run = 0; run < 50; run++) {
      const got = pickRandom(list, 3);
      expect(got).toHaveLength(3);
      expect(new Set(got).size).toBe(3);
      for (const x of got) expect(list).toContain(x);
    }
    expect(list).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('the draw is the random source\'s: another source, another three', () => {
    expect(pickRandom(list, 3, () => 0)).toEqual(['a', 'b', 'c']);
    expect(pickRandom(list, 3, () => 0.999)).toEqual(['e', 'a', 'b']);
  });

  it('every entry can come up', () => {
    const seen = new Set();
    for (let run = 0; run < 300; run++) pickRandom(list, 3).forEach((x) => seen.add(x));
    expect([...seen].sort()).toEqual(list);
  });

  it('fewer entries than asked for: all of them; nothing: nothing', () => {
    expect(pickRandom(['a', 'b'], 3).sort()).toEqual(['a', 'b']);
    expect(pickRandom([], 3)).toEqual([]);
    expect(pickRandom(null, 3)).toEqual([]);
    expect(pickRandom(list, 0)).toEqual([]);
  });
});

describe('goingWhen — „Do, 19:00“ on a card', () => {
  // Thursday 19.11.2026; today = Tuesday 17.11.2026 (Vienna day as UTC day start).
  const today = Date.UTC(2026, 10, 17);
  const opts = { locale: 'de-AT', today, todayLabel: 'Heute' };

  it('the next six days: the weekday and the time, exactly as typed (UTC-tagged wall-clock)', () => {
    expect(goingWhen('2026-11-19T19:00:00.000Z', opts)).toBe('Do, 19:00');
    expect(goingWhen('2026-11-21T21:00:00.000Z', opts)).toBe('Sa, 21:00');
    expect(goingWhen('2026-11-22T08:00:00.000Z', opts)).toBe('So, 08:00');
    // Late evening stays on its own day — no shift by the device's zone.
    expect(goingWhen('2026-11-18T23:30:00.000Z', opts)).toBe('Mi, 23:30');
    expect(goingWhen('2026-11-23T19:00:00.000Z', opts)).toBe('Mo, 19:00');
  });

  it('today says „Heute“', () => {
    expect(goingWhen('2026-11-17T19:00:00.000Z', opts)).toBe('Heute, 19:00');
  });

  it('a week or more ahead: the date beside the weekday — a bare weekday would be read as this week\'s', () => {
    expect(goingWhen('2026-11-24T19:00:00.000Z', opts)).toBe('Di, 24.11., 19:00');
    expect(goingWhen('2026-12-31T22:00:00.000Z', opts)).toBe('Do, 31.12., 22:00');
  });

  it('a meetup without a time (stored at midnight): the day alone', () => {
    expect(goingWhen('2026-11-19T00:00:00.000Z', opts)).toBe('Do');
    expect(goingWhen('2026-11-17T00:00:00.000Z', opts)).toBe('Heute');
    expect(goingWhen('2026-11-27T00:00:00.000Z', opts)).toBe('Fr, 27.11.');
  });

  it('other languages: their own weekday, capitalised, without the abbreviation\'s dot', () => {
    const fr = goingWhen('2026-11-19T19:00:00.000Z', { locale: 'fr-FR', today, todayLabel: 'Aujourd’hui' });
    expect(fr).toBe('Jeu, 19:00');
    expect(goingWhen('2026-11-19T19:00:00.000Z', { locale: 'en-US', today, todayLabel: 'Today' })).toMatch(/^Thu, 0?7:00\sPM$/);
  });

  it('nothing usable: an empty string', () => {
    expect(goingWhen(null, opts)).toBe('');
    expect(goingWhen('not a date', opts)).toBe('');
  });
});

describe('firstName', () => {
  it('the first word of the name', () => {
    expect(firstName('Fynn')).toBe('Fynn');
    expect(firstName('Fynn Huber')).toBe('Fynn');
    expect(firstName('  Anna-Lena   Maria Gruber ')).toBe('Anna-Lena');
    expect(firstName('')).toBe('');
    expect(firstName(null)).toBe('');
  });
});
