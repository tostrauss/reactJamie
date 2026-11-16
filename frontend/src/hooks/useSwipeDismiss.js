import { useEffect, useRef } from 'react';

// Swipe UP to dismiss — the transient notices at the top of the screen: the
// toasts and the offline banner (Tina 16.11.2026: „nach oben wegwischen“).
// They sit over the headers' back arrows and tabs for 3–6 s, the offline
// banner until the network is back; now a flick sends them off, like an iOS
// system banner. Upward only — downward is pull-to-refresh / notification
// centre land, so a pull down just stretches a little and springs back.
//
// Pointer events, no library (none is installed). What is easy to get wrong:
//  - Capture only AFTER the slop: capturing on pointerdown retargets the
//    click to the swiped element, and „Rückgängig" would silently stop
//    working. (The request deck captures on pointerdown — fine there, its
//    card has no buttons; not here.)
//  - A click that follows a drag is swallowed (onClickCapture), so a swipe
//    that starts on „Rückgängig" never undoes.
//  - The drag lives in refs and inline styles only, never in React state —
//    the toast context re-renders the whole toast stack on every change.
//  - `animation: none` from the first drag on, and never back: toastIn /
//    slideDown animate transform and would fight the finger in their first
//    300 ms, and lifting the override later RESTARTS them — the toast would
//    fly in a second time after springing back.
//  - The exit ends on a timer, not transitionend: under Reduce Motion the
//    global rule cuts every transition to 0.01 ms (global.css).
//  - touch-action: none on the element (global.css), else Android Chrome
//    claims the vertical pan and cancels the pointer mid-swipe.
//
// onHold/onRelease bracket the finger being down, so a countdown can pause
// (the toast must not vanish under the finger). onDismiss runs once the exit
// animation is over; the caller unmounts the element.

const SLOP = 8;              // px before the gesture locks to an axis
const COMMIT_DY = -40;       // px upward that dismiss on release…
const FLICK_SPEED = -0.5;    // …or a flick this fast (px/ms over the last ~100 ms)
const FLICK_MIN_DY = -12;    //    once it travelled at least this far
const VELOCITY_WINDOW = 100; // ms
const DOWN_MAX = 12;         // px of rubber band when pulled downward
const FADE_DY = 80;          // px over which it fades while dragged up
const EXIT_MS = 180;
const SPRING_MS = 200;

export default function useSwipeDismiss({ onDismiss, onHold, onRelease } = {}) {
  const ref = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onDismiss, onHold, onRelease };
  const gesture = useRef(null);         // { id, x0, y0, dy, dragging, samples }
  const swallowClick = useRef(false);
  const leaving = useRef(false);
  const exitTimer = useRef(null);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  const paint = (dy, ms) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ease, opacity ${ms}ms ease` : 'none';
    el.style.transform = dy ? `translateY(${dy}px)` : '';
    el.style.opacity = dy < 0 ? String(1 - Math.min(-dy / FADE_DY, 0.9)) : '';
  };

  const springBack = () => {
    paint(0, SPRING_MS);
    if (ref.current) ref.current.style.willChange = '';
    callbacks.current.onRelease?.();
  };

  const leave = () => {
    leaving.current = true;
    const el = ref.current;
    if (el) {
      el.style.transition = `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;
      el.style.transform = 'translateY(-120%)';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';   // a tap right after goes to what's below
    }
    exitTimer.current = setTimeout(() => callbacks.current.onDismiss?.(), EXIT_MS);
  };

  const onPointerDown = (e) => {
    if (leaving.current || gesture.current) return;   // one finger at a time
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gesture.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, dy: 0, dragging: false,
      samples: [[Date.now(), e.clientY]],
    };
    swallowClick.current = false;
    callbacks.current.onHold?.();
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.dragging) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      // Sideways first: not a dismiss — let go, a tap or the timer decide.
      if (Math.abs(dx) > Math.abs(dy)) {
        gesture.current = null;
        callbacks.current.onRelease?.();
        return;
      }
      g.dragging = true;
      swallowClick.current = true;
      const el = ref.current;
      if (el) {
        el.style.animation = 'none';     // for good — see the header
        el.style.willChange = 'transform';
      }
      // Only now (see the header). Missing in jsdom and old WebViews.
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
    }
    g.dy = dy < 0 ? dy : Math.min(dy * 0.2, DOWN_MAX);
    g.samples.push([Date.now(), e.clientY]);
    if (g.samples.length > 12) g.samples.shift();
    paint(g.dy, 0);
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (!g.dragging) { callbacks.current.onRelease?.(); return; }   // a tap: onClick decides
    // Speed over the last ~100 ms of movement: a quick flick dismisses even
    // when it stayed short of the 40 px; a drag that paused before letting go
    // only counts by its distance.
    const now = Date.now();
    const [tEnd, yEnd] = g.samples[g.samples.length - 1];
    const base = g.samples.find(([t]) => now - t <= VELOCITY_WINDOW);
    const speed = base && tEnd > base[0] ? (yEnd - base[1]) / (tEnd - base[0]) : 0;
    const flick = g.dy <= FLICK_MIN_DY && speed <= FLICK_SPEED;
    if (g.dy <= COMMIT_DY || flick) leave();
    else springBack();
  };

  // The browser took the pointer (scroll, system gesture): never left
  // half-dismissed — back to where it was.
  const onPointerCancel = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (g.dragging) springBack();
    else callbacks.current.onRelease?.();
  };

  // Only the element's OWN capture ending counts. On touch the pointer starts
  // implicitly captured by whatever child was hit (the text, „Rückgängig");
  // our setPointerCapture takes it over, and that child's lostpointercapture
  // bubbles up here — it must not end the swipe it just started.
  const onLostPointerCapture = (e) => {
    if (e.target !== e.currentTarget) return;
    onPointerCancel(e);
  };

  const onClickCapture = (e) => {
    // detail 0 = a keyboard click (Enter/Space on „Rückgängig"), never the
    // tail of a drag.
    if (!swallowClick.current || e.detail === 0) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return {
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onClickCapture,
    },
  };
}
