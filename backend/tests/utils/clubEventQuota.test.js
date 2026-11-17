import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FREE_CLUB_EVENTS, FREE_CLUB_EVENTS_AT_ONCE, FREE_TIER_MARKER,
  clubFreeTierEnabled, countedEventSql, unitsSql, upcomingEventSql,
  quotaBlock, PARTNER_TEXTS, partnerRequired,
  loadClubForQuota, countClubEvents, quotaOf, clubQuota, ticketRule,
} from '../../src/utils/clubEventQuota.js';

// The free tier of clubs (Tina's document of 17.11.2026, decided by Tobi).
// The decision and the SQL shape are pinned here; the real-Postgres smoke
// suite runs the counting against real rows and a set clock.
const official = (over = {}) => ({
  id: 7, name: 'Café Soleá', club_type: 'official', is_paid_partner: false, caller_is_admin: false, ...over,
});
const counting = (row) => ({ query: vi.fn(async () => ({ rows: [row] })) });

afterEach(() => { delete process.env.CLUB_FREE_TIER; });

describe('the numbers Tina set', () => {
  it('2 free events, 1 at a time', () => {
    expect(FREE_CLUB_EVENTS).toBe(2);
    expect(FREE_CLUB_EVENTS_AT_ONCE).toBe(1);
  });
});

describe('quotaBlock', () => {
  it.each([
    [{ limited: false, used: 5, upcoming: 3 }, null],          // a paying partner, a community
    [{ limited: true, used: 0, upcoming: 0 }, null],           // the first event
    [{ limited: true, used: 1, upcoming: 1 }, 'concurrent'],   // the second while the first is ahead
    [{ limited: true, used: 1, upcoming: 0 }, null],           // the second once the first is over
    [{ limited: true, used: 2, upcoming: 0 }, 'third'],        // the third
    [{ limited: true, used: 2, upcoming: 1 }, 'third'],        // 'third' wins: waiting does not help
    [{ limited: true, used: 4, upcoming: 1 }, 'third'],        // a series that has repeated
  ])('%j → %j', (input, want) => {
    expect(quotaBlock(input)).toBe(want);
  });
});

describe('the SQL', () => {
  it('counts club events created since the free tier began', () => {
    const sql = countedEventSql('e');
    expect(sql).toContain("e.type = 'event'");
    expect(sql).toContain(`FROM one_shot_migrations WHERE name = '${FREE_TIER_MARKER}'`);
    expect(sql).toContain('e.created_at >= (SELECT applied_at');
    expect(FREE_TIER_MARKER).toBe('2026-11-17_club_free_tier_start');
  });

  it('an event taken down before it began gives its place back: UTC delete time against the Vienna start', () => {
    const sql = countedEventSql('e');
    expect(sql).toContain("(e.deleted_at AT TIME ZONE 'UTC') >= (e.date AT TIME ZONE 'Europe/Vienna')");
    expect(sql).toContain('e.deleted_at IS NULL OR e.date IS NULL');
  });

  it('a weekly series counts its dates by Vienna days; a single event is 1', () => {
    const sql = unitsSql('e', '$2');
    expect(sql).toContain('e.is_recurring_weekly IS NOT TRUE OR e.date IS NULL THEN 1');
    expect(sql).toContain("($2::timestamptz AT TIME ZONE 'Europe/Vienna')::date");
    expect(sql).toContain("((e.deleted_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Vienna')::date");
    expect(sql).toMatch(/- e\.date::date - 1\) \/ 7 \+ 2/);     // running: dates over + the planned one
    expect(sql).toMatch(/- e\.date::date, 0\) \/ 7 \+ 1/);      // deleted: dates begun
  });

  it('ahead means live and today or later in Vienna — a series always', () => {
    const sql = upcomingEventSql('e', '$2');
    expect(sql).toContain('e.deleted_at IS NULL AND e.is_active = TRUE');
    expect(sql).toContain('e.is_recurring_weekly IS TRUE');
    expect(sql).toContain("e.date::date >= ($2::timestamptz AT TIME ZONE 'Europe/Vienna')::date");
  });

  it('countClubEvents asks once, for the club and the clock it was given', async () => {
    const q = counting({ started: true, used: 3, upcoming: 1 });
    const now = new Date('2026-12-01T10:00:00Z');
    expect(await countClubEvents(q, 7, now)).toEqual({ started: true, used: 3, upcoming: 1 });
    expect(q.query).toHaveBeenCalledTimes(1);
    const [sql, params] = q.query.mock.calls[0];
    expect(params).toEqual([7, now]);
    expect(sql).toContain('e.parent_club_id = $1');
    expect(sql).toContain(countedEventSql('e'));
  });

  it('loadClubForQuota reads only clubs, with the caller’s admin flag', async () => {
    const q = { query: vi.fn(async () => ({ rows: [official()] })) };
    expect(await loadClubForQuota(q, 7, 3)).toEqual(official());
    const [sql, params] = q.query.mock.calls[0];
    expect(params).toEqual([7, 3]);
    expect(sql).toContain("c.type = 'club'");
    expect(sql).toContain('c.is_paid_partner');
    expect(sql).toContain('u.is_admin');
    for (const col of ['c.name', 'c.owner_id', 'c.club_type', 'c.is_private', 'c.location', 'c.lat', 'c.lng',
      'c.category', 'c.events_owner_only', 'c.approval_status', 'c.is_active']) {
      expect(sql).toContain(col);
    }
  });
});

