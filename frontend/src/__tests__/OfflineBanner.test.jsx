import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NetworkProvider } from '../context/NetworkContext';

// „Keine Internetverbindung" swipes up (or taps) away — for the current
// offline spell only (Tina 16.11.2026). While it shows, <html> carries
// data-offline-banner + its height so the toasts start below it.
// Since the review of 16.11.2026 the banner is a button (keyboard and screen
// reader close it too) and the announcement comes from a live region that is
// always mounted — the same text is then on screen twice, so the banner is
// looked up by its class.

const OFFLINE = 'Keine Internetverbindung';
const HIDE = 'Hinweis „Keine Internetverbindung“ ausblenden';
const goOffline = () => act(() => { window.dispatchEvent(new Event('offline')); });
const goOnline = () => act(() => { window.dispatchEvent(new Event('online')); });
const banner = () => document.querySelector('.offline-banner');
const root = document.documentElement;

const swipeUp = (el) => {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 60 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 100, clientY: 50 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 100, clientY: 0 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 100, clientY: 0 });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('offline banner', () => {
  it('shows on „offline" and lifts the toasts below it', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    expect(banner()).toBeNull();
    expect(root.hasAttribute('data-offline-banner')).toBe(false);

    goOffline();
    expect(banner()).toHaveTextContent(OFFLINE);
    expect(root.hasAttribute('data-offline-banner')).toBe(true);
    expect(root.style.getPropertyValue('--offline-banner-h')).toMatch(/px$/);
  });

  it('is announced by a live region that is there from the start, not only with its text', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('sr-only', 'offline-status');
    expect(region).toBeEmptyDOMElement();

    goOffline();
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent(OFFLINE);
    goOnline();
    expect(region).toBeEmptyDOMElement();
  });

  // Review 16.11.2026: offline from the first render (a PWA or the iOS
  // bundle started in flight mode) — the region came with its text.
  it('a cold start without a network: the region is mounted empty first, its text follows', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      let atFirstCommit = null;
      const Probe = () => {
        // Layout effects run once this commit's DOM is in place.
        useLayoutEffect(() => { atFirstCommit = document.querySelector('.offline-status').textContent; }, []);
        return null;
      };
      render(<NetworkProvider><Probe /></NetworkProvider>);
      expect(atFirstCommit).toBe('');
      expect(screen.getByRole('status')).toHaveTextContent(OFFLINE);
      expect(banner()).toHaveTextContent(OFFLINE);
    } finally {
      delete window.navigator.onLine;   // the prototype's getter again
    }
  });

  it('is a button that says what it does — Enter or Space hides it', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    goOffline();
    const btn = screen.getByRole('button', { name: HIDE });
    expect(btn).toBe(banner());
    expect(btn).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(banner()).toBeNull();
    expect(root.hasAttribute('data-offline-banner')).toBe(false);

    goOnline();
    goOffline();
    fireEvent.keyDown(banner(), { key: ' ' });
    expect(banner()).toBeNull();
  });

  // Review 16.11.2026: closed by keyboard, the focus went to <body>.
  it('closed by keyboard, the focus goes back where it came from', () => {
    render(<NetworkProvider><button type="button">Davor</button></NetworkProvider>);
    goOffline();
    const before = screen.getByRole('button', { name: 'Davor' });
    before.focus();
    fireEvent.focus(banner(), { relatedTarget: before });   // Tab onto the banner
    banner().focus();
    fireEvent.keyDown(banner(), { key: 'Enter' });
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('other keys leave it alone', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    goOffline();
    fireEvent.keyDown(banner(), { key: 'Tab' });
    expect(banner()).not.toBeNull();
  });

  it('a swipe up hides it for this offline spell; the next one shows it again', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    goOffline();
    swipeUp(banner());
    act(() => { vi.advanceTimersByTime(180); });
    expect(banner()).toBeNull();
    expect(root.hasAttribute('data-offline-banner')).toBe(false);
    expect(root.style.getPropertyValue('--offline-banner-h')).toBe('');

    goOnline();
    goOffline();
    expect(banner()).not.toBeNull();
    expect(root.hasAttribute('data-offline-banner')).toBe(true);
  });

  it('a tap hides it too', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    goOffline();
    fireEvent.click(banner(), { detail: 1 });
    expect(banner()).toBeNull();
  });

  it('back online removes it and the toast offset', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    goOffline();
    goOnline();
    expect(banner()).toBeNull();
    expect(root.hasAttribute('data-offline-banner')).toBe(false);
  });
});
