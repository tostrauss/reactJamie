import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Clubs put up their own deals (P4 v2, Tina/Tobi 16.11.2026): the owner or a
// co-manager of a live OFFICIAL club, and only with JAMIE Pro or as an app
// admin (PRO_REQUIRED otherwise); a club deal never sends the city push. The
// same people hang their own deals on their own club's events. Queries are
// dispatched on SQL text; each test programs `scenario`. The real SQL (gate,
// cascades, the feed) runs in the smoke test.
const CLUB = {
  id: 7, club_type: 'official', location: 'Gumpendorfer Straße 1, 1060 Wien', lat: 48.19, lng: 16.35,
  is_live: true, is_manager: true, caller_is_admin: false,
};
const scenario = {
  access: { ...CLUB },          // the clubDealAccess row (null = no such club)
  pro: false,                   // isUserPro
  ownDeal: true,                // SELECT 1 FROM deals … club_id … (edit)
  updated: true,                // UPDATE … RETURNING (edit / delete)
  listRows: [],                 // the club's deals
  eventRows: [],                // the events those hang on
  event: { type: 'event', parent_club_id: 7 },
  isAdmin: false,               // SELECT is_admin FROM users (setEventDeal)
  dealRow: { club_id: 7, is_active: true }, // SELECT club_id, is_active FROM deals
  currentLink: null,            // the deal on the event now: { club_id }
  // A deal hung on the event between the check and the write: what the write
  // itself finds there ({ club_id }); undefined = currentLink.
  linkAtWrite: undefined,
  geo: { ok: true, coords: { lat: 48.21, lng: 16.37 } },
  liveRows: [{}],               // redeemDeal's club check (SELECT 1 FROM deals d …)
  liveFail: null,
  // The club's live deals (liveClubDeals), one entry per count — the last
  // one repeats: [pre-check, the count under the lock].
  live: [{ others: 0, self_live: false }],
};
const queries = [];

vi.mock('../../src/config/database.js', () => {
  const query = vi.fn(async (text, params) => {
    queries.push({ text, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
    if (text.startsWith('SELECT 1 FROM groups WHERE id = $1 FOR UPDATE')) return { rows: [{}] };
    if (text.includes('AS self_live')) return { rows: [scenario.live.length > 1 ? scenario.live.shift() : scenario.live[0]] };
    if (text.includes('AS caller_is_admin')) return { rows: scenario.access ? [scenario.access] : [] };
    if (text.startsWith('INSERT INTO deals')) return { rows: [{ id: 42, club_id: params.at(-2), created_by: params.at(-1) }] };
    if (text.startsWith('SELECT 1 FROM deals WHERE id = $1 AND club_id = $2')) return { rows: scenario.ownDeal ? [{}] : [] };
    if (text.startsWith('UPDATE deals SET is_active = FALSE')) return { rows: scenario.updated ? [{ id: params[0] }] : [] };
    if (text.startsWith('UPDATE deals SET')) return { rows: scenario.updated ? [{ id: params.at(-2) }] : [] };
    if (text.includes('WHERE d.club_id = $1 AND d.is_active = TRUE')) return { rows: scenario.listRows };
    if (text.includes('FROM event_deals ed\n         JOIN groups g')) return { rows: scenario.eventRows };
    if (text.startsWith('SELECT type, parent_club_id FROM groups')) return { rows: scenario.event ? [scenario.event] : [] };
    if (text.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: scenario.isAdmin }] };
    if (text.startsWith('SELECT club_id, is_active FROM deals')) return { rows: scenario.dealRow ? [scenario.dealRow] : [] };
    if (text.startsWith('SELECT 1 FROM deals d WHERE d.id = $1')) {
      if (scenario.liveFail && !text.includes('AND TRUE')) throw scenario.liveFail;
      return { rows: scenario.liveRows };
    }
    if (text.startsWith('SELECT 1 FROM deals WHERE id = $1')) return { rows: [{}] };
    if (text.startsWith('SELECT d.club_id FROM event_deals')) return { rows: scenario.currentLink ? [scenario.currentLink] : [] };
    if (/^\s*(INSERT INTO|DELETE FROM) event_deals/.test(text)) {
      // As Postgres would: a write without the club condition (an admin's)
      // takes whatever is there; the club's only its own deal or an empty slot.
      if (scenario.linkAtWrite !== undefined) scenario.currentLink = scenario.linkAtWrite;
      const link = scenario.currentLink;
      const own = (clubId) => !!link && Number(link.club_id) === Number(clubId);
      if (text.startsWith('DELETE')) {
        const hit = text.includes('USING deals d') ? own(params[1]) : !!link;
        if (hit) scenario.currentLink = null;
        return { rows: [], rowCount: hit ? 1 : 0 };
      }
      const written = !text.includes('WHERE EXISTS') || !link || own(params[3]);
      return { rows: written ? [{ group_id: params[0] }] : [], rowCount: written ? 1 : 0 };
    }
    if (text.includes('FROM event_deals ed\n         JOIN deals d')) return { rows: [] };
    if (text.includes('JOIN push_subscriptions')) return { rows: [{ id: 3 }] };
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  });
  // writeUnderClubDealLimit's transaction: the same dispatch, in order.
  return { default: { query, pool: { connect: async () => ({ query, release: () => {} }) } } };
});
const pushMock = vi.fn(async () => {});
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToUsers: (...a) => pushMock(...a) }));
const proMock = vi.fn(async () => scenario.pro);
vi.mock('../../src/controllers/subscriptionController.js', () => ({ isUserPro: (...a) => proMock(...a) }));
const geoMock = vi.fn(async () => scenario.geo);
vi.mock('../../src/utils/geocode.js', () => ({ resolveCreateLocation: (...a) => geoMock(...a) }));
const textMock = vi.fn(async (text) => (text.includes('Hurensohn')
  ? { safe: false, reason: 'Dein Text enthält unangemessene Inhalte.' } : { safe: true, reason: null }));
