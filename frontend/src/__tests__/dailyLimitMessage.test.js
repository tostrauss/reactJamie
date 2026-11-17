import { describe, it, expect, afterAll } from 'vitest';
import i18n, { switchLanguage } from '../i18n';
import { serverErrorMessage } from '../utils/apiError';

// Daily free-account limits (Tina + Tobi 28.10.2026, supersedes the weekly
// rule; 2 joins and 2 creates a day since 17.11.2026): where the "Tageslimit
// erreicht" sheet cannot open (an old bundle, an unexpected caller) the person
// reads this sentence. It must be in their language, name the number the
// SERVER sent (`limit` in the 403 body — the server can be set to another
// one) and never mention a paid upgrade (App Review 3.1.1).
const joinErr = {
  response: {
    status: 403,
    data: {
      error: 'Du bist heute schon 2 Gruppen beigetreten. Ab morgen kannst du wieder einer neuen Gruppe beitreten.',
      code: 'DAILY_JOIN_LIMIT', limit: 2, resets_at: '2026-11-17T23:00:00.000Z',
    },
  },
};
const createErr = {
  response: {
    status: 403,
    data: {
      error: 'Du hast heute schon 2 Treffen erstellt. Ab morgen kannst du neue erstellen.',
      code: 'DAILY_CREATE_LIMIT', limit: 2, resets_at: '2026-11-17T23:00:00.000Z',
    },
  },
};

// The finished sentences, not the keys: what a person reads after the second
// meet-up of the day.
const CREATE_SENTENCE = {
  de: 'Du hast heute schon 2 Treffen erstellt. Ab morgen kannst du neue erstellen.',
  en: 'You’ve already created 2 meet-ups today. From tomorrow you can create new ones.',
  it: 'Oggi hai già creato 2 incontri. Da domani potrai crearne di nuovi.',
  fr: 'Tu as déjà créé 2 rencontres aujourd’hui. À partir de demain, tu pourras en créer de nouvelles.',
  es: 'Hoy ya has creado 2 encuentros. A partir de mañana podrás crear nuevos.',
};

afterAll(async () => { await switchLanguage('de'); });

describe('DAILY_JOIN_LIMIT / DAILY_CREATE_LIMIT messages', () => {
  for (const lang of ['de', 'en', 'it', 'fr', 'es']) {
    it(`${lang}: translated, with the limit, no Pro pitch`, async () => {
      await switchLanguage(lang);                     // non-German bundles load lazily
      const t = i18n.getFixedT(lang);
      const joinMsg = serverErrorMessage(joinErr, t);
      expect(joinMsg).toContain('2');
      expect(joinMsg).not.toMatch(/Pro\b/);
      expect(joinMsg).not.toMatch(/[{}]/);
      if (lang !== 'de') expect(joinMsg).not.toBe(joinErr.response.data.error);
      const createMsg = serverErrorMessage(createErr, t);
      expect(createMsg).toBe(CREATE_SENTENCE[lang]);
      expect(createMsg).not.toMatch(/Pro\b/);
    });
  }

  it('the number is the server’s, not one written into the text', async () => {
    await switchLanguage('de');
    const t = i18n.getFixedT('de');
    const four = { response: { status: 403, data: { ...createErr.response.data, limit: 4 } } };
    expect(serverErrorMessage(four, t)).toBe('Du hast heute schon 4 Treffen erstellt. Ab morgen kannst du neue erstellen.');
  });
});
