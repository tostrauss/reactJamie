import { describe, it, expect } from 'vitest';
import { formatEventDate, eventDateLocale } from '../utils/eventDate';

// The date tile of the club/group event lists and the profile's „Demnächst
// dabei“ (one copy since 16.11.2026). The stored value is a Vienna wall-clock
// tagged UTC — only the UTC reading is what the organizer typed.
describe('formatEventDate', () => {
  it('reads day, month and time in UTC — a 22:00 event stays on its day', () => {
    const parts = formatEventDate('2026-11-20T22:00:00.000Z', 'de-AT');
    expect(parts.day).toBe(20);
    expect(parts.month).toMatch(/^Nov/);   // „Nov“ or „Nov.“, depending on the ICU data
    expect(parts.time).toBe('22:00');
  });

  it('no date or an unparseable one → null (the tile shows „?“)', () => {
    expect(formatEventDate(null, 'de-AT')).toBeNull();
    expect(formatEventDate('', 'de-AT')).toBeNull();
    expect(formatEventDate('kein Datum', 'de-AT')).toBeNull();
  });
});

describe('eventDateLocale', () => {
  it('maps the i18n language to the locale of the detail pages, German by default', () => {
    expect(eventDateLocale('en')).toBe('en-US');
    expect(eventDateLocale('it-IT')).toBe('it-IT');
    expect(eventDateLocale('fr')).toBe('fr-FR');
    expect(eventDateLocale('es')).toBe('es-ES');
    expect(eventDateLocale('de')).toBe('de-AT');
    expect(eventDateLocale(undefined)).toBe('de-AT');
  });
});
