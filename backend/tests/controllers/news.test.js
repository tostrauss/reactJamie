import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// "News an alle" (Lea, 18.10.2026): JAMIE's one-way channel into the bell.
// What is pinned here: only admins get through (the REAL authenticate +
// requireAdmin chain), the form is validated before anything is written, the
// in-app rows go out in keyset-paged chunks to every active account with a
// live `new_notification` per row, the device push reaches ONLY users who
// opted in (users.push_news — App Store Guideline 4.5.4), and the same title
// twice within 10 minutes is refused.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Fake database: a users table + a statement recorder ──────────────────────
const statements = [];        // { via: 'pool' | 'client', text, params }
let users = [];               // { id, is_active, push_news }
let dupRow = null;            // what the guard's news_posts lookup finds
let failOn = null;            // (text, params) => Error | null — per-test fault injection
let nextNotifId = 1;

const active = () => users.filter((u) => u.is_active !== false).sort((a, b) => a.id - b.id);

const answer = async (text, params = []) => {
  const injected = failOn?.(text, params);
  if (injected) throw injected;
  if (text.includes('SELECT is_active, sessions_valid_after FROM users')) {
    return { rows: [{ is_active: true, sessions_valid_after: null }] };
  }
  if (text.includes('SELECT is_admin FROM users')) {
    return { rows: [{ is_admin: params[0] === ADMIN }] };
  }
  if (text.includes('INSERT INTO notifications')) {
    const withLink = text.includes('link');
    const lastId = params[params.length - 1];
    const page = active().filter((u) => u.id > lastId).slice(0, CHUNK);
    return {
      rows: page.map((u) => ({
        id: nextNotifId++, user_id: u.id, type: 'news', title: params[0], message: params[1],
        ...(withLink ? { link: params[2] } : {}), is_read: false,
      })),
    };
  }
  if (text.includes('SELECT id FROM users') && text.includes('push_news = TRUE')) {
    return { rows: active().filter((u) => u.push_news).map((u) => ({ id: u.id })) };
  }
  if (text.includes('SELECT COUNT(*)::int AS n FROM users')) {
    const list = text.includes('push_news') ? active().filter((u) => u.push_news) : active();
    return { rows: [{ n: list.length }] };
  }
  if (text.includes('SELECT id FROM news_posts')) return { rows: dupRow ? [dupRow] : [] };
  if (text.includes('INSERT INTO news_posts')) return { rows: [{ id: 77, created_at: new Date() }] };
  return { rows: [] };
};

vi.mock('../../src/config/database.js', () => {
  const client = {
    query: vi.fn(async (text, params) => { statements.push({ via: 'client', text, params }); return answer(text, params); }),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(async (text, params) => { statements.push({ via: 'pool', text, params }); return answer(text, params); }),
      pool: { connect: vi.fn(async () => client) },
      _client: client,
    },
  };
});
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureException: vi.fn(), captureMessage: vi.fn() } }));

const sendPushToUsers = vi.fn(async () => {});
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUsers: (...args) => sendPushToUsers(...args),
}));

// adminRoutes pulls in every admin controller; only the news handlers are real.
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
vi.mock('../../src/controllers/adminController.js', () => stubs([
  'getStats', 'getRecentUsers', 'getScreenTime', 'exportUsers', 'exportScreens', 'exportSuggestions',
  'getPendingClubs', 'approveClub', 'rejectClub', 'deleteUser', 'updateUserRole', 'getTopClubs',
  'getOnlineUsers', 'getGrowth', 'getUserOrigins', 'getUserDetail', 'getIpDiagnostics',
  'getBackupStatus', 'setUserActive', 'sendUserTestPush', 'removeUserAvatar',
]));
vi.mock('../../src/controllers/feedbackController.js', () => stubs(['getFeedbackAdmin']));
vi.mock('../../src/controllers/featuredClubController.js', () => stubs(['getFeaturedClubsAdmin', 'setFeaturedClubs']));

const db = (await import('../../src/config/database.js')).default;
const news = await import('../../src/controllers/newsController.js');
const { generateToken } = await import('../../src/middleware/auth.js');
const adminRoutes = (await import('../../src/routes/adminRoutes.js')).default;

