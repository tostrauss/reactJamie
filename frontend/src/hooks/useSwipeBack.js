import { useEffect, useRef } from 'react';

// WhatsApp-style swipe-to-go-back for the full-screen chat surfaces (Tobi
// 2026-08-03: "swiping right when you are in a chat brings you back to the
// chat list"). Attaches to the chat-page element and drags it rightward with
// the finger; past the threshold it slides off and runs `onBack`, otherwise it
// springs back.
//
// `enabled` is load-bearing exactly like useChatViewport's `active`: both chat
// pages attach the ref only to the LOADED surface, so on mount (loading screen)
// ref.current is null; a plain [elementRef] dependency would attach listeners
// once against null and never re-run. Flip `enabled` when the real surface is
// mounted so the effect re-runs with the element present.

const START_ZONE = 0.55;  // gesture may begin in the left 55% of the screen
const H_SLOP = 14;        // horizontal px before we engage (lets vertical scroll win)
const THRESHOLD = 80;     // px of drag that commits the back navigation

export default function useSwipeBack(elementRef, onBack, enabled = true) {
  const cbRef = useRef(onBack);
  cbRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;
    const el = elementRef.current;
    if (!el) return;

    let active = false, dragging = false, startX = 0, startY = 0, dx = 0;

    // Don't hijack touches that begin on the composer or interactive controls —
    // typing, tapping the back button, or selecting text must still work.
    const isInteractive = (t) =>
      t instanceof Element &&
      t.closest('input, textarea, [contenteditable="true"], button, a, .no-swipe-back');

    const setTranslate = (x, animate) => {
      el.style.transition = animate ? 'transform 0.2s ease' : 'none';
      el.style.transform = x > 0 ? `translateX(${x}px)` : '';
    };

    const onStart = (e) => {
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.touches[0];
      if (isInteractive(t.target)) { active = false; return; }
      // Only arm when the finger starts in the left zone — a right-edge start is
      // usually a scroll or an OS gesture, not an intentional "go back".
      if (t.clientX > window.innerWidth * START_ZONE) { active = false; return; }
      active = true; dragging = false; startX = t.clientX; startY = t.clientY; dx = 0;
    };

    const onMove = (e) => {
      if (!active) return;
      const t = e.touches[0];
      const ddx = t.clientX - startX;
      const ddy = t.clientY - startY;
      if (!dragging) {
        // Leftward or vertical-dominant → not a back-swipe; release to scroll.
        if (ddx < 0 || Math.abs(ddy) > Math.abs(ddx)) { active = false; return; }
        if (ddx < H_SLOP) return;
        dragging = true;
      }
      if (e.cancelable) e.preventDefault(); // stop the message list panning diagonally
      dx = ddx - H_SLOP;
      setTranslate(dx, false);
    };

    const onEnd = () => {
      if (!active) return;
      const commit = dragging && dx >= THRESHOLD;
      active = false; dragging = false;
      if (commit) {
        setTranslate(window.innerWidth, true); // slide off, then navigate
        setTimeout(() => { setTranslate(0, false); cbRef.current?.(); }, 190);
      } else {
        setTranslate(0, true); // spring back
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.style.transform = '';
      el.style.transition = '';
    };
  }, [elementRef, enabled]);
}
