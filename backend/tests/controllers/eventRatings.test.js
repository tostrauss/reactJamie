import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// „Wie war’s bei X?“ — stars + feedback after an event (Tina 17.11.2026).
// The SQL is the contract (WHICH events, WHEN) and is pinned here; the
// real-Postgres smoke test runs it for real. Every query is recorded and
// dispatched to the per-test `dbQueryImpl`.
const statements = [];
let dbQueryImpl;

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      statements.push({ text, params });
      return dbQueryImpl(text, params);
    }),
  },
}));

const {
  getPendingRatings, submitRating, dismissRating, getRatingsAdmin, parseFeedback, ratableSql,
  RATING_AFTER_HOURS, RATING_DATEONLY_AT, RATING_WINDOW_DAYS, RATING_FEEDBACK_MAX,
} = await import('../../src/controllers/eventRatingController.js');
const { joinedInTimeSql, participantsAtEventSql } = await import('../../src/utils/attendanceTiers.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const ME = 7;
const missing = () => Object.assign(new Error('relation "event_ratings" does not exist'), { code: '42P01' });

beforeEach(() => {
  statements.length = 0;
  dbQueryImpl = async () => ({ rows: [] });
  delete process.env.EVENT_RATINGS;
});
afterEach(() => {
  delete process.env.EVENT_RATINGS;
  vi.restoreAllMocks();
});

describe('ratableSql — which events, and from when', () => {
  const sql = ratableSql('g', 'gm');

  it('the numbers Tina and Tobi set: 24 h after the start, date-only the day after at 18:00, open for 7 days', () => {
    expect([RATING_AFTER_HOURS, RATING_DATEONLY_AT, RATING_WINDOW_DAYS, RATING_FEEDBACK_MAX]).toEqual([24, '18:00', 7, 1000]);
    // A timed event: its true start (Vienna wall-clock → instant) + 24 h.
    expect(sql).toContain("(g.date AT TIME ZONE 'Europe/Vienna') + INTERVAL '24 hours'");
    // A date-only meetup is stored at 00:00: the day after at 18:00 Vienna.
    expect(sql).toContain("WHEN g.date::time = '00:00'");
    expect(sql).toContain("((g.date::date + 1)::timestamp + TIME '18:00') AT TIME ZONE 'Europe/Vienna'");
    expect(sql).toContain('<= NOW()');
    expect(sql).toContain(">  NOW() - INTERVAL '7 days'");
  });

  it('meetups and club events that stand, with at least two participants, the caller one of them in time', () => {
    expect(sql).toContain("g.type IN ('group', 'event')");
    expect(sql).toContain('g.is_active IS NOT FALSE');
    expect(sql).toContain('g.deleted_at IS NULL');
    expect(sql).toContain('g.did_not_take_place IS NOT TRUE');
    expect(sql).toContain('g.is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain('g.parent_club_id IS NULL OR EXISTS');
    expect(sql).toContain(joinedInTimeSql('gm', 'g'));
    expect(sql).toContain(`${participantsAtEventSql('g')} >= 2`);
  });
});

describe('getPendingRatings', () => {
  it('the caller\'s ratable events they have neither rated nor closed — at most three, newest first', async () => {
    const rows = [{ group_id: 12, group_name: 'Punsch & Rave 2', event_date: '2026-11-15T19:00:00.000Z', image_url: null }];
    dbQueryImpl = async () => ({ rows });
    const res = makeRes();
    await getPendingRatings({ userId: ME }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(rows);
    const { text, params } = statements[0];
    expect(params).toEqual([ME]);
    expect(text).toContain('gm.user_id = $1');
    expect(text).toContain(ratableSql('g', 'gm'));
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM event_ratings r WHERE r.group_id = g.id AND r.user_id = $1)');
    expect(text).toContain('ORDER BY g.date DESC');
    expect(text).toContain('LIMIT 3');
  });

  it('a database error is 200 [] — never a 5xx (api.js retries GETs)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbQueryImpl = async () => { throw new Error('connection reset'); };
    const res = makeRes();
    await getPendingRatings({ userId: ME }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([]);
    expect(log).toHaveBeenCalled();
  });

  it('the table missing in the boot window (42P01) is 200 [] — quietly', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbQueryImpl = async () => { throw missing(); };
    const res = makeRes();
    await getPendingRatings({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('EVENT_RATINGS=false: 200 [] without a single query', async () => {
    process.env.EVENT_RATINGS = 'false';
    const res = makeRes();
    await getPendingRatings({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(statements).toHaveLength(0);
  });
});

describe('parseFeedback', () => {
  it('none, empty or only spaces → null', () => {
    for (const raw of [undefined, null, '', '   ', '\n\t ']) expect(parseFeedback(raw)).toEqual({ ok: true, value: null });
  });
  it('trimmed, as written', () => {
    expect(parseFeedback('  War super! 🎉  ')).toEqual({ ok: true, value: 'War super! 🎉' });
  });
  it('not a string → refused', () => {
    for (const raw of [5, true, {}, ['x']]) expect(parseFeedback(raw)).toEqual({ ok: false, code: 'FEEDBACK_INVALID' });
  });
  it('1000 characters pass, 1001 do not — counted like Postgres char_length (an emoji is one)', () => {
    expect(parseFeedback('x'.repeat(1000)).ok).toBe(true);
    expect(parseFeedback('x'.repeat(1001))).toEqual({ ok: false, code: 'FEEDBACK_TOO_LONG' });
    expect(parseFeedback('🎉'.repeat(1000)).ok).toBe(true);
    expect(parseFeedback('🎉'.repeat(1001)).ok).toBe(false);
  });
  it('a NUL byte never reaches Postgres (it would be a 500)', () => {
    expect(parseFeedback('gut\u0000 so')).toEqual({ ok: true, value: 'gut so' });
  });
});

describe('submitRating', () => {
  const submit = async (body) => {
    const res = makeRes();
    await submitRating({ userId: ME, body }, res);
    return res;
  };
  // allowed → the permission check finds a row; written → the INSERT returns one.
  const program = ({ allowed = true, written = true } = {}) => {
    dbQueryImpl = async (text) => {
      if (text.includes('INSERT INTO event_ratings')) return { rows: written ? [{ '?column?': 1 }] : [] };
      if (text.includes('FROM group_members gm')) return { rows: allowed ? [{ '?column?': 1 }] : [] };
      throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
    };
  };

  it.each([undefined, null, 'abc', '12', 1.5, 0, -3])('group_id %p → 400 before any SQL', async (gid) => {
    const res = await submit({ group_id: gid, stars: 5 });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(statements).toHaveLength(0);
  });

  it.each([0, 6, 2.5, '3', null, undefined, -1])('stars %p → 400 before any SQL', async (stars) => {
    const res = await submit({ group_id: 12, stars });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'STARS_INVALID', error: expect.any(String) });
    expect(statements).toHaveLength(0);
  });

  it('a feedback of 1001 characters → 400 FEEDBACK_TOO_LONG, a non-string → 400', async () => {
    const long = await submit({ group_id: 12, stars: 5, feedback: 'x'.repeat(1001) });
    expect(long.status).toHaveBeenCalledWith(400);
    expect(long.json.mock.calls[0][0]).toMatchObject({ code: 'FEEDBACK_TOO_LONG', error: expect.any(String) });
    const odd = await submit({ group_id: 12, stars: 5, feedback: { a: 1 } });
    expect(odd.status).toHaveBeenCalledWith(400);
    expect(statements).toHaveLength(0);
  });

  it('a rating with feedback: 201, checked against the same rule as the question, stored trimmed', async () => {
    program();
    const res = await submit({ group_id: 12, stars: 5, feedback: '  Mega Abend!  ' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    const [check, insert] = statements;
    expect(check.params).toEqual([12, ME]);
    expect(check.text).toContain('gm.group_id = $1 AND gm.user_id = $2');
    expect(check.text).toContain(ratableSql('g', 'gm'));
    expect(insert.params).toEqual([12, ME, 5, 'Mega Abend!']);
    expect(insert.text).toContain('ON CONFLICT (group_id, user_id) DO NOTHING');
  });

  it('stars only: an empty feedback is stored as NULL', async () => {
    program();
    await submit({ group_id: 12, stars: 1, feedback: '   ' });
    expect(statements[1].params).toEqual([12, ME, 1, null]);
    statements.length = 0;
    await submit({ group_id: 12, stars: 3 });
    expect(statements[1].params).toEqual([12, ME, 3, null]);
  });

  it('not a participant, too early, too late, cancelled … → 403 RATING_NOT_ALLOWED, nothing written', async () => {
    program({ allowed: false });
    const res = await submit({ group_id: 12, stars: 4 });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bewertung nicht möglich', code: 'RATING_NOT_ALLOWED' });
    expect(statements.some((s) => s.text.includes('INSERT INTO'))).toBe(false);
  });

  it('a second rating → 409 ALREADY_RATED', async () => {
    program({ written: false });
    const res = await submit({ group_id: 12, stars: 4 });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bereits bewertet', code: 'ALREADY_RATED' });
  });

  it('the table missing in the boot window → 503 with a code and a sentence old bundles can show', async () => {
    dbQueryImpl = async () => { throw missing(); };
    const res = await submit({ group_id: 12, stars: 4 });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'RATINGS_UNAVAILABLE', error: expect.any(String) });
  });
});

describe('dismissRating (the X)', () => {
  it.each([undefined, 'abc', 0, 1.5])('group_id %p → 400 before any SQL', async (gid) => {
    const res = makeRes();
    await dismissRating({ userId: ME, body: { group_id: gid } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(statements).toHaveLength(0);
  });

  it('a participant closes the question: a row WITHOUT stars, written only for a member of the event', async () => {
    dbQueryImpl = async () => ({ rows: [{ '?column?': 1 }] });
    const res = makeRes();
    await dismissRating({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(statements).toHaveLength(1);
    expect(statements[0].params).toEqual([12, ME]);
    expect(statements[0].text).toContain('SELECT $1, $2, NULL WHERE EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)');
    expect(statements[0].text).toContain('ON CONFLICT (group_id, user_id) DO NOTHING');
  });

  it('closing twice, or after a real rating, answers the same', async () => {
    dbQueryImpl = async (text) => (text.includes('INSERT INTO') ? { rows: [] } : { rows: [{ '?column?': 1 }] });
    const res = makeRes();
    await dismissRating({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('somebody who is not in the event → 403', async () => {
    const res = makeRes();
    await dismissRating({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('getRatingsAdmin', () => {
  it('only real ratings, newest first, paged like the feedback list', async () => {
    const page = [{ group_id: 12, group_name: 'Punsch', stars: 5, feedback: 'Top', user_id: 3, user_name: 'Ann' }];
    dbQueryImpl = async (text) => (text.includes('COUNT(*)') ? { rows: [{ total: 41 }] } : { rows: page });
    const res = makeRes();
    await getRatingsAdmin({ userId: 1, query: { limit: '20', offset: '40' } }, res);
    expect(res.json).toHaveBeenCalledWith({ ratings: page, total: 41, limit: 20, offset: 40 });
    const list = statements.find((s) => s.text.includes('ORDER BY r.created_at DESC'));
    expect(list.params).toEqual([20, 40]);
    // Rows closed with the X are not ratings — in the list and in the count.
    for (const s of statements) expect(s.text).toContain('stars IS NOT NULL');
    expect(list.text).toContain('LEFT JOIN users u ON u.id = r.user_id');
    expect(list.text).toContain('LEFT JOIN groups pc ON pc.id = g.parent_club_id');
  });

  it('limit and offset are clamped: 1–200, default 50, never negative', async () => {
    dbQueryImpl = async (text) => (text.includes('COUNT(*)') ? { rows: [{ total: 0 }] } : { rows: [] });
    const page = async (query) => {
      const res = makeRes();
      await getRatingsAdmin({ userId: 1, query }, res);
      const { limit, offset } = res.json.mock.calls[0][0];
      return [limit, offset];
    };
    expect(await page({})).toEqual([50, 0]);
    expect(await page({ limit: '9999', offset: '-5' })).toEqual([200, 0]);
    expect(await page({ limit: 'abc', offset: 'x' })).toEqual([50, 0]);
    expect(await page({ limit: '-3' })).toEqual([1, 0]);
  });

  it('a missing table is an empty page marked unavailable — never a 5xx', async () => {
    dbQueryImpl = async () => { throw missing(); };
    const res = makeRes();
    await getRatingsAdmin({ userId: 1, query: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ratings: [], total: 0, limit: 50, offset: 0, unavailable: true });
  });
});
