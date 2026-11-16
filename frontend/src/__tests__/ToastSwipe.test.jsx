import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../context/ToastContext';

// Toasts swipe up to dismiss (Tina 16.11.2026, hooks/useSwipeDismiss.js).
// The REAL provider here — the page tests all mock ToastContext away, so
// nothing else renders the container, its timers or the gesture.
// jsdom 28 has PointerEvent but no setPointerCapture (the hook guards it);
// it never synthesizes a click from pointer events, so the tests fire the
// click a browser would send after pointerup themselves (detail 1 = pointer).

let toast;
let consumerRenders = 0;
const Consumer = () => {
  consumerRenders += 1;
  toast = useToast();
  return null;
};

const renderToasts = () => render(<ToastProvider><Consumer /></ToastProvider>);
const toastOf = (text) => screen.getByText(text).closest('.toast');
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

const down = (el, y, x = 100) => fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y });
const move = (el, y, x = 100) => fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });
const up = (el, y, x = 100) => fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y });
const swipe = (el, ...ys) => {
  down(el, ys[0]);
  ys.slice(1).forEach((y) => move(el, y));
  up(el, ys[ys.length - 1]);
};

beforeEach(() => {
  vi.useFakeTimers();
  consumerRenders = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts — swipe up to dismiss', () => {
  it('a swipe up past 40 px sends it off and removes it after the exit (180 ms)', () => {
    renderToasts();
    act(() => { toast.info('Verbindung unterbrochen'); });
    const el = toastOf('Verbindung unterbrochen');

    swipe(el, 100, 90, 40);
    expect(el.style.transform).toBe('translateY(-120%)');
    expect(screen.getByText('Verbindung unterbrochen')).toBeInTheDocument();

    advance(180);
    expect(screen.queryByText('Verbindung unterbrochen')).not.toBeInTheDocument();
  });

  it('a short drag springs back and the toast stays', () => {
    renderToasts();
    act(() => { toast.info('Hallo'); });
    const el = toastOf('Hallo');

    swipe(el, 100, 90);
    expect(el.style.transform).toBe('');
    advance(500);
    expect(screen.getByText('Hallo')).toBeInTheDocument();
  });

  it('a quick flick dismisses although it stayed short of 40 px', () => {
    renderToasts();
    act(() => { toast.info('Flick'); });
    const el = toastOf('Flick');

    down(el, 100);
    advance(50);
    move(el, 70);            // 30 px in 50 ms = 0.6 px/ms
    up(el, 70);
    advance(180);
    expect(screen.queryByText('Flick')).not.toBeInTheDocument();
  });

  it('pulling it down only stretches a little and never dismisses', () => {
    renderToasts();
    act(() => { toast.info('Runter'); });
    const el = toastOf('Runter');

    down(el, 100);
    move(el, 110);
    move(el, 200);
    expect(el.style.transform).toBe('translateY(12px)'); // rubber band, capped
    up(el, 200);
    advance(500);
    expect(screen.getByText('Runter')).toBeInTheDocument();
  });

  it('springing back does not replay the fly-in animation', () => {
    renderToasts();
    act(() => { toast.info('Kein zweiter Einflug'); });
    const el = toastOf('Kein zweiter Einflug');

    swipe(el, 100, 80);
    // Lifting `animation: none` again would restart toastIn — it stays off.
    expect(el.style.animation).toBe('none');
    swipe(el, 100, 95);
    expect(el.style.animation).toBe('none');
  });

  it('a sideways drag is not a dismiss', () => {
    renderToasts();
    act(() => { toast.info('Seitwärts'); });
    const el = toastOf('Seitwärts');

    down(el, 100, 100);
    move(el, 104, 160);
    up(el, 104, 160);
    advance(500);
    expect(screen.getByText('Seitwärts')).toBeInTheDocument();
    expect(el.style.transform).toBe('');
  });
});

