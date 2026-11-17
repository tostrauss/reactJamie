import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Deals at events (P4 v1, Tina 16.11.2026): an admin hangs a deal on an event
// (PUT /api/deals/event/:groupId), the event page and the club's event list
// embed it while it is visible (getDealsForEvents), the admin list names the
// events. Queries are dispatched on SQL text; each test programs `scenario`.
// The real SQL (incl. the sold-out 'once' rule) runs in the smoke test.
const scenario = {
  eventRow: { type: 'event' },  // SELECT type, parent_club_id FROM groups …
  isAdmin: true,                // the caller (P4 v2: the route no longer has requireAdmin)
  dealExists: true,
  embedRows: [],                // the event_deals ⨝ deals SELECT
  embedFail: null,
  adminRows: [],                // getDealsForAdmin's main SELECT
  attachedRows: [],             // the admin list's events per deal
  attachedFail: null,
  clubRows: [],                 // the admin list's club per deal (P4 v2)
  writeFail: null,              // INSERT/DELETE on event_deals
};
const queries = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (text.startsWith('SELECT type, parent_club_id FROM groups')) return { rows: scenario.eventRow ? [scenario.eventRow] : [] };
      if (text.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: scenario.isAdmin }] };
      if (text.startsWith('SELECT 1 FROM deals')) return { rows: scenario.dealExists ? [{}] : [] };
      if (/^\s*(INSERT INTO|DELETE FROM) event_deals/.test(text)) {
        if (scenario.writeFail) throw scenario.writeFail;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM event_deals ed\n         JOIN deals d')) {
        if (scenario.embedFail) throw scenario.embedFail;
        return { rows: scenario.embedRows };
      }
      if (text.includes('FROM event_deals ed\n         JOIN groups g')) {
        if (scenario.attachedFail) throw scenario.attachedFail;
        return { rows: scenario.attachedRows };
      }
      if (text.includes('JOIN groups c ON c.id = d.club_id')) return { rows: scenario.clubRows };
      if (text.includes('FROM deals d\n       LEFT JOIN')) return { rows: scenario.adminRows };
      throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
    }),
  },
}));
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToUsers: vi.fn(async () => {}) }));
vi.mock('../../src/utils/geocode.js', () => ({ resolveCreateLocation: vi.fn(async () => ({ ok: true })) }));

const { setEventDeal, getDealsForEvents, getDealsForAdmin } = await import('../../src/controllers/dealController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const put = async (groupId, body) => {
  const res = makeRes();
  await setEventDeal({ userId: 1, params: { groupId }, body }, res);
  return res;
};
const tableMissing = () => Object.assign(new Error('relation "event_deals" does not exist'), { code: '42P01' });
// What the embed SELECT returns: a JAMIE deal — `verified` comes from the SQL
// row since 17.11.2026 (the ✓ is for JAMIE's deals and paying partners).
const embedRow = { group_id: 5, id: 3, name: 'Café Soleá', deal_label: '2 für 1', photo: 'https://x/p.webp', verified: true };

