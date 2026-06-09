import { isNative } from './platform';
import { spotify } from './api';

// Capacitor deep-link the native apps listen for. Must be registered as a
// Redirect URI in the Spotify dashboard AND as a custom URL scheme in the
// native projects (see NATIVE SETUP at the bottom of this file).
export const NATIVE_REDIRECT = 'jamie://spotify-callback';

// Access Capacitor plugins via the runtime registry instead of importing the
// npm packages. This keeps the web/Vite bundle free of any build-time
// dependency on @capacitor/browser or @capacitor/app — they only need to
// exist in the NATIVE projects (added via npm + `npx cap sync`).
function caps() {
  return (typeof window !== 'undefined' && window.Capacitor?.Plugins) || null;
}

// Parse `code` / `state` / `error` from a deep-link URL like
// "jamie://spotify-callback?code=…&state=…". Built by hand because custom
// URL schemes don't always parse cleanly via `new URL()` on every engine.
function parseCallbackParams(url) {
  const out = {};
  const qi = url.indexOf('?');
  if (qi === -1) return out;
  for (const pair of url.slice(qi + 1).split('&')) {
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Start the Spotify connect flow.
 *
 * Web / PWA: classic full-page redirect to Spotify → returns to
 *   FRONTEND_URL/spotify/callback (handled by SpotifyCallback.jsx). The page
 *   unloads, so onSuccess/onError never fire here — that's expected.
 *
 * Native (Capacitor): opens the auth URL in the in-app browser and listens for
 *   the jamie://spotify-callback deep link. On return we close the browser and
 *   exchange the code. onSuccess / onError / onCancel drive the caller's UI.
 */
export async function connectSpotify({ onSuccess, onError, onCancel } = {}) {
  const plugins = caps();

  // Fall back to the web redirect when not native, or when the native plugins
  // aren't present (e.g. an old build that hasn't run `cap sync` yet).
  if (!isNative() || !plugins?.Browser || !plugins?.App) {
    const res = await spotify.getAuthUrl();
    window.location.href = res.data.url;
    return;
  }

  const { Browser, App } = plugins;
  const res = await spotify.getAuthUrl({ native: true });
  const authUrl = res.data.url;

  let settled = false;
  let appHandle = null;
  let browserHandle = null;
  const cleanup = () => {
    try { appHandle?.remove?.(); } catch { /* ignore */ }
    try { browserHandle?.remove?.(); } catch { /* ignore */ }
  };

  appHandle = await App.addListener('appUrlOpen', async (event) => {
    const url = event?.url || '';
    if (settled || !url.startsWith(NATIVE_REDIRECT)) return;
    settled = true;            // claim BEFORE closing so browserFinished no-ops
    cleanup();
    try { await Browser.close(); } catch { /* already closed */ }

    const { code, state, error } = parseCallbackParams(url);
    if (error) { onError?.(new Error(error)); return; }
    if (!code)  { onError?.(new Error('no_code')); return; }
    try {
      const r = await spotify.handleCallback(code, state, { native: true });
      onSuccess?.(r.data);
    } catch (e) {
      onError?.(e);
    }
  });

  // Fires when the user swipes the in-app browser away without authorizing.
  // The success path sets `settled` first, so this only runs on a real cancel.
  browserHandle = await Browser.addListener('browserFinished', () => {
    if (settled) return;
    settled = true;
    cleanup();
    onCancel?.();
  });

  await Browser.open({ url: authUrl });
}

/*
 * ── NATIVE SETUP (one-time, per platform) ──────────────────────────────────
 * 1. Install the plugins, then sync:
 *      npm i @capacitor/browser @capacitor/app && npx cap sync
 * 2. Spotify Dashboard → app → Edit Settings → Redirect URIs:
 *      add  jamie://spotify-callback   (and keep the web one for PWA)
 * 3. iOS — ios/App/App/Info.plist, add a URL scheme:
 *      <key>CFBundleURLTypes</key><array><dict>
 *        <key>CFBundleURLSchemes</key><array><string>jamie</string></array>
 *      </dict></array>
 * 4. Android — android/app/src/main/AndroidManifest.xml, inside the main
 *    <activity> add an intent-filter:
 *      <intent-filter>
 *        <action android:name="android.intent.action.VIEW"/>
 *        <category android:name="android.intent.category.DEFAULT"/>
 *        <category android:name="android.intent.category.BROWSABLE"/>
 *        <data android:scheme="jamie" android:host="spotify-callback"/>
 *      </intent-filter>
 * 5. Backend env (optional override): SPOTIFY_NATIVE_REDIRECT_URI=jamie://spotify-callback
 */
