import { describe, it, expect, vi, beforeEach } from 'vitest';

// Web Push client paths that failed SILENTLY (tester 06.10.2026: "Die
// Push-Benachrichtigungen klappen leider immer noch nicht bei mir").
const calls = [];
vi.mock('../utils/api.js', () => ({
  push: {
    getVapidKey: vi.fn(async () => { calls.push('getVapidKey'); return { data: { publicKey: 'BAAA' } }; }),
    subscribe: vi.fn(async () => { calls.push('subscribe'); return {}; }),
    unsubscribe: vi.fn(async () => { calls.push('unsubscribe'); return {}; }),
  },
}));
vi.mock('../utils/platform.js', () => ({ isNative: () => false }));
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
} = await import('../utils/pushNotifications.js');

let permission;
let existingSub;
const fakeSub = () => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  options: { applicationServerKey: new Uint8Array([4, 0, 0]).buffer },
  toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
});

beforeEach(() => {
  calls.length = 0;
  vi.mocked(pushApi.subscribe).mockClear();
  store.clear();
  permission = 'default';
  existingSub = null;
  globalThis.Notification = {
    get permission() { return permission; },
    requestPermission: vi.fn(async () => { calls.push('requestPermission'); permission = 'granted'; return 'granted'; }),
  };
  window.Notification = globalThis.Notification;
  window.PushManager = function PushManager() {};
  const reg = {
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
