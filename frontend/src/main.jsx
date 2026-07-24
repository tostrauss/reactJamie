import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n'; // Initialize i18next before React mounts so t() works on first render
import App from './App.jsx';
import { initSentry } from './utils/sentry';

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
