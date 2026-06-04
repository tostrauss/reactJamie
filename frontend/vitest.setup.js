import '@testing-library/jest-dom';
// Initialize i18n so components using useTranslation() render their German
// source strings (rather than raw keys) inside tests. We force German because
// the jsdom navigator otherwise defaults to en-US, which would silently swap
// the strings that the existing assertions match against.
import i18n from './src/i18n';
i18n.changeLanguage('de');
