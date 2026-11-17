import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DAILY_GROUP_JOINS, DEFAULT_DAILY_GROUP_CREATES,
  freeDailyGroupJoins, freeDailyGroupCreates, countsTowardJoinLimit,
  dailyJoinLimitBody, dailyCreateLimitBody,
} from '../../src/utils/dailyLimits.js';

// The two numbers of the daily free-account limits (Tobi, 17.11.2026: 2 joins
// and 2 created groups per Vienna day — 3 and 1 before). The counting itself
// (Vienna day window, rejected requests, soft-deleted creations) is pinned
// against real Postgres in the smoke suite; this pins the defaults, the env
// switches and the sentences an old app bundle shows verbatim.
describe('daily free-account limits: the defaults', () => {
  it('2 joins and 2 creates a day', () => {
    expect(DEFAULT_DAILY_GROUP_JOINS).toBe(2);
    expect(DEFAULT_DAILY_GROUP_CREATES).toBe(2);
    expect(freeDailyGroupJoins({})).toBe(2);
    expect(freeDailyGroupCreates({})).toBe(2);
  });

  it('an empty variable means the default, a number wins, 0 switches the limit off', () => {
    expect(freeDailyGroupJoins({ FREE_DAILY_GROUP_JOINS: '' })).toBe(2);
    expect(freeDailyGroupCreates({ FREE_DAILY_GROUP_CREATES: '' })).toBe(2);
    expect(freeDailyGroupJoins({ FREE_DAILY_GROUP_JOINS: '5' })).toBe(5);
    expect(freeDailyGroupCreates({ FREE_DAILY_GROUP_CREATES: '4' })).toBe(4);
    expect(freeDailyGroupJoins({ FREE_DAILY_GROUP_JOINS: '0' })).toBe(0);
    expect(freeDailyGroupCreates({ FREE_DAILY_GROUP_CREATES: '0' })).toBe(0);
  });

  it('nonsense in the variable never lifts or tightens the limit: the default again', () => {
    for (const raw of ['abc', '-1', 'NaN']) {
      expect(freeDailyGroupJoins({ FREE_DAILY_GROUP_JOINS: raw })).toBe(2);
      expect(freeDailyGroupCreates({ FREE_DAILY_GROUP_CREATES: raw })).toBe(2);
    }
  });

  it('groups and club events count, clubs and communities never', () => {
    expect(countsTowardJoinLimit({ type: 'group' })).toBe(true);
    expect(countsTowardJoinLimit({ type: 'event' })).toBe(true);
    expect(countsTowardJoinLimit({ type: 'club' })).toBe(false);
    expect(countsTowardJoinLimit(null)).toBe(false);
  });
});

describe('daily free-account limits: the 403 bodies', () => {
  const resets = '2026-11-17T23:00:00.000Z';

  it('join: the sentence names the two, a code for the sheet, no word about Pro', () => {
    const body = dailyJoinLimitBody(freeDailyGroupJoins({}), resets);
    expect(body).toEqual({
      error: 'Du bist heute schon 2 Gruppen beigetreten. Ab morgen kannst du wieder einer neuen Gruppe beitreten.',
      code: 'DAILY_JOIN_LIMIT',
      limit: 2,
      resets_at: resets,
    });
    expect(body.error).not.toMatch(/Pro/);
  });

  it('create: with two a day the sentence is the plural one', () => {
    const body = dailyCreateLimitBody(freeDailyGroupCreates({}), resets);
    expect(body).toEqual({
      error: 'Du hast heute schon 2 Treffen erstellt. Ab morgen kannst du neue erstellen.',
      code: 'DAILY_CREATE_LIMIT',
      limit: 2,
      resets_at: resets,
    });
    expect(body.error).not.toMatch(/Pro/);
  });

  it('create: a server set back to one a day keeps its own sentence; no reset time is null, not a crash', () => {
    const body = dailyCreateLimitBody(1, null);
    expect(body.error).toBe('Du hast heute schon ein Treffen erstellt. Ab morgen kannst du ein neues erstellen.');
    expect(body.limit).toBe(1);
    expect(body.resets_at).toBeNull();
  });
});
