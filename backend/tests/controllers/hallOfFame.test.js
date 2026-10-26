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
  // Profile stats + hide (26.10.2026)
  attendanceRows: [],     // rows of the badge aggregate (attendance-tiers)
  attendanceFail: null,
  clubEventsN: 0,
  friendsN: 0,
  friendsFail: null,
  memoriesN: 0,
  memoriesFailFirst: null,
  hideOwn: true,          // the hide check finds the caller's memory
  hiddenFail: null,       // INSERT/DELETE on hall_of_fame_hidden throws this
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
      if (sql.includes('attendance-tiers')) {
        if (scenario.attendanceFail) throw scenario.attendanceFail;
        return { rows: scenario.attendanceRows };
      }
      if (sql.includes('profile-stats:club-events')) return { rows: [{ n: scenario.clubEventsN }] };
      if (sql.includes('profile-stats:friends')) {
        if (scenario.friendsFail) throw scenario.friendsFail;
        return { rows: [{ n: scenario.friendsN }] };
      }
      if (sql.includes('profile-stats:memories')) {
        if (scenario.memoriesFailFirst) {
          const err = scenario.memoriesFailFirst;
          scenario.memoriesFailFirst = null;
          throw err;
        }
        return { rows: [{ n: scenario.memoriesN }] };
      }
      if (sql.includes('hall-of-fame:hide-check')) return { rows: scenario.hideOwn ? [{ '?column?': 1 }] : [] };
      if (sql.startsWith('INSERT INTO hall_of_fame_hidden') || sql.startsWith('DELETE FROM hall_of_fame_hidden')) {
        if (scenario.hiddenFail) throw scenario.hiddenFail;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const {
  getUserHallOfFame, getEventPhotos, addEventPhoto, deleteEventPhoto,
  getMyProfileStats, hideMemory, unhideMemory,
} = await import('../../src/controllers/hallOfFameController.js');
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
    attendanceRows: [], attendanceFail: null, clubEventsN: 0, friendsN: 0, friendsFail: null,
    memoriesN: 0, memoriesFailFirst: null, hideOwn: true, hiddenFail: null,
  });
});
const HIDDEN_ANTI_JOIN = 'NOT EXISTS (SELECT 1 FROM hall_of_fame_hidden hh WHERE hh.user_id = $1 AND hh.group_id = g.id)';

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

  // Profile edit mode (Tina 22.10., built 26.10.2026)
  it('the own list carries own_photo_id and leaves the memories taken out of the grid away', async () => {
    const res = await run(getUserHallOfFame, { params: { id: 'me' }, userId: 9 });
    expect(res.statusCode).toBe(200);
    const { sql } = lastSql('hall-of-fame:user');
    expect(sql).toContain('own.id AS own_photo_id');
    expect(sql).toContain('SELECT ep.id, ep.url FROM event_photos ep');
    expect(sql).toContain(HIDDEN_ANTI_JOIN);
  });

  it("somebody else's view hides the same memories but carries no photo ids", async () => {
    const res = await run(getUserHallOfFame, { params: { id: '12' }, userId: 9 });
    expect(res.statusCode).toBe(200);
    const { sql } = lastSql('hall-of-fame:user');
    expect(sql).toContain(HIDDEN_ANTI_JOIN);
    expect(sql).not.toContain('own_photo_id');
  });

  it('boot window: only the hide table missing keeps photos and leavers', async () => {
    scenario.hofFailFirst = missing('hall_of_fame_hidden');
    scenario.hofRows = [{ id: 1 }];
    const res = await run(getUserHallOfFame, { params: { id: 'me' }, userId: 9 });
    expect(res.statusCode).toBe(200);
    const { sql } = lastSql('hall-of-fame:user');
    expect(sql).not.toContain('hall_of_fame_hidden');
    expect(sql).toContain('event_photos');
    expect(sql).toContain('hall_of_fame_entries');
  });
});

