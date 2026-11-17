import { useEffect, useRef } from 'react';
import { dropIndexAt } from '../utils/profileClubs';

// Dragging the club bubbles in „Sortieren“ like icons on an iPhone home
// screen (Tina 17.11.2026: „wackeln die Bubbles wie bei Apple. User können
// die Clubs neu ansortieren“ — Apple's wiggle IS the mode for dragging).
// Tap + arrows and ← / → stay as the way without a drag (WCAG 2.5.7).
//
// Pointer events, no library (none is installed), no HTML5 drag & drop (it
// does not fire for touch in WKWebView). What is easy to get wrong:
//  - The end of the press is watched on the WINDOW (capture phase), like
//    watchEnd in useSwipeDismiss — and so are the moves: React re-inserts a
//    bubble's <li> when the order changes, which drops any pointer capture.
//  - Under 6 px it stays a tap (the old pick). From there on it is a drag,
//    and the click that follows the release must not pick or unpick: the flag
//    is taken back at the next press, or right after the release.
//  - The places („slots“) are measured once, when the drag starts: the grid's
//    tracks are fixed (64 px + 10 px, profile.css), so the places stay where
//    they are while the bubbles change them. offsetLeft/offsetTop against the
//    rail (it is position: relative) — they ignore the wiggle's rotation and
//    our own transform.
//  - No React state per pointermove: the bubble follows the finger through an
//    inline transform; state changes only when it reaches another place
//    (onMove). After that re-render its <li> sits in the new place, so the
//    transform is set again before the paint (afterRender, from a layout
//    effect).
//  - The wiggle animates `transform` and would win over the inline style —
//    the caller stops it on the dragged bubble (.is-dragging, animation none).
//  - On release it glides onto its place, and ONLY THEN the inline transform
//    and transition go: left behind, they would overrule the picked bubble's
//    scale(1.06).
//
// The other bubbles slide to their new places (FLIP, 150 ms) on their inner
// button — the <li> itself is wiggling. Under Reduce Motion nothing slides.

const SLOP = 6;            // px before a press becomes a drag
const GLIDE_MS = 150;
const EDGE = 56;           // px from the scroller's edge where it starts to scroll
const MAX_STEP = 14;       // px per frame at the very edge
const LIFT = 'scale(1.1)';
const SETTLED = 'scale(1.06)';   // .is-picked's own scale — no jump when the inline style goes

const reduceMotion = () => typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

// Missing in some test environments — the drag works without the auto-scroll.
const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : null);
const dropFrame = (id) => { if (id != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); };

const sortableItems = (rail) => [...rail.querySelectorAll('li[data-club-id]')];

