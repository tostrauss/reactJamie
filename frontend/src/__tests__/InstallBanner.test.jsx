import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Chrome fires beforeinstallprompt ONCE per page load. Right after an e-mail
// sign-up AppIntro replaces the whole shell, which unmounted the banner that
// held the event — „JAMIE installieren" then never came for the session
// (review 11.10.2026). The event now lives in utils/installPrompt.js.
const store = vi.hoisted(() => new Map());
vi.mock('../utils/safeStorage', () => {
  const s = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return { safeStorage: s, safeSession: s, default: s };
});

const {
  captureInstallPrompt, getInstallPrompt, resetInstallPromptForTests, INSTALL_DISMISSED_KEY,
} = await import('../utils/installPrompt');
const { InstallBanner } = await import('../components/InstallBanner');

// A stand-in for Chrome's BeforeInstallPromptEvent.
const fireInstallEvent = (outcome = 'accepted') => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = vi.fn();
  e.userChoice = Promise.resolve({ outcome });
  act(() => { window.dispatchEvent(e); });
  return e;
};
const banner = () => screen.queryByText('JAMIE installieren');

const UA = navigator.userAgent;
const setUA = (ua) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });

beforeEach(() => {
  store.clear();
  resetInstallPromptForTests();
  setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36');
  captureInstallPrompt();   // what main.jsx does before React mounts
});
afterEach(() => {
  resetInstallPromptForTests();
  setUA(UA);
});

describe('install prompt — caught outside React', () => {
  it('an event fired while no banner is mounted (AppIntro up) is kept and shown by the banner that mounts later', () => {
    const e = fireInstallEvent();
    expect(e.defaultPrevented).toBe(true);
    expect(getInstallPrompt()).toBe(e);
    render(<InstallBanner />);
    expect(banner()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Installieren' })).toBeTruthy();
  });

  it('survives the banner unmounting and mounting again (sign-up → AppIntro → onboarding → Home)', () => {
    const first = render(<InstallBanner suppressed />);
    fireInstallEvent();
    expect(banner()).toBeNull();                  // hidden during the sign-up flow
    first.unmount();                              // AppIntro replaces the shell
    render(<InstallBanner suppressed={false} />); // back on Home
    expect(banner()).not.toBeNull();
  });

  it('an event fired while the banner is mounted still shows it, and suppressed only hides it', () => {
    const { rerender } = render(<InstallBanner suppressed />);
    fireInstallEvent();
    expect(banner()).toBeNull();
    rerender(<InstallBanner suppressed={false} />);
    expect(banner()).not.toBeNull();
  });

  it('„Installieren" opens Chrome\'s prompt once and spends the event', async () => {
    const e = fireInstallEvent('accepted');
    render(<InstallBanner />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Installieren' })); });
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallPrompt()).toBeNull();
    expect(banner()).toBeNull();
  });

  it('within the 7-day snooze after „✕" Chrome keeps its own prompt: no preventDefault, no banner', () => {
    store.set(INSTALL_DISMISSED_KEY, String(Date.now() - 60_000));
    const e = fireInstallEvent();
    expect(e.defaultPrevented).toBe(false);
    expect(getInstallPrompt()).toBeNull();
    render(<InstallBanner />);
    expect(banner()).toBeNull();
  });

  it('an expired snooze no longer holds it back', () => {
    store.set(INSTALL_DISMISSED_KEY, String(Date.now() - 8 * 864e5));
    const e = fireInstallEvent();
    expect(e.defaultPrevented).toBe(true);
    render(<InstallBanner />);
    expect(banner()).not.toBeNull();
  });

  it('„✕" hides the banner and starts the snooze', () => {
    fireInstallEvent();
    render(<InstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(banner()).toBeNull();
    expect(Number(store.get(INSTALL_DISMISSED_KEY))).toBeGreaterThan(Date.now() - 5000);
  });

  it('iOS shows the share-sheet hint without any event', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    render(<InstallBanner />);
    expect(banner()).not.toBeNull();
    expect(screen.getByText('Zum Home-Bildschirm')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Installieren' })).toBeNull();
  });
});
