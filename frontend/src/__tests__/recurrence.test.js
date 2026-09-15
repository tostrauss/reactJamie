import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  nextOccurrence,
  parseDateDescriptor,
  isHappeningSoon,
  viennaTodayUTC,
  utcDayStart,
} from '../utils/recurrence';

/**
 * The UTC-tagged wall-clock contract.
 *
 * `groups.date` is a naive TIMESTAMP holding Vienna wall-clock; on the UTC
 * server it reaches the client tagged `Z`, so getUTC* is the only accessor
 * that returns what the organizer typed. Reading it with the LOCAL getters
 * shifted an evening event onto the next calendar day: a 22:00 event was
 * badged "Morgen", the "Heute" filter dropped it, and the Gruppen feed's
 * Heute/Morgen split would have put it in the wrong block.
 *
 * These cases pin that, because it is the kind of bug that grows back the
 * next time someone writes another day helper.
 */
describe('UTC-tagged wall-clock date handling', () => {
  // 15.09.2026 21:00 Vienna (CEST, UTC+2) = 19:00Z. Chosen so the device's
  // local day and Vienna's day still agree, while a 22:00 EVENT does not.
  const NOW = new Date('2026-09-15T19:00:00.000Z');

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('viennaTodayUTC is Vienna\'s calendar day as a UTC day-start', () => {
    expect(new Date(viennaTodayUTC()).toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('late-evening event stays on TODAY (the regression)', () => {
    // Organizer typed 15.09. 22:00. Local getters read this as 16.09. 00:00
    // in CEST and reported "Morgen".
    const ev = { date: '2026-09-15T22:00:00.000Z' };
    expect(parseDateDescriptor(nextOccurrence(ev)).kind).toBe('today');
    expect(isHappeningSoon(ev)).toBe(true);
  });

  it('a 22:00 event TOMORROW is "tomorrow", not the day after', () => {
    const ev = { date: '2026-09-16T22:00:00.000Z' };
    expect(parseDateDescriptor(nextOccurrence(ev)).kind).toBe('tomorrow');
    expect(isHappeningSoon(ev)).toBe(true);
  });

  it('formats the typed time, not the device-shifted one', () => {
    const d = parseDateDescriptor(new Date('2026-09-15T22:00:00.000Z'), 'de-DE');
    expect(d.time).toBe('22:00');
  });

  it('day boundaries either side of the imminent window', () => {
    expect(isHappeningSoon({ date: '2026-09-14T22:00:00.000Z' })).toBe(false); // yesterday
    expect(isHappeningSoon({ date: '2026-09-15T00:00:00.000Z' })).toBe(true);  // all-day today
    expect(isHappeningSoon({ date: '2026-09-16T23:59:00.000Z' })).toBe(true);  // last minute of tomorrow
    expect(isHappeningSoon({ date: '2026-09-17T00:00:00.000Z' })).toBe(false); // day after
  });

  it('undated groups are never imminent', () => {
    // They are ongoing/open-ended — the server bucket agrees (IS_IMMINENT_SQL).
    expect(isHappeningSoon({ date: null })).toBe(false);
    expect(isHappeningSoon({})).toBe(false);
    expect(isHappeningSoon({ date: 'not a date' })).toBe(false);
  });

  it('a weekly group whose stored start is weeks past counts as today', () => {
    // Mirrors the server: the stored first occurrence rolls forward in whole
    // weeks, so a Tuesday meetup is "Heute" on Tuesday.
    const weekly = { date: '2026-08-25T22:00:00.000Z', is_recurring_weekly: true };
    expect(new Date(weekly.date).getUTCDay()).toBe(2);            // Tuesday
    expect(new Date(NOW).getUTCDay()).toBe(2);                    // also a Tuesday
    expect(utcDayStart(nextOccurrence(weekly))).toBe(viennaTodayUTC());
    expect(isHappeningSoon(weekly)).toBe(true);
  });

  it('a weekly slot that already passed today rolls to next week', () => {
    // 18:00 Vienna is over at 21:00 Vienna, so the card must show next Tuesday
    // — and the group is NOT imminent. This is the comparison that was two
    // hours out: 18:00 tagged UTC vs the real instant kept it "upcoming".
    const weekly = { date: '2026-08-25T18:00:00.000Z', is_recurring_weekly: true };
    expect(nextOccurrence(weekly).toISOString()).toBe('2026-09-22T18:00:00.000Z');
    expect(isHappeningSoon(weekly)).toBe(false);
  });

  it('the wall-clock baseline holds right at the hour the old code got wrong', () => {
    // 20:30 Vienna = 18:30Z. A weekly 19:00 slot is still AHEAD in Vienna, but
    // an instant comparison against 18:30Z would have called 19:00 "future"
    // too — for the wrong reason, and at 21:30 Vienna it would still say so.
    vi.setSystemTime(new Date('2026-09-15T19:30:00.000Z')); // 21:30 Vienna
    const weekly = { date: '2026-08-25T19:00:00.000Z', is_recurring_weekly: true };
    expect(nextOccurrence(weekly).toISOString()).toBe('2026-09-22T19:00:00.000Z');
  });

  it('non-recurring past events are left alone', () => {
    const past = { date: '2026-08-25T18:00:00.000Z' };
    expect(nextOccurrence(past).toISOString()).toBe('2026-08-25T18:00:00.000Z');
    expect(isHappeningSoon(past)).toBe(false);
  });
});
