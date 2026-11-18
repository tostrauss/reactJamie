import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── A club's deal in the Gruppen feed (D-1, Tina 17.11.2026) ──────────────
// „Der Deal wird auch als Gruppe angezeigt (am Tag des Events)“ — „Das können
// nur wir als Admins einstellen!“. An admin releases one pair of event and
// deal (PUT /api/deals/event/:groupId/feed); GET /api/deals then carries the
// released club deals in front of JAMIE's. Queries are dispatched on SQL
// text; the real SQL (day, club gate, limits) runs in the smoke test.
const scenario = {
  jamieRows: [],       // getDeals' own SELECT
  feedRows: [],        // the released club deals (deals:club-feed)
  feedFail: null,
  isAdmin: true,
  releaseRows: [{ deal_id: 9 }],   // INSERT INTO feed_event_deals … RETURNING
  linkRows: [],                    // why nothing was released
  writeFail: null,
};
const queries = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (text.includes('/* deals:club-feed */')) {
        if (scenario.feedFail) throw scenario.feedFail;
        return { rows: scenario.feedRows };
      }
      if (text.startsWith('SELECT id, name, category, deal_label')) return { rows: scenario.jamieRows };
      if (text.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: scenario.isAdmin }] };
      if (text.startsWith('DELETE FROM feed_event_deals')) {
        if (scenario.writeFail) throw scenario.writeFail;
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('INSERT INTO feed_event_deals')) {
        if (scenario.writeFail) throw scenario.writeFail;
        return { rows: scenario.releaseRows, rowCount: scenario.releaseRows.length };
      }
      if (text.startsWith('SELECT d.club_id FROM event_deals ed')) return { rows: scenario.linkRows };
      throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
    }),
  },
}));
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToUsers: vi.fn(async () => {}) }));
vi.mock('../../src/utils/geocode.js', () => ({ resolveCreateLocation: vi.fn(async () => ({ ok: true })) }));
// Only the country boxes are read from it (loaded lazily, with the first row).
vi.mock('../../src/controllers/groupController.js', () => ({
  COUNTRY_BOUNDS: { AT: [{ latMin: 46.37, latMax: 49.02, lngMin: 9.53, lngMax: 17.16 }] },
}));

const {
  getDeals, clubDealsForFeed, setEventDealFeed, CLUB_DEALS_IN_FEED_MAX,
} = await import('../../src/controllers/dealController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const feed = async (userId = 1) => {
  const res = makeRes();
  await getDeals({ userId }, res);
  return res;
};
const put = async (groupId, body, userId = 1) => {
  const res = makeRes();
  await setEventDealFeed({ userId, params: { groupId }, body }, res);
  return res;
};

// The columns of a row in GET /deals — what app bundles already know.
const DEAL_KEYS = ['id', 'name', 'category', 'deal_label', 'description', 'address', 'lat', 'lng',
  'photos', 'booking_url', 'visible_until', 'created_at'];
const dealCols = (id, name) => ({
  id, name, category: 'Bar', deal_label: '1 Punsch gratis', description: null, address: 'Wien',
  lat: 48.2, lng: 16.37, photos: [], booking_url: null, visible_until: null, created_at: '2026-11-18T08:00:00.000Z',
});
// A released club deal as the feed query returns it: Vienna event, no age range,
// the caller 30 years old in AT.
const released = (id, eventId, over = {}) => ({
  ...dealCols(id, `Club-Deal ${id}`), feed_event_id: eventId,
  event_lat: 48.2, event_lng: 16.37, target_age_min: null, target_age_max: null,
  my_age: 30, my_country: 'AT', ...over,
});

let logSpy;
beforeEach(() => {
  Object.assign(scenario, {
    jamieRows: [], feedRows: [], feedFail: null, isAdmin: true,
    releaseRows: [{ deal_id: 9 }], linkRows: [], writeFail: null,
  });
  queries.length = 0;
  delete process.env.CLUB_DEAL_FEED_ENABLED;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  delete process.env.CLUB_DEAL_FEED_ENABLED;
});

