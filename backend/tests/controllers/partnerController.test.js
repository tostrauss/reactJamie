import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The partner model's own endpoints (Tina's document of 17.11.2026). The
// real-Postgres smoke suite runs them against real rows; this pins who gets
// an answer, its shape, and that a GET here never answers 5xx (the app
// retries those and counts them against its circuit breaker).
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// One query mock for the pool and for a client checked out of it (the deal
// endpoints write in a transaction).
vi.mock('../../src/config/database.js', () => {
  const query = vi.fn();
  return { default: { query, pool: { connect: async () => ({ query, release: () => {} }) } } };
});
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToAdmins: vi.fn(async () => {}), sendPushToUsers: vi.fn(async () => {}),
}));
vi.mock('../../src/utils/email.js', () => ({ sendPartnerLeadEmail: vi.fn(async () => {}) }));
// What the deal fields go through (dealController.parseClubDealBody): the
// real checks run in the smoke suite.
vi.mock('../../src/utils/geocode.js', () => ({ resolveCreateLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.37 } })) }));
vi.mock('../../src/config/moderation.js', () => ({
  checkTextSafety: vi.fn(async (text) => (text.includes('Hurensohn')
    ? { safe: false, reason: 'Dein Text enthält unangemessene Inhalte.' } : { safe: true, reason: null })),
}));
vi.mock('../../src/utils/safeUrl.js', () => ({ checkImageField: () => null }));

const db = (await import('../../src/config/database.js')).default;
const { sendPushToAdmins } = await import('../../src/controllers/pushController.js');
const { sendPartnerLeadEmail } = await import('../../src/utils/email.js');
const {
  getEventQuota, requestPartner, getPartnerLeadsAdmin, parsePartnerLead,
  getEventExtras, saveEventDeal, removeEventDeal,
} = await import('../../src/controllers/partnerController.js');

const run = async (fn, req) => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  await fn({ userId: 3, params: {}, query: {}, body: {}, ...req }, res);
  return res;
};

const CLUB = {
  id: 7, name: 'Café Soleá', owner_id: 3, club_type: 'official', is_paid_partner: false, caller_is_admin: false,
};
// Routes db.query by what it asks for.
const answer = ({ club = CLUB, role = 'owner', counted = { started: true, used: 0, upcoming: 0 } } = {}) => {
  vi.mocked(db.query).mockImplementation(async (sql) => {
    if (/FROM groups c/.test(sql)) return { rows: club ? [club] : [] };
    if (/FROM group_members/.test(sql)) return { rows: role ? [{ role }] : [] };
    if (/one_shot_migrations/.test(sql)) return { rows: [counted] };
    throw new Error(`unexpected query: ${sql}`);
  });
};

let errorLog;
beforeEach(() => {
  vi.mocked(db.query).mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  delete process.env.CLUB_FREE_TIER;
});

