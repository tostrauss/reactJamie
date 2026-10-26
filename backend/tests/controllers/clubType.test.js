import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// The Community/Club split (Tina, 22.10.2026). What these tests pin down:
//  - who gets auto-approved and who waits for a moderator,
//  - that a client which does NOT send club_type (iOS 1.4.1) keeps today's
//    behaviour, because that is the whole reason the field is read explicitly,
//  - the ?club_type= filter, including the fail-open NULL side,
//  - that a boosted club still outranks the admin's curation (Pro sells it),
//  - the per-day cap on the auto-live path,
//  - the approval gates on getClubById / joinClub.
//
// db.query dispatches on SQL text; each test programs `scenario`.
const scenario = {
  isAdmin: false,
  createdWith: null,     // params the INSERT ran with
  queries: [],           // every SQL text, in order
  communityCount: 0,     // rows the 24h cap counts
  clubRow: null,         // row returned for a club lookup (getClubById/joinClub)
  isMember: false,
  textSafe: true,
};

const reset = () => {
  scenario.isAdmin = false;
  scenario.createdWith = null;
  scenario.queries = [];
  scenario.communityCount = 0;
  scenario.clubRow = null;
  scenario.isMember = false;
  scenario.textSafe = true;
};

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      scenario.queries.push(text);
      if (text.includes('SELECT is_admin FROM users')) {
        return { rows: [{ is_admin: scenario.isAdmin }] };
      }
      if (text.includes("COUNT(*)::int AS n FROM groups")) {
        return { rows: [{ n: scenario.communityCount }] };
      }
      if (text.includes('FROM group_members WHERE group_id')) {
        return { rows: scenario.isMember ? [{ role: 'member' }] : [] };
      }
      // getClubById's main SELECT and joinClub's lookup
      if (text.includes('FROM groups g') && text.includes('WHERE g.id = $1')) {
        return { rows: scenario.clubRow ? [scenario.clubRow] : [] };
      }
      if (text.includes('FROM groups\n        WHERE id = $1') || text.includes('FROM groups WHERE id = $1')) {
        return { rows: scenario.clubRow ? [scenario.clubRow] : [] };
      }
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));

vi.mock('../../src/config/sentry.js', () => ({ Sentry: {}, initSentry: vi.fn() }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/config/moderation.js', () => ({
  checkTextSafety: vi.fn(async () => ({ safe: scenario.textSafe, reason: 'nope' })),
  checkImageSafety: vi.fn(async () => ({ safe: true })),
}));
vi.mock('../../src/utils/geocode.js', () => ({
  geocodeLocation: vi.fn(async () => null),
  resolveCreateLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.3 } })),
}));
vi.mock('../../src/utils/systemMessage.js', async (importOriginal) => ({
  // The real SYSTEM_TEXTS (pure functions) — only the DB write is stubbed.
  SYSTEM_TEXTS: (await importOriginal()).SYSTEM_TEXTS,
  postSystemMessage: vi.fn(async () => {}),
}));
vi.mock('../../src/services/entityLifecycle.js', () => ({
  createEntityWithOwner: vi.fn(async (sql, params) => {
    scenario.createdWith = { sql, params };
    return { id: 99, name: params[0], approval_status: params[14], club_type: params[16] };
  }),
  notifyCancellationFanout: vi.fn(async () => {}),
}));
vi.mock('../../src/controllers/groupController.js', () => ({
  notifyJoinRequest: vi.fn(), notifyGroupJoin: vi.fn(), evictFromRoom: vi.fn(),
  creatorHasAvatar: vi.fn(async () => true), promoteFromWaitlist: vi.fn(),
  promoteWaitlistSeats: vi.fn(), formatEventWhen: vi.fn(() => ''),
}));
vi.mock('../../src/controllers/subscriptionController.js', () => ({ isUserPro: vi.fn(async () => false) }));
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUser: vi.fn(), sendPushToUsers: vi.fn(), sendPushToAdmins: vi.fn(),
}));
vi.mock('../../src/utils/cache.js', () => ({
  getCached: vi.fn(() => null), setCached: vi.fn(), invalidatePrefix: vi.fn(), deleteCached: vi.fn(),
}));

const { createClub, getClubs, getClubById, joinClub } = await import('../../src/controllers/clubController.js');
const { sendPushToAdmins } = await import('../../src/controllers/pushController.js');
const { postSystemMessage, SYSTEM_TEXTS } = await import('../../src/utils/systemMessage.js');

const mkRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const createWith = async (body) => {
  const res = mkRes();
  await createClub({ userId: 7, body: { name: 'Testclub', location: 'Wien', ...body } }, res);
  return res;
};

beforeEach(() => { reset(); vi.clearAllMocks(); });

describe('createClub — who needs approval', () => {
  it("club_type:'community' goes live immediately", async () => {
    const res = await createWith({ club_type: 'community' });
    expect(res.statusCode).toBe(201);
    expect(scenario.createdWith.params[14]).toBe('approved');
    expect(scenario.createdWith.params[16]).toBe('community');
    // No moderator is waiting for it, so no admin push either.
    expect(sendPushToAdmins).not.toHaveBeenCalled();
  });

  it("club_type:'official' waits for a moderator and pings the admins", async () => {
    const res = await createWith({ club_type: 'official' });
    expect(res.statusCode).toBe(201);
    expect(scenario.createdWith.params[14]).toBe('pending');
    expect(scenario.createdWith.params[16]).toBe('official');
    expect(sendPushToAdmins).toHaveBeenCalled();
  });

  // The reason club_type is read explicitly rather than defaulted: an old
  // bundle must not lose the moderation gate it was shipped with.
  it('a request WITHOUT club_type (iOS 1.4.1) still goes to the queue', async () => {
    const res = await createWith({});
    expect(res.statusCode).toBe(201);
    expect(scenario.createdWith.params[14]).toBe('pending');
    expect(scenario.createdWith.params[16]).toBe('community');
    expect(sendPushToAdmins).toHaveBeenCalled();
  });

  it('an unknown club_type is treated as "not sent", not as official', async () => {
    await createWith({ club_type: 'VEREIN' });
    expect(scenario.createdWith.params[14]).toBe('pending');
    expect(scenario.createdWith.params[16]).toBe('community');
  });

  it('an admin owner is auto-approved either way', async () => {
    scenario.isAdmin = true;
    await createWith({ club_type: 'official' });
    expect(scenario.createdWith.params[14]).toBe('approved');
  });
});

