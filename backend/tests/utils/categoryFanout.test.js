import { describe, it, expect } from 'vitest';
import { expandMatchTerms } from '../../src/utils/categoryFanout.js';

describe('expandMatchTerms — interest-match push targeting', () => {
  it('expands a sub-category to itself + its main label', () => {
    const terms = expandMatchTerms(['Fußball']);
    expect(terms).toContain('fußball');
    expect(terms).toContain('sport');
  });

  it('adds main-level aliases (Natur matches every Outdoor group)', () => {
    const terms = expandMatchTerms(['Wandern']);
    expect(terms).toEqual(expect.arrayContaining(['wandern', 'outdoor', 'natur']));
  });

  it('adds sub-level aliases only for that sub (Film→Filme, Essen gehen→Essen)', () => {
    expect(expandMatchTerms(['Film'])).toContain('filme');
    expect(expandMatchTerms(['Essen gehen'])).toContain('essen');
    // Theater is Kultur too but must NOT pull the Filme alias
    expect(expandMatchTerms(['Theater'])).not.toContain('filme');
  });

  it('drops "Sonstiges" entirely — no interest signal, pure noise', () => {
    expect(expandMatchTerms(['Sonstiges'])).toEqual([]);
  });

  it('subs of the Sonstiges main still match directly, without an umbrella term', () => {
    const terms = expandMatchTerms(['Gaming']);
    expect(terms).toContain('gaming');
    expect(terms).not.toContain('sonstiges');
  });

  it('dedupes across multiple categories of the same main', () => {
    const terms = expandMatchTerms(['Fußball', 'Tennis']);
    expect(terms.filter(t => t === 'sport')).toHaveLength(1);
  });

  it('is defensive about junk input', () => {
    expect(expandMatchTerms(null)).toEqual([]);
    expect(expandMatchTerms([])).toEqual([]);
    expect(expandMatchTerms([null, 42, '  '])).toEqual([]);
  });
});
