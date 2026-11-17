import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The partner model's own endpoints (Tina's document of 17.11.2026). The
// real-Postgres smoke suite runs them against real rows; this pins who gets
// an answer, its shape, and that a GET here never answers 5xx (the app
// retries those and counts them against its circuit breaker).
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToAdmins: vi.fn(async () => {}) }));
vi.mock('../../src/utils/email.js', () => ({ sendPartnerLeadEmail: vi.fn(async () => {}) }));

const db = (await import('../../src/config/database.js')).default;
const { sendPushToAdmins } = await import('../../src/controllers/pushController.js');
const { sendPartnerLeadEmail } = await import('../../src/utils/email.js');
const {
  getEventQuota, requestPartner, getPartnerLeadsAdmin, parsePartnerLead,
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
