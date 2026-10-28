import { describe, it, expect, afterAll } from 'vitest';
import i18n, { switchLanguage } from '../i18n';
import { serverErrorMessage } from '../utils/apiError';

// Daily free-account limits (Tina + Tobi 28.10.2026, supersedes the weekly
// rule): where the "Tageslimit erreicht" sheet cannot open (an old bundle, an
// unexpected caller) the person reads this sentence. It must be in their
// language and never mention a paid upgrade (App Review 3.1.1).
const joinErr = {
  response: {
    status: 403,
    data: {
      error: 'Du bist heute schon 3 Gruppen beigetreten. Ab morgen kannst du wieder einer neuen Gruppe beitreten.',
      code: 'DAILY_JOIN_LIMIT', limit: 3, resets_at: '2026-10-29T23:00:00.000Z',
    },
  },
};
const createErr = {
  response: {
    status: 403,
    data: {
      error: 'Du hast heute schon ein Treffen erstellt. Ab morgen kannst du ein neues erstellen.',
      code: 'DAILY_CREATE_LIMIT', limit: 1, resets_at: '2026-10-29T23:00:00.000Z',
    },
  },
};

afterAll(async () => { await switchLanguage('de'); });

describe('DAILY_JOIN_LIMIT / DAILY_CREATE_LIMIT messages', () => {
  for (const lang of ['de', 'en', 'it', 'fr', 'es']) {
    it(`${lang}: translated, with the limit, no Pro pitch`, async () => {
      await switchLanguage(lang);                     // non-German bundles load lazily
      const t = i18n.getFixedT(lang);
      const joinMsg = serverErrorMessage(joinErr, t);
      expect(joinMsg).toContain('3');
      expect(joinMsg).not.toMatch(/Pro\b/);
      if (lang !== 'de') expect(joinMsg).not.toBe(joinErr.response.data.error);
      const createMsg = serverErrorMessage(createErr, t);
      expect(createMsg.length).toBeGreaterThan(10);
      expect(createMsg).not.toMatch(/Pro\b/);
      if (lang !== 'de') expect(createMsg).not.toBe(createErr.response.data.error);
    });
  }
});
