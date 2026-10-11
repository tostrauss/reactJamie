import { describe, it, expect } from 'vitest';
import { postAuthPath } from '../utils/authRedirect';

// The landing target shared by AuthRoute, Register and GoogleCallback. The
// 10.10.2026 race (AuthRoute's /home beat Register's /onboarding) is gone
// only because they all agree — these pin what they agree on.
describe('postAuthPath', () => {
  const fresh = { id: 7, onboarding_completed: false };
  const done = { id: 7, onboarding_completed: true };

  it('sign-up entry points send an unfinished account into onboarding', () => {
    expect(postAuthPath(fresh, { newUserAware: true })).toBe('/onboarding');
  });

  it('a finished account lands on Home, sign-up entry point or not', () => {
    expect(postAuthPath(done, { newUserAware: true })).toBe('/home');
    expect(postAuthPath(done)).toBe('/home');
  });

  it('/login (not newUserAware) keeps /home even for an unfinished profile', () => {
    expect(postAuthPath(fresh)).toBe('/home');
    expect(postAuthPath(fresh, {})).toBe('/home');
    expect(postAuthPath(fresh, { newUserAware: false })).toBe('/home');
  });

  it('only an explicit false counts: guests, old cached users and older servers keep /home', () => {
    expect(postAuthPath({ id: 0, isGuest: true }, { newUserAware: true })).toBe('/home');
    expect(postAuthPath({ id: 7 }, { newUserAware: true })).toBe('/home');
    expect(postAuthPath({ id: 7, onboarding_completed: null }, { newUserAware: true })).toBe('/home');
    expect(postAuthPath(null, { newUserAware: true })).toBe('/home');
    expect(postAuthPath(undefined)).toBe('/home');
  });
});