const CHUNK = news.NEWS_CHUNK;
const ADMIN = 1;
const MEMBER = 2;

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
const bearer = (id) => `Bearer ${generateToken(id)}`;

// Direct handler calls for the flows (the guard is covered over HTTP below).
const emitted = [];
const fakeIo = { to: (room) => ({ emit: (ev, payload) => emitted.push({ room, ev, payload }) }) };
const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const send = async (body) => {
  const res = makeRes();
  await news.sendNews({ userId: ADMIN, body, app: { get: (k) => (k === 'io' ? fakeIo : undefined) } }, res);
  return res;
};
const VALID = { title: 'Neue Deals in Wien', message: 'Drei neue Kooperationen — schau rein!', link: '/deal/12', push: true };

const inserts = () => statements.filter((s) => s.text.includes('INSERT INTO notifications'));
const clientTexts = () => statements.filter((s) => s.via === 'client').map((s) => s.text.trim().split('\n')[0]);
const seedUsers = (n, { optIn = () => false, frozen = () => false } = {}) => {
  users = Array.from({ length: n }, (_, i) => ({ id: i + 1, is_active: !frozen(i + 1), push_news: optIn(i + 1) }));
};

beforeEach(() => {
  statements.length = 0;
  emitted.length = 0;
  users = [];
  dupRow = null;
  failOn = null;
  nextNotifId = 1;
  sendPushToUsers.mockClear();
  db._client.release.mockClear();
});

describe('parseNewsInput / isInternalLink', () => {
  it('accepts a valid form and normalises it', () => {
    expect(news.parseNewsInput({ title: '  Hallo  ', message: ' Text ', link: '', push: true }))
      .toEqual({ value: { title: 'Hallo', message: 'Text', link: null, push: true } });
  });

  it.each([
    ['no title', { message: 'x' }, 'NEWS_TITLE_REQUIRED'],
    ['a title over 80 chars', { title: 'x'.repeat(81), message: 'x' }, 'NEWS_TITLE_TOO_LONG'],
    ['no message', { title: 'x', message: '   ' }, 'NEWS_MESSAGE_REQUIRED'],
    ['a message over 500 chars', { title: 'x', message: 'y'.repeat(501) }, 'NEWS_MESSAGE_TOO_LONG'],
    ['an external link', { title: 'x', message: 'y', link: 'https://evil.example' }, 'NEWS_LINK_INVALID'],
    ['a protocol-relative link', { title: 'x', message: 'y', link: '//evil.example/x' }, 'NEWS_LINK_INVALID'],
  ])('refuses %s', (_label, body, code) => {
    expect(news.parseNewsInput(body)).toMatchObject({ code });
  });

  it('exactly 80 / 500 characters are still fine', () => {
    expect(news.parseNewsInput({ title: 'x'.repeat(80), message: 'y'.repeat(500) }).value).toBeTruthy();
  });

  it('switches the push on only for a real boolean', () => {
    expect(news.parseNewsInput({ title: 'x', message: 'y', push: 'true' }).value.push).toBe(false);
  });

  it.each([
    ['/deal/12', true], ['/explore', true], ['/club/3?tab=events#top', true],
    ['deal/12', false], ['//evil.example', false], ['/\\evil.example', false],
    ['/with space', false], ['javascript:alert(1)', false], [`/${'a'.repeat(500)}`, false], [42, false],
  ])('isInternalLink(%j) → %s', (value, expected) => {
    expect(news.isInternalLink(value)).toBe(expected);
  });
});

