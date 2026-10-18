import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Lea, 18.10.2026: „Bei vielen Android-Nutzern funktionieren die
// Push-Benachrichtigungen gar nicht." Once the web permission is DENIED (in
// the Play app: Android's own dialog answered "no"), NotificationPrompt never
// asks again and the app said nothing — WebPushDeniedBanner names the way back.
const store = vi.hoisted(() => new Map());
vi.mock('../utils/safeStorage', () => {
  const s = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return { safeStorage: s, safeSession: s, default: s };
});
const where = vi.hoisted(() => ({ value: 'android-app' }));
vi.mock('../utils/platform', async (importOriginal) => ({
  ...(await importOriginal()),
  pushSettingsLocation: () => where.value,
}));
const sync = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../utils/pushNotifications', () => ({
  isPushSupported: () => true,
  syncPushSubscription: sync,
  WEB_PUSH_DENIED_DISMISS_KEY: 'jamie_web_push_denied_dismissed',
}));

const { WebPushDeniedBanner, NativePushDeniedBanner, DISMISS_KEY } = await import('../components/NativePushDeniedBanner');

const WEB_KEY = 'jamie_web_push_denied_dismissed';
const TITLE = 'Benachrichtigungen sind ausgeschaltet';
let permission;
let permissionStatus;
const settle = () => act(() => { vi.advanceTimersByTime(3000); });

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  sync.mockClear();
  where.value = 'android-app';
  permission = 'denied';
  window.Notification = { get permission() { return permission; } };
  permissionStatus = { onchange: null };
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => permissionStatus) },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WebPushDeniedBanner', () => {
  it('Play app, permission denied: the Android steps, 3 s after mount, no CTA it could not keep', () => {
    render(<WebPushDeniedBanner />);
    expect(screen.queryByText(TITLE)).toBeNull();
    settle();
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(screen.getByText(/Einstellungen › Apps › JAMIE › Benachrichtigungen/)).toBeTruthy();
    // The page cannot open Android's settings — "Später" is the only button.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Später']);
  });

  it('an Android browser tab gets the site-permission steps instead', () => {
    where.value = 'android-browser';
    render(<WebPushDeniedBanner />);
    settle();
    expect(screen.getByText(/Adressleiste.*Berechtigungen › Benachrichtigungen › Zulassen/)).toBeTruthy();
    expect(screen.queryByText(/Apps › JAMIE/)).toBeNull();
  });

  it.each(['default', 'granted', 'unsupported'])('permission %s → no banner', (p) => {
    permission = p;
    render(<WebPushDeniedBanner />);
    settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['browser', 'ios-web', 'native'])('outside Android (%s) → no banner, even when denied', (w) => {
    where.value = w;
    render(<WebPushDeniedBanner />);
    settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('„Später" hides it and snoozes 14 days under its own key', () => {
    render(<WebPushDeniedBanner />);
    settle();
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(Number(store.get(WEB_KEY))).toBeGreaterThan(Date.now() - 5000);
    expect(store.has(DISMISS_KEY)).toBe(false);
  });

  it('stays away within the snooze (also the one a fresh denial writes), comes back after it', () => {
    store.set(WEB_KEY, String(Date.now() - 13 * 864e5));
    const first = render(<WebPushDeniedBanner />);
    settle();
    expect(screen.queryByRole('status')).toBeNull();
    first.unmount();
    store.set(WEB_KEY, String(Date.now() - 15 * 864e5));
    render(<WebPushDeniedBanner />);
    settle();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('switched back on while JAMIE is open: the banner goes and the subscription is made right away', async () => {
    render(<WebPushDeniedBanner />);
    await act(async () => {});            // permissions.query() resolves
    settle();
    expect(screen.getByRole('status')).toBeTruthy();
    permission = 'granted';
    act(() => { permissionStatus.onchange(); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('a return from Android settings (visibilitychange) re-reads the permission too', () => {
    render(<WebPushDeniedBanner />);
    settle();
    expect(screen.getByRole('status')).toBeTruthy();
    permission = 'granted';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a permission that STARTS granted is not "switched back on" — no extra subscribe', async () => {
    permission = 'granted';
    render(<WebPushDeniedBanner />);
    await act(async () => {});
    act(() => { permissionStatus.onchange(); });
    expect(sync).not.toHaveBeenCalled();
  });
});

describe('NativePushDeniedBanner (iOS) on the shared shell', () => {
  it('keeps its "Einstellungen öffnen" CTA and its own snooze key', () => {
    render(<NativePushDeniedBanner permission="denied" />);
    settle();
    expect(screen.getByText('Benachrichtigungen sind in iOS deaktiviert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Einstellungen öffnen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(store.has(DISMISS_KEY)).toBe(true);
    expect(store.has(WEB_KEY)).toBe(false);
  });

  it('hides as soon as the hook reports granted', () => {
    const { rerender } = render(<NativePushDeniedBanner permission="denied" />);
    settle();
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(<NativePushDeniedBanner permission="granted" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