export default function useBubbleDrag({ enabled, railRef, onStart, onMove, onEnd }) {
  const callbacks = useRef({});
  callbacks.current = { onStart, onMove, onEnd };
  // { id, pointerId, startX, startY, clientX, clientY, active, index, slots,
  //   grabX, grabY, viewport, raf, positions, ending }
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const unwatch = useRef(null);
  const timers = useRef({ glide: null, click: null });

  const itemOf = (id) => railRef.current?.querySelector(`li[data-club-id="${id}"]`) || null;

  // The finger in the rail's own coordinates.
  const fingerInRail = (d) => {
    const rail = railRef.current;
    const box = rail.getBoundingClientRect();
    return { x: d.clientX - box.left + rail.scrollLeft, y: d.clientY - box.top + rail.scrollTop };
  };

  const follow = (d) => {
    const li = itemOf(d.id);
    if (!li || !railRef.current) return;
    const { x, y } = fingerInRail(d);
    li.style.transition = 'none';
    li.style.transform = `translate(${x - d.grabX - li.offsetLeft}px, ${y - d.grabY - li.offsetTop}px) ${LIFT}`;
  };

  // Where the finger is now: another place → tell the caller; then follow.
  const place = (d) => {
    if (!railRef.current) return;
    const { x, y } = fingerInRail(d);
    const to = dropIndexAt(d.slots, x, y);
    if (to >= 0 && to !== d.index) {
      d.index = to;
      callbacks.current.onMove?.(d.id, to);
    }
    follow(d);
  };

  const clearInline = (rail) => {
    if (!rail) return;
    for (const li of rail.querySelectorAll('li')) {
      li.style.transform = '';
      li.style.transition = '';
      const inner = li.firstElementChild;
      if (inner) {
        inner.style.transform = '';
        inner.style.transition = '';
      }
    }
  };

  const stopWatching = () => {
    unwatch.current?.();
    unwatch.current = null;
  };

  // Everything of a drag that is not React state — also when the mode ends or
  // the component goes mid-drag.
  const abort = () => {
    const d = drag.current;
    drag.current = null;
    stopWatching();
    clearTimeout(timers.current.glide);
    dropFrame(d?.raf);
    clearInline(railRef.current);
  };

  // The bubble is home: every inline style of the drag goes (the dragged
  // bubble's and the slide of the others, long over by now).
  const finish = (d) => {
    clearInline(railRef.current);
    drag.current = null;
    callbacks.current.onEnd?.(d.id);
  };

  const release = () => {
    const d = drag.current;
    stopWatching();
    if (!d) return;
    if (!d.active) {            // a tap: the click decides
      drag.current = null;
      return;
    }
    dropFrame(d.raf);
    d.ending = true;
    // The click that follows this release belongs to the drag.
    clearTimeout(timers.current.click);
    timers.current.click = setTimeout(() => { suppressClick.current = false; }, 0);
    const li = itemOf(d.id);
    if (!li || reduceMotion()) {
      finish(d);
      return;
    }
    li.style.transition = `transform ${GLIDE_MS}ms ease`;
    li.style.transform = `translate(0px, 0px) ${SETTLED}`;
    timers.current.glide = setTimeout(() => finish(d), GLIDE_MS);
  };

  const autoScroll = () => {
    const d = drag.current;
    if (!d || !d.active || d.ending) return;
    const scroller = d.viewport;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const fromTop = d.clientY - box.top;
      const fromBottom = box.bottom - d.clientY;
      let step = 0;
      if (fromTop < EDGE) step = -Math.ceil(Math.min(1, (EDGE - fromTop) / EDGE) * MAX_STEP);
      else if (fromBottom < EDGE) step = Math.ceil(Math.min(1, (EDGE - fromBottom) / EDGE) * MAX_STEP);
      if (step) {
        const before = scroller.scrollTop;
        scroller.scrollTop = before + step;
        if (scroller.scrollTop !== before) place(d);
      }
    }
    d.raf = nextFrame(autoScroll);
  };

  const begin = (d) => {
    const rail = railRef.current;
    const li = itemOf(d.id);
    if (!rail || !li) return false;
    const items = sortableItems(rail);
    d.slots = items.map((el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 }));
    d.positions = new Map(items.map((el) => [el.dataset.clubId, [el.offsetLeft, el.offsetTop]]));
    d.index = items.indexOf(li);
    // Where in the bubble the finger took hold — measured from the press.
    const box = rail.getBoundingClientRect();
    d.grabX = d.startX - box.left + rail.scrollLeft - li.offsetLeft;
    d.grabY = d.startY - box.top + rail.scrollTop - li.offsetTop;
    d.viewport = rail.closest('.app-viewport');
    d.active = true;
    suppressClick.current = true;
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    callbacks.current.onStart?.(d.id);
    d.raf = nextFrame(autoScroll);
    return true;
  };

  const onWindowMove = (e) => {
    const d = drag.current;
    if (!d || d.ending || e.pointerId !== d.pointerId) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < SLOP) return;
      if (!begin(d)) return;
    }
    if (e.cancelable) e.preventDefault();
    place(d);
  };

  const onWindowEnd = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    release();
  };

  // On a movable bubble's button.
  const onPointerDown = (e, id) => {
    if (!enabled || drag.current) return;       // one finger at a time, also while it glides home
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearTimeout(timers.current.click);
    suppressClick.current = false;
    drag.current = {
      id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      clientX: e.clientX, clientY: e.clientY, active: false, ending: false,
    };
    stopWatching();
    window.addEventListener('pointermove', onWindowMove, true);
    window.addEventListener('pointerup', onWindowEnd, true);
    window.addEventListener('pointercancel', onWindowEnd, true);
    unwatch.current = () => {
      window.removeEventListener('pointermove', onWindowMove, true);
      window.removeEventListener('pointerup', onWindowEnd, true);
      window.removeEventListener('pointercancel', onWindowEnd, true);
    };
  };

  // After every re-render of the bubbles (from a layout effect): the dragged
  // bubble's <li> may sit in a new place — keep it under the finger — and the
  // others slide from their old place to the new one.
  const afterRender = () => {
    const d = drag.current;
    const rail = railRef.current;
    if (!d || !d.active || !rail) return;
    if (!d.ending) follow(d);
    const still = reduceMotion();
    for (const li of sortableItems(rail)) {
      const key = li.dataset.clubId;
      const before = d.positions.get(key);
      const now = [li.offsetLeft, li.offsetTop];
      d.positions.set(key, now);
      if (still || !before || key === String(d.id)) continue;
      const dx = before[0] - now[0];
      const dy = before[1] - now[1];
      const inner = li.firstElementChild;
      if ((!dx && !dy) || !inner) continue;
      inner.style.transition = 'none';
      inner.style.transform = `translate(${dx}px, ${dy}px)`;
      inner.getBoundingClientRect();           // take the start position in
      inner.style.transition = `transform ${GLIDE_MS}ms ease`;
      inner.style.transform = '';
    }
  };

  // True once for the click that ends a drag.
  const consumeClick = () => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  };

  // The mode ended (or the component went) mid-drag.
  useEffect(() => {
    if (!enabled) return undefined;
    const pending = timers.current;
    return () => {
      abort();
      clearTimeout(pending.click);
      suppressClick.current = false;
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { onPointerDown, afterRender, consumeClick };
}