vi.mock('../../src/config/moderation.js', () => ({ checkTextSafety: (...a) => textMock(...a) }));
// The real allowlist runs in the smoke test; here: our own uploads only.
vi.mock('../../src/utils/safeUrl.js', () => ({
  checkImageField: (v, label = 'Bild-URL') => (!v || String(v).startsWith('https://app.jamie-app.com/media/') ? null : `Ungültige ${label}`),
}));

const {
  getClubDeals, createClubDeal, updateClubDeal, deleteClubDeal, setEventDeal, redeemDeal, CLUB_DEAL_MAX_DAYS,
  CLUB_DEAL_MAX_LIVE,
} = await import('../../src/controllers/dealController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const run = async (fn, { userId = 5, params = {}, body = {} } = {}) => {
  const res = makeRes();
  await fn({ userId, params, body }, res);
  return res;
};
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const photo = 'https://app.jamie-app.com/media/uploads/deal.webp';
const body = (o = {}) => ({ name: 'Café Soleá', deal_label: '2 für 1', visible_until: day(30), ...o });
const create = (b, userId) => run(createClubDeal, { userId, params: { clubId: '7' }, body: b });
const inserts = () => queries.filter((q) => q.text.startsWith('INSERT INTO deals'));
const attach = (dealId, groupId = '90') => run(setEventDeal, { params: { groupId }, body: { deal_id: dealId } });

