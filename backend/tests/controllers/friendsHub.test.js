import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// The new Friends page (Tina, 17.11.2026): GET /api/friends/going („Wo gehen
// deine Freunde hin? 🎉“) and GET /api/friends/people („Leute, die du kennen
// könntest“). Their rules live in SQL — the real-Postgres smoke suite runs
// them against every edge case. Pinned here: what the JS around the SQL does
// (the caller's gates, the card's shape), the statements' contract, and that
// neither endpoint ever answers 5xx.
const scenario = { me: [{ age: null, country: null }], rows: [], failOn: null };
const queries = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      const isCaller = text.includes('FROM users WHERE id = $1') && !text.includes('friends:');
      if (scenario.failOn === 'all' || (scenario.failOn === 'caller' && isCaller)
        || (scenario.failOn === 'list' && !isCaller)) {
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      }
      return { rows: isCaller ? scenario.me : scenario.rows };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/subscriptionController.js', () => ({ isUserPro: vi.fn(async () => false) }));

const hub = await import('../../src/controllers/friendsHubController.js');
const { NEXT_AT_SQL, COUNTRY_BOUNDS } = await import('../../src/controllers/groupController.js');
const { parentClubGateSql } = await import('../../src/utils/clubGate.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const run = async (fn, userId = 7) => {
  const res = makeRes();
  await fn({ userId, params: {}, query: {}, body: {} }, res);
  return res;
};
const listQuery = () => queries.find((q) => q.text.includes('friends:'));

beforeEach(() => {
  scenario.me = [{ age: null, country: null }];
  scenario.rows = [];
  scenario.failOn = null;
  queries.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /friends/going — „Wo gehen deine Freunde hin?“', () => {
  const row = (over = {}) => ({
    id: 5, name: 'Spieleabend im Café', type: 'group', image_url: 'https://x/y.webp',
    date: '2026-11-19T19:00:00.000Z', next_at: '2026-11-19T19:00:00.000Z', is_recurring_weekly: false,
    friend_count: 3,
    friends: [{ id: 1, name: 'Fynn', avatar_url: 'a' }, { id: 2, name: 'Laura', avatar_url: 'b' }, { id: 3, name: 'Tim', avatar_url: null }],
    is_member: false, has_requested: false, ...over,
  });

  it('never answers 5xx: a failing caller lookup or a failing list is 200 with an empty list', async () => {
    for (const failOn of ['caller', 'list', 'all']) {
      scenario.failOn = failOn;
      const res = await run(hub.getFriendsGoing);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it('the card: the meetup, the friends, and the caller\'s own state for the button', async () => {
    scenario.rows = [
      row(),
      row({ id: 6, is_member: true }),
      row({ id: 7, has_requested: true }),
      // In it AND an old request row still pending: in it wins.
      row({ id: 8, is_member: true, has_requested: true }),
    ];
    const res = await run(hub.getFriendsGoing);
    expect(res.statusCode).toBe(200);
    expect(res.body.map((c) => [c.id, c.my_status])).toEqual([
      [5, 'none'], [6, 'member'], [7, 'requested'], [8, 'member'],
    ]);
    expect(res.body[0]).toEqual({
      id: 5, name: 'Spieleabend im Café', type: 'group', image_url: 'https://x/y.webp',
      date: '2026-11-19T19:00:00.000Z', next_at: '2026-11-19T19:00:00.000Z', is_recurring_weekly: false,
      friend_count: 3,
      friends: [{ id: 1, name: 'Fynn', avatar_url: 'a' }, { id: 2, name: 'Laura', avatar_url: 'b' }, { id: 3, name: 'Tim', avatar_url: null }],
      my_status: 'none',
    });
    // The two booleans are the query's, not the answer's.
    expect(res.body[0]).not.toHaveProperty('is_member');
    expect(res.body[0]).not.toHaveProperty('has_requested');
  });

  it('names at most three friends — friend_count stays the number of all of them', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `F${i + 1}`, avatar_url: null }));
    scenario.rows = [row({ friend_count: 7, friends: many }), row({ id: 6, friend_count: 1, friends: null })];
    const res = await run(hub.getFriendsGoing);
    expect(hub.GOING_FRIENDS_SHOWN).toBe(3);
    expect(res.body[0].friends.map((f) => f.name)).toEqual(['F1', 'F2', 'F3']);
    expect(res.body[0].friend_count).toBe(7);
    expect(res.body[1].friends).toEqual([]);
  });

  it('no date of birth, no country: only the caller\'s id is bound — nothing is filtered by age or place', async () => {
    await run(hub.getFriendsGoing, 42);
    const q = listQuery();
    expect(q.params).toEqual([42]);
    expect(q.text).not.toMatch(/target_age_min/);
    expect(q.text).not.toMatch(/g\.lat BETWEEN/);
  });

  it('the feed\'s own gates for this caller: the age range and the country box', async () => {
    scenario.me = [{ age: 31, country: 'AT' }];
    await run(hub.getFriendsGoing, 42);
    const q = listQuery();
    const box = COUNTRY_BOUNDS.AT[0];
    expect(q.params).toEqual([42, 31, box.latMin, box.latMax, box.lngMin, box.lngMax]);
    expect(q.text).toMatch(/g\.target_age_min IS NULL OR g\.target_age_min <= \$2/);
    expect(q.text).toMatch(/g\.target_age_max IS NULL OR g\.target_age_max >= \$2/);
    expect(q.text).toMatch(/g\.lat IS NULL OR \(g\.lat BETWEEN \$3 AND \$4 AND g\.lng BETWEEN \$5 AND \$6\)/);
  });

  it('a country of two boxes (Spain: mainland + Canaries) binds both', async () => {
    scenario.me = [{ age: null, country: 'ES' }];
    await run(hub.getFriendsGoing, 42);
    const q = listQuery();
    expect(q.params).toHaveLength(1 + 8);
    expect(q.text).toMatch(/g\.lng BETWEEN \$4 AND \$5\) OR \(g\.lat BETWEEN \$6 AND \$7/);
  });

  it('a country outside the launch markets has no box — like in the feed', async () => {
    scenario.me = [{ age: null, country: 'US' }];
    await run(hub.getFriendsGoing, 42);
    expect(listQuery().params).toEqual([42]);
  });

  it('the statement: the feed\'s rule, accepted friends with an active account, what is still to come, 12 cards', async () => {
    await run(hub.getFriendsGoing);
    const sql = listQuery().text;
    // The feed's gate — the LIVE parent club, and it has to be public.
    expect(sql).toContain(parentClubGateSql('g', { requirePublic: true }));
    expect(sql).toMatch(/g\.type IN \('group', 'event'\)/);
    expect(sql).toMatch(/g\.is_active = TRUE/);
    expect(sql).toMatch(/g\.deleted_at IS NULL/);
    // Friends: accepted only (a block replaces the row), active accounts only.
    expect(sql).toMatch(/f\.status = 'accepted'/);
    expect(sql).toMatch(/fu\.is_active IS DISTINCT FROM FALSE/);
    // The feed's own next date, compared by the Vienna day.
    expect(sql).toContain(NEXT_AT_SQL);
    expect(sql).toMatch(/go\.next_at IS NOT NULL/);
    expect(sql).toMatch(/go\.next_at::date >= \(NOW\(\) AT TIME ZONE 'Europe\/Vienna'\)::date/);
    // A full meetup only for somebody who is in it or has asked.
    expect(sql).toMatch(/m\.is_member OR m\.has_requested\s+OR g\.max_members IS NULL OR g\.members_count < g\.max_members/);
    expect(sql).toMatch(/jr\.status = 'pending'/);
    expect(hub.GOING_LIMIT).toBe(12);
    expect(sql).toMatch(/ORDER BY m\.next_at ASC, m\.id\s+LIMIT 12/);
  });
});

