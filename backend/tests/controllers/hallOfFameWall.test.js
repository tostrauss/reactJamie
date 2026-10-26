import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Hall of Fame on the group controller (Lea, 18.10.2026): the Explore wall
// carries participant photos and who may add one, a like lands in the bell of
// the owner and the photo contributors, and leaving after the meetup records
// the event before the membership row disappears.

const scenario = {
  wallRows: [],
  wallFail: null,
  legacyRows: [],
  likeExists: false,
  notifRows: [],
};
const calls = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('hall-of-fame:wall')) {
        if (scenario.wallFail) throw scenario.wallFail;
        return { rows: scenario.wallRows };
      }
      if (sql.includes('FROM groups g') && sql.includes('event_likes el') && !sql.includes('hall-of-fame:wall')) {
        return { rows: scenario.legacyRows };
      }
      if (sql.includes('SELECT 1 FROM event_likes')) return { rows: scenario.likeExists ? [{}] : [] };
      if (sql.startsWith('INSERT INTO event_likes') || /^\s*INSERT INTO event_likes/.test(sql)) return { rows: [], rowCount: 1 };
      if (sql.includes('SELECT COUNT(*)::int AS c FROM event_likes')) return { rows: [{ c: 4 }] };
      if (sql.includes('SELECT owner_id, name FROM groups')) return { rows: [{ owner_id: 2, name: 'Wandern' }] };
      if (sql.includes('SELECT name FROM users WHERE id')) return { rows: [{ name: 'Lea' }] };
      if (sql.includes('hof-like-notify')) return { rows: scenario.notifRows };
      if (sql.includes('SELECT owner_id, members_count, max_members FROM groups')) return { rows: [{ owner_id: 2 }] };
      if (sql.includes('DELETE FROM group_members')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    pool: { connect: vi.fn(async () => { throw new Error('no pool in unit tests'); }) },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/controllers/subscriptionController.js', () => ({ isUserPro: vi.fn(async () => false) }));

const { getHallOfFame, toggleLike, leaveGroup } = await import('../../src/controllers/groupController.js');

const missing = (rel) => Object.assign(new Error(`relation "${rel}" does not exist`), { code: '42P01' });
const flush = () => new Promise(r => setTimeout(r, 0));

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};

beforeEach(() => {
  calls.length = 0;
  Object.assign(scenario, { wallRows: [], wallFail: null, legacyRows: [], likeExists: false, notifRows: [] });
});

describe('getHallOfFame — participant photos', () => {
  it('marks a card addable for a participant below both limits, never for a non-participant', async () => {
    scenario.wallRows = [
      { id: 1, is_participant: true, my_photo_count: 1, photo_count: 3, photos: [] },
      { id: 2, is_participant: true, my_photo_count: 5, photo_count: 3, photos: [] },
      { id: 3, is_participant: true, my_photo_count: 0, photo_count: 40, photos: [] },
      { id: 4, is_participant: false, my_photo_count: 0, photo_count: 0, photos: [] },
    ];
    const res = makeRes();
    await getHallOfFame({ query: {}, userId: 9 }, res);
    expect(res.body.map(r => [r.id, r.can_add_photo])).toEqual([[1, true], [2, false], [3, false], [4, false]]);
    const wall = calls.find(c => c.sql.includes('hall-of-fame:wall'));
    expect(wall.params).toEqual([9, 30, 0]);
    expect(wall.sql).toContain('WITH mine AS');
    expect(wall.sql).toContain("g.date > NOW() - INTERVAL '30 days'");
    expect(wall.sql).toContain('EXISTS (SELECT 1 FROM event_photos ep WHERE ep.group_id = g.id)');
  });

  it('falls back to the old wall while the new tables are missing', async () => {
    scenario.wallFail = missing('event_photos');
    scenario.legacyRows = [{ id: 8, like_count: 2 }];
    const res = makeRes();
    await getHallOfFame({ query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 8, like_count: 2 }]);
  });
});

