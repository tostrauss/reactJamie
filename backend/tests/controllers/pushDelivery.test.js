import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// Push delivery paths that used to fail SILENTLY (tester 06.10.2026: "Die
// Push-Benachrichtigungen klappen leider immer noch nicht bei mir").
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';
process.env.VAPID_PUBLIC_KEY = 'test-public';
process.env.VAPID_PRIVATE_KEY = 'test-private';
process.env.APNS_KEY_ID = 'KEYID12345';
process.env.APNS_TEAM_ID = 'RTJNBK94F8';
process.env.APNS_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
process.env.APNS_BUNDLE_ID = 'com.jamie-app.app';

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureMessage: vi.fn() } }));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));
// node-apn: record every notification the provider is asked to send.
const apnSent = [];
vi.mock('@parse/node-apn', () => {
  class Notification {}
  class Provider {
    async send(notification, token) {
      apnSent.push({ notification, token });
      return { sent: [{ device: token }], failed: [] };
    }
  }
  return { default: { Provider, Notification } };
});

const db = (await import('../../src/config/database.js')).default;
const webpush = (await import('web-push')).default;
const {
  sendPushToUser, sendPushToUsers, subscribe, rememberDeadEndpoint, PUSH_CONVERSATION,
} = await import('../../src/controllers/pushController.js');

const webRow = (over = {}) => ({
  id: 11, user_id: 7, platform: 'web', locale: 'de',
  endpoint: 'https://fcm.googleapis.com/fcm/send/SECRET-TOKEN-abc',
  p256dh: 'p', auth_key: 'a', device_token: null, ...over,
});
const apnsRow = (over = {}) => ({
  id: 12, user_id: 7, platform: 'apns', locale: 'de',
  endpoint: null, p256dh: null, auth_key: null, device_token: 'devtoken', ...over,
});

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};

beforeEach(() => {
  vi.mocked(db.query).mockReset();
  vi.mocked(webpush.sendNotification).mockReset().mockResolvedValue({ statusCode: 201 });
  apnSent.length = 0;
});

describe('web push send options', () => {
  it('every web push carries a timeout — a hung request used to pin a semaphore slot forever', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [webRow()] });
    await sendPushToUser(7, 'T', 'B', '/x');
    const [, , options] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(options.timeout).toBe(10_000);
    // Non-conversation pushes keep the library defaults.
    expect(options.urgency).toBeUndefined();
    expect(options.TTL).toBeUndefined();
  });

  it('conversation pushes go out with urgency high (Android Doze) and a 24 h TTL', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [webRow({ user_id: 1 }), webRow({ id: 13, user_id: 2 })] });
    await sendPushToUsers([1, 2], 'T', 'B', '/chat/5', PUSH_CONVERSATION);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    for (const [, , options] of vi.mocked(webpush.sendNotification).mock.calls) {
      expect(options).toEqual({ timeout: 10_000, urgency: 'high', TTL: 86_400 });
    }
  });

  it('a conversation push to an iPhone survives an hour offline (APNs expiry follows the TTL)', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [apnsRow()] });
    const before = Math.floor(Date.now() / 1000);
    await sendPushToUser(7, 'T', 'B', '/dm/3', PUSH_CONVERSATION);
    expect(apnSent).toHaveLength(1);
    const { expiry } = apnSent[0].notification;
    expect(expiry).toBeGreaterThanOrEqual(before + 86_400);
    expect(expiry).toBeLessThanOrEqual(before + 86_400 + 5);
  });

  it('other iPhone pushes keep the one-hour expiry', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [apnsRow()] });
    const before = Math.floor(Date.now() / 1000);
    await sendPushToUser(7, 'T', 'B', '/notifications');
    expect(apnSent[0].notification.expiry).toBeLessThanOrEqual(before + 3600 + 5);
  });

  it('the subscriptions SELECT returns user_id, so failures can be attributed', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    await sendPushToUsers([1], 'T', 'B');
    expect(vi.mocked(db.query).mock.calls[0][0]).toMatch(/ps\.user_id/);
  });
});