let logSpy;
beforeEach(() => {
  Object.assign(scenario, {
    eventRow: { type: 'event' }, isAdmin: true, dealExists: true, embedRows: [], embedFail: null,
    adminRows: [], attachedRows: [], attachedFail: null, clubRows: [], writeFail: null,
  });
  queries.length = 0;
  logSpy?.mockRestore();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('getDealsForEvents', () => {
  it('one query for a whole list; only what redeemDeal would still let you redeem', async () => {
    scenario.embedRows = [embedRow, { ...embedRow, group_id: 6, photo: null }];
    const deals = await getDealsForEvents([5, '6', 5, null]);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([[5, 6]]);
    const sql = queries[0].text;
    expect(sql).toContain('ed.group_id = ANY($1::int[])');
    expect(sql).toContain("d.photos->>0 AS photo");
    expect(sql).toContain('d.is_active = TRUE');
    expect(sql).toContain('(d.visible_until IS NULL OR d.visible_until > NOW())');
    // the cap of the CURRENT round, and only for 'once' deals — exactly redeemDeal
    expect(sql).toContain("d.redeem_interval <> 'once'");
    expect(sql).toContain('< COALESCE(d.max_redemptions, 2147483647)');
    expect(sql).toContain("WHEN 'weekly' THEN 'w:'");
    expect(deals.get(5)).toEqual({ id: 3, name: 'Café Soleá', deal_label: '2 für 1', photo: 'https://x/p.webp', verified: true });
    expect(deals.get(6).photo).toBeNull();
  });

  // Tina 17.11.2026: „Den Haken bekommen nur Partner, die bezahlen.“ The ✓ at
  // a deal is for JAMIE's own deals and for the deals of paying partners —
  // decided in the query, from the deal's club.
  it('verified comes from the row: a JAMIE deal and a paying partner\'s yes, a club that does not pay no', async () => {
    scenario.embedRows = [
      { ...embedRow, group_id: 5, verified: true },                 // JAMIE's, or a paying partner's
      { ...embedRow, group_id: 6, id: 4, verified: false },         // an official club that does not pay
      { ...embedRow, group_id: 7, id: 5, verified: null },          // its club row is gone
    ];
    const deals = await getDealsForEvents([5, 6, 7]);
    expect(deals.get(5).verified).toBe(true);
    expect(deals.get(6).verified).toBe(false);
    expect(deals.get(7).verified).toBe(false);
    // …and otherwise they are the same object: „die dann genau so aussehen“
    expect(Object.keys(deals.get(6))).toEqual(Object.keys(deals.get(5)));
    const sql = queries[0].text;
    expect(sql).toContain('(d.club_id IS NULL OR dc.is_paid_partner = TRUE) AS verified');
    expect(sql).toContain('LEFT JOIN groups dc ON dc.id = d.club_id');
  });

  it('before the deals.club_id migration (42703): the same read without the club join — every deal is JAMIE\'s, so verified', async () => {
    const db = (await import('../../src/config/database.js')).default;
    db.query.mockImplementationOnce(async (text, params) => {
      queries.push({ text, params });
      throw Object.assign(new Error('column d.club_id does not exist'), { code: '42703' });
    });
    scenario.embedRows = [embedRow];
    const deals = await getDealsForEvents([5]);
    expect(deals.get(5).verified).toBe(true);
    expect(queries).toHaveLength(2);
    const fallback = queries[1].text;
    expect(fallback).toContain('TRUE AS verified');
    expect(fallback).not.toContain('dc.');
    expect(fallback).not.toContain('d.club_id');
    expect(fallback).toMatch(/AND TRUE$/);
  });

  it('nothing asked, nothing queried', async () => {
    expect((await getDealsForEvents([])).size).toBe(0);
    expect((await getDealsForEvents(undefined)).size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it('never throws: no table yet is quietly „no deal“, anything else is logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.embedFail = tableMissing();
    expect((await getDealsForEvents([5])).size).toBe(0);
    expect(err).not.toHaveBeenCalled();
    scenario.embedFail = new Error('boom');
    expect((await getDealsForEvents([5])).size).toBe(0);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe('PUT /api/deals/event/:groupId (setEventDeal)', () => {
  it('hangs a deal on an event — one per event, a second one replaces it — and says what the page shows', async () => {
    scenario.embedRows = [embedRow];
    const res = await put('5', { deal_id: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ group_id: 5, deal_id: 3, deal: {
      id: 3, name: 'Café Soleá', deal_label: '2 für 1', photo: 'https://x/p.webp', verified: true } });
    const write = queries.find((q) => q.text.startsWith('INSERT INTO event_deals'));
    expect(write.params).toEqual([5, 3, 1]);
    expect(write.text).toContain('ON CONFLICT (group_id) DO UPDATE');
    expect(write.text).toContain('deal_id = EXCLUDED.deal_id');
  });

  it('attached but not visible right now (expired, sold out): deal null', async () => {
    const res = await put('5', { deal_id: '3' });
    expect(res.body).toEqual({ group_id: 5, deal_id: 3, deal: null });
  });

  it('deal_id null takes it off again', async () => {
    const res = await put('5', { deal_id: null });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ group_id: 5, deal_id: null, deal: null });
    expect(queries.find((q) => q.text.startsWith('DELETE FROM event_deals')).params).toEqual([5]);
    expect(queries.some((q) => q.text.startsWith('SELECT 1 FROM deals'))).toBe(false);
  });

  it('refuses what is not an event: bad ids 400, missing 404, a club 400', async () => {
    expect((await put('abc', { deal_id: 3 })).statusCode).toBe(400);
    expect((await put('5', {})).statusCode).toBe(400);              // deal_id has to be stated
    expect((await put('5', { deal_id: -1 })).statusCode).toBe(400);
    expect((await put('5', { deal_id: 'x' })).statusCode).toBe(400);
    scenario.eventRow = null;
    expect((await put('5', { deal_id: 3 })).statusCode).toBe(404);  // unknown or deleted
    scenario.eventRow = { type: 'club' };
    const club = await put('5', { deal_id: 3 });
    expect(club.statusCode).toBe(400);
    expect(club.body.code).toBe('NOT_AN_EVENT');
    scenario.eventRow = { type: 'group' };                          // a meetup may carry one
    expect((await put('5', { deal_id: 3 })).statusCode).toBe(200);
    scenario.dealExists = false;
    expect((await put('5', { deal_id: 3 })).statusCode).toBe(404);
    expect(queries.filter((q) => q.text.startsWith('INSERT INTO event_deals'))).toHaveLength(1);
  });

  it('before the migration (42P01) a 503, a deal deleted in between a 404', async () => {
    scenario.writeFail = tableMissing();
    const boot = await put('5', { deal_id: 3 });
    expect(boot.statusCode).toBe(503);
    expect(boot.body.code).toBe('EVENT_DEALS_UNAVAILABLE');
    scenario.writeFail = Object.assign(new Error('fk'), { code: '23503' });
    expect((await put('5', { deal_id: 3 })).statusCode).toBe(404);
  });
});

describe('GET /api/deals/admin/list (getDealsForAdmin)', () => {
  it('names the events each deal hangs on; the deleted ones drop out', async () => {
    scenario.adminRows = [{ id: 3, name: 'Café Soleá' }, { id: 4, name: 'Bar' }];
    scenario.attachedRows = [
      { deal_id: 3, id: 5, name: 'Punsch Night', date: '2026-12-01T19:00:00.000Z' },
      { deal_id: 3, id: 8, name: 'Quiz', date: null },
    ];
    const res = makeRes();
    await getDealsForAdmin({}, res);
    expect(res.body).toEqual([
      { id: 3, name: 'Café Soleá', club: null, events: [
        { id: 5, name: 'Punsch Night', date: '2026-12-01T19:00:00.000Z' }, { id: 8, name: 'Quiz', date: null }] },
      { id: 4, name: 'Bar', club: null, events: [] },
    ]);
    expect(queries.find((q) => q.text.includes('JOIN groups g')).text).toContain('g.deleted_at IS NULL');
  });

  it('a club\'s own deal names its club (P4 v2), JAMIE\'s own none', async () => {
    scenario.adminRows = [{ id: 3, name: 'Café Soleá' }, { id: 4, name: 'Bar' }];
    scenario.clubRows = [{ deal_id: 4, id: 70, name: 'Bar Neun Club' }];
    const res = makeRes();
    await getDealsForAdmin({}, res);
    expect(res.body.map((d) => d.club)).toEqual([null, { id: 70, name: 'Bar Neun Club' }]);
  });

  it('without the table the list still loads, every deal with no events', async () => {
    scenario.adminRows = [{ id: 3 }];
    scenario.attachedFail = tableMissing();
    const res = makeRes();
    await getDealsForAdmin({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 3, club: null, events: [] }]);
  });
});
