import { describe, it, expect, vi, beforeEach } from 'vitest';

// Web Push client paths that failed SILENTLY (tester 06.10.2026: "Die
// Push-Benachrichtigungen klappen leider immer noch nicht bei mir").
const calls = [];
vi.mock('../utils/api.js', () => ({
  push: {
    getVapidKey: vi.fn(async () => { calls.push('getVapidKey'); return { data: { publicKey: 'BAAA' } }; }),
    subscribe: vi.fn(async () => { calls.push('subscribe'); return {}; }),
    unsubscribe: vi.fn(async () => { calls.push('unsubscribe'); return {}; }),
    reportDiagnostics: vi.fn(async () => ({})),
  },
}));
// An Android home-screen / Play-app context as far as the diagnostics care.
vi.mock('../utils/platform.js', () => ({
  isNative: () => false,
  isTWA: () => false,
  isAndroidWeb: () => true,
  isIOSWeb: () => false,
  displayMode: () => 'standalone',
}));
// In-memory storage: the test runtime's localStorage is not dependable here.
const store = new Map();
vi.mock('../utils/safeStorage.js', () => ({
  safeStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
}));

const { push: pushApi } = await import('../utils/api.js');
const {
  subscribeToPush, syncPushSubscription, unsubscribeFromPush, hasOptedOutOfPush,
  isPushSubscribed, reportPushStartDiagnostics, WEB_PUSH_DENIED_DISMISS_KEY,
} = await import('../utils/pushNotifications.js');
const { START_KEY, describePushError, _resetPushDiagForTests } = await import('../utils/pushDiagnostics.js');

const LIVE = 'https://fcm.googleapis.com/fcm/send/x';
const DEAD = 'https://fcm.googleapis.com/fcm/send/dead';

let permission;
let existingSub;
let reg;
const fakeSub = (endpoint = LIVE) => ({
  endpoint,
  options: { applicationServerKey: new Uint8Array([4, 0, 0]).buffer },
  toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
});
// The diagnostics POST runs detached from the push flow — let it land.
const flush = () => new Promise((r) => setTimeout(r, 0));
const diag = (event) => vi.mocked(pushApi.reportDiagnostics).mock.calls
  .map(([payload]) => payload).filter((p) => p.event === event);

beforeEach(() => {
  calls.length = 0;
  // mockReset, not mockClear: a queued ...Once() must never leak into the next test.
  vi.mocked(pushApi.subscribe).mockReset()
    .mockImplementation(async () => { calls.push('subscribe'); return {}; });
  vi.mocked(pushApi.getVapidKey).mockReset()
    .mockImplementation(async () => { calls.push('getVapidKey'); return { data: { publicKey: 'BAAA' } }; });
  vi.mocked(pushApi.reportDiagnostics).mockReset().mockResolvedValue({});
  _resetPushDiagForTests();
  store.clear();
  permission = 'default';
  existingSub = null;
  globalThis.Notification = {
    get permission() { return permission; },
    requestPermission: vi.fn(async () => { calls.push('requestPermission'); permission = 'granted'; return 'granted'; }),
  };
  window.Notification = globalThis.Notification;
  window.PushManager = function PushManager() {};
  reg = {
    pushManager: {
      getSubscription: vi.fn(async () => existingSub),
      subscribe: vi.fn(async () => { calls.push('pushManager.subscribe'); existingSub = fakeSub(); return existingSub; }),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) },
  });
});

describe('subscribeToPush (explicit opt-in from a tap)', () => {
  it('asks for permission BEFORE any network round trip — WebKit drops the prompt once the tap gesture is gone', async () => {
    expect(await subscribeToPush()).toBe(true);
    expect(calls[0]).toBe('requestPermission');
    expect(calls.indexOf('requestPermission')).toBeLessThan(calls.indexOf('getVapidKey'));
    expect(calls).toContain('subscribe');
  });

  it('a denied prompt subscribes nothing', async () => {
    Notification.requestPermission = vi.fn(async () => 'denied');
    expect(await subscribeToPush()).toBe(false);
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });

  it('switching push on again clears a previous opt-out', async () => {
    await unsubscribeFromPush({ optOut: true });
    expect(hasOptedOutOfPush()).toBe(true);
    await subscribeToPush();
    expect(hasOptedOutOfPush()).toBe(false);
  });
});

