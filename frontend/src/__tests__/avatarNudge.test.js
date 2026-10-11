import { describe, it, expect } from 'vitest';
import { shouldNudge, isNudgeQuietRoute, AVATAR_NUDGE_KEY, AVATAR_NUDGE_SNOOZE_MS } from '../utils/avatarNudge';

// The soft „Magst du ein Profilbild ergänzen?" sheet. App.jsx asks this rule
// when arming its timer AND at render time; the arm-time check alone let the
// sheet open over onboarding step 1 (Tina, 10.10.2026: „Profilbild-Schritt
// vom Anfang weg").
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const member = { id: 7, name: 'Tina', avatar_url: null, onboarding_completed: true };
const ask = (over = {}) => shouldNudge({ user: member, pathname: '/home', now: NOW, snoozeUntil: null, ...over });

describe('shouldNudge', () => {
  it('a finished, avatar-less member on Home without a snooze is nudged', () => {
    expect(ask()).toBe(true);
    expect(ask({ pathname: '/club/12' })).toBe(true);
    expect(ask({ pathname: '/profile' })).toBe(true);
  });

  it('never for nobody, guests or members who have a picture', () => {
    expect(ask({ user: null })).toBe(false);
    expect(ask({ user: undefined })).toBe(false);
    expect(ask({ user: { id: 0, isGuest: true } })).toBe(false);
    expect(ask({ user: { ...member, avatar_url: '/media/uploads/a.webp' } })).toBe(false);
    // A Google picture counts too — the server's join gate accepts any URL.
    expect(ask({ user: { ...member, avatar_url: 'https://lh3.googleusercontent.com/a/x' } })).toBe(false);
  });

  it('never while the profile is unfinished (Home shows its banner and the wizard instead)', () => {
    expect(ask({ user: { ...member, onboarding_completed: false } })).toBe(false);
    expect(ask({ user: { ...member, onboarding_completed: undefined } })).toBe(false);
    expect(ask({ user: { ...member, onboarding_completed: null } })).toBe(false);
  });

  it('never on the sign-up, onboarding and auth routes', () => {
    for (const pathname of [
      '/onboarding', '/onboarding/clubs', '/register', '/login', '/welcome', '/auth/google/callback',
    ]) {
      expect(ask({ pathname })).toBe(false);
      expect(isNudgeQuietRoute(pathname)).toBe(true);
    }
    for (const pathname of ['/home', '/', '/profile/edit', '/chats', '/club/3', '']) {
      expect(isNudgeQuietRoute(pathname)).toBe(false);
    }
  });

  it('respects the 7-day snooze, stored as a string or a number', () => {
    expect(ask({ snoozeUntil: String(NOW + 1000) })).toBe(false);
    expect(ask({ snoozeUntil: NOW + AVATAR_NUDGE_SNOOZE_MS })).toBe(false);
    expect(ask({ snoozeUntil: String(NOW - 1) })).toBe(true);   // expired
    expect(ask({ snoozeUntil: String(NOW) })).toBe(true);       // ends exactly now
  });

  it('a missing or garbage snooze value means not snoozed', () => {
    expect(ask({ snoozeUntil: undefined })).toBe(true);
    expect(ask({ snoozeUntil: '' })).toBe(true);
    expect(ask({ snoozeUntil: 'abc' })).toBe(true);
    expect(ask({ snoozeUntil: '0' })).toBe(true);
  });

  it('keeps the storage key and the 7-day window the app already uses', () => {
    expect(AVATAR_NUDGE_KEY).toBe('jamie_avatar_nudge_next');
    expect(AVATAR_NUDGE_SNOOZE_MS).toBe(7 * 864e5);
  });

  it('called without arguments it just says no', () => {
    expect(shouldNudge()).toBe(false);
  });
});
