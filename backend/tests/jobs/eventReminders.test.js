import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Programmable fake db + query recorder (same shape as entityLifecycle.test):
// every query is recorded into `statements`, then dispatched to the per-test
// `dbQueryImpl` on SQL substrings.
const statements = [];
let dbQueryImpl;

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      statements.push({ text, params });
      return dbQueryImpl(text, params);
    }),
  },
}));

// Push senders: wrapper arrows keep the stable vi.fn handles programmable per
// test (mockRejectedValueOnce etc.). pushLocale stays REAL — the builders the
// job hands to the senders are what we assert on.
const pushUsersMock = vi.fn(async () => {});
const pushUserMock = vi.fn(async () => {});
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUsers: (...a) => pushUsersMock(...a),
  sendPushToUser: (...a) => pushUserMock(...a),
}));

const {
  runEventReminders, reminderParams, nudgeParams, APP_TZ, NUDGE_MIN_OTHERS,
} = await import('../../src/jobs/eventReminders.js');

// ── Helpers ───────────────────────────────────────────────────────────────
// No fake timers in this repo: `now` is injected explicitly.
const NOW = new Date('2026-09-19T16:30:00Z');
const MARKERS = ['reminder_day_sent_for', 'reminder_hour_sent_for', 'owner_nudge_sent_for'];

// Programs dbQueryImpl: each claim UPDATE hands back its rows, the members
// SELECT returns `members`; anything else is a test bug and throws.
const program = ({ day = [], hour = [], nudge = [], members = [] } = {}) => {
  dbQueryImpl = async (text) => {
    if (text.includes('reminder_day_sent_for')) return { rows: day };
    if (text.includes('reminder_hour_sent_for')) return { rows: hour };
    if (text.includes('owner_nudge_sent_for')) return { rows: nudge };
    if (text.includes('FROM group_members gm')) return { rows: members };
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  };
};

const claimOf = (marker) =>
  statements.find(s => s.text.includes('UPDATE groups g SET') && s.text.includes(marker));
const membersSelects = () => statements.filter(s => s.text.includes('FROM group_members gm'));

let logSpy;
let errSpy;

