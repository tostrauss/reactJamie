import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NetworkProvider } from '../context/NetworkContext';

// „Keine Internetverbindung" swipes up (or taps) away — for the current
// offline spell only (Tina 16.11.2026). While it shows, <html> carries
// data-offline-banner + its height so the toasts start below it.

const OFFLINE = 'Keine Internetverbindung';
const goOffline = () => act(() => { window.dispatchEvent(new Event('offline')); });
const goOnline = () => act(() => { window.dispatchEvent(new Event('online')); });
const banner = () => screen.queryByText(OFFLINE)?.closest('.offline-banner') ?? null;
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
  it('shows on „offline" as a status message and lifts the toasts below it', () => {
    render(<NetworkProvider><div /></NetworkProvider>);
    expect(banner()).toBeNull();
    expect(root.hasAttribute('data-offline-banner')).toBe(false);

    goOffline();
    expect(banner()).toHaveAttribute('role', 'status');
    expect(root.hasAttribute('data-offline-banner')).toBe(true);
    expect(root.style.getPropertyValue('--offline-banner-h')).toMatch(/px$/);
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