describe('createClub — welcome line', () => {
  it('greets the new chat with the one shared text (SYSTEM_TEXTS.welcomeClub)', async () => {
    const res = await createWith({ club_type: 'community' });
    expect(res.statusCode).toBe(201);
    expect(postSystemMessage).toHaveBeenCalledWith(99, SYSTEM_TEXTS.welcomeClub('Testclub'));
  });
});

describe('createClub — daily cap on the auto-live path', () => {
  it('refuses the 4th community in 24 h with 429', async () => {
    scenario.communityCount = 3;
    const res = await createWith({ club_type: 'community' });
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('COMMUNITY_DAILY_LIMIT');
    expect(scenario.createdWith).toBeNull();
  });

  it('allows the 3rd', async () => {
    scenario.communityCount = 2;
    const res = await createWith({ club_type: 'community' });
    expect(res.statusCode).toBe(201);
  });

  // Official clubs wait for a human anyway — capping them would only punish
  // the promoters the feature exists for.
  it('does not cap official clubs', async () => {
    scenario.communityCount = 99;
    const res = await createWith({ club_type: 'official' });
    expect(res.statusCode).toBe(201);
  });

  it('refuses BEFORE spending a text-moderation call', async () => {
    scenario.communityCount = 3;
    const { checkTextSafety } = await import('../../src/config/moderation.js');
    await createWith({ club_type: 'community' });
    expect(checkTextSafety).not.toHaveBeenCalled();
  });
});

describe('getClubs — segment filter', () => {
  const list = async (query) => {
    const res = mkRes();
    await getClubs({ query, userId: 0 }, res);
    return scenario.queries.find((q) => q.includes('FROM groups g')) || '';
  };

  it("?club_type=official filters on the official rows", async () => {
    const sql = await list({ club_type: 'official' });
    expect(sql).toContain("g.club_type = 'official'");
  });

  // NULL must read as community: a row the backfill has not reached (or one an
  // old replica inserted mid-deploy) stays discoverable.
  it('?club_type=community is NULL-safe', async () => {
    const sql = await list({ club_type: 'community' });
    expect(sql).toContain("g.club_type IS DISTINCT FROM 'official'");
  });

  it('no club_type param (old bundle) filters on neither', async () => {
    const sql = await list({});
    expect(sql).not.toContain('club_type');
  });

  it('an unknown club_type value does not filter either', async () => {
    const sql = await list({ club_type: 'bogus' });
    expect(sql).not.toContain('club_type');
  });

  // Pro SELLS position 1 ("Immer ganz oben in der Entdecken-Liste"), so the
  // admin's curation has to rank below a paid boost, not above it.
  it('boosted clubs outrank the admin-curated order', async () => {
    const sql = await list({ club_type: 'community' });
    // lastIndexOf: the member_previews subquery carries an ORDER BY of its own.
    const order = sql.slice(sql.lastIndexOf('ORDER BY'));
    expect(order.indexOf('is_boosted DESC')).toBeLessThan(order.indexOf('f.position'));
    expect(order).toContain('g.id DESC'); // total order for LIMIT/OFFSET paging
  });
});

describe('approval gates on the direct link', () => {
  it('getClubById hides a pending club from a guest', async () => {
    scenario.clubRow = { id: 5, owner_id: 1, approval_status: 'pending', is_active: true, deleted_at: null };
    const res = mkRes();
    await getClubById({ params: { id: '5' }, userId: null }, res);
    expect(res.statusCode).toBe(404);
  });

  it('getClubById shows a pending club to its owner', async () => {
    scenario.clubRow = { id: 5, owner_id: 7, approval_status: 'pending', is_active: true, deleted_at: null };
    const res = mkRes();
    await getClubById({ params: { id: '5' }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
  });

  it('getClubById keeps a rejected club readable for its members', async () => {
    scenario.clubRow = { id: 5, owner_id: 1, approval_status: 'rejected', is_active: false, deleted_at: null };
    scenario.isMember = true;
    const res = mkRes();
    await getClubById({ params: { id: '5' }, userId: 7 }, res);
    expect(res.statusCode).toBe(200);
  });

  it('getClubById 404s a soft-deleted club even for its owner', async () => {
    scenario.clubRow = { id: 5, owner_id: 7, approval_status: 'approved', is_active: true, deleted_at: '2026-10-01' };
    const res = mkRes();
    await getClubById({ params: { id: '5' }, userId: 7 }, res);
    expect(res.statusCode).toBe(404);
  });

  it('joinClub asks the database only for an approved, active club', async () => {
    scenario.clubRow = null; // the gated lookup finds nothing
    const res = mkRes();
    await joinClub({ params: { id: '5' }, userId: 7, body: {} }, res);
    expect(res.statusCode).toBe(404);
    const lookup = scenario.queries.find((q) => q.includes('is_private, owner_id, name FROM groups'));
    expect(lookup).toContain("approval_status = 'approved'");
    expect(lookup).toContain('is_active = TRUE');
  });
});