describe('the Settings switch-off sticks', () => {
  it('syncPushSubscription does not silently re-subscribe a user who switched push off', async () => {
    permission = 'granted';
    existingSub = fakeSub();
    await unsubscribeFromPush({ optOut: true });
    vi.mocked(pushApi.subscribe).mockClear();
    expect(await syncPushSubscription()).toBe(false);
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });

  it('logout only detaches the device — it does not record an opt-out', async () => {
    permission = 'granted';
    existingSub = fakeSub();
    await unsubscribeFromPush();
    expect(hasOptedOutOfPush()).toBe(false);
  });

  it('without an opt-out, sync still creates the missing subscription (the TWA permission≠subscription fix)', async () => {
    permission = 'granted';
    expect(await syncPushSubscription()).toBe(true);
    expect(calls).toContain('pushManager.subscribe');
    expect(pushApi.subscribe).toHaveBeenCalledTimes(1);
  });
});

// Lea, 18.10.2026: a subscription the push service answered 404/410 for was
// pruned, then re-posted by the browser on every start and pruned again —
// forever. The server now refuses it with 409 { resubscribe: true }.
describe('a dead subscription is replaced, not re-posted forever', () => {
  const refusedAsDead = () => Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: { status: 409, data: { error: 'Subscription expired', resubscribe: true } },
  });

  it('on the signal: unsubscribe the dead one, subscribe fresh (no prompt), post the new one', async () => {
    permission = 'granted';
    const dead = fakeSub(DEAD);
    existingSub = dead;
    vi.mocked(pushApi.subscribe).mockRejectedValueOnce(refusedAsDead());
    expect(await syncPushSubscription()).toBe(true);
    expect(dead.unsubscribe).toHaveBeenCalledTimes(1);
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(pushApi.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pushApi.subscribe).mock.calls[0][0].endpoint).toBe(DEAD);
    expect(vi.mocked(pushApi.subscribe).mock.calls[1][0].endpoint).toBe(LIVE);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    await flush();
    expect(diag('subscribed')).toEqual([expect.objectContaining({ detail: 'resubscribed', permission: 'granted' })]);
  });

  it('retries ONCE — a second refusal fails instead of looping, and says where', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    permission = 'granted';
    existingSub = fakeSub(DEAD);
    vi.mocked(pushApi.subscribe).mockRejectedValueOnce(refusedAsDead()).mockRejectedValueOnce(refusedAsDead());
    expect(await syncPushSubscription()).toBe(false);
    expect(pushApi.subscribe).toHaveBeenCalledTimes(2);
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1);
    await flush();
    expect(diag('subscribe_failed')).toEqual([
      expect.objectContaining({ detail: 'resubscribe:http409 Subscription expired' }),
    ]);
    warn.mockRestore();
  });

  it.each([
    ['a 409 without the flag', { status: 409, data: {} }],
    ['a 500', { status: 500, data: { error: 'Internal server error' } }],
  ])('%s is NOT taken for a dead subscription', async (_label, response) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    permission = 'granted';
    const sub = fakeSub();
    existingSub = sub;
    vi.mocked(pushApi.subscribe).mockRejectedValueOnce(Object.assign(new Error('x'), { isAxiosError: true, response }));
    expect(await syncPushSubscription()).toBe(false);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(pushApi.subscribe).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('the explicit opt-in recovers the same way', async () => {
    existingSub = fakeSub(DEAD);
    vi.mocked(pushApi.subscribe).mockRejectedValueOnce(refusedAsDead());
    expect(await subscribeToPush()).toBe(true);
    expect(pushApi.subscribe).toHaveBeenCalledTimes(2);
    await flush();
    expect(diag('subscribed')).toEqual([expect.objectContaining({ detail: 'optin resubscribed' })]);
  });
});

// A leftover subscription without the permission delivers nothing, but it
// kept the banner away and made Settings say "an" (Lea, 18.10.2026).
describe('isPushSubscribed needs the permission, not just a subscription', () => {
  it.each(['default', 'denied'])('a leftover subscription with permission %s is NOT subscribed', async (p) => {
    permission = p;
    existingSub = fakeSub();
    expect(await isPushSubscribed()).toBe(false);
  });

  it('granted + subscription is subscribed; granted alone is not', async () => {
    permission = 'granted';
    expect(await isPushSubscribed()).toBe(false);
    existingSub = fakeSub();
    expect(await isPushSubscribed()).toBe(true);
  });
});

