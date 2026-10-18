import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Hall of Fame (Lea, 18.10.2026): the profile history must survive leaving a
// chat or the owner deleting it afterwards, others see only public events,
// and participants — not only the owner — may add photos to an event's card.

// ── Mocks ─────────────────────────────────────────────────────────────────
// db.query dispatches on the SQL markers/text; each test programs `scenario`.
const scenario = {
  visible: true,          // target user exists and no block either way
  hofRows: [],            // rows of the profile list
  hofFailFirst: null,     // error the FIRST profile-list query throws
  photoCheck: null,       // row of the add-photo check (null = event not found)
  photoRows: [],
  photosFail: null,
  deleteRow: null,        // row of the delete lookup
  insertFail: null,
};
const calls = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('hall-of-fame:user')) {
        if (scenario.hofFailFirst) {
          const err = scenario.hofFailFirst;
          scenario.hofFailFirst = null;
          throw err;
        }
        return { rows: scenario.hofRows };
      }
      if (/SELECT 1 FROM users\s+WHERE id = \$1/.test(sql)) {
        return { rows: scenario.visible ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('hall-of-fame:photos')) {
        if (scenario.photosFail) throw scenario.photosFail;
        return { rows: scenario.photoRows };
      }
      if (sql.includes('hall-of-fame:photo-check')) {
        return { rows: scenario.photoCheck ? [scenario.photoCheck] : [] };
      }
      if (sql.startsWith('INSERT INTO event_photos')) {
        if (scenario.insertFail) throw scenario.insertFail;
        return { rows: [{ id: 7, url: params[2], user_id: params[1], created_at: '2026-10-18T12:00:00Z' }] };
      }
      if (sql.startsWith('SELECT name, avatar_url FROM users')) {
        return { rows: [{ name: 'Lea', avatar_url: '/media/lea.jpg' }] };
      }
      if (/FROM event_photos ep\s+JOIN groups g ON g\.id = ep\.group_id\s+WHERE ep\.id = \$2/.test(sql)) {
        return { rows: scenario.deleteRow ? [scenario.deleteRow] : [] };
      }
      if (sql.startsWith('DELETE FROM event_photos')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { getUserHallOfFame, getEventPhotos, addEventPhoto, deleteEventPhoto } =
  await import('../../src/controllers/hallOfFameController.js');
const hof = await import('../../src/utils/hallOfFame.js');

const missing = (rel) => Object.assign(new Error(`relation "${rel}" does not exist`), { code: '42P01' });

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const run = async (handler, req) => {
  const res = makeRes();
  await handler(req, res);
  return res;
};
const lastSql = (marker) => [...calls].reverse().find(c => c.sql.includes(marker));

beforeEach(() => {
  calls.length = 0;
  Object.assign(scenario, {
    visible: true, hofRows: [], hofFailFirst: null, photoCheck: null,
    photoRows: [], photosFail: null, deleteRow: null, insertFail: null,
  });
});

// ── SQL builders ──────────────────────────────────────────────────────────
describe('utils/hallOfFame SQL builders', () => {
  it('counts only past one-off events that stand, deleted no earlier than the day after', () => {
    const sql = hof.hallOfFameEventSql('g');
    expect(sql).toContain("g.type IN ('group', 'event')");
    expect(sql).toContain("g.date < (NOW() AT TIME ZONE 'Europe/Vienna')");
    expect(sql).toContain('g.is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain('g.did_not_take_place IS NOT TRUE');
    expect(sql).toContain('g.is_active IS NOT FALSE');
    expect(sql).toMatch(/deleted_at IS NULL\s+OR \(g\.deleted_at::timestamptz AT TIME ZONE 'Europe\/Vienna'\)::date > g\.date::date/);
  });

  it('reads participation from memberships (joined in time), leavers and review answers', () => {
    const sql = hof.participatedIdsSql('$1');
    expect(sql).toContain('FROM group_members gm');
    expect(sql).toContain('gm.joined_at IS NULL');            // joinedInTimeSql
    expect(sql).toContain('FROM hall_of_fame_entries h WHERE h.user_id = $1');
    expect(sql).toContain('er.reviewer_id = $1 OR (er.reviewed_user_id = $1 AND er.was_present)');
    expect(hof.participatedIdsSql('$1', { withEntries: false })).not.toContain('hall_of_fame_entries');
  });

  it('refuses anything that is not a plain alias or $n parameter', () => {
    expect(() => hof.hallOfFameEventSql('g; DROP TABLE users')).toThrow();
    expect(() => hof.participatedIdsSql('1 OR 1=1')).toThrow();
  });
});

describe('recordHallOfFameEntry / insertHofLikeNotifications', () => {
  it('records the leaver only from their membership row, once the day has begun, never throwing', async () => {
    const db = { query: vi.fn(async () => { throw missing('hall_of_fame_entries'); }) };
    await expect(hof.recordHallOfFameEntry(db, 5, 9)).resolves.toBeUndefined();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO hall_of_fame_entries');
    expect(sql).toContain('FROM group_members gm');
    expect(sql).toContain("g.date::date <= (NOW() AT TIME ZONE 'Europe/Vienna')::date");
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(params).toEqual([5, 9]);
  });

  it('notifies owner + photo contributors, skips the liker, blocks and repeats, and falls back without event_photos', async () => {
    const db = {
      query: vi.fn()
        .mockRejectedValueOnce(missing('event_photos'))
        .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 2 }] }),
    };
    const rows = await hof.insertHofLikeNotifications(db, { groupId: 5, likerId: 9, title: 'Lea gefällt …' });
    expect(rows).toEqual([{ id: 1, user_id: 2 }]);
    const [first] = db.query.mock.calls[0];
    expect(first).toContain('UNION SELECT ep.user_id FROM event_photos ep');
    expect(first).toContain('r.uid <> $2');
    expect(first).toContain("status = 'blocked'");
    expect(first).toContain("INTERVAL '1 day'");
    const [second, params] = db.query.mock.calls[1];
    expect(second).not.toContain('event_photos');
    expect(params).toEqual([5, 9, 'Lea gefällt …']);
  });
});

