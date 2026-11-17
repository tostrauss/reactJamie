import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The partner model's own endpoints (Tina's document of 17.11.2026). The
// real-Postgres smoke suite runs them against real rows; this pins who gets
// an answer, its shape, and that a GET here never answers 5xx (the app
// retries those and counts them against its circuit breaker).
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));

const db = (await import('../../src/config/database.js')).default;
const { getEventQuota } = await import('../../src/controllers/partnerController.js');

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
