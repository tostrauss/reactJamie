import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NODE_ENV = 'test';

// ── DB / Sentry / Redis mocks (same shape as the other controller tests) ──
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({
  initSentry: vi.fn(),
  Sentry: { captureException: vi.fn(), captureMessage: vi.fn(), setupExpressErrorHandler: vi.fn() },
}));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { Sentry } = await import('../../src/config/sentry.js');
const { reportPushDiagnostics } = await import('../../src/controllers/pushController.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (body) => ({ userId: 42, body });

// The endpoint exists so device-side push failures become visible in Railway
// logs ([APNs-diag]). These tests pin the contract the app relies on: which
// events are accepted, which log level they land on, and which reach Sentry.
describe('reportPushDiagnostics', () => {
  let log, warn;
  beforeEach(() => {
    log  = vi.spyOn(console, 'log').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Sentry.captureMessage.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects unknown events with 400 (no log line, no Sentry)', () => {
    const res = mockRes();
    reportPushDiagnostics(req({ event: 'made_up' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('logs a successful registration at info level, without Sentry', () => {
    const res = mockRes();
    reportPushDiagnostics(req({ event: 'registered', detail: 'len 64', app_version: '1.4 (9)', platform: 'ios' }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0];
    expect(line).toContain('[APNs-diag]');
    expect(line).toContain('user=42');
    expect(line).toContain('event=registered');
    expect(line).toContain('app=1.4 (9)');
    expect(warn).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('treats permission=granted as healthy (info), permission=denied as a warning but NOT a Sentry event', () => {
    reportPushDiagnostics(req({ event: 'permission', permission: 'granted' }), mockRes());
    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    reportPushDiagnostics(req({ event: 'permission', permission: 'denied' }), mockRes());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('permission=denied');
    // Denied is expected user churn — it must not page anyone.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it.each(['registration_error', 'plugin_unavailable', 'import_failed', 'token_save_failed'])(
    'escalates %s to warn + Sentry (a broken build/server, not user churn)',
    (event) => {
      reportPushDiagnostics(req({ event, detail: 'boom' }), mockRes());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage.mock.calls[0][1]).toMatchObject({ tags: { area: 'push', kind: event } });
    },
  );

  it('rejects guest tokens with 403 (no device row to diagnose, no Sentry)', () => {
    const res = mockRes();
    reportPushDiagnostics({ userId: 0, isGuest: true, body: { event: 'registration_error' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('escalates to Sentry with a STABLE fingerprint and only once per user+event per hour', () => {
    // Different user id than the it.each above so the throttle map is fresh.
    reportPushDiagnostics({ userId: 777, body: { event: 'import_failed', detail: 'chunk A', app_version: '1.4.1 (10)' } }, mockRes());
    reportPushDiagnostics({ userId: 777, body: { event: 'import_failed', detail: 'chunk B', app_version: '1.4.1 (10)' } }, mockRes());
    // Both requests are LOGGED …
    expect(warn).toHaveBeenCalledTimes(2);
    // … but Sentry sees one event, grouped by (event, app), never by the free-text detail.
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = Sentry.captureMessage.mock.calls[0];
    expect(msg).toBe('[APNs-diag] import_failed app=1.4.1 (10)');
    expect(opts).toMatchObject({ fingerprint: ['apns-diag', 'import_failed', '1.4.1 (10)'], tags: { kind: 'import_failed' } });
    expect(opts.extra.detail).toBe('chunk A');
  });

  it('strips control characters and bidi overrides from client strings', () => {
    const detail = 'x\u001b[31mRED\u001b[0m\u202ey';
    reportPushDiagnostics({ userId: 778, body: { event: 'registration_error', detail } }, mockRes());
    const line = warn.mock.calls[0][0];
    expect(line).not.toMatch(/[\u0000-\u001F\u007F-\u009F\u202E]/);
    expect(line).toContain('detail=x[31mRED[0my');
  });

  it('clips oversized / multi-line detail so a client cannot flood the log', () => {
    const detail = ('x'.repeat(50) + '\n\n' + 'y'.repeat(500));
    reportPushDiagnostics(req({ event: 'registration_error', detail }), mockRes());
    const line = warn.mock.calls[0][0];
    expect(line).not.toContain('\n');
    // 160-char cap on detail (see clip() in the controller)
    const detailPart = line.split('detail=')[1];
    expect(detailPart.length).toBeLessThanOrEqual(160);
  });
});