// ── GET /users/:id/hall-of-fame ───────────────────────────────────────────
describe('getUserHallOfFame', () => {
  it('returns the own list including private events, with the photo-aware cover', async () => {
    scenario.hofRows = [{ id: 3, name: 'Wandern', cover_url: '/media/a.jpg', is_deleted: true }];
    const res = await run(getUserHallOfFame, { params: { id: 'me' }, userId: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(scenario.hofRows);
    const { sql, params } = lastSql('hall-of-fame:user');
    expect(params).toEqual([9]);
    expect(sql).not.toContain('is_private IS NOT TRUE');
    expect(sql).toContain('COALESCE(own.url, g.moment_photo_url, g.image_url) AS cover_url');
    // No visibility lookup for yourself.
    expect(calls.some(c => /SELECT 1 FROM users/.test(c.sql))).toBe(false);
  });

  it('shows somebody else only their public events', async () => {
    const res = await run(getUserHallOfFame, { params: { id: '12' }, userId: 9 });
    expect(res.statusCode).toBe(200);
    const { sql, params } = lastSql('hall-of-fame:user');
    expect(params).toEqual([12]);
    expect(sql).toContain('AND g.is_private IS NOT TRUE');
  });

  it('answers 404 across a block (same as the profile) and never runs the list', async () => {
    scenario.visible = false;
    const res = await run(getUserHallOfFame, { params: { id: '12' }, userId: 9 });
    expect(res.statusCode).toBe(404);
    expect(calls.some(c => c.sql.includes('hall-of-fame:user'))).toBe(false);
  });

  it('rejects a malformed id', async () => {
    const res = await run(getUserHallOfFame, { params: { id: '12abc' }, userId: 9 });
    expect(res.statusCode).toBe(400);
  });

  it('falls back to memberships + reviews while the new tables are missing (boot window)', async () => {
    scenario.hofFailFirst = missing('event_photos');
    scenario.hofRows = [{ id: 1 }];
    const res = await run(getUserHallOfFame, { params: { id: 'me' }, userId: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 1 }]);
    const { sql } = lastSql('hall-of-fame:user');
    expect(sql).not.toContain('event_photos');
    expect(sql).not.toContain('hall_of_fame_entries');
  });
});

// ── Photos ────────────────────────────────────────────────────────────────
describe('addEventPhoto', () => {
  const req = (url = '/media/photo.jpg') => ({ params: { id: '5' }, body: { url }, userId: 9 });

  it('lets a participant add a photo and returns it with the uploader', async () => {
    scenario.photoCheck = { id: 5, participant: true, total: 3, mine: 1 };
    const res = await run(addEventPhoto, req());
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 7, url: '/media/photo.jpg', user_id: 9, user_name: 'Lea', can_delete: true });
    const check = lastSql('hall-of-fame:photo-check');
    expect(check.params).toEqual([5, 9]);
  });

  it('refuses somebody who was not there', async () => {
    scenario.photoCheck = { id: 5, participant: false, total: 0, mine: 0 };
    const res = await run(addEventPhoto, req());
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('NOT_PARTICIPANT');
    expect(calls.some(c => c.sql.startsWith('INSERT INTO event_photos'))).toBe(false);
  });

  it('enforces the per-person and per-event limits', async () => {
    scenario.photoCheck = { id: 5, participant: true, total: 3, mine: hof.MAX_PHOTOS_PER_USER };
    expect((await run(addEventPhoto, req())).body.code).toBe('USER_LIMIT');
    scenario.photoCheck = { id: 5, participant: true, total: hof.MAX_PHOTOS_PER_EVENT, mine: 0 };
    expect((await run(addEventPhoto, req())).body.code).toBe('EVENT_LIMIT');
  });

  it('404s a future, cancelled or unknown event, and 400s a foreign URL', async () => {
    scenario.photoCheck = null;
    expect((await run(addEventPhoto, req())).statusCode).toBe(404);
    expect((await run(addEventPhoto, req('https://evil.example/x.jpg'))).statusCode).toBe(400);
    expect((await run(addEventPhoto, req('javascript:alert(1)'))).statusCode).toBe(400);
  });

  it('answers 503 while event_photos is missing', async () => {
    scenario.photoCheck = { id: 5, participant: true, total: 0, mine: 0 };
    scenario.insertFail = missing('event_photos');
    expect((await run(addEventPhoto, req())).statusCode).toBe(503);
  });
});