describe('GET /api/clubs/:id/event-quota', () => {
  const quota = (over = {}) => run(getEventQuota, { params: { id: '7' }, ...over });

  it('a limited club with one event ahead: block concurrent, no ticket link', async () => {
    answer({ counted: { started: true, used: 1, upcoming: 1 } });
    const res = await quota();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      club_id: 7, club_name: 'Café Soleá', limited: true, free_events: 2,
      used: 1, upcoming: 1, block: 'concurrent', ticket_allowed: false, is_manager: true,
    });
  });

  it('two used: block third', async () => {
    answer({ counted: { started: true, used: 2, upcoming: 0 } });
    expect((await quota()).body).toMatchObject({ limited: true, used: 2, upcoming: 0, block: 'third' });
  });

  it('nothing used yet: limited, but free to go — tickets stay a partner’s', async () => {
    answer();
    expect((await quota()).body).toMatchObject({ limited: true, used: 0, block: null, ticket_allowed: false });
  });

  it('a paying partner: not limited, ticket links allowed', async () => {
    answer({ club: { ...CLUB, is_paid_partner: true }, counted: { started: true, used: 5, upcoming: 3 } });
    expect((await quota()).body).toMatchObject({ limited: false, block: null, ticket_allowed: true });
  });

  it('a community: not limited, nothing counted', async () => {
    answer({ club: { ...CLUB, club_type: 'community' } });
    const res = await quota();
    expect(res.body).toEqual({
      club_id: 7, club_name: 'Café Soleá', limited: false, free_events: 2,
      used: 0, upcoming: 0, block: null, ticket_allowed: true, is_manager: true,
    });
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => /one_shot_migrations/.test(sql))).toBe(false);
  });

  it('is_manager: the owner and a co-manager, not a plain member', async () => {
    answer({ club: { ...CLUB, owner_id: 99 }, role: 'admin' });
    expect((await quota()).body.is_manager).toBe(true);
    answer({ club: { ...CLUB, owner_id: 99 }, role: 'member' });
    const member = await quota();
    expect(member.statusCode).toBe(200);
    expect(member.body.is_manager).toBe(false);
  });

  it('an outsider gets 403 NOT_MEMBER — an app admin gets the answer', async () => {
    answer({ club: { ...CLUB, owner_id: 99 }, role: null });
    const res = await quota();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('NOT_MEMBER');
    expect(typeof res.body.error).toBe('string');

    answer({ club: { ...CLUB, owner_id: 99, caller_is_admin: true }, role: null });
    const admin = await quota();
    expect(admin.statusCode).toBe(200);
    expect(admin.body).toMatchObject({ limited: false, is_manager: false });
  });

  it('no such club, or an id that is no number: 404 without a query that could fail on a cast', async () => {
    answer({ club: null });
    expect((await quota()).statusCode).toBe(404);
    vi.mocked(db.query).mockClear();
    for (const id of ['featured', '7; DROP', '-1', '0', '99999999999']) {
      expect((await quota({ params: { id } })).statusCode).toBe(404);
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it('nobody logged in: 401', async () => {
    expect((await quota({ userId: undefined })).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('CLUB_FREE_TIER=false: not limited', async () => {
    process.env.CLUB_FREE_TIER = 'false';
    answer({ counted: { started: true, used: 2, upcoming: 1 } });
    expect((await quota()).body).toMatchObject({ limited: false, block: null, ticket_allowed: true });
  });

  it('never a 5xx: a database error reads as not limited', async () => {
    vi.mocked(db.query).mockImplementation(async () => { throw Object.assign(new Error('connection lost'), { code: '57P01' }); });
    const res = await quota();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      club_id: 7, club_name: '', limited: false, free_events: 2,
      used: 0, upcoming: 0, block: null, ticket_allowed: true, is_manager: false, unavailable: true,
    });
    expect(errorLog).toHaveBeenCalled();
  });

  it('a missing table in the boot window: 200, not limited', async () => {
    vi.mocked(db.query).mockImplementation(async (sql) => {
      if (/FROM groups c/.test(sql)) return { rows: [CLUB] };
      if (/FROM group_members/.test(sql)) return { rows: [{ role: 'owner' }] };
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    });
    const res = await quota();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ club_name: 'Café Soleá', limited: false, block: null, is_manager: true });
    expect(res.body.unavailable).toBeUndefined();
  });
});

