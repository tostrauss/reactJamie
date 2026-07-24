import { describe, it, expect, afterAll } from 'vitest';
import i18n, { switchLanguage } from '../i18n';

// Exercises the lazy-locale path added when en/it were code-split out of the
// eager bundle. The global vitest.setup.js forces German, so without this the
// en/it dynamic-import + switchLanguage flow would ship untested.
describe('i18n lazy locale loading', () => {
  afterAll(async () => {
    await switchLanguage('de'); // restore default for any later suites
  });

  it('resolves German synchronously (bundled, the default/majority locale)', () => {
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
    expect(i18n.t('events.forYou')).toBe('Events für dich');
  });

  it('switchLanguage("en") dynamically loads English and renders English strings', async () => {
    await switchLanguage('en');
    expect(i18n.language).toBe('en');
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.t('events.forYou')).toBe('Events for you');
  });

  it('switchLanguage("it") dynamically loads Italian', async () => {
    await switchLanguage('it');
    expect(i18n.language).toBe('it');
    expect(i18n.hasResourceBundle('it', 'translation')).toBe(true);
  });

  it('missing keys fall back to German instead of showing raw keys', async () => {
    await switchLanguage('en');
    // A key that exists in de but might be untranslated in en still returns a
    // human string via fallbackLng, never the bare dotted key.
    const val = i18n.t('common.save');
    expect(val).not.toBe('common.save');
    expect(val.length).toBeGreaterThan(0);
  });
});