describe('GET /friends/people — „Leute, die du kennen könntest“', () => {
  it('never answers 5xx: a failing query is 200 with nobody and has_shared null (the page then shows nothing)', async () => {
    scenario.failOn = 'all';
    const res = await run(hub.getPeopleYouMayKnow);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ people: [], has_shared: null });
  });

  it('the people and whether there was a shared meetup at all', async () => {
    const people = [{ id: 9, name: 'Mara', avatar_url: 'm', age: 22, event_name: 'Kochabend' }];
    scenario.rows = [{ people, has_shared: true }];
    expect((await run(hub.getPeopleYouMayKnow)).body).toEqual({ people, has_shared: true });

    scenario.rows = [{ people: [], has_shared: false }];
    expect((await run(hub.getPeopleYouMayKnow)).body).toEqual({ people: [], has_shared: false });

    // Shared meetups, but everybody is a friend or asked already.
    scenario.rows = [{ people: [], has_shared: true }];
    expect((await run(hub.getPeopleYouMayKnow)).body).toEqual({ people: [], has_shared: true });
  });

  it('an answer without rows reads as „no shared meetup“, never as an error', async () => {
    scenario.rows = [];
    expect((await run(hub.getPeopleYouMayKnow)).body).toEqual({ people: [], has_shared: false });
    scenario.rows = [{ people: null, has_shared: null }];
    expect((await run(hub.getPeopleYouMayKnow)).body).toEqual({ people: [], has_shared: false });
  });

  it('the statement: meetups that took place, the 30 most recent, nobody with a friendship row that counts', async () => {
    await run(hub.getPeopleYouMayKnow, 42);
    const q = listQuery();
    expect(q.params).toEqual([42]);
    const sql = q.text;
    // The same meetup or event — never the same club or community.
    expect(sql).toMatch(/g\.type IN \('group', 'event'\)/);
    // It took place: dated, past by Vienna time, not cancelled, not „hat nicht stattgefunden“.
    expect(sql).toMatch(/g\.date IS NOT NULL/);
    expect(sql).toMatch(/g\.date < \(NOW\(\) AT TIME ZONE 'Europe\/Vienna'\)/);
    expect(sql).toMatch(/g\.is_active = TRUE/);
    expect(sql).toMatch(/g\.deleted_at IS NULL/);
    expect(sql).toMatch(/g\.did_not_take_place IS NOT TRUE/);
    // Bounded without a time window.
    expect(sql).not.toMatch(/120 days/);
    expect(hub.PEOPLE_SOURCE_EVENTS).toBe(30);
    expect(sql).toMatch(/ORDER BY g\.date DESC, g\.id DESC\s+LIMIT 30/);
    expect(hub.PEOPLE_LIMIT).toBe(20);
    expect(sql).toMatch(/ORDER BY co\.event_date DESC, u\.id\s+LIMIT 20/);
    // Friends, open requests in either direction, rejections, blocks: out.
    expect(sql).toMatch(/f\.status IN \('accepted', 'pending', 'rejected', 'blocked'\)/);
    expect(sql).toMatch(/f\.requester_id = \$1 AND f\.addressee_id = u\.id/);
    expect(sql).toMatch(/f\.requester_id = u\.id AND f\.addressee_id = \$1/);
    expect(sql).toMatch(/u\.is_active IS DISTINCT FROM FALSE/);
  });
});
