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
  geo: { ok: true, coords: { lat: 48.21, lng: 16.37 } },
};
const queries = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
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
      if (text.startsWith('SELECT 1 FROM deals WHERE id = $1')) return { rows: [{}] };
      if (text.startsWith('SELECT d.club_id FROM event_deals')) return { rows: scenario.currentLink ? [scenario.currentLink] : [] };
      if (/^\s*(INSERT INTO|DELETE FROM) event_deals/.test(text)) return { rows: [], rowCount: 1 };
      if (text.includes('FROM event_deals ed\n         JOIN deals d')) return { rows: [] };
      if (text.includes('JOIN push_subscriptions')) return { rows: [{ id: 3 }] };
      throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
    }),
  },
}));
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
  getClubDeals, createClubDeal, updateClubDeal, deleteClubDeal, setEventDeal, CLUB_DEAL_MAX_DAYS,
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
    currentLink: null, geo: { ok: true, coords: { lat: 48.21, lng: 16.37 } },
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
    for (const visible_until of [undefined, null, '', 'kein Datum', day(-1), day(0), day(CLUB_DEAL_MAX_DAYS + 3)]) {
      const res = await create(body({ visible_until }));
      expect(res.statusCode, String(visible_until)).toBe(400);
    }
    expect((await create(body({ visible_until: day(1) }))).statusCode).toBe(201);
    expect((await create(body({ visible_until: day(CLUB_DEAL_MAX_DAYS) }))).statusCode).toBe(201);
    expect(inserts()).toHaveLength(2);
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

  it('before the deals.club_id migration (42703): 503, not 500', async () => {
    const db = (await import('../../src/config/database.js')).default;
    db.query.mockImplementationOnce(async () => ({ rows: [scenario.access] }))
      .mockImplementationOnce(async () => { throw Object.assign(new Error('column "club_id" does not exist'), { code: '42703' }); });
    const res = await create(body());
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CLUB_DEALS_UNAVAILABLE');
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
    expect(linkWrites()[0].params).toEqual([90, 11, 5]);
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

  it('an app admin keeps the old path: any deal, any event, no club gate', async () => {
    scenario.isAdmin = true;
    scenario.event = { type: 'group', parent_club_id: null };
    const res = await attach(11);
    expect(res.statusCode).toBe(200);
    expect(queries.some((q) => q.text.includes('AS caller_is_admin'))).toBe(false);
    expect(queries.some((q) => q.text.startsWith('SELECT d.club_id FROM event_deals'))).toBe(false);
    expect(proMock).not.toHaveBeenCalled();
  });

  it('no session: 401 before anything is read', async () => {
    const res = await run(setEventDeal, { userId: 0, params: { groupId: '90' }, body: { deal_id: 11 } });
    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0);
  });
});
