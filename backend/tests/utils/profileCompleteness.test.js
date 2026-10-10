import { describe, it, expect, vi } from 'vitest';
import {
  profileMissing, isProfileComplete, incompleteMessage, healOnboardingFlag, PROFILE_COMPLETE_SQL, MIN_INTERESTS,
} from '../../src/utils/profileCompleteness.js';

// One rule for "profile complete" (10.10.2026): an 18+ birth date, a gender and
// at least three interests — what the onboarding wizard asks for, now counted
// wherever the data came from (the profile editor never set the flag before).
const adult = '1995-04-01';
const complete = { id: 7, date_of_birth: adult, gender: 'female', interests: ['Musik', 'Kunst', 'Yoga'] };

describe('profileMissing / isProfileComplete', () => {
  it('a complete profile misses nothing', () => {
    expect(profileMissing(complete)).toEqual([]);
    expect(isProfileComplete(complete)).toBe(true);
  });

  it('names each missing part', () => {
    expect(profileMissing({ ...complete, date_of_birth: null })).toEqual(['date_of_birth']);
    expect(profileMissing({ ...complete, gender: null })).toEqual(['gender']);
    expect(profileMissing({ ...complete, gender: 'unknown' })).toEqual(['gender']);
    expect(profileMissing({ ...complete, interests: ['Musik', 'Kunst'] })).toEqual(['interests']);
    expect(profileMissing(null)).toEqual(['date_of_birth', 'gender', 'interests']);
  });

  it('an under-18 birth date does not count', () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 16);
    expect(profileMissing({ ...complete, date_of_birth: d.toISOString().slice(0, 10) })).toEqual(['date_of_birth']);
  });

  it('blank interests do not count; a JSON string (raw column) is read too', () => {
    expect(profileMissing({ ...complete, interests: ['Musik', ' ', '', null] })).toEqual(['interests']);
    expect(profileMissing({ ...complete, interests: '["Musik","Kunst","Yoga"]' })).toEqual([]);
    expect(profileMissing({ ...complete, interests: 'kaputt' })).toEqual(['interests']);
    expect(MIN_INTERESTS).toBe(3);
  });

  it('every accepted gender value counts', () => {
    for (const g of ['male', 'female', 'diverse', 'prefer_not_to_say']) {
      expect(isProfileComplete({ ...complete, gender: g })).toBe(true);
    }
  });
});

describe('incompleteMessage', () => {
  it('keeps the old first sentence and says what is missing and where', () => {
    const msg = incompleteMessage(['gender', 'interests']);
    expect(msg.startsWith('Bitte vervollständige dein Profil, bevor du Gruppen beitrittst.')).toBe(true);
    expect(msg).toContain('dein Geschlecht');
    expect(msg).toContain('mindestens 3 Interessen');
    expect(msg).toContain('Profil → Bearbeiten');
  });
  it('without details it is the old message', () => {
    expect(incompleteMessage([])).toBe('Bitte vervollständige dein Profil, bevor du Gruppen beitrittst.');
  });
});

describe('healOnboardingFlag', () => {
  it('sets the flag for a complete profile and reports it in the user object', async () => {
    const db = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })) };
    const user = { ...complete, onboarding_completed: false };
    expect(await healOnboardingFlag(db, user)).toBe(true);
    expect(user.onboarding_completed).toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/SET onboarding_completed = TRUE/), [7]);
  });

  it('does nothing for an incomplete profile or a flag that is already set', async () => {
    const db = { query: vi.fn() };
    expect(await healOnboardingFlag(db, { ...complete, gender: null, onboarding_completed: false })).toBe(false);
    expect(await healOnboardingFlag(db, { ...complete, onboarding_completed: true })).toBe(false);
    expect(await healOnboardingFlag(db, null)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('never throws — a failed update just leaves the flag as it was', async () => {
    const db = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const user = { ...complete, onboarding_completed: false };
    expect(await healOnboardingFlag(db, user)).toBe(false);
    expect(user.onboarding_completed).toBe(false);
  });
});

describe('PROFILE_COMPLETE_SQL (the one-time backfill)', () => {
  it('encodes the same rule: 18+, the gender set and at least 3 non-blank interests', () => {
    expect(PROFILE_COMPLETE_SQL).toMatch(/INTERVAL '18 years'/);
    expect(PROFILE_COMPLETE_SQL).toMatch(/'male', 'female', 'diverse', 'prefer_not_to_say'/);
    expect(PROFILE_COMPLETE_SQL).toMatch(/btrim\(t\.v\) <> ''/);
    expect(PROFILE_COMPLETE_SQL).toMatch(/>= 3/);
  });
});
