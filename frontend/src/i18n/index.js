import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import de from './locales/de.json';

// German is the source-of-truth language, the default, and the majority
// (AT/DE) market — so it's bundled eagerly. English and Italian (~135 KB of
// raw JSON combined) are code-split and pulled in on demand: for a returning
// en/it user before first render, or when someone switches language in
// Settings. This keeps that JSON out of the cold-start bundle for the German
// majority. Missing keys fall back to German so anything untranslated — or a
// locale chunk that fails to load — still renders readable German.
// Italian added 2026-07-23 for the Italy market rollout.
const lazyLocales = {
  en: () => import('./locales/en.json'),
  it: () => import('./locales/it.json'),
};

const baseLang = (lng) => (lng || 'de').split('-')[0];

// Keep <html lang="…"> in sync so screen readers + Chrome's translate prompt
// behave correctly.
const syncHtmlLang = (lng) => {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = baseLang(lng);
  }
};

// Load a non-German locale bundle once, on demand. De-duped so concurrent
// callers (initial detection + an in-app switch) share a single fetch, and a
// failed load resolves quietly to the German fallback rather than throwing.
const inflight = {};
function ensureBundle(lng) {
  const base = baseLang(lng);
  if (base === 'de' || !lazyLocales[base]) return Promise.resolve();
  if (i18n.hasResourceBundle(base, 'translation')) return Promise.resolve();
  if (!inflight[base]) {
    inflight[base] = lazyLocales[base]()
      .then((mod) => {
        i18n.addResourceBundle(base, 'translation', mod.default, true, true);
      })
      .catch((err) => {
        console.warn(`Locale "${base}" failed to load — using German fallback`, err);
        delete inflight[base]; // allow a later retry (e.g. next switch)
      });
  }
  return inflight[base];
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
    },
    partialBundledLanguages: true, // en/it are added at runtime via ensureBundle
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

syncHtmlLang(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', syncHtmlLang);

// Switch language the flash-free way: load the target locale FIRST, then apply
// it, so react-i18next re-renders straight into real strings instead of
// briefly showing German fallback. Use this everywhere instead of calling
// i18n.changeLanguage directly.
export const switchLanguage = async (lng) => {
  await ensureBundle(lng);
  await i18n.changeLanguage(lng);
};

// Resolves once the initially-detected language is ready to render without a
// flash. German (default/majority) resolves immediately, so main.jsx mounts
// right away; for en/it it awaits the one locale chunk before the first render.
export const whenActiveLanguageReady = ensureBundle(i18n.resolvedLanguage || i18n.language);

export default i18n;
