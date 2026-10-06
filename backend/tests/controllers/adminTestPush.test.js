import { describe, it, expect, vi, beforeEach } from 'vitest';

// Admin "Test-Push senden" (support tool for "Push klappt bei mir nicht",
// tester 06.10.2026): it must travel like a chat push — urgency high, or
// Android Doze holds it until the phone is unlocked and the test wrongly reads
// "device broken" — and expire after 10 minutes instead of popping up later.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';
process.env.VAPID_PUBLIC_KEY = 'test-public';
process.env.VAPID_PRIVATE_KEY = 'test-private';

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureMessage: vi.fn() } }));
vi.mock('../../src/socket.js', () => ({ revokeUserSessions: vi.fn() }));
vi.mock('../../src/jobs/backup.js', () => ({
  isBackupConfigured: () => false, missingBackupEnv: () => [], listBackupObjects: vi.fn(), DB_BACKUP_PREFIX: 'db/',
}));
vi.mock('geoip-lite', () => ({ default: { lookup: () => null } }));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const db = (await import('../../src/config/database.js')).default;
const webpush = (await import('web-push')).default;
const { sendUserTestPush } = await import('../../src/controllers/adminController.js');
const { PUSH_TEST } = await import('../../src/controllers/pushController.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};

beforeEach(() => {
  vi.mocked(db.query).mockReset();
  vi.mocked(webpush.sendNotification).mockReset().mockResolvedValue({ statusCode: 201 });
});

describe('sendUserTestPush', () => {
  it('goes out with urgency high and a 10-minute TTL, and reports the device verdict', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] }) // the user exists
      .mockResolvedValueOnce({ rows: [{
        id: 11, user_id: 7, platform: 'web', locale: 'de',
        endpoint: 'https://fcm.googleapis.com/fcm/send/SECRET', p256dh: 'p', auth_key: 'a', device_token: null,
      }] });
    const res = makeRes();
    await sendUserTestPush({ params: { id: '7' }, userId: 1 }, res);
    expect(PUSH_TEST).toEqual({ urgency: 'high', ttl: 600 });
    const [, , options] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(options).toEqual({ timeout: 10_000, urgency: 'high', TTL: 600 });
    expect(res.body.results[0]).toMatchObject({ ok: true, status: 201 });
    log.mockRestore();
  });

  it('404 for an unknown user, without sending anything', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = makeRes();
    await sendUserTestPush({ params: { id: '99' }, userId: 1 }, res);
    expect(res.statusCode).toBe(404);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
