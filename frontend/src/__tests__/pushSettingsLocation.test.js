import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Where a blocked notification permission is switched back on — decides the
// text of WebPushDeniedBanner AND of the Settings row (Lea, 18.10.2026). The
// Android fallback (standalone without the TWA referrer) must NOT leak into
// isTWA(): that one gates Stripe, and a home-screen install keeps checkout.
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const UA = navigator.userAgent;
const setUA = (ua) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const setReferrer = (value) => Object.defineProperty(document, 'referrer', { value, configurable: true });
// display-mode media query: only `mode` matches (undefined = no matchMedia, like jsdom).
const setDisplayMode = (mode) => {
  if (mode === undefined) { delete window.matchMedia; return; }
  window.matchMedia = (q) => ({ matches: q === `(display-mode: ${mode})` });
};
// isTWA() caches per module instance — a fresh platform.js per scenario.
const loadPlatform = async () => {
  vi.resetModules();
  return import('../utils/platform');
};

const savedMatchMedia = window.matchMedia;
beforeEach(() => {
  sessionStorage.clear();
  setReferrer('');
  delete window.Capacitor;
});
afterEach(() => {
  setUA(UA);
  setReferrer('');
  if (savedMatchMedia) window.matchMedia = savedMatchMedia; else delete window.matchMedia;
});

describe('pushSettingsLocation', () => {
  it('the Play app (TWA referrer) → Android per-app settings', async () => {
    setUA(ANDROID_CHROME);
    setReferrer('android-app://jamie.app');
    setDisplayMode('standalone');
    const p = await loadPlatform();
    expect(p.pushSettingsLocation()).toBe('android-app');
  });

  it('standalone on Android WITHOUT the referrer (Samsung-hosted TWA, home-screen install) → per-app settings too, but isTWA() stays false', async () => {
    setUA(SAMSUNG);
    setDisplayMode('standalone');
    const p = await loadPlatform();
    expect(p.pushSettingsLocation()).toBe('android-app');
    expect(p.isTWA()).toBe(false);
  });

  it.each([['browser'], [undefined]])('an Android tab (display-mode %s) → the site permission', async (mode) => {
    setUA(ANDROID_CHROME);
    setDisplayMode(mode);
    const p = await loadPlatform();
    expect(p.pushSettingsLocation()).toBe('android-browser');
  });

  it('the iPhone home-screen web app → ios-web; a desktop browser → browser', async () => {
    setUA(IPHONE);
    setDisplayMode('standalone');
    let p = await loadPlatform();
    expect(p.pushSettingsLocation()).toBe('ios-web');
    setUA(DESKTOP);
    setDisplayMode('browser');
    p = await loadPlatform();
    expect(p.pushSettingsLocation()).toBe('browser');
  });

  it('the native app → native (its own banner)', async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const p = await loadPlatform();
    expect(p.pushSettingsLocation()).toBe('native');
    delete window.Capacitor;
  });
});
