// ==========================================
// Where a freshly authenticated user lands
// ==========================================
// ONE answer shared by every place that moves a user right after sign-in:
// AuthRoute's redirect (App.jsx), Register's own navigate and GoogleCallback.
//
// Why it has to be one answer (the 10.10.2026 sign-up race): react-router v7
// wraps every navigation in startTransition, while the setUser that a
// successful register()/googleLogin fires renders at default priority. That
// render reached AuthRoute while the router still said /register, AuthRoute
// redirected to /home, and Register's navigate('/onboarding') of the same tick
// lost — a brand-new account skipped onboarding (and the avatar nudge armed
// itself on /home). Timing tricks can't fix that ordering; agreeing on the
// target can: whichever navigation wins, it goes to the same place.
//
// newUserAware: only the sign-UP entry points (/register, the Google redirect
// landing) send an unfinished account into onboarding. /login keeps /home —
// a returning user with an unfinished profile gets Home's banner instead of
// being forced into the wizard.
//
// `=== false`, not falsy: a guest, a user object from an old cached session
// or an older server without the field must keep the old /home behaviour.
export function postAuthPath(user, { newUserAware = false } = {}) {
  return newUserAware && user?.onboarding_completed === false ? '/onboarding' : '/home';
}

export default postAuthPath;