describe('web push failures are logged with WHO, never with the endpoint', () => {
  it('a 410 prunes the row and says so (the prune used to be silent)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [webRow()] })   // subscriptions SELECT
      .mockResolvedValue({ rows: [] });              // DELETE
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
    await sendPushToUser(7, 'T', 'B');
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(db.query).mock.calls.some(([sql, params]) =>
      /DELETE FROM push_subscriptions WHERE id = \$1/.test(sql) && params[0] === 11)).toBe(true);
    const line = warn.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[push] pruning'));
    expect(line).toContain('user=7');
    expect(line).toContain('host=fcm.googleapis.com');
    // The endpoint is a bearer credential for this device's push channel.
    expect(line).not.toContain('SECRET-TOKEN');
    warn.mockRestore();
  });

  it('a 403 (VAPID mismatch) is logged with the user, and NOT pruned', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [webRow()] });
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    await sendPushToUser(7, 'T', 'B');
    expect(vi.mocked(db.query)).toHaveBeenCalledTimes(1); // no DELETE
    const line = err.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[push] web send failed'));
    expect(line).toContain('user=7');
    expect(line).toContain('status=403');
    expect(line).not.toContain('SECRET-TOKEN');
    err.mockRestore();
  });
});

describe('per-device results (admin "Test-Push senden")', () => {
  it('sendPushToUser resolves one verdict per device: accepted, pruned, rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [
        webRow({ id: 1 }),
        webRow({ id: 2, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x' }),
        webRow({ id: 3 }),
        apnsRow({ id: 4 }),
      ] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(webpush.sendNotification)
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    const results = await sendPushToUser(7, 'T', 'B');
    expect(results).toEqual([
      { id: 1, platform: 'web', host: 'fcm.googleapis.com', ok: true, status: 201 },
      { id: 2, platform: 'web', host: 'updates.push.services.mozilla.com', ok: false, status: 410, pruned: true },
      { id: 3, platform: 'web', host: 'fcm.googleapis.com', ok: false, status: 403, reason: 'Forbidden' },
      { id: 4, platform: 'apns', host: 'apns', ok: true },
    ]);
    warn.mockRestore();
    error.mockRestore();
  });

  it('resolves [] (not undefined) when the user has no device at all', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });
    expect(await sendPushToUser(7, 'T', 'B')).toEqual([]);
  });

  it('listPushDevices never exposes the endpoint or the device token', async () => {
    const { listPushDevices } = await import('../../src/controllers/pushController.js');
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [
      { id: 1, platform: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/SECRET', created_at: '2026-10-03' },
      { id: 2, platform: 'apns', endpoint: null, created_at: '2026-09-06' },
    ] });
    const out = await listPushDevices(7);
    expect(out).toEqual([
      { id: 1, platform: 'web', host: 'fcm.googleapis.com', registered_at: '2026-10-03' },
      { id: 2, platform: 'apns', host: 'apns', registered_at: '2026-09-06' },
    ]);
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(vi.mocked(db.query).mock.calls[0][0]).not.toMatch(/device_token/);
  });
});

describe('POST /push/subscribe never refuses the device registering right now', () => {
  const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/current', keys: { p256dh: 'p', auth: 'a' } };

  it('evicts the stalest rows instead of answering 429', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });
    const res = makeRes();
    await subscribe({ userId: 7, body }, res);
    expect(res.statusCode).toBe(200);
    // (the dead-endpoint lookup runs first — see the block below)
    const [evictSql, evictParams] = vi.mocked(db.query).mock.calls
      .find(([sql]) => /DELETE FROM push_subscriptions WHERE id IN/.test(sql));
    expect(evictSql).toMatch(/DELETE FROM push_subscriptions WHERE id IN/);
    expect(evictSql).toMatch(/ORDER BY created_at DESC/);
    // keep the 24 freshest OTHER rows + the one being registered = 25
    expect(evictParams).toEqual([7, body.endpoint, 24]);
    // and nothing in the flow counts rows to refuse with
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => /COUNT\(\*\)/.test(sql))).toBe(false);
  });

  it('a re-post refreshes created_at, so "stalest" means "not seen alive for longest"', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });
    await subscribe({ userId: 7, body }, makeRes());
    const upsert = vi.mocked(db.query).mock.calls.find(([sql]) => /INSERT INTO push_subscriptions/.test(sql))[0];
    expect(upsert).toMatch(/created_at = CURRENT_TIMESTAMP/);
  });
});

