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
