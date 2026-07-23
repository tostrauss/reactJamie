import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import de from './locales/de.json';
import en from './locales/en.json';
import it from './locales/it.json';

// i18n setup — German is the source-of-truth language; English and Italian
// inherit missing keys via fallback so untranslated areas still render
// readable German instead of bare keys until the next translation pass.
// Italian added 2026-07-23 for the Italy market rollout.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
      it: { translation: it },
    },
    fallbackLng: 'de',
    supportedLngs: ['de', 'en', 'it'],
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // Persist explicit user choice; fall back to browser locale on first run.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'jamie_lang',
      caches: ['localStorage'],
    },
  });

// Keep <html lang="…"> in sync so screen readers + Chrome's translate prompt
// behave correctly.
const syncHtmlLang = (lng) => {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = (lng || 'de').split('-')[0];
  }
};
syncHtmlLang(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