beforeEach(() => {
  statements.length = 0;
  pushUsersMock.mockClear();
  pushUserMock.mockClear();
  program();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────
describe('claim SQL guards', () => {
  it.each(MARKERS)('%s: atomic claim carries every liveness/re-arm/timezone guard and [now, limit]', async (marker) => {
    await runEventReminders({ now: NOW });
    const claim = claimOf(marker);
    expect(claim).toBeDefined();
    const { text, params } = claim;

    expect(text).toContain('UPDATE groups g SET');
    expect(text).toContain(`${marker} = g.date`);
    expect(text).toContain("x.type IN ('group', 'event')");
    expect(text).toContain('x.is_active = TRUE');
    expect(text).toContain('x.deleted_at IS NULL');
    expect(text).toContain('x.did_not_take_place = FALSE');
    expect(text).toContain('x.is_recurring_weekly IS NOT TRUE');
    // OF x: lock the group row only — the nudge JOINs users, and without OF a
    // concurrent profile save would make SKIP LOCKED skip the event for a tick.
    expect(text).toContain('FOR UPDATE OF x SKIP LOCKED');
    expect(text).toContain("to_char(g.date, 'YYYY-MM-DD HH24:MI:SS') AS claimed_date");
    expect(text).toContain("AT TIME ZONE 'Europe/Vienna'");
    // Re-arm predicate: the marker stores the EVENT DATE, so a moved event
    // no longer matches and gets reminded again for the new date.
    expect(text).toContain(`x.${marker} IS NULL OR x.${marker} <> x.date`);
    expect(text).toContain('$1::timestamptz');
    expect(text).toContain('LIMIT $2');

    expect(params).toEqual([NOW, 200]);
    expect(params[0]).toBe(NOW); // the very Date instance passed in, not a re-parsed copy
  });

  it('forwards a custom limit as $2 to all three claims', async () => {
    await runEventReminders({ now: NOW, limit: 50 });
    for (const marker of MARKERS) {
      expect(claimOf(marker).params).toEqual([NOW, 50]);
    }
  });

  it('variant windows: hour = timed-only 60→30 min, day anchors 18:00, nudge joins owner prefs + 11:00 + <3 others', async () => {
    await runEventReminders({ now: NOW });
    const day = claimOf('reminder_day_sent_for').text;
    const hour = claimOf('reminder_hour_sent_for').text;
    const nudge = claimOf('owner_nudge_sent_for').text;

    expect(hour).toContain("x.date::time <> '00:00'");
    expect(hour).toContain("INTERVAL '60 minutes'");
    expect(hour).toContain("INTERVAL '30 minutes'");

    expect(day).toContain("TIME '18:00'");

    expect(nudge).toContain('JOIN users o ON o.id = x.owner_id');
    expect(nudge).toContain('o.push_reminders = TRUE');
    expect(nudge).toContain('x.members_count - 1 < 3');
    expect(nudge).toContain("TIME '11:00'");

    // Review 2026-09-06: sole-owner events wait for a second member (no
    // "reminder" 5 min after creation); a 00:xx start must not get "Heute" the
    // evening before; a freshly created event gets no immediate nudge.
    expect(day).toContain('x.members_count > 1');
    expect(hour).toContain('x.members_count > 1');
    expect(hour).toContain("(x.date::date::timestamp) AT TIME ZONE 'Europe/Vienna' <= $1::timestamptz");
    expect(nudge).toContain("x.created_at < $1::timestamptz - INTERVAL '6 hours'");
  });
});

describe('day-before fan-out', () => {
  it('claims, resolves recipients in ONE roster query, sends one localized push per event', async () => {
    program({
      day: [
        { id: 11, owner_id: 1, name: 'Bar Abend', location: 'Prater', members_count: 6, time_hhmm: '19:00' },
        { id: 12, owner_id: 2, name: 'Picknick', location: null, members_count: 1, time_hhmm: null },
      ],
      members: [
        { group_id: 11, user_id: 7 }, { group_id: 11, user_id: 8 }, { group_id: 12, user_id: 9 },
      ],
    });

    const out = await runEventReminders({ now: NOW });

    const sel = membersSelects();
    expect(sel).toHaveLength(1);
    expect(sel[0].text).toContain('gm.notifications_muted = FALSE');
    expect(sel[0].text).toContain('u.push_reminders = TRUE');
    expect(sel[0].params).toEqual([[11, 12]]);

    expect(pushUsersMock).toHaveBeenCalledTimes(2);
    expect(pushUsersMock).toHaveBeenNthCalledWith(1, [7, 8], expect.any(Function), null, '/group/11');
    expect(pushUsersMock).toHaveBeenNthCalledWith(2, [9], expect.any(Function), null, '/group/12');

    const build11 = pushUsersMock.mock.calls[0][1];
    const build12 = pushUsersMock.mock.calls[1][1];
    expect(build11('de')).toEqual({ title: 'Morgen: Bar Abend', body: '19:00 · 6 dabei · Prater' });
    expect(build11('en').body).toBe('19:00 · 6 going · Prater');
    // All-day + no location: no "00:00", no dangling separator.
    expect(build12('de')).toEqual({ title: 'Morgen: Picknick', body: '1 dabei' });

    expect(pushUserMock).not.toHaveBeenCalled();
    expect(out).toEqual({ dayBefore: 2, hourBefore: 0, ownerNudge: 0, pushes: 3 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('[cron] event reminders: day-before=2 hour-before=0 owner-nudge=0 (3 recipients)');
  });
});

describe('hour-before', () => {
  it('sends "Heute HH:MM" to members on the SAME /group/:id URL as the day push (replaces the unread banner)', async () => {
    program({
      hour: [{ id: 21, owner_id: 1, name: 'Tennis', location: null, members_count: 3, time_hhmm: '19:00' }],
      members: [{ group_id: 21, user_id: 5 }],
    });
    const out = await runEventReminders({ now: NOW });

    expect(membersSelects()).toHaveLength(1);
    expect(membersSelects()[0].params).toEqual([[21]]);
    expect(pushUsersMock).toHaveBeenCalledTimes(1);
    expect(pushUsersMock).toHaveBeenCalledWith([5], expect.any(Function), null, '/group/21');
    expect(pushUsersMock.mock.calls[0][1]('de')).toEqual({ title: 'Heute 19:00 · Tennis', body: 'Bis gleich! 👋' });
    expect(pushUserMock).not.toHaveBeenCalled();
    expect(out).toEqual({ dayBefore: 0, hourBefore: 1, ownerNudge: 0, pushes: 1 });
  });

  it('prefixes the location when present', async () => {
    program({
      hour: [{ id: 21, owner_id: 1, name: 'Tennis', location: 'Prater', members_count: 3, time_hhmm: '19:00' }],
      members: [{ group_id: 21, user_id: 5 }],
    });
    await runEventReminders({ now: NOW });
    expect(pushUsersMock.mock.calls[0][1]('de')).toEqual({ title: 'Heute 19:00 · Tennis', body: 'Prater · Bis gleich! 👋' });
  });
});

describe('owner nudge', () => {
  it('pushes the OWNER only, on a distinct ?via=nudge URL, with others = members_count minus owner', async () => {
    program({
      nudge: [
        { id: 31, owner_id: 4, name: 'Bar Abend', location: null, members_count: 2, time_hhmm: '19:00' },
        { id: 32, owner_id: 5, name: 'Yoga', location: null, members_count: 1, time_hhmm: null },
      ],
    });
    const out = await runEventReminders({ now: NOW });

    // Owner-only: no roster lookup, no member fan-out.
    expect(membersSelects()).toHaveLength(0);
    expect(pushUsersMock).not.toHaveBeenCalled();

    expect(pushUserMock).toHaveBeenCalledTimes(2);
    expect(pushUserMock).toHaveBeenNthCalledWith(1, 4, expect.any(Function), null, '/group/31?via=nudge');
    expect(pushUserMock).toHaveBeenNthCalledWith(2, 5, expect.any(Function), null, '/group/32?via=nudge');
    expect(pushUserMock.mock.calls[0][1]('de')).toEqual({
      title: 'Noch 2 Tage bis "Bar Abend"',
      body: "Außer dir erst 1 dabei – teile dein Event, damit's voll wird 🚀",
    });
    const yoga = pushUserMock.mock.calls[1][1]('de');
    expect(yoga.title).toBe('Noch 2 Tage bis "Yoga"');
    expect(yoga.body.startsWith('Noch niemand dabei')).toBe(true);

    expect(out).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 2, pushes: 2 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('owner-nudge=2 (2 recipients)');
  });
});

describe('edge cases', () => {
  it('no recipients (all muted / opted out): the claim still counts, nothing is sent', async () => {
    program({
      day: [{ id: 11, owner_id: 1, name: 'Bar Abend', location: null, members_count: 4, time_hhmm: '19:00' }],
      members: [],
    });
    const out = await runEventReminders({ now: NOW });
    expect(membersSelects()).toHaveLength(1);
    expect(pushUsersMock).not.toHaveBeenCalled();
    expect(pushUserMock).not.toHaveBeenCalled();
    expect(out).toEqual({ dayBefore: 1, hourBefore: 0, ownerNudge: 0, pushes: 0 });
  });

  it('nothing due: exactly the three claims in order, no roster query, no pushes, silent', async () => {
    const out = await runEventReminders({ now: NOW });
    expect(statements).toHaveLength(3);
    expect(statements.map(s => MARKERS.find(m => s.text.includes(m)))).toEqual(MARKERS);
    expect(pushUsersMock).not.toHaveBeenCalled();
    expect(pushUserMock).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(out).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, pushes: 0 });
  });

  it('a failing send is logged and contained — the run resolves and the other event still goes out', async () => {
    program({
      day: [
        { id: 11, owner_id: 1, name: 'Bar Abend', location: null, members_count: 4, time_hhmm: '19:00' },
        { id: 12, owner_id: 2, name: 'Picknick', location: null, members_count: 1, time_hhmm: null },
      ],
      members: [{ group_id: 11, user_id: 7 }, { group_id: 11, user_id: 8 }, { group_id: 12, user_id: 9 }],
    });
    pushUsersMock.mockRejectedValueOnce(new Error('boom'));

    const out = await runEventReminders({ now: NOW });

    expect(pushUsersMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('eventReminderDay failed for group 11');
    expect(errSpy.mock.calls[0][1]).toBe('boom');
    // `pushes` counts attempts (incremented before the send), so the failed
    // batch stays in the tally.
    expect(out).toEqual({ dayBefore: 2, hourBefore: 0, ownerNudge: 0, pushes: 3 });
  });
});

describe('failure isolation', () => {
  it('roster lookup fails AFTER the claim → markers are re-armed (NULL), nothing sent, other variants still run', async () => {
    dbQueryImpl = async (text) => {
      if (text.includes('UPDATE groups g SET') && text.includes('reminder_day_sent_for')) {
        return { rows: [{ id: 11, owner_id: 1, name: 'Bar Abend', location: null, members_count: 2, time_hhmm: '19:00', claimed_date: '2026-09-20 19:00:00' }] };
      }
      if (text.includes('FROM group_members gm')) throw new Error('pool exhausted');
      return { rows: [] };
    };

    const out = await runEventReminders({ now: NOW });

    expect(pushUsersMock).not.toHaveBeenCalled();
    expect(out.dayBefore).toBe(0);
    // Without the re-arm the stamped event would never be reminded again.
    const rearm = statements.find(s => s.text.includes('SET reminder_day_sent_for = NULL'));
    expect(rearm).toBeDefined();
    // Precise undo: only rows whose marker still holds OUR stamp (unnest pairs),
    // so a concurrent claim for a MOVED date is never wiped.
    expect(rearm.text).toContain('FROM unnest($1::int[], $2::timestamp[])');
    expect(rearm.text).toContain('g.reminder_day_sent_for = c.d');
    expect(rearm.params).toEqual([[11], ['2026-09-20 19:00:00']]);
    expect(errSpy.mock.calls[0][0]).toContain('roster lookup failed, re-arming 1 event(s)');
    expect(claimOf('reminder_hour_sent_for')).toBeDefined();
    expect(claimOf('owner_nudge_sent_for')).toBeDefined();
  });

  it('a failing claim (e.g. 42703 before the migration landed) is isolated — the other variants still run', async () => {
    dbQueryImpl = async (text) => {
      if (text.includes('reminder_day_sent_for')) throw new Error('column "reminder_day_sent_for" does not exist');
      return { rows: [] };
    };

    const out = await runEventReminders({ now: NOW });

    expect(out).toEqual({ dayBefore: 0, hourBefore: 0, ownerNudge: 0, pushes: 0 });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('event reminders (day-before) failed');
    expect(claimOf('reminder_hour_sent_for')).toBeDefined();
    expect(claimOf('owner_nudge_sent_for')).toBeDefined();
  });
});

describe('pure helpers', () => {
  it('reminderParams: coerces count, nulls empty time/location', () => {
    expect(reminderParams({ name: 'X', time_hhmm: null, members_count: '4', location: '' }))
      .toEqual({ groupName: 'X', time: null, count: 4, location: null });
  });

  it('nudgeParams: others = members_count minus the owner, floored at 0', () => {
    expect(nudgeParams({ name: 'X', members_count: 1 })).toEqual({ groupName: 'X', others: 0 });
    expect(nudgeParams({ members_count: 5 })).toEqual({ groupName: '', others: 4 });
  });

  it('constants', () => {
    expect(APP_TZ).toBe('Europe/Vienna');
    expect(NUDGE_MIN_OTHERS).toBe(3);
  });
});
