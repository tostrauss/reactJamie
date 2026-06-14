import { describe, it, expect } from 'vitest';
import { findBlockedTerm, checkTextSafety } from '../../src/config/moderation.js';

describe('findBlockedTerm — deterministic word blocklist', () => {
  it('blocks a bare inappropriate group name', () => {
    expect(findBlockedTerm('Sex')).toBeTruthy();
    expect(findBlockedTerm('Sex Party Wien')).toBeTruthy();
  });

  it('is case-insensitive', () => {
    expect(findBlockedTerm('FICKEN')).toBeTruthy();
    expect(findBlockedTerm('Porno')).toBeTruthy();
  });

  it('sees through leetspeak obfuscation', () => {
    expect(findBlockedTerm('S3x')).toBeTruthy();
    expect(findBlockedTerm('p0rno')).toBeTruthy();
  });

  it('blocks slurs / hate terms', () => {
    expect(findBlockedTerm('Nazi Treffen')).toBeTruthy();
    expect(findBlockedTerm('Heil Hitler')).toBeTruthy();
    expect(findBlockedTerm('Schwuchtel')).toBeTruthy();
  });

  it('blocks sexual compounds and strong profanity', () => {
    expect(findBlockedTerm('Sextreffen Wien')).toBeTruthy();
    expect(findBlockedTerm('Hurensohn')).toBeTruthy();
    expect(findBlockedTerm('Arschloch')).toBeTruthy();
    expect(findBlockedTerm('Fuck this')).toBeTruthy();
    expect(findBlockedTerm('Onlyfans Promo')).toBeTruthy();
  });

  it('does NOT flag legitimate words that merely contain a blocked substring', () => {
    // whole-word matching guards these real words
    expect(findBlockedTerm('Sexten')).toBeNull();        // town in South Tyrol
    expect(findBlockedTerm('Sussex')).toBeNull();
    expect(findBlockedTerm('Sexualität')).toBeNull();    // school subject
    expect(findBlockedTerm('unisex')).toBeNull();
    expect(findBlockedTerm('Analyse')).toBeNull();       // contains "anal"
    expect(findBlockedTerm('Kanal')).toBeNull();
    expect(findBlockedTerm('Nudeln')).toBeNull();        // contains "nude(s)"
    expect(findBlockedTerm('Cocktailabend')).toBeNull(); // contains "cock"
    expect(findBlockedTerm('Spastik-Selbsthilfe')).toBeNull(); // contains "spast"
  });

  it('passes ordinary group/club names through', () => {
    expect(findBlockedTerm('Volleyball im Schönbornpark')).toBeNull();
    expect(findBlockedTerm('Foodie Crew Vienna')).toBeNull();
    expect(findBlockedTerm('Kochkurs für Anfänger')).toBeNull();
  });

  it('handles empty / nullish input', () => {
    expect(findBlockedTerm('')).toBeNull();
    expect(findBlockedTerm(null)).toBeNull();
    expect(findBlockedTerm(undefined)).toBeNull();
  });
});

describe('checkTextSafety — blocklist integration', () => {
  it('rejects blocked text with a German reason, even without an API key', async () => {
    const res = await checkTextSafety('Sex');
    expect(res.safe).toBe(false);
    expect(typeof res.reason).toBe('string');
    expect(res.reason.length).toBeGreaterThan(0);
  });

  it('allows clean text', async () => {
    const res = await checkTextSafety('Wandergruppe Wien');
    expect(res.safe).toBe(true);
    expect(res.reason).toBeNull();
  });
});