let logSpy;
beforeEach(() => {
  Object.assign(scenario, {
    access: { ...CLUB }, pro: false, ownDeal: true, updated: true, listRows: [], eventRows: [],
    event: { type: 'event', parent_club_id: 7 }, isAdmin: false, dealRow: { club_id: 7, is_active: true },
    currentLink: null, linkAtWrite: undefined, geo: { ok: true, coords: { lat: 48.21, lng: 16.37 } }, liveRows: [{}], liveFail: null,
    live: [{ others: 0, self_live: false }],
  });
  queries.length = 0;
  pushMock.mockClear(); proMock.mockClear(); geoMock.mockClear(); textMock.mockClear();
  logSpy?.mockRestore();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('the club-deal gate', () => {
  it('a manager without Pro: 403 PRO_REQUIRED on create, nothing written, nothing geocoded', async () => {
    const res = await create(body());
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
    expect(proMock).toHaveBeenCalledWith(5);
    expect(inserts()).toHaveLength(0);
    expect(geoMock).not.toHaveBeenCalled();
  });

  it('an app admin who manages the club needs no Pro — isUserPro is not even asked', async () => {
    scenario.access.caller_is_admin = true;
    const res = await create(body());
    expect(res.statusCode).toBe(201);
    expect(proMock).not.toHaveBeenCalled();
  });

  it('in this order: unknown club 404, non-manager 403 (with Pro too), community, club not live — before Pro is asked', async () => {
    scenario.pro = true;
    scenario.access = null;
    expect((await create(body())).statusCode).toBe(404);
    scenario.access = { ...CLUB, is_manager: false, club_type: 'community', is_live: false };
    const outsider = await create(body());
    expect(outsider.statusCode).toBe(403);
    expect(outsider.body.code).toBe('NOT_CLUB_MANAGER');
    scenario.access = { ...CLUB, club_type: 'community', is_live: false };
    const community = await create(body());
    expect(community.statusCode).toBe(403);
    expect(community.body.code).toBe('OFFICIAL_CLUB_REQUIRED');
    scenario.access = { ...CLUB, is_live: false };
    const pending = await create(body());
    expect(pending.statusCode).toBe(403);
    expect(pending.body.code).toBe('CLUB_NOT_LIVE');
    expect(proMock).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);
  });

  it('the gate query: owner or co-manager (role admin), the live-club predicate, the caller\'s admin flag', async () => {
    await create(body());
    const q = queries.find((x) => x.text.includes('AS caller_is_admin'));
    expect(q.params).toEqual([7, 5]);
    expect(q.text).toContain("c.owner_id = $2");
    expect(q.text).toContain("gm.role = 'admin'");
    expect(q.text).toContain("c.approval_status = 'approved'");
    expect(q.text).toContain('c.is_active = TRUE');
    expect(q.text).toContain("c.type = 'club' AND c.deleted_at IS NULL");
  });

  it('bad ids 400, no session 401', async () => {
    expect((await run(createClubDeal, { params: { clubId: 'x' }, body: body() })).statusCode).toBe(400);
    expect((await run(updateClubDeal, { params: { clubId: '7', dealId: '-3' }, body: {} })).statusCode).toBe(400);
    expect((await run(getClubDeals, { userId: 0, params: { clubId: '7' } })).statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });
});

describe('POST /api/deals/club/:clubId (createClubDeal)', () => {
  beforeEach(() => { scenario.pro = true; });

  it('stores the deal with club_id + created_by; an empty address is the club\'s, pin included; no city push', async () => {
    const res = await create(body({ description: '  Sag „Jamie“  ', photos: [photo], redeem_interval: 'weekly', redeem_days: [4] }));
    expect(res.statusCode).toBe(201);
    const ins = inserts()[0];
    const cols = ins.text.match(/INSERT INTO deals \(([^)]+)\)/)[1].split(', ');
    const row = Object.fromEntries(cols.map((c, i) => [c, ins.params[i]]));
    expect(row).toMatchObject({
      name: 'Café Soleá', deal_label: '2 für 1', description: 'Sag „Jamie“',
      photos: JSON.stringify([photo]), redeem_interval: 'weekly', redeem_days: [4],
      address: CLUB.location, lat: CLUB.lat, lng: CLUB.lng, club_id: 7, created_by: 5,
    });
    expect(new Date(row.visible_until).toISOString().slice(0, 10)).toBe(day(30));
    expect(cols).not.toContain('max_redemptions');   // the DB default (100), like JAMIE's deals
    expect(cols).not.toContain('is_active');
    expect(geoMock).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect(queries.some((q) => q.text.includes('JOIN push_subscriptions'))).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a typed address goes through the region gate and gets its own pin; outside the markets 400', async () => {
    let res = await create(body({ address: 'Neubaugasse 7, 1070 Wien' }));
    expect(res.statusCode).toBe(201);
    expect(geoMock).toHaveBeenCalledWith('Neubaugasse 7, 1070 Wien');
    const ins = inserts()[0];
    const cols = ins.text.match(/INSERT INTO deals \(([^)]+)\)/)[1].split(', ');
    expect(ins.params[cols.indexOf('lat')]).toBe(48.21);
    scenario.geo = { ok: false };
    res = await create(body({ address: 'Times Square, New York' }));
    expect(res.statusCode).toBe(400);
    expect(inserts()).toHaveLength(1);
  });

  it(`visible_until is required, in the future, at most ${CLUB_DEAL_MAX_DAYS} days ahead`, async () => {
    for (const visible_until of [undefined, null, '', 'kein Datum', day(-1), day(CLUB_DEAL_MAX_DAYS + 3)]) {
      const res = await create(body({ visible_until }));
      expect(res.statusCode, String(visible_until)).toBe(400);
    }
    expect((await create(body({ visible_until: day(1) }))).statusCode).toBe(201);
    expect((await create(body({ visible_until: day(CLUB_DEAL_MAX_DAYS) }))).statusCode).toBe(201);
    expect(inserts()).toHaveLength(2);
  });

  // Review 16.11.2026: „Sichtbar bis 17.12.“ is all of the 17th in Vienna —
  // midnight UTC hid the deal from 01:00 that very day.
  it('a bare date runs to the end of its Vienna day — 23:59:59 there, in winter and in summer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-16T23:30:00Z'));   // 17.11. 00:30 in Vienna, the 16th in UTC
      const stored = async (visible_until) => {
        queries.length = 0;
        const res = await create(body({ visible_until }));
        if (res.statusCode !== 201) return res.statusCode;
        const ins = inserts()[0];
        const cols = ins.text.match(/INSERT INTO deals \(([^)]+)\)/)[1].split(', ');
        return ins.params[cols.indexOf('visible_until')];
      };
      expect(await stored('2026-12-17')).toBe('2026-12-17T22:59:59.000Z');   // CET
      expect(await stored('2027-05-14')).toBe('2027-05-14T21:59:59.000Z');   // CEST
      expect(await stored('2026-11-17')).toBe('2026-11-17T22:59:59.000Z');   // today in Vienna: until tonight
      expect(await stored('2026-11-16')).toBe(400);                          // over in Vienna, still the UTC day
      expect(await stored('2026-02-30')).toBe(400);
      // a value with a time is the instant it names
      expect(await stored('2026-12-01T12:00:00.000Z')).toBe('2026-12-01T12:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  // Review 16.11.2026: the upper limit is the form's max (DealForm
  // isoDay(CLUB_DEAL_MAX_DAYS)) — Vienna calendar days. It was now + 181 days
  // in milliseconds, which the clock change in between shifted by an hour.
  it(`the last day is ${CLUB_DEAL_MAX_DAYS} Vienna calendar days after today there — across the clock change, both ways`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const status = async (visible_until) => (await create(body({ visible_until }))).statusCode;
      // 02.06.2027 00:30 in Vienna (summer time), still the 1st in UTC: the
      // form offers up to 29.11.2027 (winter time) — the old span refused it.
      vi.setSystemTime(new Date('2027-06-01T22:30:00Z'));
      expect(await status('2027-11-29')).toBe(201);
      expect(await status('2027-11-30')).toBe(400);
      // 17.11.2026 00:30 in Vienna (winter time): up to 16.05.2027
      vi.setSystemTime(new Date('2026-11-16T23:30:00Z'));
      expect(await status('2027-05-16')).toBe(201);
      expect(await status('2027-05-17')).toBe(400);
      // 16.11.2026 23:30 in Vienna (winter time): up to 15.05.2027 — the old
      // span let 16.05. (summer time) through, a day past the form's max.
      vi.setSystemTime(new Date('2026-11-16T22:30:00Z'));
      expect(await status('2027-05-15')).toBe(201);
      expect(await status('2027-05-16')).toBe(400);
      // the lower end is unchanged: today runs until its end in Vienna
      expect(await status('2026-11-16')).toBe(201);
      expect(await status('2026-11-15')).toBe(400);
      expect(inserts()).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an edit has the same last day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const edit = (visible_until) => run(updateClubDeal, { params: { clubId: '7', dealId: '11' }, body: { visible_until } });
      vi.setSystemTime(new Date('2027-06-01T22:30:00Z'));
      expect((await edit('2027-11-29')).statusCode).toBe(200);
      expect((await edit('2027-11-30')).statusCode).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('name and headline required; texts moderated (422); photos only from the allowlist; links http(s)', async () => {
    expect((await create(body({ name: '  ' }))).statusCode).toBe(400);
    expect((await create(body({ deal_label: undefined }))).statusCode).toBe(400);
    const bad = await create(body({ description: 'du Hurensohn' }));
    expect(bad.statusCode).toBe(422);
    expect(textMock).toHaveBeenLastCalledWith('Café Soleá\n2 für 1\ndu Hurensohn');
    const ext = await create(body({ photos: ['https://evil.example/x.jpg'] }));
    expect(ext.statusCode).toBe(400);
    expect(ext.body.error).toBe('Ungültige Foto-URL');
    expect((await create(body({ booking_url: 'javascript:alert(1)' }))).statusCode).toBe(400);
    expect((await create(body({ redeem_interval: 'hourly' }))).statusCode).toBe(400);
    expect((await create(body({ max_redemptions: 0 }))).statusCode).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  // Review 16.11.2026: clubs type these themselves now.
  it('an address over 255 characters or a cap beyond INTEGER: 400 — not the database\'s bare 500', async () => {
    expect((await create(body({ address: `Gumpendorfer Straße 1, 1060 Wien ${'x'.repeat(230)}` }))).statusCode).toBe(400);
    expect((await create(body({ max_redemptions: '99999999999' }))).statusCode).toBe(400);
    expect(inserts()).toHaveLength(0);
    expect((await create(body({ max_redemptions: 2147483647 }))).statusCode).toBe(201);
  });

  it('a typed address is moderated with the texts — it shows on the deal page as typed', async () => {
    expect((await create(body({ address: 'Neubaugasse 7, 1070 Wien' }))).statusCode).toBe(201);
    expect(textMock).toHaveBeenLastCalledWith('Café Soleá\n2 für 1\nNeubaugasse 7, 1070 Wien');
    const bad = await create(body({ address: 'Hurensohnweg 1, 1070 Wien' }));
    expect(bad.statusCode).toBe(422);
    expect(geoMock).toHaveBeenCalledTimes(1);   // refused before geocoding
    expect(inserts()).toHaveLength(1);
  });

  it('before the deals.club_id migration (42703): 503, not 500', async () => {
    const db = (await import('../../src/config/database.js')).default;
    db.query.mockImplementationOnce(async () => ({ rows: [scenario.access] }))
      .mockImplementationOnce(async () => { throw Object.assign(new Error('column "club_id" does not exist'), { code: '42703' }); });
    const res = await create(body());
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CLUB_DEALS_UNAVAILABLE');
  });
});

// Review 16.11.2026: the feed has no place filter and puts the newest first —
// one club with Pro and a script filled it for every city.
describe(`at most ${CLUB_DEAL_MAX_LIVE} live deals per club`, () => {
  beforeEach(() => { scenario.pro = true; });
  const edit = (b) => run(updateClubDeal, { params: { clubId: '7', dealId: '11' }, body: b });
  const counts = () => queries.filter((q) => q.text.includes('AS self_live'));
  const flow = () => queries.map(({ text }) => (text.includes('AS self_live') ? 'count'
    : text.includes('FOR UPDATE') ? 'lock' : /^(INSERT INTO deals|UPDATE deals SET)/.test(text) ? 'write'
      : /^(BEGIN|COMMIT|ROLLBACK)$/.test(text) ? text : null)).filter(Boolean);

  it('at the limit: 409 CLUB_DEAL_LIMIT before the moderation and geocoding calls, nothing written', async () => {
    scenario.live = [{ others: CLUB_DEAL_MAX_LIVE, self_live: false }];
    const res = await create(body({ address: 'Neubaugasse 7, 1070 Wien' }));
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CLUB_DEAL_LIMIT');
    expect(textMock).not.toHaveBeenCalled();
    expect(geoMock).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);
    // live: active, not past its end date — a one-time deal at its cap, which
    // the feed hides, counts too
    expect(counts()[0].params).toEqual([7, null]);
    expect(counts()[0].text).toContain('WHERE club_id = $1 AND is_active = TRUE');
    expect(counts()[0].text).toContain('(visible_until IS NULL OR visible_until > NOW())');
    expect(counts()[0].text).not.toContain('deal_redemptions');
  });

  it('below it: counted again under a lock on the club\'s row, in one transaction with the INSERT', async () => {
    scenario.live = [{ others: CLUB_DEAL_MAX_LIVE - 1, self_live: false }];
    expect((await create(body())).statusCode).toBe(201);
    expect(flow()).toEqual(['count', 'BEGIN', 'lock', 'count', 'write', 'COMMIT']);
    expect(queries.find((q) => q.text.includes('FOR UPDATE')).params).toEqual([7]);
  });

  it('a parallel request got there first: the count under the lock refuses — ROLLBACK, 409, nothing written', async () => {
    scenario.live = [{ others: CLUB_DEAL_MAX_LIVE - 1, self_live: false }, { others: CLUB_DEAL_MAX_LIVE, self_live: false }];
    const res = await create(body());
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CLUB_DEAL_LIMIT');
    expect(flow()).toEqual(['count', 'BEGIN', 'lock', 'count', 'ROLLBACK']);
  });

  it('an edit counts only when its new end date brings an expired deal back', async () => {
    scenario.live = [{ others: CLUB_DEAL_MAX_LIVE, self_live: true }];     // live already: the count stays
    expect((await edit({ deal_label: 'neu', visible_until: day(10) })).statusCode).toBe(200);
    expect(counts()[0].params).toEqual([7, 11]);
    expect(flow()).toEqual(['BEGIN', 'lock', 'count', 'write', 'COMMIT']);
    scenario.live = [{ others: CLUB_DEAL_MAX_LIVE, self_live: false }];    // expired: one too many
    const back = await edit({ visible_until: day(10) });
    expect(back.statusCode).toBe(409);
    expect(back.body.code).toBe('CLUB_DEAL_LIMIT');
    queries.length = 0;
    expect((await edit({ deal_label: 'neu' })).statusCode).toBe(200);      // no end date: no count at all
    expect(flow()).toEqual(['write']);
  });
});

describe('GET / PUT / DELETE a club\'s deals', () => {
  it('the list needs no Pro: live deals of this club, with the events they hang on', async () => {
    scenario.listRows = [{ id: 11, name: 'A' }, { id: 12, name: 'B' }];
    scenario.eventRows = [{ deal_id: 12, id: 90, name: 'Punsch Night', date: null }];
    const res = await run(getClubDeals, { params: { clubId: '7' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { id: 11, name: 'A', events: [] },
      { id: 12, name: 'B', events: [{ id: 90, name: 'Punsch Night', date: null }] },
    ]);
    expect(proMock).not.toHaveBeenCalled();
    const ev = queries.find((q) => q.text.includes('JOIN groups g'));
    expect(ev.text).toContain('ed.deal_id = ANY($1::int[])');
    expect(ev.params).toEqual([[11, 12]]);
  });

  it('an edit needs Pro, touches only the club\'s own live deal and only what was sent', async () => {
    let res = await run(updateClubDeal, { params: { clubId: '7', dealId: '11' }, body: { deal_label: '3 für 2' } });
    expect(res.body.code).toBe('PRO_REQUIRED');
    scenario.pro = true;
    res = await run(updateClubDeal, { params: { clubId: '7', dealId: '11' }, body: { deal_label: ' 3 für 2 ' } });
    expect(res.statusCode).toBe(200);
    const upd = queries.find((q) => q.text.startsWith('UPDATE deals SET'));
    expect(upd.text).toMatch(/^UPDATE deals SET deal_label=\$1, updated_at=CURRENT_TIMESTAMP\s+WHERE id=\$2 AND club_id=\$3/);
    expect(upd.params).toEqual(['3 für 2', 11, 7]);
    scenario.ownDeal = false;                        // another club's, or deleted
    expect((await run(updateClubDeal, { params: { clubId: '7', dealId: '11' }, body: { name: 'x' } })).statusCode).toBe(404);
  });

  it('an edit cannot clear the end date, nor go past the limit; an empty edit is a 400', async () => {
    scenario.pro = true;
    const edit = (b) => run(updateClubDeal, { params: { clubId: '7', dealId: '11' }, body: b });
    expect((await edit({ visible_until: null })).statusCode).toBe(400);
    expect((await edit({ visible_until: day(CLUB_DEAL_MAX_DAYS + 3) })).statusCode).toBe(400);
    expect((await edit({})).statusCode).toBe(400);
    expect((await edit({ visible_until: day(60) })).statusCode).toBe(200);
  });

  it('deleting is free (no Pro) and soft; someone else\'s deal 404', async () => {
    const res = await run(deleteClubDeal, { params: { clubId: '7', dealId: '11' } });
    expect(res.statusCode).toBe(200);
    expect(proMock).not.toHaveBeenCalled();
    const del = queries.find((q) => q.text.startsWith('UPDATE deals SET is_active = FALSE'));
    expect(del.text).toContain('WHERE id = $1 AND club_id = $2 AND is_active = TRUE');
    expect(del.params).toEqual([11, 7]);
    scenario.updated = false;
    expect((await run(deleteClubDeal, { params: { clubId: '7', dealId: '11' } })).statusCode).toBe(404);
  });

  it('a community\'s owner cannot even list', async () => {
    scenario.access = { ...CLUB, club_type: 'community' };
    const res = await run(getClubDeals, { params: { clubId: '7' } });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('OFFICIAL_CLUB_REQUIRED');
  });
});

describe('PUT /api/deals/event/:groupId by a club\'s manager (P4 v2)', () => {
  const linkWrites = () => queries.filter((q) => /^\s*(INSERT INTO|DELETE FROM) event_deals/.test(q.text));

  it('hangs the club\'s own deal on the club\'s own event — with Pro', async () => {
    scenario.pro = true;
    const res = await attach(11);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ group_id: 90, deal_id: 11, deal: null });
    expect(queries.find((q) => q.text.includes('AS caller_is_admin')).params).toEqual([7, 5]);
    expect(linkWrites()[0].params).toEqual([90, 11, 5, 7]);
  });

  it('hanging one on needs Pro; taking it off does not', async () => {
    const res = await attach(11);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
    expect(linkWrites()).toHaveLength(0);
    const off = await attach(null);
    expect(off.statusCode).toBe(200);
    expect(linkWrites()[0].text).toMatch(/^DELETE FROM event_deals/);
  });

  it('only the club\'s own live deals: another club\'s 403 NOT_OWN_DEAL, JAMIE\'s 403, a deleted one 404', async () => {
    scenario.pro = true;
    scenario.dealRow = { club_id: 8, is_active: true };
    const foreign = await attach(11);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body.code).toBe('NOT_OWN_DEAL');
    scenario.dealRow = { club_id: null, is_active: true };
    expect((await attach(11)).body.code).toBe('NOT_OWN_DEAL');
    scenario.dealRow = { club_id: 7, is_active: false };
    expect((await attach(11)).statusCode).toBe(404);
    scenario.dealRow = null;
    expect((await attach(11)).statusCode).toBe(404);
    expect(linkWrites()).toHaveLength(0);
  });

  it('only events of a club they manage: a meetup or an orphan 403, someone else\'s club 403', async () => {
    scenario.pro = true;
    scenario.event = { type: 'group', parent_club_id: null };
    expect((await attach(11)).body.code).toBe('NOT_CLUB_MANAGER');
    scenario.event = { type: 'event', parent_club_id: null };
    expect((await attach(11)).body.code).toBe('NOT_CLUB_MANAGER');
    scenario.event = { type: 'event', parent_club_id: 7 };
    scenario.access = { ...CLUB, is_manager: false };
    expect((await attach(null)).body.code).toBe('NOT_CLUB_MANAGER');
    scenario.access = { ...CLUB, club_type: 'community' };
    expect((await attach(null)).body.code).toBe('OFFICIAL_CLUB_REQUIRED');
    expect(linkWrites()).toHaveLength(0);
  });

  it('a deal JAMIE hung there stays: neither replaced nor taken off by the club (409)', async () => {
    scenario.pro = true;
    scenario.currentLink = { club_id: null };
    const replace = await attach(11);
    expect(replace.statusCode).toBe(409);
    expect(replace.body.code).toBe('DEAL_SET_BY_JAMIE');
    expect((await attach(null)).statusCode).toBe(409);
    scenario.currentLink = { club_id: 7 };          // the club's own: theirs to change
    expect((await attach(12)).statusCode).toBe(200);
    expect((await attach(null)).statusCode).toBe(200);
    expect(linkWrites()).toHaveLength(2);
  });

  // Review 16.11.2026: the check above is a SELECT of its own — a deal JAMIE
  // hung on the event between it and the write was replaced or taken off.
  // The club's writes carry the condition themselves.
  it('JAMIE hangs a deal on between the check and the write: the club\'s write leaves it there (409)', async () => {
    scenario.pro = true;
    scenario.linkAtWrite = { club_id: null };       // none at the check, JAMIE's at the write
    const replace = await attach(11);
    expect(replace.statusCode).toBe(409);
    expect(replace.body.code).toBe('DEAL_SET_BY_JAMIE');
    const upsert = linkWrites()[0];
    expect(upsert.text).toMatch(
      /ON CONFLICT \(group_id\) DO UPDATE[\s\S]+WHERE EXISTS \(SELECT 1 FROM deals d WHERE d\.id = event_deals\.deal_id AND d\.club_id = \$4\)/);
    expect(upsert.params).toEqual([90, 11, 5, 7]);
    // taking it off: the club's own at the check, JAMIE's at the write
    scenario.currentLink = { club_id: 7 };
    const off = await attach(null);
    expect(off.statusCode).toBe(409);
    expect(off.body.code).toBe('DEAL_SET_BY_JAMIE');
    const del = linkWrites()[1];
    expect(del.text).toMatch(/^DELETE FROM event_deals ed USING deals d\s+WHERE ed\.group_id = \$1 AND d\.id = ed\.deal_id AND d\.club_id = \$2$/);
    expect(del.params).toEqual([90, 7]);
    expect(scenario.currentLink).toEqual({ club_id: null });   // JAMIE's is still there
  });

  it('nothing on the event: taking it off stays a no-op that succeeds', async () => {
    const off = await attach(null);
    expect(off.statusCode).toBe(200);
    expect(off.body).toEqual({ group_id: 90, deal_id: null, deal: null });
    expect(linkWrites()).toHaveLength(1);
  });

  it('an app admin keeps the old path: any deal, any event, no club gate', async () => {
    scenario.isAdmin = true;
    scenario.event = { type: 'group', parent_club_id: null };
    scenario.currentLink = { club_id: 8 };
    const res = await attach(11);
    expect(res.statusCode).toBe(200);
    expect(queries.some((q) => q.text.includes('AS caller_is_admin'))).toBe(false);
    expect(queries.some((q) => q.text.startsWith('SELECT d.club_id FROM event_deals'))).toBe(false);
    expect(proMock).not.toHaveBeenCalled();
    // …and its writes take whatever hangs there: no club condition
    expect(linkWrites()[0].text).not.toContain('WHERE EXISTS');
    expect(linkWrites()[0].params).toEqual([90, 11, 5]);
    expect((await attach(null)).statusCode).toBe(200);
    expect(linkWrites()[1].text).toBe('DELETE FROM event_deals WHERE group_id = $1');
    expect(linkWrites()[1].params).toEqual([90]);
  });

  it('no session: 401 before anything is read', async () => {
    const res = await run(setEventDeal, { userId: 0, params: { groupId: '90' }, body: { deal_id: 11 } });
    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });
});

describe('redeemDeal — a club deal whose club went dark (P4 v2)', () => {
  it('404 before any transaction: not shown anywhere, not redeemable either', async () => {
    scenario.liveRows = [];
    const res = await run(redeemDeal, { params: { id: '11' } });
    expect(res.statusCode).toBe(404);
    const q = queries.find((x) => x.text.startsWith('SELECT 1 FROM deals d WHERE d.id = $1'));
    expect(q.params).toEqual(['11']);
    expect(q.text).toContain("c.club_type = 'official'");
    expect(q.text).toContain('d.club_id IS NULL OR EXISTS');
  });

  it('boot window (42703, no deals.club_id yet): the same check without the club condition', async () => {
    scenario.liveRows = [];
    scenario.liveFail = Object.assign(new Error('column d.club_id does not exist'), { code: '42703' });
    const res = await run(redeemDeal, { params: { id: '11' } });
    expect(res.statusCode).toBe(404);
    const checks = queries.filter((x) => x.text.startsWith('SELECT 1 FROM deals d WHERE d.id = $1'));
    expect(checks).toHaveLength(2);
    expect(checks[1].text).toMatch(/AND TRUE$/);
  });
});