describe('admin guard (real authenticate + requireAdmin)', () => {
  it('401 without a session, 403 for a normal user — and nothing is written', async () => {
    seedUsers(5);
    await request(app).post('/api/admin/news').send(VALID).expect(401);
    const res = await request(app).post('/api/admin/news').set('Authorization', bearer(MEMBER)).send(VALID);
    expect(res.status).toBe(403);
    await request(app).get('/api/admin/news/audience').set('Authorization', bearer(MEMBER)).expect(403);
    expect(inserts()).toHaveLength(0);
    expect(statements.some((s) => s.text.includes('news_posts'))).toBe(false);
    expect(sendPushToUsers).not.toHaveBeenCalled();
  });

  it('an admin reaches the audience, the list and the send', async () => {
    seedUsers(3, { optIn: (id) => id === 3 });
    const audience = await request(app).get('/api/admin/news/audience').set('Authorization', bearer(ADMIN));
    expect(audience.status).toBe(200);
    expect(audience.body).toEqual({ total: 3, pushOptIn: 1 });

    const list = await request(app).get('/api/admin/news').set('Authorization', bearer(ADMIN));
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ news: [] });

    const sent = await request(app).post('/api/admin/news').set('Authorization', bearer(ADMIN)).send(VALID);
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ id: 77, recipients: 3, pushRecipients: 1, push: true });
  });

  it('a 400 from validation never claims a news_posts row', async () => {
    const res = await request(app).post('/api/admin/news').set('Authorization', bearer(ADMIN))
      .send({ title: '', message: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NEWS_TITLE_REQUIRED');
    expect(statements.some((s) => s.text.includes('news_posts'))).toBe(false);
  });
});

describe('sendNews fan-out', () => {
  it('inserts in keyset-paged chunks for every ACTIVE account and emits one live event per row', async () => {
    const total = CHUNK * 2 + 500;
    seedUsers(total + 3, { frozen: (id) => id > total });   // 3 frozen accounts at the end
    const res = await send({ ...VALID, push: false });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 77, recipients: total, pushRecipients: 0, push: false });

    // 1000 + 1000 + 500: the short page ends the loop — no fourth statement.
    const ins = inserts();
    expect(ins).toHaveLength(3);
    expect(ins.map((s) => s.params[s.params.length - 1])).toEqual([0, CHUNK, CHUNK * 2]);
    for (const s of ins) {
      expect(s.text).toContain('is_active IS DISTINCT FROM FALSE');
      expect(s.text).toContain('ORDER BY id');
      expect(s.text).toContain(`LIMIT ${CHUNK}`);
      expect(s.text).toContain("'news'");
      // sender_id is never written → NULL: the news is from JAMIE, not a person.
      expect(s.text).not.toContain('sender_id');
      expect(s.params.slice(0, 3)).toEqual([VALID.title, VALID.message, VALID.link]);
    }

    expect(emitted).toHaveLength(total);
    expect(emitted.every((e) => e.ev === 'new_notification')).toBe(true);
    expect(emitted[0]).toMatchObject({ room: 'user_1', payload: { user_id: 1, type: 'news', link: '/deal/12' } });
    expect(new Set(emitted.map((e) => e.room)).size).toBe(total);
    expect(sendPushToUsers).not.toHaveBeenCalled();

    const done = statements.find((s) => s.text.includes("SET status = 'sent'"));
    expect(done.params).toEqual([77, total, 0]);
  });

  it('a page that is exactly full asks once more and stops on the empty one', async () => {
    seedUsers(CHUNK);
    const res = await send({ ...VALID, push: false });
    expect(res.body.recipients).toBe(CHUNK);
    expect(inserts()).toHaveLength(2);
  });

  it('pushes ONLY to opted-in active users, with the link and a one-day TTL', async () => {
    seedUsers(10, { optIn: (id) => id % 3 === 0, frozen: (id) => id === 9 });
    const res = await send(VALID);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ recipients: 9, pushRecipients: 2, push: true });
    expect(sendPushToUsers).toHaveBeenCalledTimes(1);
    const [ids, title, body, url, opts] = sendPushToUsers.mock.calls[0];
    expect(ids).toEqual([3, 6]);           // 9 opted in too, but the account is frozen
    expect(title).toBe(VALID.title);
    expect(body).toBe(VALID.message);
    expect(url).toBe('/deal/12');
    expect(opts).toEqual({ ttl: 24 * 60 * 60 });
  });

  it('without a link the push opens the notification list', async () => {
    seedUsers(2, { optIn: () => true });
    await send({ ...VALID, link: '' });
    expect(sendPushToUsers.mock.calls[0][3]).toBe('/notifications');
    expect(inserts()[0].text).not.toContain('link');
  });

  it('a missing push_news column means nobody consented — in-app only, no push', async () => {
    seedUsers(4, { optIn: () => true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failOn = (text) => (text.includes('push_news') ? Object.assign(new Error('column "push_news" does not exist'), { code: '42703' }) : null);
    const res = await send(VALID);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ recipients: 4, pushRecipients: 0 });
    expect(sendPushToUsers).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a missing notifications.link column sends the news without its link', async () => {
    seedUsers(3);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failOn = (text) => (text.includes('INSERT INTO notifications') && text.includes('link')
      ? Object.assign(new Error('column "link" does not exist'), { code: '42703' }) : null);
    const res = await send({ ...VALID, push: false });
    expect(res.statusCode).toBe(201);
    expect(res.body.recipients).toBe(3);
    expect(inserts().map((s) => s.text.includes('link'))).toEqual([true, false]);
    warn.mockRestore();
  });
});