describe('undo toasts', () => {
  it('a tap on „Rückgängig" undoes exactly once and closes the toast', () => {
    renderToasts();
    const onUndo = vi.fn();
    act(() => { toast.showUndo('Anfrage abgelehnt', onUndo, 'Rückgängig'); });
    const btn = screen.getByRole('button', { name: /Rückgängig/ });

    down(btn, 100);
    up(btn, 100);
    fireEvent.click(btn, { detail: 1 });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Anfrage abgelehnt')).not.toBeInTheDocument();
  });

  it('a swipe that starts on „Rückgängig" closes the toast WITHOUT undoing', () => {
    renderToasts();
    const onUndo = vi.fn();
    act(() => { toast.showUndo('Anfrage abgelehnt', onUndo, 'Rückgängig'); });
    const btn = screen.getByRole('button', { name: /Rückgängig/ });

    swipe(btn, 100, 90, 40);
    fireEvent.click(btn, { detail: 1 });   // what a browser sends after pointerup
    expect(onUndo).not.toHaveBeenCalled();

    advance(180);
    expect(screen.queryByText('Anfrage abgelehnt')).not.toBeInTheDocument();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('„Rückgängig" by keyboard still works right after an aborted swipe', () => {
    renderToasts();
    const onUndo = vi.fn();
    act(() => { toast.showUndo('Anfrage abgelehnt', onUndo, 'Rückgängig'); });
    const btn = screen.getByRole('button', { name: /Rückgängig/ });

    swipe(btn, 100, 90);                 // springs back, no click follows
    fireEvent.click(btn);                // Enter/Space: detail 0
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('a stray tap on the body keeps an undo toast', () => {
    renderToasts();
    act(() => { toast.showUndo('Anfrage abgelehnt', vi.fn(), 'Rückgängig'); });
    fireEvent.click(screen.getByText('Anfrage abgelehnt'), { detail: 1 });
    expect(screen.getByText('Anfrage abgelehnt')).toBeInTheDocument();
  });
});

describe('timers', () => {
  it('does not time out under the finger; released, it runs on for at least 1.5 s', () => {
    renderToasts();
    act(() => { toast.success('Gespeichert'); });   // 3 s
    const el = toastOf('Gespeichert');

    advance(2500);
    down(el, 100);
    advance(5000);                       // held: far past the 3 s
    expect(screen.getByText('Gespeichert')).toBeInTheDocument();
    move(el, 90);
    up(el, 90);                          // springs back → countdown resumes

    advance(1400);
    expect(screen.getByText('Gespeichert')).toBeInTheDocument();
    advance(100);
    expect(screen.queryByText('Gespeichert')).not.toBeInTheDocument();
  });

  // A mouse has no implicit capture, and ours starts only after the 8 px slop
  // (review 16.11.2026): pressed near the edge, moved off and released
  // elsewhere, the toast never heard the end — held for good.
  it('a press that wanders off before the slop and ends elsewhere lets go of the toast', () => {
    renderToasts();
    act(() => { toast.success('Gespeichert'); });   // 3 s
    const el = toastOf('Gespeichert');

    advance(2500);
    down(el, 100);
    advance(5000);                       // held while pressed
    expect(screen.getByText('Gespeichert')).toBeInTheDocument();
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 100, clientY: 300 });

    advance(1400);                       // runs on for at least 1.5 s…
    expect(screen.getByText('Gespeichert')).toBeInTheDocument();
    advance(100);                        // …and then goes
    expect(screen.queryByText('Gespeichert')).not.toBeInTheDocument();
  });

  it('…and it follows no hovering mouse afterwards, while a new swipe works', () => {
    renderToasts();
    act(() => { toast.showUndo('Anfrage abgelehnt', vi.fn(), 'Rückgängig'); });
    const el = toastOf('Anfrage abgelehnt');

    down(el, 100);
    fireEvent.pointerCancel(document.body, { pointerId: 1, clientX: 100, clientY: 300 });
    move(el, 40);                        // back over it, no button down
    expect(el.style.transform).toBe('');

    swipe(el, 100, 90, 40);
    advance(180);
    expect(screen.queryByText('Anfrage abgelehnt')).not.toBeInTheDocument();
  });

  it('watches the window only while a pointer is down — nothing left behind', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    // [type, listener] of every pointer-end watch (capture phase)
    const ends = (spy) => spy.mock.calls
      .filter(([type, , capture]) => (type === 'pointerup' || type === 'pointercancel') && capture === true)
      .map(([type, fn]) => [type, fn]);
    const { unmount } = renderToasts();
    act(() => { toast.success('Sauber'); });
    const el = toastOf('Sauber');

    swipe(el, 100, 90);                  // pressed and released on the toast
    down(el, 100);
    fireEvent.pointerUp(document.body, { pointerId: 1 });   // released elsewhere
    down(el, 100);
    unmount();                           // gone mid-press: its watch goes with it
    const added = ends(add);
    const removed = ends(remove);
    expect(added).toHaveLength(6);       // three presses × pointerup + pointercancel
    for (const [type, fn] of added) {
      expect(removed.some(([t, f]) => t === type && f === fn), type).toBe(true);
    }
    add.mockRestore();
    remove.mockRestore();
  });

  it('a plain toast still closes on a tap', () => {
    renderToasts();
    act(() => { toast.error('Fehler'); });
    fireEvent.click(screen.getByText('Fehler'), { detail: 1 });
    expect(screen.queryByText('Fehler')).not.toBeInTheDocument();
  });

  it('a toast pushed out by the max-5 cap takes its timer with it', () => {
    renderToasts();
    act(() => {
      for (let i = 1; i <= 6; i += 1) toast.info(`Toast ${i}`);
    });
    expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Toast \d$/)).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(5);
  });
});

describe('container', () => {
  it('is a live region from the start, not only once the first toast arrives', () => {
    renderToasts();
    const region = screen.getByRole('status');
    expect(region).toHaveClass('toast-container');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('toasts coming and going do not re-render the useToast() consumers', () => {
    renderToasts();
    const before = consumerRenders;
    act(() => { toast.info('Eins'); toast.success('Zwei'); });
    advance(5000);
    expect(consumerRenders).toBe(before);
  });
});