// „Ja, meldet euch!“ → the form „JAMIE Anfrage“ (Tina 17.11.2026): name,
// company (optional), e-mail, phone, the mail/call switch, the privacy tick.
describe('POST /api/clubs/:id/partner-request', () => {
  const FORM = {
    name: 'Tina Muster', company: 'Café Soleá', email: 'tina@solea.at', phone: '+43 660 1234567',
    contact: 'mail', privacy: true, reason: 'third',
  };
  // Lets the fire-and-forget mail import and push run.
  const settle = () => new Promise((r) => setTimeout(r, 20));
  // owner_id 3 = the caller. `managerRow`: whether a co-manager row is found.
  const club = ({ ownerId = 3, admin = false, managerRow = false, stored = 1 } = {}) => {
    vi.mocked(db.query).mockImplementation(async (sql) => {
      if (/FROM groups c/.test(sql)) return { rows: [{ ...CLUB, owner_id: ownerId, caller_is_admin: admin }] };
      if (/FROM group_members/.test(sql)) return { rows: managerRow ? [{}] : [] };
      if (/INSERT INTO partner_leads/.test(sql)) {
        return stored
          ? { rowCount: 1, rows: [{ id: 11, created_at: new Date('2026-11-17T09:00:00Z') }] }
          : { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
  };
  const send = (body = FORM, over = {}) => run(requestPartner, { params: { id: '7' }, body, ...over });
  const inserts = () => vi.mocked(db.query).mock.calls.filter(([sql]) => /INSERT INTO partner_leads/.test(sql));

  let log;
  beforeEach(() => {
    vi.mocked(sendPushToAdmins).mockClear();
    vi.mocked(sendPartnerLeadEmail).mockClear();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
    delete process.env.PARTNER_LEADS_NOTIFY;
  });

  it('the owner’s request is stored, mailed to the office and pushed to the admins', async () => {
    club();
    const res = await send();
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ ok: true });

    const [sql, params] = inserts()[0];
    expect(params).toEqual([7, 3, 'third', 'Tina Muster', 'Café Soleá', 'tina@solea.at', '+43 660 1234567', 'mail']);
    expect(sql).toContain('privacy_accepted_at');
    expect(sql).toContain("created_at > NOW() - INTERVAL '24 hours'");   // one per club and person a day
    expect(sql).toContain('WHERE NOT EXISTS');

    await settle();
    expect(sendPushToAdmins).toHaveBeenCalledTimes(1);
    const [builder, body, url] = vi.mocked(sendPushToAdmins).mock.calls[0];
    expect(url).toBe('/admin#partner-leads');
    expect(body).toBeNull();
    expect(builder('de')).toEqual({ title: 'Neue Partner-Anfrage 🤝', body: '"Café Soleá" möchte JAMIE Partner werden' });
    expect(sendPartnerLeadEmail).toHaveBeenCalledTimes(1);
    const [lead, mailClub] = vi.mocked(sendPartnerLeadEmail).mock.calls[0];
    expect(lead).toMatchObject({ id: 11, user_id: 3, source: 'third', name: 'Tina Muster', contact: 'mail' });
    expect(mailClub).toEqual({ id: 7, name: 'Café Soleá' });
  });

  it('a co-manager and an app admin may send it too, a plain member or outsider may not', async () => {
    club({ ownerId: 99, managerRow: true });
    expect((await send()).statusCode).toBe(201);
    club({ ownerId: 99, admin: true });
    expect((await send()).statusCode).toBe(201);

    club({ ownerId: 99 });
    const res = await send();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('NOT_CLUB_MANAGER');
    await settle();
    // only the two that went through wrote and pushed
    expect(inserts()).toHaveLength(2);
    expect(sendPushToAdmins).toHaveBeenCalledTimes(2);
  });

  it('a second request within 24 hours answers like a success — nothing written, mailed or pushed', async () => {
    club({ stored: 0 });
    const res = await send();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: true });
    await settle();
    expect(sendPushToAdmins).not.toHaveBeenCalled();
    expect(sendPartnerLeadEmail).not.toHaveBeenCalled();
  });

  it('PARTNER_LEADS_NOTIFY=false: stored, but no mail and no push', async () => {
    process.env.PARTNER_LEADS_NOTIFY = 'false';
    club();
    const res = await send();
    expect(res.statusCode).toBe(201);
    expect(inserts()).toHaveLength(1);
    await settle();
    expect(sendPushToAdmins).not.toHaveBeenCalled();
    expect(sendPartnerLeadEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['name', { name: '' }],
    ['name', { name: '   ' }],
    ['name', { name: 'x'.repeat(101) }],
    ['name', { name: 42 }],
    ['company', { company: 'x'.repeat(151) }],
    ['contact', { contact: 'sms' }],
    ['contact', { contact: undefined }],
    ['email', { email: '' }],                                   // by mail: the e-mail is required
    ['email', { email: 'tina@solea' }],
    ['email', { email: 'tina solea@x.at' }],
    ['email', { email: `${'x'.repeat(250)}@x.at` }],
    ['email', { contact: 'call', email: 'kein-at' }],           // optional by call, but if given: valid
    ['phone', { contact: 'call', phone: '' }],                  // by call: the phone is required
    ['phone', { contact: 'call', phone: '12345' }],
    ['phone', { phone: 'ruf mich an' }],                        // optional by mail, but if given: valid
    ['phone', { phone: `+43 ${'1'.repeat(40)}` }],
    ['privacy', { privacy: false }],
    ['privacy', { privacy: 'true' }],
    ['privacy', { privacy: undefined }],
    ['reason', { reason: 'other' }],
    ['reason', { reason: undefined }],
  ])('400 LEAD_INVALID for %s: %j — nothing written', async (field, over) => {
    club();
    const res = await send({ ...FORM, ...over });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'LEAD_INVALID', field });
    expect(res.body.error.length).toBeGreaterThan(5);
    await settle();
    expect(inserts()).toHaveLength(0);
    expect(sendPushToAdmins).not.toHaveBeenCalled();
  });

  it('by call the e-mail may stay empty, by mail the phone — empty values are stored as NULL', async () => {
    expect(parsePartnerLead({ ...FORM, contact: 'call', email: '' }).lead)
      .toMatchObject({ contact: 'call', email: null, phone: '+43 660 1234567' });
    expect(parsePartnerLead({ ...FORM, phone: '', company: '  ' }).lead)
      .toMatchObject({ contact: 'mail', phone: null, company: null });
    // all four reasons, both ways of contact
    for (const reason of ['concurrent', 'third', 'ticket', 'deal']) {
      expect(parsePartnerLead({ ...FORM, reason }).lead.source).toBe(reason);
    }
  });

  it('free text is stored trimmed and in one line', async () => {
    const { lead } = parsePartnerLead({ ...FORM, name: '  Tina\n Muster  ', company: 'Café\r\nSoleá', email: '  tina@solea.at ' });
    expect(lead).toMatchObject({ name: 'Tina Muster', company: 'Café Soleá', email: 'tina@solea.at' });
    expect(parsePartnerLead(null).invalid.field).toBe('name');
  });

  it('no such club 404, an id that is no number 404, nobody logged in 401', async () => {
    vi.mocked(db.query).mockImplementation(async () => ({ rows: [] }));
    expect((await send()).statusCode).toBe(404);
    vi.mocked(db.query).mockClear();
    expect((await send(FORM, { params: { id: 'abc' } })).statusCode).toBe(404);
    expect((await send(FORM, { userId: undefined })).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('the table is not there yet (boot window): 503 PARTNER_UNAVAILABLE with a sentence', async () => {
    vi.mocked(db.query).mockImplementation(async (sql) => {
      if (/FROM groups c/.test(sql)) return { rows: [CLUB] };
      throw Object.assign(new Error('relation "partner_leads" does not exist'), { code: '42P01' });
    });
    const res = await send();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    expect(res.body.error).toContain('gleich wieder verfügbar');
    await settle();
    expect(sendPushToAdmins).not.toHaveBeenCalled();
  });

  it('a failing mail or push never reaches the caller', async () => {
    club();
    vi.mocked(sendPartnerLeadEmail).mockRejectedValueOnce(new Error('resend down'));
    vi.mocked(sendPushToAdmins).mockRejectedValueOnce(new Error('push down'));
    const res = await send();
    expect(res.statusCode).toBe(201);
    await settle();
    expect(errorLog).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/admin/partner-leads', () => {
  it('lists the requests newest first, with club and person — or null once they are gone', async () => {
    const at = new Date('2026-11-17T09:00:00Z');
    vi.mocked(db.query).mockResolvedValue({ rows: [
      { id: 2, created_at: at, source: 'third', name: 'Tina', company: 'Café', email: 't@x.at', phone: null, contact: 'mail',
        club_id: 7, club_name: 'Café Soleá', user_id: 3, user_name: 'Tina M.' },
      { id: 1, created_at: at, source: 'ticket', name: 'Max', company: null, email: null, phone: '+43 1 234567', contact: 'call',
        club_id: null, club_name: null, user_id: null, user_name: null },
    ] });
    const res = await run(getPartnerLeadsAdmin, {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { id: 2, created_at: at, source: 'third', name: 'Tina', company: 'Café', email: 't@x.at', phone: null, contact: 'mail',
        club: { id: 7, name: 'Café Soleá' }, user: { id: 3, name: 'Tina M.' } },
      { id: 1, created_at: at, source: 'ticket', name: 'Max', company: null, email: null, phone: '+43 1 234567', contact: 'call',
        club: null, user: null },
    ]);
    const sql = vi.mocked(db.query).mock.calls[0][0];
    expect(sql).toContain('ORDER BY l.created_at DESC');
    expect(sql).toContain('LIMIT 200');
    expect(sql).toContain('LEFT JOIN groups g');
    expect(sql).toContain('LEFT JOIN users u');
  });

  it.each(['42P01', '57P01'])('never a 5xx: error %s reads as an empty list', async (code) => {
    vi.mocked(db.query).mockImplementation(async () => { throw Object.assign(new Error('nope'), { code }); });
    const res = await run(getPartnerLeadsAdmin, {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// „Man kann nur einen Deal pro Event anlegen“ (Tina 17.11.2026): the event's
// one deal on its edit page. Queries are dispatched on their text; `w` is the
// world each test sets up. The real SQL runs in the smoke suite.
describe('the deal of one event: /api/clubs/:id/events/:eventId/…', () => {
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const DEAL = {
    id: 42, club_id: 7, is_active: true, name: 'Café Soleá', deal_label: '1 Punsch gratis', description: null,
    address: 'Wien', booking_url: null, photos: [], visible_until: '2026-12-31T22:59:59.000Z',
    max_redemptions: 100, redeem_interval: 'once', redeem_days: null,
  };
  const FIELDS = { name: 'Café Soleá', deal_label: '1 Punsch gratis', visible_until: day(30) };
  let w;
  let sql;   // every query text, in order
  const world = (over = {}) => {
    w = {
      club: { ...CLUB, is_live: true, location: 'Wien', lat: 48.2, lng: 16.37 },   // loadClubForQuota + the gate row
      manager: true,           // the gate's is_manager / a co-manager row
      eventExists: true,       // a live event of this club
      linked: null,            // the deal on the event now (LINKED_DEAL_SQL)
      shown: null,             // what the event page shows (getDealsForEvents)
      counted: { started: true, used: 1, upcoming: 1 },
      rank: { counted: true, before: 0 },
      linkWritable: true,      // false: JAMIE's deal is there at the write
      removed: 1,
      otherLink: false,        // a deal that is not the club's hangs there
      auto: null,              // the switch „Automatisierte Nachrichten“: true | false | null (no row)
      fail: null,              // { on: /regex/, err }
      ...over,
    };
    sql = [];
    vi.mocked(db.query).mockImplementation(async (text) => {
      sql.push(text);
      if (w.fail && w.fail.on.test(text)) throw w.fail.err;
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
      if (text.includes('AS is_manager')) return { rows: w.club ? [{ ...w.club, is_manager: w.manager }] : [] };
      if (text.includes('c.events_owner_only')) return { rows: w.club ? [w.club] : [] };
      if (text.includes("role = 'admin'") && text.startsWith('SELECT 1 FROM group_members')) return { rows: w.manager ? [{}] : [] };
      if (text.startsWith('SELECT 1 FROM groups WHERE id = $1 AND parent_club_id = $2')) return { rows: w.eventExists ? [{}] : [] };
      if (text.includes('AS started')) return { rows: [w.counted] };
      if (text.includes('AS counted')) return { rows: w.eventExists && w.rank ? [w.rank] : [] };
      if (text.includes('AS verified')) return { rows: w.shown ? [{ group_id: 9, ...w.shown }] : [] };
      if (text.includes('FROM club_event_auto_messages')) return { rows: w.auto === null ? [] : [{ enabled: w.auto }] };
      if (text.includes('d.booking_url') && text.includes('WHERE ed.group_id = $1')) return { rows: w.linked ? [w.linked] : [] };
      if (text.startsWith('INSERT INTO deals')) return { rows: [{ ...DEAL, id: 43 }] };
      if (text.startsWith('UPDATE deals SET')) return { rows: [{ ...DEAL, deal_label: 'neu' }] };
      if (text.includes('INSERT INTO event_deals')) return w.linkWritable ? { rows: [{ group_id: 9 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      if (text.includes('WITH off AS')) return { rows: [{ removed: w.removed, retired: w.removed }] };
      if (text.startsWith('SELECT 1 FROM event_deals WHERE group_id = $1')) return { rows: w.otherLink ? [{}] : [] };
      throw new Error(`unexpected query: ${text.slice(0, 90)}`);
    });
  };
  const at = (fn, over = {}) => run(fn, { params: { id: '7', eventId: '9' }, ...over });
  const wrote = () => sql.some((t) => /^(INSERT INTO deals|UPDATE deals SET)/.test(t) || t.includes('INSERT INTO event_deals'));
  const ownerOnly = { owner_id: 99 };   // the caller (3) does not own the club

  let log;
  beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { log.mockRestore(); delete process.env.CLUB_FREE_TIER; });

  describe('GET …/extras', () => {
    it('the club\'s own deal with every field its form edits, what the page shows, and that it may be edited', async () => {
      world({ linked: DEAL, shown: { id: 42, name: 'Café Soleá', deal_label: '1 Punsch gratis', photo: null, verified: false } });
      const res = await at(getEventExtras);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        is_official: true, club_name: 'Café Soleá', auto_messages: false,
        deal: {
          id: 42, name: 'Café Soleá', deal_label: '1 Punsch gratis', description: null, address: 'Wien', booking_url: null,
          photos: [], visible_until: '2026-12-31T22:59:59.000Z', max_redemptions: 100, redeem_interval: 'once', redeem_days: null,
        },
        deal_shown: { id: 42, name: 'Café Soleá', deal_label: '1 Punsch gratis', photo: null, verified: false },
        jamie_deal: null, deal_allowed: true,
      });
    });

    it('nothing on the event: both null — and a deal may be put up on one of the first two events', async () => {
      world({ rank: { counted: true, before: 1 } });
      expect((await at(getEventExtras)).body).toMatchObject({ deal: null, deal_shown: null, jamie_deal: null, deal_allowed: true });
    });

    it('a deal that is not the club\'s is named, not handed out; a deleted own one reads as none', async () => {
      world({ linked: { ...DEAL, club_id: null, name: 'JAMIE Punsch' } });
      expect((await at(getEventExtras)).body).toMatchObject({ deal: null, jamie_deal: { name: 'JAMIE Punsch' } });
      world({ linked: { ...DEAL, club_id: 8, name: 'Fremder Club' } });
      expect((await at(getEventExtras)).body).toMatchObject({ deal: null, jamie_deal: { name: 'Fremder Club' } });
      world({ linked: { ...DEAL, is_active: false } });
      expect((await at(getEventExtras)).body).toMatchObject({ deal: null, jamie_deal: null });
    });

    it('deal_allowed: not from the third event on, not for an event from before the deploy — a paying partner always', async () => {
      world({ rank: { counted: true, before: 2 } });
      expect((await at(getEventExtras)).body.deal_allowed).toBe(false);
      world({ rank: { counted: false, before: 0 } });
      expect((await at(getEventExtras)).body.deal_allowed).toBe(false);
      world({ rank: { counted: true, before: 5 }, club: { ...CLUB, is_live: true, is_paid_partner: true } });
      expect((await at(getEventExtras)).body.deal_allowed).toBe(true);
      world({ rank: { counted: true, before: 5 } });
      process.env.CLUB_FREE_TIER = 'false';
      expect((await at(getEventExtras)).body.deal_allowed).toBe(true);
    });

    // „Automatisierte Nachrichten“ (Tina 17.11.2026): the edit page shows the
    // switch as it is stored.
    it('auto_messages mirrors the switch of the event: on, off, never set', async () => {
      world({ auto: true });
      expect((await at(getEventExtras)).body.auto_messages).toBe(true);
      world({ auto: false });
      expect((await at(getEventExtras)).body.auto_messages).toBe(false);
      world();
      expect((await at(getEventExtras)).body.auto_messages).toBe(false);
    });

    it('the table of the switch is not there yet: off — and everything else of the answer as always', async () => {
      world({
        linked: DEAL,
        fail: { on: /FROM club_event_auto_messages/, err: Object.assign(new Error('relation does not exist'), { code: '42P01' }) },
      });
      const res = await at(getEventExtras);
      expect(res.statusCode).toBe(200);
      expect(res.body.auto_messages).toBe(false);
      expect(res.body.unavailable).toBeUndefined();
      expect(res.body.deal.id).toBe(42);
      expect(res.body.deal_allowed).toBe(true);
    });

    it('a community, or a club that is not live: no deals', async () => {
      world({ club: { ...CLUB, club_type: 'community', is_live: true } });
      expect((await at(getEventExtras)).body).toMatchObject({ is_official: false, deal_allowed: false });
      world({ club: { ...CLUB, is_live: false } });
      expect((await at(getEventExtras)).body).toMatchObject({ is_official: true, deal_allowed: false });
    });

    it('only for the people who run the club: a plain member 403, an app admin gets it', async () => {
      world({ club: { ...CLUB, ...ownerOnly, is_live: true }, manager: false });
      const res = await at(getEventExtras);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('NOT_CLUB_MANAGER');
      world({ club: { ...CLUB, ...ownerOnly, is_live: true, caller_is_admin: true }, manager: false });
      expect((await at(getEventExtras)).statusCode).toBe(200);
      world({ club: { ...CLUB, ...ownerOnly, is_live: true }, manager: true });   // a co-manager
      expect((await at(getEventExtras)).statusCode).toBe(200);
    });

    it('an event of another club, a club that does not exist, ids that are no numbers: 404', async () => {
      world({ eventExists: false });
      expect((await at(getEventExtras)).statusCode).toBe(404);
      world({ club: null });
      expect((await at(getEventExtras)).statusCode).toBe(404);
      world();
      expect((await at(getEventExtras, { params: { id: '7', eventId: 'x' } })).statusCode).toBe(404);
      expect((await at(getEventExtras, { params: { id: 'x', eventId: '9' } })).statusCode).toBe(404);
      expect(sql).toHaveLength(0);
      expect((await at(getEventExtras, { userId: undefined })).statusCode).toBe(401);
    });

    it.each(['42P01', '42703', '57P01'])('never a 5xx: error %s reads as nothing there, not available', async (code) => {
      world({ fail: { on: /d\.booking_url/, err: Object.assign(new Error('missing'), { code }) } });
      const res = await at(getEventExtras);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        is_official: true, club_name: 'Café Soleá', auto_messages: false,
        deal: null, deal_shown: null, jamie_deal: null, deal_allowed: false, unavailable: true,
      });
    });
  });

  describe('PUT …/deal', () => {
    it('nothing there yet: a new deal of the club is put up and hung on, in one transaction', async () => {
      world({ shown: { id: 43, name: 'Café Soleá', deal_label: '1 Punsch gratis', photo: null, verified: false } });
      const res = await at(saveEventDeal, { body: FIELDS });
      expect(res.statusCode).toBe(200);
      expect(res.body.deal).toMatchObject({ id: 43, name: 'Café Soleá', deal_label: '1 Punsch gratis' });
      expect(res.body.deal_shown).toEqual({ id: 43, name: 'Café Soleá', deal_label: '1 Punsch gratis', photo: null, verified: false });
      const order = sql.filter((t) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(t) || /^(INSERT INTO deals|UPDATE deals SET)/.test(t)
        || t.includes('INSERT INTO event_deals')).map((t) => t.split(/[\s(]/).slice(0, 3).join(' ').trim());
      expect(order).toEqual(['BEGIN', 'INSERT INTO deals', 'INSERT INTO event_deals', 'COMMIT']);
      const insert = vi.mocked(db.query).mock.calls.find(([t]) => t.startsWith('INSERT INTO deals'));
      const cols = insert[0].match(/INSERT INTO deals \(([^)]+)\)/)[1].split(', ');
      const row = Object.fromEntries(cols.map((c, i) => [c, insert[1][i]]));
      expect(row).toMatchObject({ name: 'Café Soleá', deal_label: '1 Punsch gratis', club_id: 7, created_by: 3 });
      const link = vi.mocked(db.query).mock.calls.find(([t]) => t.includes('INSERT INTO event_deals'));
      expect(link[1]).toEqual([9, 43, 3, 7]);
      expect(link[0]).toMatch(/WHERE EXISTS \(SELECT 1 FROM deals d WHERE d\.id = event_deals\.deal_id AND d\.club_id = \$4\)/);
    });

    it('the club\'s own deal is there: edited in place, only what was sent', async () => {
      world({ linked: DEAL });
      const res = await at(saveEventDeal, { body: { deal_label: ' neu ' } });
      expect(res.statusCode).toBe(200);
      expect(res.body.deal.deal_label).toBe('neu');
      const update = vi.mocked(db.query).mock.calls.find(([t]) => t.startsWith('UPDATE deals SET'));
      expect(update[0]).toMatch(/^UPDATE deals SET deal_label=\$1, updated_at=CURRENT_TIMESTAMP\s+WHERE id=\$2 AND club_id=\$3/);
      expect(update[1]).toEqual(['neu', 42, 7]);
      expect(sql.some((t) => t.startsWith('INSERT INTO deals'))).toBe(false);
      // an edit with nothing in it
      world({ linked: DEAL });
      expect((await at(saveEventDeal, { body: {} })).statusCode).toBe(400);
      expect(wrote()).toBe(false);
    });

    it('a deal the club deleted still hangs there, dark: a new one replaces it', async () => {
      world({ linked: { ...DEAL, is_active: false } });
      expect((await at(saveEventDeal, { body: FIELDS })).statusCode).toBe(200);
      expect(sql.some((t) => t.startsWith('INSERT INTO deals'))).toBe(true);
    });

    it('JAMIE\'s deal stays: 409 before anything is written — also when it lands between the look and the write', async () => {
      world({ linked: { ...DEAL, club_id: null } });
      const res = await at(saveEventDeal, { body: FIELDS });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('DEAL_SET_BY_JAMIE');
      expect(wrote()).toBe(false);

      world({ linkWritable: false });
      const raced = await at(saveEventDeal, { body: FIELDS });
      expect(raced.statusCode).toBe(409);
      expect(raced.body.code).toBe('DEAL_SET_BY_JAMIE');
      expect(sql).toContain('ROLLBACK');     // the deal written a moment before goes with it
      expect(sql).not.toContain('COMMIT');
    });

    it('from the club\'s third event on: 403 PARTNER_REQUIRED / deal, nothing written — a paying partner goes through', async () => {
      world({ rank: { counted: true, before: 2 } });
      const res = await at(saveEventDeal, { body: FIELDS });
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ code: 'PARTNER_REQUIRED', reason: 'deal', club_name: 'Café Soleá' });
      expect(wrote()).toBe(false);
      world({ rank: { counted: true, before: 2 }, club: { ...CLUB, is_live: true, is_paid_partner: true } });
      expect((await at(saveEventDeal, { body: FIELDS })).statusCode).toBe(200);
    });

    it('in this order: no club 404, not running it 403, a community, not live, no such event 404', async () => {
      world({ club: null });
      expect((await at(saveEventDeal, { body: FIELDS })).statusCode).toBe(404);
      world({ manager: false });
      expect((await at(saveEventDeal, { body: FIELDS })).body.code).toBe('NOT_CLUB_MANAGER');
      world({ manager: false, club: { ...CLUB, is_live: true, caller_is_admin: true } });   // an app admin may
      expect((await at(saveEventDeal, { body: FIELDS })).statusCode).toBe(200);
      world({ club: { ...CLUB, club_type: 'community', is_live: true } });
      expect((await at(saveEventDeal, { body: FIELDS })).body.code).toBe('OFFICIAL_CLUB_REQUIRED');
      world({ club: { ...CLUB, is_live: false } });
      expect((await at(saveEventDeal, { body: FIELDS })).body.code).toBe('CLUB_NOT_LIVE');
      world({ eventExists: false });
      const noEvent = await at(saveEventDeal, { body: FIELDS });
      expect(noEvent.statusCode).toBe(404);
      expect(noEvent.body.error).toBe('Veranstaltung nicht gefunden');
      expect(wrote()).toBe(false);
    });

    it('the fields are checked like every club deal: required, end date, moderation — nothing written', async () => {
      world();
      expect((await at(saveEventDeal, { body: { ...FIELDS, deal_label: '' } })).statusCode).toBe(400);
      expect((await at(saveEventDeal, { body: { ...FIELDS, visible_until: undefined } })).statusCode).toBe(400);
      expect((await at(saveEventDeal, { body: { ...FIELDS, visible_until: day(400) } })).statusCode).toBe(400);
      expect((await at(saveEventDeal, { body: { ...FIELDS, description: 'du Hurensohn' } })).statusCode).toBe(422);
      expect(wrote()).toBe(false);
      expect(sql).not.toContain('BEGIN');
    });

    it.each(['42P01', '42703'])('the deal tables are not there yet (%s): 503 CLUB_DEALS_UNAVAILABLE', async (code) => {
      world({ fail: { on: /d\.booking_url/, err: Object.assign(new Error('missing'), { code }) } });
      const res = await at(saveEventDeal, { body: FIELDS });
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('CLUB_DEALS_UNAVAILABLE');
    });

    it('bad ids 404, nobody logged in 401 — before any query', async () => {
      world();
      expect((await at(saveEventDeal, { params: { id: '7', eventId: '0' }, body: FIELDS })).statusCode).toBe(404);
      expect((await at(saveEventDeal, { userId: undefined, body: FIELDS })).statusCode).toBe(401);
      expect(sql).toHaveLength(0);
    });
  });

  describe('DELETE …/deal', () => {
    it('takes the club\'s own deal off and retires it when it hangs nowhere else — one statement, no payment check', async () => {
      world({ rank: { counted: true, before: 9 } });
      const res = await at(removeEventDeal);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      const call = vi.mocked(db.query).mock.calls.find(([t]) => t.includes('WITH off AS'));
      expect(call[1]).toEqual([9, 7]);
      expect(call[0]).toContain('d.club_id = $2');                       // only the club's own
      expect(call[0]).toContain('o.deal_id = deals.id AND o.group_id <> $1');   // …still on another event: it stays
      expect(sql.some((t) => t.includes('AS started') || t.includes('AS counted'))).toBe(false);
    });

    it('nothing on the event: a no-op that succeeds; JAMIE\'s deal: 409', async () => {
      world({ removed: 0 });
      expect((await at(removeEventDeal)).body).toEqual({ ok: true });
      world({ removed: 0, otherLink: true });
      const res = await at(removeEventDeal);
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('DEAL_SET_BY_JAMIE');
    });

    it('a community or a club that is not live can still take its deal down', async () => {
      world({ club: { ...CLUB, club_type: 'community', is_live: false } });
      expect((await at(removeEventDeal)).statusCode).toBe(200);
    });

    it('not running the club 403, another club\'s event 404, no club 404, no session 401', async () => {
      world({ club: { ...CLUB, ...ownerOnly, is_live: true }, manager: false });
      expect((await at(removeEventDeal)).body.code).toBe('NOT_CLUB_MANAGER');
      world({ eventExists: false });
      expect((await at(removeEventDeal)).statusCode).toBe(404);
      world({ club: null });
      expect((await at(removeEventDeal)).statusCode).toBe(404);
      expect(sql.some((t) => t.includes('WITH off AS'))).toBe(false);
      expect((await at(removeEventDeal, { userId: undefined })).statusCode).toBe(401);
    });

    it.each(['42P01', '42703'])('the deal tables are not there yet (%s): 503', async (code) => {
      world({ fail: { on: /WITH off AS/, err: Object.assign(new Error('missing'), { code }) } });
      const res = await at(removeEventDeal);
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('CLUB_DEALS_UNAVAILABLE');
    });
  });
});