describe('double-send guard', () => {
  it('the check and the claim run in one transaction under the advisory lock', async () => {
    seedUsers(1);
    await send({ ...VALID, push: false });
    expect(clientTexts()).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock($1)',
      'SELECT id FROM news_posts',
      'INSERT INTO news_posts (title, message, link, with_push, created_by)',
      'COMMIT',
    ]);
    const lock = statements.find((s) => s.text.includes('pg_advisory_xact_lock'));
    expect(lock.params).toEqual([news.NEWS_SEND_LOCK_ID]);
    const check = statements.find((s) => s.text.includes('SELECT id FROM news_posts'));
    expect(check.text).toContain('lower(title) = lower($1)');
    expect(check.text).toContain(`INTERVAL '${news.NEWS_DUPLICATE_WINDOW_MINUTES} minutes'`);
    // A send that failed before reaching anyone must not block the retry.
    expect(check.text).toContain("NOT (status = 'failed' AND recipients = 0)");
    expect(check.params).toEqual([VALID.title]);
    expect(db._client.release).toHaveBeenCalledTimes(1);
  });

  it('the same title within 10 minutes → 409 NEWS_DUPLICATE, nobody gets anything', async () => {
    seedUsers(5, { optIn: () => true });
    dupRow = { id: 76 };
    const res = await send(VALID);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'NEWS_DUPLICATE', minutes: 10 });
    expect(clientTexts()).toContain('ROLLBACK');
    expect(statements.some((s) => s.text.includes('INSERT INTO news_posts'))).toBe(false);
    expect(inserts()).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(sendPushToUsers).not.toHaveBeenCalled();
    expect(db._client.release).toHaveBeenCalledTimes(1);
  });

  it('news_posts not migrated yet → 503 NEWS_UNAVAILABLE instead of an unguarded send', async () => {
    seedUsers(5);
    failOn = (text) => (text.includes('FROM news_posts')
      ? Object.assign(new Error('relation "news_posts" does not exist'), { code: '42P01' }) : null);
    const res = await send(VALID);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('NEWS_UNAVAILABLE');
    expect(inserts()).toHaveLength(0);
  });

  it('a fan-out that breaks mid-way says how many already have it and marks the post failed', async () => {
    seedUsers(CHUNK + 10);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    failOn = (text, params) => (text.includes('INSERT INTO notifications') && params[params.length - 1] > 0
      ? new Error('connection lost') : null);
    const res = await send({ ...VALID, push: false });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: 'NEWS_SEND_FAILED', recipients: CHUNK });
    const failed = statements.find((s) => s.text.includes("SET status = 'failed'"));
    expect(failed.params).toEqual([77, CHUNK]);
    expect(sendPushToUsers).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('audience + recent list degrade in the boot window', () => {
  it('no push_news column → pushOptIn 0, total still counted', async () => {
    seedUsers(4);
    failOn = (text) => (text.includes('push_news') ? Object.assign(new Error('x'), { code: '42703' }) : null);
    const res = makeRes();
    await news.getNewsAudience({}, res);
    expect(res.body).toEqual({ total: 4, pushOptIn: 0 });
  });

  it('no news_posts table → an empty list, not a 500', async () => {
    failOn = (text) => (text.includes('FROM news_posts') ? Object.assign(new Error('x'), { code: '42P01' }) : null);
    const res = makeRes();
    await news.listNews({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ news: [] });
  });
});
