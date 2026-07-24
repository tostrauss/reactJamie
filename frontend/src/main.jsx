import React from 'react';
import ReactDOM from 'react-dom/client';
import i18n, { whenActiveLanguageReady } from './i18n'; // init i18next before React mounts
import App from './App.jsx';
import { initSentry } from './utils/sentry';

function mount() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Load Sentry AFTER first paint so the ~90 KB SDK never blocks cold start.
  // See utils/sentry.js for the trade-off. requestIdleCallback runs it once the
  // main thread is free; the timeout guarantees it still loads on a busy thread,
  // and setTimeout is the fallback for browsers without requestIdleCallback.
  if (typeof window !== 'undefined') {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => initSentry(), { timeout: 4000 });
    } else {
      window.setTimeout(() => initSentry(), 2000);
    }
  }
}

// German (the default/majority market) is bundled and ready synchronously, so
// it mounts immediately. A returning en/it user has their locale code-split
// out of the main bundle — wait the one chunk before first render so the UI
// never flashes German first. The catch guarantees we still mount even if the
// locale chunk fails (i18n then falls back to German).
if (baseLang(i18n.resolvedLanguage || i18n.language) === 'de') {
  mount();
} else {
  whenActiveLanguageReady.then(mount).catch(mount);
}

function baseLang(lng) {
  return (lng || 'de').split('-')[0];
}
