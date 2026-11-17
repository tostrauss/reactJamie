import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import ReconnectBanner from '../components/ReconnectBanner';

// „Verbindung unterbrochen – Wiederverbindung...“ under the chat header was
// the one network notice that could not be swiped away (audit
// S1-chat-reconnect-leiste; Tina: „diese Mitteilung sollte man nach oben
// swipen können“). It swipes up or taps away now, for the current disconnect
// only — like the offline banner. Real German i18n.

const TEXT = 'Verbindung unterbrochen – Wiederverbindung...';
const HIDE = 'Hinweis „Verbindung unterbrochen“ ausblenden';
const banner = () => document.querySelector('.reconnect-banner');

const swipe = (el, [x0, y0], [x1, y1]) => {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x0, clientY: y0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: (x0 + x1) / 2, clientY: (y0 + y1) / 2 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x1, clientY: y1 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x1, clientY: y1 });
};

// The pages mount the banner while the socket is down and unmount it when it
// is back — exactly this.
function Chat() {
  const [connected, setConnected] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setConnected((c) => !c)}>socket</button>
      {!connected && <ReconnectBanner />}
    </>
  );
}
const toggleSocket = () => fireEvent.click(screen.getByRole('button', { name: 'socket' }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ReconnectBanner', () => {
  it('shows the sentence, and is a button that says what it does', () => {
    render(<ReconnectBanner />);
    expect(banner()).toHaveTextContent(TEXT);
    const btn = screen.getByRole('button', { name: HIDE });
    expect(btn).toBe(banner());
    expect(btn).toHaveAttribute('tabindex', '0');
    // No live region: the same sentence is already announced as a toast.
    expect(screen.queryByRole('status')).toBeNull();
    expect(btn).not.toHaveAttribute('aria-live');
  });

  it('a swipe up of 60 px sends it off — gone after the 180 ms exit', () => {
    render(<ReconnectBanner />);
    swipe(banner(), [100, 80], [100, 20]);
    expect(banner()).not.toBeNull();                 // still leaving
    act(() => { vi.advanceTimersByTime(180); });
    expect(banner()).toBeNull();
  });

  it('a short pull up springs back', () => {
    render(<ReconnectBanner />);
    swipe(banner(), [100, 80], [100, 62]);            // 18 px, slowly
    act(() => { vi.advanceTimersByTime(400); });
    expect(banner()).not.toBeNull();
  });

  it('a tap hides it', () => {
    render(<ReconnectBanner />);
    fireEvent.click(banner());
    expect(banner()).toBeNull();
  });

  it('Enter or Space hides it', () => {
    const { unmount } = render(<ReconnectBanner />);
    fireEvent.keyDown(banner(), { key: 'Enter' });
    expect(banner()).toBeNull();
    unmount();
    render(<ReconnectBanner />);
    fireEvent.keyDown(banner(), { key: ' ' });
    expect(banner()).toBeNull();
  });

  it('other keys leave it alone', () => {
    render(<ReconnectBanner />);
    fireEvent.keyDown(banner(), { key: 'Tab' });
    fireEvent.keyDown(banner(), { key: 'a' });
    expect(banner()).not.toBeNull();
  });

  it('closed by keyboard, the focus goes back where it came from', () => {
    render(<><button type="button">Davor</button><ReconnectBanner /></>);
    const before = screen.getByRole('button', { name: 'Davor' });
    before.focus();
    fireEvent.focus(banner(), { relatedTarget: before });   // Tab onto the banner
    banner().focus();
    fireEvent.keyDown(banner(), { key: 'Enter' });
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('hidden for THIS disconnect only: reconnected and cut off again, it is back', () => {
    render(<Chat />);
    fireEvent.click(banner());
    expect(banner()).toBeNull();
    toggleSocket();                                   // the socket is back: the page unmounts it
    expect(banner()).toBeNull();
    toggleSocket();                                   // …and drops again
    expect(banner()).toHaveTextContent(TEXT);
    // Same after a swipe.
    swipe(banner(), [100, 80], [100, 20]);
    act(() => { vi.advanceTimersByTime(180); });
    expect(banner()).toBeNull();
    toggleSocket();
    toggleSocket();
    expect(banner()).not.toBeNull();
  });

  // The chat pages go back on a horizontal swipe (useSwipeBack) — a sideways
  // drag over the banner must neither hide it nor swallow that gesture.
  it('a sideways drag does nothing: the banner stays and the gesture reaches the page', () => {
    const pageMove = vi.fn();
    render(<div onPointerMove={pageMove}><ReconnectBanner /></div>);
    swipe(banner(), [40, 80], [200, 84]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(banner()).not.toBeNull();
    expect(banner().style.transform).toBe('');
    expect(pageMove).toHaveBeenCalled();
  });

  it('a pull down only stretches a little and springs back', () => {
    render(<ReconnectBanner />);
    swipe(banner(), [100, 20], [100, 120]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(banner()).not.toBeNull();
  });
});

// jsdom loads no stylesheet — the rules the swipe depends on are pinned on
// the file (pattern of GroupDetailPills.test.jsx).
describe('chat.css — the banner can be swiped, and leaves under the header', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../styles/chat.css'), 'utf8');
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\})\\s*(?:/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*/\\s*)*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return m ? m[1] : null;
  };

  it('.reconnect-banner: touch-action none (else Android cancels the swipe), below the header', () => {
    const rule = block('.reconnect-banner');
    expect(rule).toMatch(/touch-action:\s*none/);
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/z-index:\s*0/);
    expect(rule).toMatch(/cursor:\s*pointer/);
  });

  it('.chat-page-header sits one layer above it', () => {
    const rule = block('.chat-page-header');
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/z-index:\s*1/);
  });
});
