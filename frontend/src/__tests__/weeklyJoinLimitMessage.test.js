import { describe, it, expect, afterAll } from 'vitest';
import i18n, { switchLanguage } from '../i18n';
import { serverErrorMessage } from '../utils/apiError';

// Weekly group-join limit (Tina 12.10.2026): where the Pro sheet cannot open
// (iOS without in-app purchase) the person reads this sentence. It must be in
// their language, carry the date, and never mention a paid upgrade.
const err = {
  response: {
    status: 403,
    data: {
      error: 'Du bist diese Woche schon 3 Gruppen beigetreten. Ab 16.10. kannst du wieder einer neuen Gruppe beitreten.',
      code: 'WEEKLY_JOIN_LIMIT', limit: 3, resets_at: '2026-10-16T08:00:00.000Z', resets_on: '16.10.',
    },
  },
};

afterAll(async () => { await switchLanguage('de'); });

describe('WEEKLY_JOIN_LIMIT message', () => {
  for (const lang of ['de', 'en', 'it', 'fr', 'es']) {
    it(`${lang}: translated, with limit and date, no Pro pitch`, async () => {
      await switchLanguage(lang);                     // non-German bundles load lazily
      const msg = serverErrorMessage(err, i18n.getFixedT(lang));
      expect(msg).toContain('3');
      expect(msg).toContain('16.10.');
      expect(msg).not.toMatch(/Pro\b/);
      if (lang !== 'de') expect(msg).not.toBe(err.response.data.error);
    });
  }
});
