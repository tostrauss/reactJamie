/**
 * Cross-platform "share a link" helper.
 *
 * Web:    navigator.share opens the OS share sheet → clipboard fallback.
 * Native: navigator.share is UNDEFINED inside the Capacitor WKWebView (iOS)
 *         and the Android WebView, so the old code silently fell through to
 *         "Link kopiert" — exactly the bug report (Profil/Gruppe teilen tut
 *         nichts, Club teilen zeigt nur "Link wurde kopiert"). Use the
 *         @capacitor/share plugin to open the real iOS/Android share sheet.
 *
 * Returns one of:
 *   'shared'    — handed off to the share sheet / native picker
 *   'cancelled' — user dismissed the share sheet (no toast)
 *   'copied'    — no share sheet available, link copied to clipboard
 *   'failed'    — nothing worked
 * so the caller decides whether to show a "Link kopiert" toast.
 */
import { isNative } from './platform.js';

const isAbort = (err) =>
  err?.name === 'AbortError' || /cancel/i.test(err?.message || '');

// Canonical public web origin for shared links. Inside the native app the
// WebView origin is capacitor://app.jamie-app.com (iOS custom scheme), so
// callers passing window.location.href produced "capacitor://…" links that
// recipients can't open (Tina 2026-07-31). Normalize EVERY shared URL to the
// public https origin — for web-PWA callers this is a no-op.
const PUBLIC_WEB_ORIGIN = 'https://app.jamie-app.com';
const toPublicUrl = (url) => {
  try {
    const u = new URL(url, PUBLIC_WEB_ORIGIN);
    return `${PUBLIC_WEB_ORIGIN}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url; // unparseable — share as-is
  }
};

export async function shareLink({ title, text, url }) {
  if (!url) return 'failed';
  url = toPublicUrl(url);

  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      // plugin missing / failed → fall through to clipboard
    }
  } else if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
