/**
 * Google Sign-In — auth-code REDIRECT flow (no popup).
 *
 * Why: the previous implicit/popup flow (useGoogleLogin from @react-oauth/google)
 * opens a popup that posts the token back to the opener window. Inside the
 * Android Play-Store TWA / an installed PWA there IS no normal opener/popup
 * relationship, so picking a Google account silently dead-ended back on the
 * login screen (Tina's uncle + Karl on Samsung, 2026-07-20). A full-page
 * redirect needs no popup — it works identically in a browser tab, the TWA,
 * and any WebView that can navigate — so it's used everywhere (except native
 * iOS, which stays email-only per the existing App Review decision).
 *
 * Flow: startGoogleLogin() navigates the whole page to Google's consent
 * screen. Google redirects back to GOOGLE_CALLBACK_PATH with ?code=&state=
 * (or ?error= on cancel/denial). GoogleCallback.jsx picks that up, validates
 * state, and exchanges the code server-side (authController.googleLoginCode)
 * — auth-code exchange needs a client secret, so it can't happen client-side.
 */
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';
const STATE_KEY = 'jamie_google_oauth_state';

/** CSRF state token. crypto.getRandomValues is Chrome87+/Safari14+ — matches
 * the app's Vite build target, so no crypto.randomUUID dependency needed. */
function randomState() {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

/** Must be registered EXACTLY (including path) under the OAuth client's
 * "Authorized redirect URIs" in Google Cloud Console. Computed from the
 * current origin so the same code works on every deployed domain. */
export const googleRedirectUri = () => `${window.location.origin}${GOOGLE_CALLBACK_PATH}`;

/** Navigate the whole page to Google's consent screen. */
export function startGoogleLogin(clientId) {
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Validate the state GoogleCallback received against what startGoogleLogin
 * stored. One-shot — always clears it, so a replayed callback can't reuse it. */
export function consumeGoogleState(receivedState) {
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return !!expected && !!receivedState && expected === receivedState;
}