describe('GET /api/deals with released club deals', () => {
  it('nothing released: the list is JAMIE\'s deals, exactly as before', async () => {
    scenario.jamieRows = [dealCols(1, 'JAMIE Deal')];
    const res = await feed();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([dealCols(1, 'JAMIE Deal')]);
  });

  it('a released club deal comes first, in the shape of a deal row plus feed_event_id', async () => {
    scenario.jamieRows = [dealCols(1, 'JAMIE Deal'), dealCols(2, 'JAMIE Deal 2')];
    scenario.feedRows = [released(9, 50)];
    const res = await feed();
    expect(res.body.map((d) => d.id)).toEqual([9, 1, 2]);
    expect(Object.keys(res.body[0])).toEqual([...DEAL_KEYS, 'feed_event_id']);
    expect(res.body[0].feed_event_id).toBe(50);
    // JAMIE's own rows are not touched
    expect(Object.keys(res.body[1])).toEqual(DEAL_KEYS);
  });

  it(`at most ${CLUB_DEALS_IN_FEED_MAX} of them, in the query's order, each deal once`, async () => {
    expect(CLUB_DEALS_IN_FEED_MAX).toBe(3);
    scenario.jamieRows = [dealCols(1, 'JAMIE Deal')];
    scenario.feedRows = [released(9, 50), released(9, 51), released(10, 52), released(11, 53), released(12, 54)];
    const res = await feed();
    expect(res.body.map((d) => [d.id, d.feed_event_id ?? null])).toEqual([[9, 50], [10, 52], [11, 53], [1, null]]);
  });

  it('the caller\'s age range and country box decide, like for the event in the Gruppen feed', async () => {
    scenario.feedRows = [
      released(9, 50, { target_age_min: 40 }),                 // too young
      released(10, 51, { target_age_max: 25 }),                // too old
      released(11, 52, { event_lat: 52.5, event_lng: 13.4 }),  // Berlin, the caller is in AT
      released(12, 53, { target_age_min: 18, target_age_max: 30 }),
      released(13, 54, { event_lat: null, event_lng: null }),  // no coordinates: kept, like in the feed
    ];
    expect((await clubDealsForFeed(1)).map((d) => d.id)).toEqual([12, 13]);
    // no date of birth and no country: everything passes
    scenario.feedRows = scenario.feedRows.map((r) => ({ ...r, my_age: null, my_country: null }));
    expect((await clubDealsForFeed(1)).map((d) => d.id)).toEqual([9, 10, 11]);
  });

  it('the query: the pair event + deal, the event\'s Vienna day, the feed\'s deal rule, the club gate', async () => {
    scenario.feedRows = [released(9, 50)];
    await clubDealsForFeed(7);
    const q = queries.find((x) => x.text.includes('/* deals:club-feed */'));
    expect(q.params).toEqual([7]);
    const sql = q.text;
    expect(sql).toContain('JOIN event_deals ed ON ed.group_id = f.group_id AND ed.deal_id = f.deal_id');
    expect(sql).toContain('d.club_id IS NOT NULL');
    expect(sql).toContain('d.is_active = TRUE');
    expect(sql).toContain('(d.visible_until IS NULL OR d.visible_until > NOW())');
    expect(sql).toContain('< d.max_redemptions');
    expect(sql).toContain("c.club_type = 'official'");
    expect(sql).toContain('g.is_active = TRUE');
    expect(sql).toContain('g.deleted_at IS NULL');
    expect(sql).toContain('pc.id = g.parent_club_id');
    expect(sql).toContain('g.date IS NOT NULL');
    expect(sql).toContain("g.date::date = (NOW() AT TIME ZONE 'Europe/Vienna')::date");
    expect(sql).toContain('% 7 = 0');
  });

  it('emergency switch CLUB_DEAL_FEED_ENABLED=false: no second query, the list as before', async () => {
    process.env.CLUB_DEAL_FEED_ENABLED = 'false';
    scenario.jamieRows = [dealCols(1, 'JAMIE Deal')];
    scenario.feedRows = [released(9, 50)];
    const res = await feed();
    expect(res.body).toEqual([dealCols(1, 'JAMIE Deal')]);
    expect(queries.some((x) => x.text.includes('/* deals:club-feed */'))).toBe(false);
  });

  it('the second query never fails the feed: no table yet is quietly none, anything else is logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    scenario.jamieRows = [dealCols(1, 'JAMIE Deal')];
    scenario.feedFail = Object.assign(new Error('relation "feed_event_deals" does not exist'), { code: '42P01' });
    let res = await feed();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([dealCols(1, 'JAMIE Deal')]);
    expect(err).not.toHaveBeenCalled();
    scenario.feedFail = new Error('boom');
    res = await feed();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([dealCols(1, 'JAMIE Deal')]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe('PUT /api/deals/event/:groupId/feed (setEventDealFeed)', () => {
  it('show=true releases the club deal on the event right now — read and written in one statement', async () => {
    const res = await put('50', { show: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ group_id: 50, deal_id: 9, in_feed: true });
    const write = queries.find((q) => q.text.startsWith('INSERT INTO feed_event_deals'));
    expect(write.params).toEqual([50, 1]);
    expect(write.text).toContain('d.club_id IS NOT NULL');
    expect(write.text).toContain('g.deleted_at IS NULL');
    expect(write.text).toContain('ON CONFLICT (group_id) DO UPDATE');
  });

  it('show=false takes the release back', async () => {
    const res = await put('50', { show: false });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ group_id: 50, deal_id: null, in_feed: false });
    expect(queries.find((q) => q.text.startsWith('DELETE FROM feed_event_deals')).params).toEqual([50]);
  });

  it('only app admins — nothing is written for anyone else', async () => {
    scenario.isAdmin = false;
    expect((await put('50', { show: true })).statusCode).toBe(403);
    expect((await put('50', { show: false })).statusCode).toBe(403);
    expect(queries.some((q) => /feed_event_deals/.test(q.text))).toBe(false);
    expect((await put('50', { show: true }, null)).statusCode).toBe(401);
  });

  it('bad input 400; no deal on the event 404; a JAMIE deal 400 (it is in the feed anyway)', async () => {
    expect((await put('abc', { show: true })).statusCode).toBe(400);
    expect((await put('50', {})).statusCode).toBe(400);
    expect((await put('50', { show: 'yes' })).statusCode).toBe(400);
    scenario.releaseRows = [];
    const none = await put('50', { show: true });
    expect(none.statusCode).toBe(404);
    expect(none.body.code).toBe('NO_EVENT_DEAL');
    scenario.linkRows = [{ club_id: null }];
    const jamie = await put('50', { show: true });
    expect(jamie.statusCode).toBe(400);
    expect(jamie.body.code).toBe('NOT_A_CLUB_DEAL');
  });

  it('before the migration (42P01) a 503 with a German sentence, a deleted event or deal a 404', async () => {
    scenario.writeFail = Object.assign(new Error('relation "feed_event_deals" does not exist'), { code: '42P01' });
    const boot = await put('50', { show: true });
    expect(boot.statusCode).toBe(503);
    expect(boot.body.code).toBe('EVENT_DEAL_FEED_UNAVAILABLE');
    expect(boot.body.error).toMatch(/gleich wieder verfügbar/);
    expect((await put('50', { show: false })).statusCode).toBe(503);
    scenario.writeFail = Object.assign(new Error('fk'), { code: '23503' });
    expect((await put('50', { show: true })).statusCode).toBe(404);
  });
});
