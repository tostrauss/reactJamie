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
const { reportPushDiagnostics, browserFamily } = await import('../../src/controllers/pushController.js');

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
    // eslint-disable-next-line no-control-regex -- asserting control chars are GONE
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

// Web / Play-app counterpart (Lea, 18.10.2026: „Bei vielen Android-Nutzern
// funktionieren die Push-Benachrichtigungen gar nicht" — and every web-side
// failure stayed in the browser console). Same endpoint, its own line.
describe('reportPushDiagnostics — web / TWA ([push-diag])', () => {
  const SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
  const webReq = (userId, body, ua = SAMSUNG_UA) => ({ userId, body, headers: { 'user-agent': ua } });
  let log, warn;
  beforeEach(() => {
    log  = vi.spyOn(console, 'log').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Sentry.captureMessage.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('a denied start is ONE warn line with every field, the browser family taken from the User-Agent', () => {
    const res = mockRes();
    reportPushDiagnostics(webReq(62, {
      platform: 'twa', event: 'start', permission: 'denied', has_subscription: false,
      display_mode: 'standalone', android: '14',
    }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      '[push-diag] user=62 platform=twa ua=SamsungBrowser/26 android=14 display=standalone event=start permission=denied sub=no detail=-'
    );
  });

  it('a healthy start (granted + subscription) and a success are info lines', () => {
    reportPushDiagnostics(webReq(63, { platform: 'android-web', event: 'start', permission: 'granted', has_subscription: true }), mockRes());
    reportPushDiagnostics(webReq(63, { platform: 'android-web', event: 'subscribed', permission: 'granted', detail: 'resubscribed' }), mockRes());
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain('event=subscribed permission=granted sub=- detail=resubscribed');
  });

  it('granted but no subscription is a problem line — the "permission ≠ subscription" case', () => {
    reportPushDiagnostics(webReq(64, { platform: 'twa', event: 'start', permission: 'granted', has_subscription: false }), mockRes());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('permission=granted sub=no');
  });

  it('web failures are log-only — never Sentry (device churn would burn the quota)', () => {
    reportPushDiagnostics(webReq(65, {
      platform: 'twa', event: 'subscribe_failed', permission: 'granted',
      detail: 'subscribe:AbortError Registration failed - push service not available',
    }), mockRes());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('detail=subscribe:AbortError Registration failed');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('rejects an unknown web event with 400 (and iOS-only events do not leak into the web set)', () => {
    for (const event of ['made_up', 'registration_error']) {
      const res = mockRes();
      reportPushDiagnostics(webReq(66, { platform: 'web', event }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('client values outside the allowlists print as "-", free text is clipped and stripped', () => {
    reportPushDiagnostics(webReq(67, {
      platform: 'web', event: 'start', permission: 'evil\u001b[31m', has_subscription: 'yes',
      display_mode: 'x y', android: '14; DROP', detail: 'a‮b\n' + 'c'.repeat(400),
    }, 'curl/8'), mockRes());
    const line = warn.mock.calls[0][0];
    expect(line).toContain('ua=- android=- display=- event=start permission=- sub=-');
    // eslint-disable-next-line no-control-regex -- asserting control chars are GONE
    expect(line).not.toMatch(/[\u0000-\u001F\u007F-\u009F‮]/);
    expect(line.split('detail=')[1].length).toBeLessThanOrEqual(160);
  });

  it('guests are refused before anything is logged', () => {
    const res = mockRes();
    reportPushDiagnostics({ userId: 0, isGuest: true, body: { platform: 'twa', event: 'start' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(warn).not.toHaveBeenCalled();
  });

  it('caps one user at 30 lines an hour (429 after that, nothing logged) — other users unaffected', () => {
    const body = { platform: 'web', event: 'subscribe_failed', detail: 'post:http500' };
    for (let i = 0; i < 30; i++) reportPushDiagnostics(webReq(68, body), mockRes());
    const res = mockRes();
    reportPushDiagnostics(webReq(68, body), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(warn).toHaveBeenCalledTimes(30);
    // the iOS branch shares the budget …
    const ios = mockRes();
    reportPushDiagnostics({ userId: 68, body: { platform: 'ios', event: 'registration_error' } }, ios);
    expect(ios.status).toHaveBeenCalledWith(429);
    // … and another user still gets through.
    reportPushDiagnostics(webReq(69, body), mockRes());
    expect(warn).toHaveBeenCalledTimes(31);
  });
});

describe('browserFamily — Samsung Internet, Edge, Opera all ALSO say Chrome/', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Chrome/129'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 'SamsungBrowser/26'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0', 'Edge/129'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 OPR/84.0.0.0', 'Opera/84'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', 'Firefox/131'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari/18'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'iOS/17'],
    ['', '-'],
    [undefined, '-'],
  ])('%s → %s', (ua, family) => {
    expect(browserFamily(ua)).toBe(family);
  });
});