// ── GET /users/me/profile-stats ───────────────────────────────────────────
describe('getMyProfileStats', () => {
  it('meetups = confirmed group meetups + club events; friends and memories are counts', async () => {
    scenario.attendanceRows = [{ user_id: 9, confirmed_events: 2, confirmers: 3 }];
    Object.assign(scenario, { clubEventsN: 3, friendsN: 4, memoriesN: 7 });
    const res = await run(getMyProfileStats, { userId: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      available: true, meetups: 5, meetups_confirmed: 2, meetups_club_events: 3, friends: 4, memories: 7,
    });
    expect(lastSql('profile-stats:club-events').sql).toContain("g.type = 'event'");
    expect(lastSql('profile-stats:friends').sql).toContain("f.status = 'accepted'");
    const memories = lastSql('profile-stats:memories').sql;
    expect(memories).toContain(HIDDEN_ANTI_JOIN);
    expect(memories).not.toContain('is_private');          // the own grid shows private events too
  });

  it('nobody confirmed yet is a 0, not "unavailable"', async () => {
    const res = await run(getMyProfileStats, { userId: 9 });
    expect(res.body).toMatchObject({ available: true, meetups: 0, meetups_confirmed: 0 });
  });

  it('never a 5xx: a failing count answers 200 { available:false }', async () => {
    scenario.friendsFail = new Error('connection reset');
    const res = await run(getMyProfileStats, { userId: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('a failed badge lookup also hides the row instead of claiming 0 meetups', async () => {
    scenario.attendanceFail = new Error('timeout');
    const res = await run(getMyProfileStats, { userId: 9 });
    expect(res.body).toEqual({ available: false });
  });

  it('boot window: the hide table missing still counts the memories, unfiltered', async () => {
    scenario.memoriesFailFirst = missing('hall_of_fame_hidden');
    scenario.memoriesN = 4;
    const res = await run(getMyProfileStats, { userId: 9 });
    expect(res.body).toMatchObject({ available: true, memories: 4 });
    expect(lastSql('profile-stats:memories').sql).not.toContain('hall_of_fame_hidden');
  });
});

// ── POST/DELETE /users/me/hall-of-fame/:groupId/hide ─────────────────────
describe('hideMemory / unhideMemory', () => {
  const req = (groupId = '5') => ({ params: { groupId }, userId: 9 });

  it('hides a real own memory — idempotently: an already hidden one still counts as own', async () => {
    const res = await run(hideMemory, req());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ hidden: true });
    expect(lastSql('hall-of-fame:hide-check').sql).not.toContain('hall_of_fame_hidden');
    const ins = lastSql('INSERT INTO hall_of_fame_hidden');
    expect(ins.sql).toContain('ON CONFLICT DO NOTHING');
    expect(ins.params).toEqual([9, 5]);
  });

  it("404s an event that is not the caller's memory and writes nothing", async () => {
    scenario.hideOwn = false;
    const res = await run(hideMemory, req());
    expect(res.statusCode).toBe(404);
    expect(calls.some(c => c.sql.startsWith('INSERT INTO hall_of_fame_hidden'))).toBe(false);
  });

  it('400s a malformed id', async () => {
    expect((await run(hideMemory, req('5x'))).statusCode).toBe(400);
    expect((await run(unhideMemory, req('0'))).statusCode).toBe(400);
  });

  it('503 while the table is missing (boot window)', async () => {
    scenario.hiddenFail = missing('hall_of_fame_hidden');
    expect((await run(hideMemory, req())).statusCode).toBe(503);
  });

  it('unhide is the undo: deletes the row, and without the table nothing is hidden anyway', async () => {
    const res = await run(unhideMemory, req());
    expect(res.body).toEqual({ hidden: false });
    expect(lastSql('DELETE FROM hall_of_fame_hidden').params).toEqual([9, 5]);
    scenario.hiddenFail = missing('hall_of_fame_hidden');
    const boot = await run(unhideMemory, req());
    expect(boot.statusCode).toBe(200);
    expect(boot.body).toEqual({ hidden: false });
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
