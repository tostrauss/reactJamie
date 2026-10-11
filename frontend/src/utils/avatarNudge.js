// ==========================================
// Soft avatar nudge — may it show right now?
// ==========================================
// The „Magst du ein Profilbild ergänzen?" sheet (App.jsx, AvatarGateModal
// soft) is for members who FINISHED onboarding and still have no picture —
// joining needs one (server 403 requiresAvatar).
//
// Pure on purpose: App.jsx asks it twice, when arming the 1.8 s timer AND at
// render time with the router's current pathname. The arm-time check alone
// was the bug Tina saw as „Profilbild-Schritt vom Anfang weg" (10.10.2026):
// the timer armed while AuthRoute had briefly moved a new account to /home,
// no route change cancels it, and the sheet popped up over onboarding step 1.
//
// Never on the sign-up / auth screens: Register, the onboarding wizard (its
// last step IS the photo step) and its clubs page, Login, the /welcome
// redirect and the OAuth landing pages (/auth/...).
const QUIET_ROUTE = /^\/(onboarding|register|login|welcome|auth\/)/;

export const AVATAR_NUDGE_KEY = 'jamie_avatar_nudge_next';
// Shared by the sheet's „Später" and onboarding's „Überspringen".
export const AVATAR_NUDGE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export const isNudgeQuietRoute = (pathname) => QUIET_ROUTE.test(String(pathname || ''));

/**
 * @param user         AuthContext user (null when logged out)
 * @param pathname     current route
 * @param now          ms timestamp (injected for tests)
 * @param snoozeUntil  stored jamie_avatar_nudge_next — a ms timestamp as
 *                     number or string; missing/garbage = not snoozed
 */
export function shouldNudge({ user, pathname, now = Date.now(), snoozeUntil } = {}) {
  if (!user || user.isGuest) return false;
  if (user.avatar_url) return false;
  // Unfinished profiles get Home's „Profil noch nicht vollständig" banner and
  // the wizard; the nudge would only talk over it. `!== true`, not `=== false`:
  // when in doubt, stay quiet.
  if (user.onboarding_completed !== true) return false;
  if (isNudgeQuietRoute(pathname)) return false;
  const until = parseInt(snoozeUntil, 10);
  if (Number.isFinite(until) && until > 0 && now < until) return false;
  return true;
}

export default shouldNudge;
