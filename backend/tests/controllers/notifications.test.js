import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

// The bell on Home (Robert / Lea, 18.10.2026): its list renders by type, so
// every row carries the sender and the referenced group/club; the badge comes
// from a capped unread count; and opening the list marks read only what it
// actually showed.
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureException: vi.fn(), captureMessage: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const db = (await import('../../src/config/database.js')).default;
const { getNotifications, getUnreadCount, markRead, UNREAD_COUNT_CAP } =
  await import('../../src/controllers/notificationController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((o) => { res.body = o; return res; });
  return res;
};

beforeEach(() => vi.mocked(db.query).mockReset());

describe('getNotifications — list shape', () => {
  it('joins sender + referenced group/club and adds sender, reference_name, reference_gone', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [
      // hof_like from a liker, about a live group
      { id: 3, user_id: 7, sender_id: 12, type: 'hof_like', title: 'Anna gefällt …', message: null,
        reference_type: 'group', reference_id: 40, is_read: false, created_at: '2026-10-18T10:00:00Z',
        sender_name: 'Anna', sender_avatar: '/media/a.webp', sender_age: 29,
        reference_name: 'Laufen im Prater', reference_gone: false },
      // news from JAMIE: no sender, a link, no reference
      { id: 2, user_id: 7, sender_id: null, type: 'news', title: 'Neue Deals', message: 'Schau rein',
        reference_type: null, reference_id: null, link: '/deal/12', is_read: false, created_at: '2026-10-18T09:00:00Z',
        sender_name: null, sender_avatar: null, sender_age: null, reference_name: null, reference_gone: null },
      // a club that was deleted since
      { id: 1, user_id: 7, sender_id: 5, type: 'club_deleted', title: 'Club gelöscht', message: '…',
        reference_type: 'club', reference_id: 9, is_read: true, created_at: '2026-10-17T09:00:00Z',
        sender_name: 'Owner', sender_avatar: null, sender_age: 41, reference_name: 'Weg', reference_gone: true },
    ] });
    const res = makeRes();
    await getNotifications({ userId: 7 }, res);

    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(params).toEqual([7]);
    expect(sql).toContain('LEFT JOIN users u ON n.sender_id = u.id');
    expect(sql).toContain("LEFT JOIN groups g ON n.reference_type IN ('group', 'club') AND g.id = n.reference_id");
    expect(sql).toContain('ORDER BY n.created_at DESC, n.id DESC');
    expect(sql).toContain('LIMIT 50');

    const [like, newsRow, gone] = res.body;
    expect(like.sender).toEqual({ id: 12, name: 'Anna', avatar: '/media/a.webp' });
    expect(like.reference_name).toBe('Laufen im Prater');
    expect(like.reference_gone).toBe(false);
    // legacy fields stay for older bundles
    expect(like.sender_name).toBe('Anna');
    expect(newsRow.sender).toBeNull();
    expect(newsRow.link).toBe('/deal/12');
    expect(newsRow.reference_gone).toBe(false);   // NULL from SQL → a real boolean
    expect(gone.reference_gone).toBe(true);
    expect(gone.sender).toEqual({ id: 5, name: 'Owner', avatar: null });
  });

  it('a sender whose account is gone (sender_id kept, no user row) → sender null', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [
      { id: 1, sender_id: 99, sender_name: null, type: 'hof_like', reference_type: 'group', reference_id: 1 },
    ] });
    const res = makeRes();
    await getNotifications({ userId: 7 }, res);
    expect(res.body[0].sender).toBeNull();
  });

  it('500 with an error string when the DB rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockRejectedValueOnce(new Error('boom'));
    const res = makeRes();
    await getNotifications({ userId: 7 }, res);
    expect(res.statusCode).toBe(500);
    expect(typeof res.body.error).toBe('string');
    error.mockRestore();
  });
});

describe('getUnreadCount — the badge', () => {
  it('counts unread rows of THIS user, bounded by the cap', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ count: 4 }] });
    const res = makeRes();
    await getUnreadCount({ userId: 7 }, res);
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(params).toEqual([7]);
    expect(sql).toContain('WHERE user_id = $1 AND is_read = FALSE');
    expect(sql).toContain(`LIMIT ${UNREAD_COUNT_CAP}`);
    expect(res.body).toEqual({ count: 4 });
  });

  it('guests get 0 without a query', async () => {
    const res = makeRes();
    await getUnreadCount({ userId: 0, isGuest: true }, res);
    expect(res.body).toEqual({ count: 0 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('500 when the DB rejects (the client keeps its last badge)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockRejectedValueOnce(new Error('boom'));
    const res = makeRes();
    await getUnreadCount({ userId: 7 }, res);
    expect(res.statusCode).toBe(500);
    error.mockRestore();
  });
});

describe('markRead — only what the list showed', () => {
  it('with upToId: marks rows up to that id only', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 2 });
    const res = makeRes();
    await markRead({ userId: 7, body: { upToId: 41 } }, res);
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toContain('AND id <= $2');
    expect(params).toEqual([7, 41]);
    expect(res.body).toEqual({ success: true });
  });

  it.each([
    ['no body (older bundles)', undefined],
    ['a string id', { upToId: '41' }],
    ['a negative id', { upToId: -1 }],
    ['an id beyond INTEGER', { upToId: 2 ** 31 }],
  ])('%s → marks everything, as before', async (_label, body) => {
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 0 });
    const res = makeRes();
    await markRead({ userId: 7, body }, res);
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).not.toContain('id <=');
    expect(params).toEqual([7]);
  });
});
