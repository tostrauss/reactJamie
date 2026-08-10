/**
 * localStorage that never throws.
 *
 * In storage-denied contexts (Android WebView with third-party storage
 * blocked, private/incognito Custom Tabs, iOS lockdown), even READING
 * `window.localStorage` throws a SecurityError — which took down /login for
 * affected users because AuthContext's setItem after a successful login was
 * unguarded (Sentry JAMIE-REACT-J, escalating, 2026-07).
 *
 * Semantics: get returns null, set/remove are no-ops when storage is denied.
 * The app must always work WITHOUT persistence — the session cookie, not
 * localStorage, is the source of truth for auth (see AuthContext).
 */
export const safeStorage = {
  getItem(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* denied — session-only */ }
  },
  removeItem(key) {
    try { window.localStorage.removeItem(key); } catch { /* denied */ }
  },
};

// Same contract for sessionStorage — the SAME contexts deny it, and unguarded
// sessionStorage reads crashed lazy routes/Register/OAuth for those users
// (audit 2026-08-10). Every sessionStorage access must go through this.
export const safeSession = {
  getItem(key) {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch { /* denied */ }
  },
  removeItem(key) {
    try { window.sessionStorage.removeItem(key); } catch { /* denied */ }
  },
};

export default safeStorage;
