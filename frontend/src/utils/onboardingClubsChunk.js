// The clubs page after the onboarding save is a lazy route (App.jsx), and the
// wizard's photo step warms its chunk ahead of time (pages/Onboarding.jsx).
// One loader for both, so they always name the same module — the preload only
// helps if the route's import() then resolves from the very same chunk.
export const loadOnboardingClubs = () => import('../pages/OnboardingClubs');
