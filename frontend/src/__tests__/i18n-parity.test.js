import { describe, it, expect } from 'vitest';
import de from '../i18n/locales/de.json';
import en from '../i18n/locales/en.json';
import itLocale from '../i18n/locales/it.json';
import fr from '../i18n/locales/fr.json';
import es from '../i18n/locales/es.json';

// All five locales must carry the same keys in the same order, with the same
// {{placeholders}} — a key missing in one language silently falls back to
// German there, and a placeholder typo prints "{{n}}" to the user.
// (Added with the Abzeichen-Stufen, 06.10.2026, when every feature started
// shipping 20+ keys in five files at once.)
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
const placeholders = (s) => (typeof s === 'string' ? [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort() : []);

const LOCALES = { en, it: itLocale, fr, es };
const deFlat = flatten(de);
const deKeys = deFlat.map(([k]) => k);
const deMap = Object.fromEntries(deFlat);

describe('i18n parity with German', () => {
  for (const [name, loc] of Object.entries(LOCALES)) {
    it(`${name}: identical keys in identical order`, () => {
      expect(flatten(loc).map(([k]) => k)).toEqual(deKeys);
    });

    it(`${name}: identical {{placeholders}} per key`, () => {
      const mismatches = flatten(loc).filter(([k, v]) => {
        const mine = placeholders(v);
        const ref = placeholders(deMap[k]);
        // A singular form may legitimately spell the number out on either side
        // ("einmal" vs "{{count}} event") — {{count}} is optional there.
        if (k.endsWith('_one')) {
          const strip = (arr) => JSON.stringify(arr.filter((p) => p !== 'count'));
          return strip(mine) !== strip(ref);
        }
        return JSON.stringify(mine) !== JSON.stringify(ref);
      }).map(([k]) => k);
      expect(mismatches).toEqual([]);
    });
  }
});