// Memories (Tina, 22.10.2026): the new Explore asks with photos_only=1 and gets
// only cards with a picture. Old bundles call without it and must keep their
// upload entry points (own photoless events first) untouched.
describe('getHallOfFame — photos_only', () => {
  const wallSql = () => calls.find(c => c.sql.includes('hall-of-fame:wall')).sql;

  it('drops the caller-bound upload arms and the own-first order, keeps every picture arm', async () => {
    const res = makeRes();
    await getHallOfFame({ query: { photos_only: '1' }, userId: 9 }, res);
    expect(res.statusCode).toBe(200);
    expect(calls.find(c => c.sql.includes('hall-of-fame:wall')).params).toEqual([9, 30, 0]);
    const sql = wallSql();
    expect(sql).not.toContain('g.owner_id = $1::int)');
    expect(sql).not.toContain("INTERVAL '30 days'");
    expect(sql).not.toContain('g.moment_photo_url IS NULL) DESC');
    expect(sql).toContain('ORDER BY g.date DESC, g.id DESC');
    expect(sql).toContain('g.moment_photo_url IS NOT NULL');
    expect(sql).toContain('OR g.image_url IS NOT NULL');
    expect(sql).toContain('OR EXISTS (SELECT 1 FROM event_photos ep WHERE ep.group_id = g.id)');
    // The card still says whether the caller may add a photo.
    expect(sql).toContain('AS is_participant');
  });

  it('keeps the old wall without the param — and for any other value', async () => {
    for (const query of [{}, { photos_only: 'true' }]) {
      calls.length = 0;
      await getHallOfFame({ query, userId: 9 }, makeRes());
      const sql = wallSql();
      expect(sql).toContain('OR ($1::int > 0 AND g.owner_id = $1::int)');
      expect(sql).toContain("g.date > NOW() - INTERVAL '30 days'");
      expect(sql).toContain('ORDER BY (g.owner_id = $1::int AND g.moment_photo_url IS NULL) DESC');
    }
  });

  it('the boot-window fallback follows the same switch', async () => {
    scenario.wallFail = missing('event_photos');
    const res = makeRes();
    await getHallOfFame({ query: { photos_only: '1' }, userId: 9 }, res);
    expect(res.statusCode).toBe(200);
    const legacy = calls.find(c => !c.sql.includes('hall-of-fame:wall') && c.sql.includes('event_likes el'));
    expect(legacy.sql).not.toContain('g.owner_id = $1::int)');
    expect(legacy.sql).toContain('ORDER BY g.date DESC, g.id DESC');
  });
});

describe('toggleLike — in-app notification', () => {
  it('inserts bell rows on a new like and emits each to its recipient', async () => {
    scenario.notifRows = [{ id: 11, user_id: 2, type: 'hof_like' }, { id: 12, user_id: 5, type: 'hof_like' }];
    const emitted = [];
    const io = { to: (room) => ({ emit: (ev, payload) => emitted.push([room, ev, payload.id]) }) };
    const res = makeRes();
    await toggleLike({ params: { id: '7' }, userId: 9, app: { get: () => io } }, res);
    expect(res.body).toEqual({ liked: true, like_count: 4 });
    await flush(); await flush();
    const notify = calls.find(c => c.sql.includes('hof-like-notify'));
    expect(notify.params).toEqual(['7', 9, 'Lea gefällt „Wandern“ in den Memories']);
    expect(emitted).toEqual([['user_2', 'new_notification', 11], ['user_5', 'new_notification', 12]]);
  });

  it('does not notify on an unlike', async () => {
    scenario.likeExists = true;
    const res = makeRes();
    await toggleLike({ params: { id: '7' }, userId: 9, app: { get: () => null } }, res);
    await flush();
    expect(res.body.liked).toBe(false);
    expect(calls.some(c => c.sql.includes('hof-like-notify'))).toBe(false);
  });
});

describe('leaveGroup — keeps the Hall of Fame', () => {
  it('records the event before deleting the membership row', async () => {
    const res = makeRes();
    await leaveGroup({ params: { id: '7' }, userId: 9, app: { get: () => null } }, res);
    expect(res.body).toEqual({ message: 'Left group successfully' });
    const record = calls.findIndex(c => c.sql.includes('INSERT INTO hall_of_fame_entries'));
    const del = calls.findIndex(c => c.sql.includes('DELETE FROM group_members'));
    expect(record).toBeGreaterThan(-1);
    expect(record).toBeLessThan(del);
    expect(calls[record].params).toEqual(['7', 9]);
  });
});