describe('quotaOf', () => {
  it('an official club that does not pay is limited', async () => {
    const q = counting({ started: true, used: 1, upcoming: 1 });
    expect(await quotaOf(q, official())).toEqual({
      official: true, active: true, limited: true, used: 1, upcoming: 1, block: 'concurrent',
    });
  });

  it('a paying partner is not — whatever it has planned', async () => {
    const q = counting({ started: true, used: 9, upcoming: 3 });
    expect(await quotaOf(q, official({ is_paid_partner: true }))).toMatchObject({ active: true, limited: false, block: null });
  });

  it('an app admin calling is not (the JAMIE team’s own clubs)', async () => {
    const q = counting({ started: true, used: 9, upcoming: 3 });
    expect(await quotaOf(q, official({ caller_is_admin: true }))).toMatchObject({ active: true, limited: false, block: null });
  });

  it('a community is never limited and never counted', async () => {
    const q = counting({ started: true, used: 9, upcoming: 3 });
    for (const club_type of ['community', null, undefined]) {
      expect(await quotaOf(q, official({ club_type }))).toEqual({
        official: false, active: false, limited: false, used: 0, upcoming: 0, block: null,
      });
    }
    expect(q.query).not.toHaveBeenCalled();
  });

  it('CLUB_FREE_TIER=false switches it off without a query', async () => {
    process.env.CLUB_FREE_TIER = 'false';
    const q = counting({ started: true, used: 9, upcoming: 3 });
    expect(clubFreeTierEnabled()).toBe(false);
    expect(await quotaOf(q, official())).toMatchObject({ official: true, active: false, limited: false, block: null });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('on by default, and for anything but the word false', () => {
    expect(clubFreeTierEnabled()).toBe(true);
    for (const v of ['true', '1', '']) {
      process.env.CLUB_FREE_TIER = v;
      expect(clubFreeTierEnabled()).toBe(true);
    }
  });

  it('no marker row yet (boot window): nothing is limited', async () => {
    const q = counting({ started: false, used: 0, upcoming: 0 });
    expect(await quotaOf(q, official())).toMatchObject({ active: false, limited: false, block: null });
  });

  it.each(['42P01', '42703'])('a missing table or column (%s) reads as not limited', async (code) => {
    const q = { query: vi.fn(async () => { throw Object.assign(new Error('missing'), { code }); }) };
    expect(await quotaOf(q, official())).toMatchObject({ active: false, limited: false, block: null });
  });

  it('any other database error is not swallowed', async () => {
    const q = { query: vi.fn(async () => { throw Object.assign(new Error('down'), { code: '57P01' }); }) };
    await expect(quotaOf(q, official())).rejects.toThrow('down');
  });
});

describe('clubQuota', () => {
  it('loads the club, then counts', async () => {
    const q = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [official()] })
      .mockResolvedValueOnce({ rows: [{ started: true, used: 2, upcoming: 0 }] }) };
    const out = await clubQuota(q, { clubId: 7, userId: 3 });
    expect(out.club).toEqual(official());
    expect(out).toMatchObject({ limited: true, used: 2, upcoming: 0, block: 'third' });
  });

  it('no such club: club undefined, nothing limited', async () => {
    const q = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await clubQuota(q, { clubId: 7, userId: 3 })).toMatchObject({ club: undefined, limited: false, block: null });
    expect(q.query).toHaveBeenCalledTimes(1);
  });
});

describe('ticketRule', () => {
  it('a limited official club: only as a partner', () => {
    expect(ticketRule({ active: true, limited: true })).toBe('partner');
  });
  it('a paying partner or the JAMIE team: free of the Pro rule', () => {
    expect(ticketRule({ active: true, limited: false })).toBe('free');
  });
  it('a community, the switch off, the boot window: JAMIE Pro as before', () => {
    expect(ticketRule({ active: false, limited: false })).toBe('pro');
    expect(ticketRule(undefined)).toBe('pro');
  });
});

describe('partnerRequired', () => {
  it('carries a code for the new surface and a German sentence for old bundles', () => {
    expect(partnerRequired('third', 'Café Soleá')).toEqual({
      error: 'Ab dem dritten Event geht es als JAMIE Partner weiter.',
      code: 'PARTNER_REQUIRED',
      reason: 'third',
      club_name: 'Café Soleá',
    });
  });

  it('has a sentence for each of the four reasons — none with a price', () => {
    expect(Object.keys(PARTNER_TEXTS).sort()).toEqual(['concurrent', 'deal', 'third', 'ticket']);
    for (const reason of Object.keys(PARTNER_TEXTS)) {
      const body = partnerRequired(reason, 'X');
      expect(body.error.length).toBeGreaterThan(10);
      expect(body.error).not.toMatch(/€|\d+\s*Euro/);
      expect(body.reason).toBe(reason);
    }
    // Tina's own words
    expect(PARTNER_TEXTS.concurrent).toContain('Gratis geht 1 Event gleichzeitig.');
    expect(PARTNER_TEXTS.concurrent).toContain('Ein weiteres Event ist gratis, sobald euer erstes vorbei ist.');
    expect(partnerRequired('ticket', undefined).club_name).toBe('');
  });
});