// Lea, 18.10.2026: the same dead endpoint was pruned for user 62 three times in
// one day — the browser re-posted it on every app start. The prune now
// remembers it (push_dead_endpoints) and subscribe refuses it with a signal
// the client answers by subscribing fresh.
describe('dead web endpoints are remembered and never re-registered', () => {
  const sha256 = (s) => createHash('sha256').update(s).digest('hex');
  const DEAD = 'https://fcm.googleapis.com/fcm/send/SECRET-TOKEN-abc';
  const deadInsert = () => vi.mocked(db.query).mock.calls
    .find(([sql]) => /INSERT INTO push_dead_endpoints/.test(sql));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const missingTable = () => Object.assign(new Error('relation "push_dead_endpoints" does not exist'), { code: '42P01' });

  it.each([410, 404])('a %i prune records the endpoint by sha256, never the URL itself', async (status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [webRow()] })   // subscriptions SELECT
      .mockResolvedValue({ rows: [] });              // DELETE + INSERT
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: status }));
    await sendPushToUser(7, 'T', 'B');
    await flush();
    const [sql, params] = deadInsert();
    expect(sql).toMatch(/ON CONFLICT \(endpoint_hash\) DO UPDATE SET pruned_at = NOW\(\)/);
    expect(params).toEqual([sha256(DEAD)]);
    expect(JSON.stringify(vi.mocked(db.query).mock.calls.slice(1))).not.toContain('SECRET-TOKEN');
    warn.mockRestore();
  });

  it('a failure that is not final (403, 500) is not remembered', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [webRow(), webRow({ id: 13 })] });
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }))
      .mockRejectedValueOnce(Object.assign(new Error('Boom'), { statusCode: 500 }));
    await sendPushToUser(7, 'T', 'B');
    await flush();
    expect(deadInsert()).toBeUndefined();
    err.mockRestore();
  });

  it('remembering tolerates a missing table (boot window): no warning, resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(db.query).mockRejectedValueOnce(missingTable());
    await expect(rememberDeadEndpoint(DEAD)).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('subscribe with a dead endpoint answers 409 { resubscribe: true } and writes NOTHING', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });   // dead lookup: hit
    const res = makeRes();
    await subscribe({ userId: 7, body: { endpoint: DEAD, keys: { p256dh: 'p', auth: 'a' } } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ resubscribe: true });
    // One query — the lookup, by hash. No eviction, no takeover, no upsert.
    expect(vi.mocked(db.query)).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(db.query).mock.calls[0];
    expect(sql).toMatch(/FROM push_dead_endpoints WHERE endpoint_hash = \$1/);
    expect(params).toEqual([sha256(DEAD)]);
    const line = warn.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('[push] refused dead web subscription'));
    expect(line).toContain('user=7');
    expect(line).not.toContain('SECRET-TOKEN');
    warn.mockRestore();
  });

  it('subscribe without the table (42P01) stores the subscription exactly as before', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(db.query)
      .mockRejectedValueOnce(missingTable())
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const res = makeRes();
    await subscribe({ userId: 7, body: { endpoint: DEAD, keys: { p256dh: 'p', auth: 'a' } } }, res);
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => /INSERT INTO push_subscriptions/.test(sql))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a live endpoint (no row) is stored as before', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });
    const res = makeRes();
    await subscribe({ userId: 7, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/fresh', keys: { p256dh: 'p', auth: 'a' } } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

// "Do Android pushes go out at all?" had no answer in the logs: only failures
// logged per device. One summary line per send call now.
describe('one summary line per send for the web rows', () => {
  it('bulk: counts ok / failed / pruned and the push-service hosts, never an endpoint or a full route', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [
        webRow({ id: 1, user_id: 1 }),
        webRow({ id: 2, user_id: 2 }),
        webRow({ id: 3, user_id: 2, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/SECRET-TOKEN-x' }),
        apnsRow({ id: 4, user_id: 3 }),
      ] })
      .mockResolvedValue({ rows: [] });
    vi.mocked(webpush.sendNotification)
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error('Boom'), { statusCode: 500 }));
    await sendPushToUsers([1, 2, 3], 'T', 'B', '/chat/55', PUSH_CONVERSATION);
    const lines = log.mock.calls.map((c) => c.join(' ')).filter((l) => l.startsWith('[push] web sent'));
    expect(lines).toEqual([
      '[push] web sent bulk users=3 kind=chat subs=3 ok=1 failed=1 pruned=1 hosts=fcm.googleapis.com:2,updates.push.services.mozilla.com:1',
    ]);
    expect(lines[0]).not.toContain('SECRET-TOKEN');
    expect(lines[0]).not.toContain('/chat/55');
    log.mockRestore(); warn.mockRestore(); error.mockRestore();
  });

  it('1:1: one line naming the recipient', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [webRow()] });
    await sendPushToUser(7, 'T', 'B', '/dm/3');
    expect(log.mock.calls.map((c) => c.join(' ')).filter((l) => l.startsWith('[push] web sent')))
      .toEqual(['[push] web sent user=7 kind=dm subs=1 ok=1 failed=0 pruned=0 hosts=fcm.googleapis.com:1']);
    log.mockRestore();
  });

  it('no web rows → no web line (iOS keeps its own per-send lines)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [apnsRow()] });
    await sendPushToUser(7, 'T', 'B');
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('[push] web sent'))).toBe(false);
    log.mockRestore();
  });
});