describe('deleteEventPhoto', () => {
  const del = (userId) => run(deleteEventPhoto, { params: { id: '5', photoId: '7' }, userId });

  it('lets the uploader, the owner and an admin delete, nobody else', async () => {
    scenario.deleteRow = { user_id: 9, owner_id: 2, caller_is_admin: false };
    expect((await del(9)).body).toEqual({ deleted: true });
    expect((await del(2)).body).toEqual({ deleted: true });
    expect((await del(30)).statusCode).toBe(403);
    scenario.deleteRow = { user_id: 9, owner_id: 2, caller_is_admin: true };
    expect((await del(30)).body).toEqual({ deleted: true });
  });

  it('404s an unknown photo', async () => {
    scenario.deleteRow = null;
    expect((await del(9)).statusCode).toBe(404);
  });
});

describe('getEventPhotos', () => {
  it('returns the gallery with per-photo delete rights for the caller', async () => {
    scenario.photoRows = [{ id: 7, url: '/media/p.jpg', can_delete: true }];
    const res = await run(getEventPhotos, { params: { id: '5' }, userId: 9 });
    expect(res.body).toEqual(scenario.photoRows);
    expect(lastSql('hall-of-fame:photos').params).toEqual([5, 9]);
  });

  it('serves guests (no user) and an empty list while the table is missing', async () => {
    const res = await run(getEventPhotos, { params: { id: '5' } });
    expect(lastSql('hall-of-fame:photos').params).toEqual([5, 0]);
    expect(res.statusCode).toBe(200);
    scenario.photosFail = missing('event_photos');
    expect((await run(getEventPhotos, { params: { id: '5' }, userId: 9 })).body).toEqual([]);
  });
});
