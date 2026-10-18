import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  tierFor, nextStepFor, getAttendanceStats, attachAttendanceTiers, _resetAttendanceLog,
  TIER_MIN_EVENTS, TIER_MIN_CONFIRMERS, countableEventSql, reviewableEventSql, ATTENDANCE_SQL,
  eventStandsSql, reviewRoundOpenSql, joinedInTimeSql, blockedWithSql, REVIEW_WINDOW_DAYS,
  LEGACY_STEPS, legacyTierOf, legacyNextStepFor,
} from '../../src/utils/attendanceTiers.js';

// Abzeichen-Stufen (tester 06.10.2026): from 5 confirmed meetups 🏅, from 10 🏆,
// from 100 🎆 — counted from "Wer war dabei?" confirmations, never sign-ups.
// 25 🌟 and 50 💎 in between since Lea's feedback (18.10.2026).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('thresholds', () => {
  it('follow the decision (5 / 10 / 25 / 50 / 100, people 2 / 3 / 5 / 7 / 10) and strictly ascend', () => {
    expect(TIER_MIN_EVENTS).toEqual([5, 10, 25, 50, 100]);
    expect(TIER_MIN_CONFIRMERS).toEqual([2, 3, 5, 7, 10]);
    for (const arr of [TIER_MIN_EVENTS, TIER_MIN_CONFIRMERS]) {
      for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1]);
    }
  });

  it('are mirrored byte-for-byte in the frontend (own ladder + progress bar)', () => {
    const fe = fs.readFileSync(path.join(__dirname, '../../../frontend/src/utils/attendanceTiers.js'), 'utf8');
    const read = (name) => {
      const m = fe.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\];`));
      expect(m, `${name} missing in the frontend mirror`).toBeTruthy();
      return m[1].split(',').map((x) => Number(x.trim()));
    };
    expect(read('TIER_MIN_EVENTS')).toEqual(TIER_MIN_EVENTS);
    expect(read('TIER_MIN_CONFIRMERS')).toEqual(TIER_MIN_CONFIRMERS);
  });
});

describe('tierFor', () => {
  it.each([
    [0, 0, 0], [4, 9, 0], [5, 1, 0], [5, 2, 1], [9, 9, 1], [10, 2, 1],
    [10, 3, 2], [24, 24, 2], [25, 4, 2], [25, 5, 3], [49, 49, 3], [50, 6, 3],
    [50, 7, 4], [99, 99, 4], [100, 9, 4], [100, 10, 5], [500, 50, 5],
  ])('(%i meetups, %i confirmers) → %i', (events, confirmers, tier) => {
    expect(tierFor(events, confirmers)).toBe(tier);
  });
});

describe('nextStepFor (own progress card)', () => {
  it('says what is still missing', () => {
    expect(nextStepFor(0, 0)).toEqual({ tier: 1, events_missing: 5, confirmers_missing: 2 });
    expect(nextStepFor(12, 2)).toEqual({ tier: 2, events_missing: 0, confirmers_missing: 1 });
    // The new steps between 🏆 and 🎆 — the jump Lea found too big.
    expect(nextStepFor(12, 4)).toEqual({ tier: 3, events_missing: 13, confirmers_missing: 1 });
    expect(nextStepFor(30, 6)).toEqual({ tier: 4, events_missing: 20, confirmers_missing: 1 });
    expect(nextStepFor(60, 8)).toEqual({ tier: 5, events_missing: 40, confirmers_missing: 2 });
  });
  it('is null at the top', () => {
    expect(nextStepFor(100, 10)).toBeNull();
  });
});

// Old app bundles (iOS ships the web build inside the binary) know 🏅 5 /
// 🏆 10 / 🎆 100 and read every *_tier field on that scale. Pinned against a
// copy of the pre-18.10.2026 rule so an old bundle shows EXACTLY what it
// showed before — never "🎆 100+" for 25 meetups.
describe('legacy three-step scale (old app bundles)', () => {
  const OLD_EVENTS = [5, 10, 100];
  const OLD_CONFIRMERS = [2, 3, 10];
  const oldTierFor = (events, confirmers) => {
    let tier = 0;
    OLD_EVENTS.forEach((min, i) => { if (events >= min && confirmers >= OLD_CONFIRMERS[i]) tier = i + 1; });
    return tier;
  };
  const oldNextStepFor = (events, confirmers) => {
    const tier = oldTierFor(events, confirmers);
    if (tier >= OLD_EVENTS.length) return null;
    return {
      tier: tier + 1,
      events_missing: Math.max(0, OLD_EVENTS[tier] - events),
      confirmers_missing: Math.max(0, OLD_CONFIRMERS[tier] - confirmers),
    };
  };
  const grid = [];
  for (const events of [0, 4, 5, 9, 10, 24, 25, 30, 49, 50, 99, 100, 150]) {
    for (const confirmers of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 20]) grid.push([events, confirmers]);
  }

  it('the old steps are steps 1, 2 and 5 of the new ladder, with the same thresholds', () => {
    expect(LEGACY_STEPS.map((s) => TIER_MIN_EVENTS[s - 1])).toEqual(OLD_EVENTS);
    expect(LEGACY_STEPS.map((s) => TIER_MIN_CONFIRMERS[s - 1])).toEqual(OLD_CONFIRMERS);
  });

  it('legacyTierOf maps 0–5 onto 0–3: 🌟 and 💎 stay 🏆, 🎆 stays 🎆', () => {
    expect([0, 1, 2, 3, 4, 5].map(legacyTierOf)).toEqual([0, 1, 2, 2, 2, 3]);
  });

  it('level and next step match the old rule for every count', () => {
    for (const [events, confirmers] of grid) {
      expect(legacyTierOf(tierFor(events, confirmers)), `${events}/${confirmers}`).toBe(oldTierFor(events, confirmers));
      expect(legacyNextStepFor(events, confirmers), `${events}/${confirmers}`).toEqual(oldNextStepFor(events, confirmers));
    }
  });
});

describe('SQL', () => {
  it('starts with the routing marker and pins every counting rule', () => {
    expect(ATTENDANCE_SQL.startsWith('/* attendance-tiers */')).toBe(true);
    expect(ATTENDANCE_SQL).toContain('er.reviewer_id <> er.reviewed_user_id');
    expect(ATTENDANCE_SQL).toMatch(/HAVING COUNT\(\*\) FILTER \(WHERE er\.was_present\) > COUNT\(\*\) FILTER \(WHERE NOT er\.was_present\)/);
    expect(ATTENDANCE_SQL).toContain(eventStandsSql('g'));
  });

  it('judges recorded votes by when they were cast, not by the editable date', async () => {
    // Re-dating a past group or ticking „wöchentlich“ afterwards must not take
    // the meetup out of anyone's count (review finding, B2).
    expect(ATTENDANCE_SQL).not.toContain('is_recurring_weekly');
    expect(ATTENDANCE_SQL).not.toContain('g.date < CURRENT_DATE');
    expect(ATTENDANCE_SQL).toContain(`LEAST(MIN(g.date), MIN(er.created_at)) <= NOW() - INTERVAL '${REVIEW_WINDOW_DAYS} days'`);
    // deleted only after the event DAY, Vienna days on both sides
    expect(ATTENDANCE_SQL).toContain("(MIN(g.deleted_at)::timestamptz AT TIME ZONE 'Europe/Vienna')::date");
    expect(ATTENDANCE_SQL).toContain("LEAST(MIN(g.date)::date, (MIN(er.created_at)::timestamptz AT TIME ZONE 'Europe/Vienna')::date)");
  });

  it('counts only once the review round has closed — the exact complement of the write window', () => {
    expect(REVIEW_WINDOW_DAYS).toBe(14);
    const open = reviewRoundOpenSql('g');
    expect(open).toContain(`g.date > NOW() - INTERVAL '${REVIEW_WINDOW_DAYS} days'`);
    expect(open).toContain(`rr.created_at <= NOW() - INTERVAL '${REVIEW_WINDOW_DAYS} days'`);
  });

  it('reads only reviews + groups: never sign-ups, never writes, never the seal', () => {
    for (const bad of ['group_members', 'UPDATE', 'INSERT', 'is_trusted_user', 'JOIN users']) {
      expect(ATTENDANCE_SQL).not.toContain(bad);
    }
    // Substrings other controllers' unit-test mocks route on.
    for (const routed of ['JOIN users u ON gm.user_id = u.id', 'FROM groups WHERE id', 'FROM group_members WHERE group_id',
      'SELECT is_admin', 'FROM group_join_requests jr', 'LEFT JOIN group_members gm ON gm.group_id = g.id', 'FROM group_members gm']) {
      expect(ATTENDANCE_SQL).not.toContain(routed);
    }
  });

  it('the shared event fragments use the given alias and refuse anything else', () => {
    expect(countableEventSql('x')).not.toContain('g.');
    expect(countableEventSql('x')).toContain("x.type = 'group'");
    expect(countableEventSql('x')).toContain('x.did_not_take_place IS NOT TRUE');
    expect(countableEventSql('x')).toContain('x.is_active IS NOT FALSE');
    expect(countableEventSql('x')).toContain('x.is_recurring_weekly IS NOT TRUE');
    expect(reviewableEventSql('x')).toContain('x.deleted_at IS NULL');
    expect(() => countableEventSql('g; DROP TABLE users')).toThrow();
  });

  it('eventStandsSql (recorded votes) ignores the weekly flag; the write side keeps it', () => {
    expect(eventStandsSql('x')).not.toContain('is_recurring_weekly');
    expect(countableEventSql('x')).toContain(eventStandsSql('x'));
  });

  it('joinedInTimeSql compares Vienna days and treats legacy NULL as in time', () => {
    const sql = joinedInTimeSql('m', 'x');
    expect(sql).toContain('m.joined_at IS NULL');
    expect(sql).toContain("(m.joined_at::timestamptz AT TIME ZONE 'Europe/Vienna') < x.date::date + 1");
    expect(() => joinedInTimeSql('m', 'x)--')).toThrow();
  });

  it('blockedWithSql is two-way and takes only a bind parameter', () => {
    const sql = blockedWithSql('$3');
    expect(sql).toContain("status = 'blocked'");
    expect(sql).toContain('requester_id = $3 OR addressee_id = $3');
    for (const bad of ['3', '$0', '$1; DROP TABLE users', 'u.id']) expect(() => blockedWithSql(bad)).toThrow();
  });
});

describe('getAttendanceStats', () => {
  beforeEach(() => _resetAttendanceLog());

  it('skips the query when there is no valid id', async () => {
    const db = { query: vi.fn() };
    expect(await getAttendanceStats(db, [])).toEqual(new Map());
    expect(await getAttendanceStats(db, [null, 'temp-1', 0, -3, ''])).toEqual(new Map());
    expect(db.query).not.toHaveBeenCalled();
  });

  it('deduplicates ids and chunks above 1000', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    await getAttendanceStats(db, [3, 3, '4', null]);
    expect(db.query.mock.calls[0][1]).toEqual([[3, 4]]);
    const big = { query: vi.fn(async () => ({ rows: [] })) };
    await getAttendanceStats(big, Array.from({ length: 1001 }, (_, i) => i + 1));
    expect(big.query).toHaveBeenCalledTimes(2);
  });

  it('returns null — never zeros — on failure; quiet for 42P01/42703 (boot window)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['42P01', '42703']) {
      const db = { query: vi.fn(async () => { throw Object.assign(new Error('x'), { code }); }) };
      expect(await getAttendanceStats(db, [1])).toBeNull();
    }
    expect(err).not.toHaveBeenCalled();
    const db = { query: vi.fn(async () => { throw new Error('connection reset'); }) };
    expect(await getAttendanceStats(db, [1])).toBeNull();
    expect(await getAttendanceStats(db, [1])).toBeNull();
    expect(err).toHaveBeenCalledTimes(1); // at most once a minute
    err.mockRestore();
  });

  it('tolerates a db that resolves nothing', async () => {
    expect(await getAttendanceStats({ query: vi.fn(async () => undefined) }, [1])).toEqual(new Map());
  });
});

describe('attachAttendanceTiers', () => {
  const dbWith = (rows) => ({ query: vi.fn(async () => ({ rows })) });

  it('stamps only the LEVEL — 0 for people without confirmed meetups', async () => {
    const db = dbWith([{ user_id: 7, confirmed_events: 12, confirmers: 4 }, { user_id: 8, confirmed_events: 5, confirmers: 2 }]);
    const rows = [{ id: 7 }, { id: 8 }, { id: 9 }];
    await attachAttendanceTiers(db, rows);
    expect(rows).toEqual([
      { id: 7, attendance_tier: 2, attendance_step: 2 },
      { id: 8, attendance_tier: 1, attendance_step: 1 },
      { id: 9, attendance_tier: 0, attendance_step: 0 },
    ]);
  });

  it('the five-step level goes to *_step, the old bundles\' three-step one stays in *_tier', async () => {
    const db = dbWith([
      { user_id: 1, confirmed_events: 30, confirmers: 6 },   // 🌟
      { user_id: 2, confirmed_events: 60, confirmers: 8 },   // 💎
      { user_id: 3, confirmed_events: 120, confirmers: 30 }, // 🎆
    ]);
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await attachAttendanceTiers(db, rows);
    expect(rows.map((r) => r.attendance_step)).toEqual([3, 4, 5]);
    // An old bundle keeps calling 🌟 / 💎 „10+“ (true) and never „100+“.
    expect(rows.map((r) => r.attendance_tier)).toEqual([2, 2, 3]);
  });

  it('supports the user_-prefixed join-request shape and the admin count', async () => {
    const db = dbWith([{ user_id: 5, confirmed_events: 100, confirmers: 12 }]);
    const rows = [{ id: 99, user_id: 5 }];
    await attachAttendanceTiers(db, rows, { idKey: 'user_id', field: 'user_attendance_tier', countField: 'attendance_count' });
    expect(rows[0]).toMatchObject({ user_attendance_tier: 3, user_attendance_step: 5, attendance_count: 100 });
  });

  it('derives the step field from any field name, or takes an explicit one', async () => {
    const db = dbWith([{ user_id: 5, confirmed_events: 25, confirmers: 5 }]);
    const rows = [{ requester_id: 5 }];
    await attachAttendanceTiers(db, rows, { idKey: 'requester_id', field: 'requester_attendance_tier' });
    expect(rows[0]).toEqual({ requester_id: 5, requester_attendance_tier: 2, requester_attendance_step: 3 });
    const odd = [{ id: 5 }];
    await attachAttendanceTiers(db, odd, { field: 'badge' });
    expect(odd[0]).toEqual({ id: 5, badge: 2, badge_step: 3 });
    const explicit = [{ id: 5 }];
    await attachAttendanceTiers(db, explicit, { stepField: 'level' });
    expect(explicit[0]).toEqual({ id: 5, attendance_tier: 2, level: 3 });
  });

  it('leaves both fields ABSENT when the lookup failed — unknown never renders as 0', async () => {
    const db = { query: vi.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); }) };
    const rows = [{ id: 1 }];
    await expect(attachAttendanceTiers(db, rows)).resolves.toBe(rows);
    expect(rows[0]).not.toHaveProperty('attendance_tier');
    expect(rows[0]).not.toHaveProperty('attendance_step');
  });

  it('tolerates empty, missing and non-object rows', async () => {
    const db = dbWith([]);
    expect(await attachAttendanceTiers(db, [])).toEqual([]);
    expect(await attachAttendanceTiers(db, null)).toBeNull();
    const rows = [null, 'x', { id: 1 }];
    await attachAttendanceTiers(db, rows);
    expect(rows[2].attendance_tier).toBe(0);
    expect(rows[2].attendance_step).toBe(0);
  });
});