describe('[push-diag] reporting', () => {
  it('reports what the prompt answered; a fresh "no" snoozes the denied banner', async () => {
    Notification.requestPermission = vi.fn(async () => { permission = 'denied'; return 'denied'; });
    expect(await subscribeToPush()).toBe(false);
    await flush();
    expect(diag('permission')).toEqual([expect.objectContaining({
      permission: 'denied', detail: 'prompt', platform: 'android-web', display_mode: 'standalone',
    })]);
    expect(Number(store.get(WEB_PUSH_DENIED_DISMISS_KEY))).toBeGreaterThan(Date.now() - 5000);
  });

  it('a refused subscribe() names the stage and the DOMException', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reg.pushManager.subscribe = vi.fn(async () => {
      throw new DOMException('Registration failed - push service not available', 'AbortError');
    });
    expect(await subscribeToPush()).toBe(false);
    await flush();
    expect(diag('subscribe_failed')).toEqual([expect.objectContaining({
      permission: 'granted', detail: 'subscribe:AbortError Registration failed - push service not available',
    })]);
    error.mockRestore();
  });

  it('a failure repeating on every mount is reported once per page load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    permission = 'granted';
    const unavailable = () => Object.assign(new Error('503'), { isAxiosError: true, response: { status: 503, data: { error: 'Push not configured' } } });
    vi.mocked(pushApi.getVapidKey).mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable());
    await syncPushSubscription();
    await syncPushSubscription();
    await flush();
    expect(diag('subscribe_failed')).toEqual([expect.objectContaining({ detail: 'vapid:http503 Push not configured' })]);
    warn.mockRestore();
  });

  it('a healthy re-post on start reports nothing (the daily start line covers it)', async () => {
    permission = 'granted';
    existingSub = fakeSub();
    expect(await syncPushSubscription()).toBe(true);
    await flush();
    expect(pushApi.reportDiagnostics).not.toHaveBeenCalled();
  });

  it('start: once a day per device, with the subscription as FOUND — a leftover counts even without permission', async () => {
    existingSub = fakeSub();
    await reportPushStartDiagnostics();
    await flush();
    expect(diag('start')).toEqual([expect.objectContaining({ permission: 'default', has_subscription: true, platform: 'android-web' })]);
    await reportPushStartDiagnostics();
    await flush();
    expect(diag('start')).toHaveLength(1);
    store.set(START_KEY, String(Date.now() - 25 * 60 * 60 * 1000));
    await reportPushStartDiagnostics();
    await flush();
    expect(diag('start')).toHaveLength(2);
  });

  it('a start report that did not get through is retried on the next start', async () => {
    vi.mocked(pushApi.reportDiagnostics).mockRejectedValueOnce(new Error('offline'));
    await reportPushStartDiagnostics();
    await flush();
    expect(store.has(START_KEY)).toBe(false);
    await reportPushStartDiagnostics();
    await flush();
    expect(pushApi.reportDiagnostics).toHaveBeenCalledTimes(2);
    expect(store.has(START_KEY)).toBe(true);
  });

  it('a browser without the Push API still reports its start, as "unsupported"', async () => {
    delete window.PushManager;
    await reportPushStartDiagnostics();
    await flush();
    expect(diag('start')).toEqual([expect.objectContaining({ permission: 'unsupported', has_subscription: false })]);
  });

  it('describePushError: stage + error name + message, our API errors by HTTP status', () => {
    expect(describePushError(Object.assign(new DOMException('denied', 'NotAllowedError'), { pushStage: 'subscribe' })))
      .toBe('subscribe:NotAllowedError denied');
    expect(describePushError({ isAxiosError: true, code: 'ERR_NETWORK', pushStage: 'post' })).toBe('post:ERR_NETWORK');
    expect(describePushError('weird')).toBe('-:Error weird');
    expect(describePushError(new Error('x'.repeat(300)))).toHaveLength(160);
  });
});
