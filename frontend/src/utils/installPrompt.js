// ==========================================
// PWA install prompt — captured once per page load, outside React
// ==========================================
// Chrome fires beforeinstallprompt ONCE per document. The install banner used
// to listen for it itself, so whenever the banner happened to be unmounted —
// AppIntro right after an e-mail sign-up returns early from AppRoutes, so does
// OutOfRegion — the event (or the one the banner had already stashed) was
// gone for the rest of the session, and „JAMIE installieren" never came: not
// during sign-up (suppressed there) and not on Home either. So the event is
// caught here, armed from main.jsx before React mounts, and handed to
// whichever banner mounts later.
//
// preventDefault (which hides Chrome's own mini-infobar) only when our banner
// will offer the install: not in standalone mode and not during the 7-day
// snooze after „✕" — then Chrome's own prompt stays, exactly as when the
// banner skipped its listener in those cases. iOS and the native apps never
// fire the event; there this module simply stays idle.
import { safeStorage } from './safeStorage';

export const INSTALL_DISMISSED_KEY = 'pwa-install-dismissed';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export const isInStandaloneMode = () => {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || window.navigator.standalone === true;
  } catch {
    return false;
  }
};

export const installDismissedRecently = (now = Date.now()) => {
  const at = parseInt(safeStorage.getItem(INSTALL_DISMISSED_KEY), 10);
  return Number.isFinite(at) && now - at < DISMISS_MS;
};

let deferred = null;
let armed = false;
const subscribers = new Set();

const onBeforeInstallPrompt = (e) => {
  if (isInStandaloneMode() || installDismissedRecently()) return;
  e.preventDefault();
  deferred = e;
  subscribers.forEach((fn) => {
    try { fn(e); } catch { /* one broken subscriber must not starve the rest */ }
  });
};
// Installed from Chrome's own menu meanwhile — the stashed event is spent.
const onAppInstalled = () => { deferred = null; };

/** Start listening. Idempotent; main.jsx calls it before the first render. */
export function captureInstallPrompt() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
}

/** The event caught so far in this page load, or null. */
export const getInstallPrompt = () => deferred;

/** A prompt event can be used once — drop it after prompt(). */
export const clearInstallPrompt = () => { deferred = null; };

/** Called with every event caught from now on; returns the unsubscribe. */
export function onInstallPrompt(fn) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Tests only: forget the event, the subscribers and the listeners. */
export function resetInstallPromptForTests() {
  deferred = null;
  subscribers.clear();
  if (armed && typeof window !== 'undefined') {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onAppInstalled);
  }
  armed = false;
}
