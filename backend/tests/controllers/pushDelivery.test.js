import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  sendPushToUser, sendPushToUsers, subscribe, PUSH_CONVERSATION,
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
    const [evictSql, evictParams] = vi.mocked(db.query).mock.calls[0];
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
