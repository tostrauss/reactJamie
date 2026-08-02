import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

// ============================================================================
// Global pull-to-refresh (Instagram-style), Tina 2026-08-02: "Wenn man nach
// unten wischt kommt so ein Ladezeichen oben und die App aktualisiert sich."
//
// ONE gesture engine for the whole app instead of per-page plumbing:
//   • Pages opt in via useOnPullRefresh(reload) (hooks/useOnPullRefresh.js) —
//     the gesture dispatches 'jamie:pull-refresh' and every listener registers
//     its reload promise; the spinner stays until all of them settle.
//   • Every triggered refresh ALSO fires 'jamie:unread-resync' so the bottom-nav
//     chat badge re-syncs with the server (stale "1" was the actual complaint).
//   • Works for both scroll models (global.css): document-flow pages scroll in
//     .app-viewport, fixed-height pages (Explore) scroll internally — the
//     engine walks up from the touch target to the nearest scrollable and only
//     arms when THAT is at scrollTop 0.
// ============================================================================

// Routes with a useOnPullRefresh listener. The gesture is inert elsewhere so
// the indicator can never show a refresh that no page performs.
const PTR_ROUTES = new Set(['/home', '/explore', '/chats', '/friends', '/notifications']);

const START_SLOP = 8;   // px of downward travel before we treat it as a pull
const THRESHOLD = 64;   // dampened px that arm a refresh on release
const MAX_PULL = 100;   // dampened px visual cap

// Surfaces with their own pan/drag gestures — never hijack these.
const EXCLUDE_SELECTOR = '.home-container--map, .map-container, .modal-overlay, .gm-style';

function findScrollable(start) {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') return el;
    }
    el = el.parentElement;
  }
  return document.querySelector('.app-viewport');
}

const PullToRefresh = () => {
  const location = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const indicatorRef = useRef(null);
  const refreshingRef = useRef(false);
  // Route in a ref so the touch handlers (bound once) always see the current one.
  const routeOkRef = useRef(false);
  routeOkRef.current = PTR_ROUTES.has(location.pathname);

  useEffect(() => {
    const gesture = { active: false, pulling: false, startX: 0, startY: 0, pull: 0, scrollEl: null };

    const setIndicator = (pull, springBack) => {
      const el = indicatorRef.current;
      if (!el) return;
      el.style.transition = springBack ? 'transform 0.25s ease, opacity 0.25s ease' : 'none';
      el.style.opacity = pull > 0 ? String(Math.min(pull / THRESHOLD, 1)) : '0';
      el.style.transform = `translateX(-50%) translateY(${pull}px) rotate(${pull * 3}deg)`;
    };

    const reset = () => {
      gesture.active = false;
      gesture.pulling = false;
      gesture.pull = 0;
    };

    const onTouchStart = (e) => {
      if (!routeOkRef.current || refreshingRef.current || e.touches.length !== 1) return;
      const target = e.touches[0].target || e.target;
      if (target instanceof Element && target.closest(EXCLUDE_SELECTOR)) return;
      const scrollEl = findScrollable(target);
      if (!scrollEl || scrollEl.scrollTop > 0) return;
      gesture.active = true;
      gesture.pulling = false;
      gesture.scrollEl = scrollEl;
      gesture.startX = e.touches[0].clientX;
      gesture.startY = e.touches[0].clientY;
    };

    const onTouchMove = (e) => {
      if (!gesture.active) return;
      const dx = e.touches[0].clientX - gesture.startX;
      const dy = e.touches[0].clientY - gesture.startY;

      if (!gesture.pulling) {
        // Upward or clearly horizontal → normal scroll/swipe, get out of the way.
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) { reset(); return; }
        if (dy < START_SLOP) return;
        // The container may have scrolled since touchstart (momentum) — re-check.
        if (gesture.scrollEl.scrollTop > 0) { reset(); return; }
        gesture.pulling = true;
      }

      // Suppress iOS rubber-banding while the indicator tracks the finger —
      // otherwise page bounce + indicator move in parallel (double motion).
      if (e.cancelable) e.preventDefault();
      gesture.pull = Math.min((dy - START_SLOP) * 0.5, MAX_PULL);
      setIndicator(gesture.pull, false);
    };

    const onTouchEnd = () => {
      if (!gesture.active) return;
      const trigger = gesture.pulling && gesture.pull >= THRESHOLD;
      reset();
      if (!trigger) { setIndicator(0, true); return; }

      refreshingRef.current = true;
      setRefreshing(true);
      setIndicator(THRESHOLD * 0.75, true);

      // Collect every page listener's reload promise.
      const jobs = [];
      window.dispatchEvent(new CustomEvent('jamie:pull-refresh', {
        detail: { register: (p) => { if (p && typeof p.then === 'function') jobs.push(p); } },
      }));
      // Always re-sync the bottom-nav unread badge (Navigation listens).
      window.dispatchEvent(new Event('jamie:unread-resync'));

      const minSpin = new Promise((r) => setTimeout(r, 500));   // readable feedback
      const timeout = new Promise((r) => setTimeout(r, 8000));  // never spin forever
      Promise.race([Promise.allSettled(jobs.concat(minSpin)), timeout]).finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setIndicator(0, true);
      });
    };

    // touchmove needs passive:false for the preventDefault above; the handler
    // bails on its first line for non-pull touches, so scroll perf is unharmed.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  return (
    <div ref={indicatorRef} className={`ptr-indicator${refreshing ? ' ptr-refreshing' : ''}`} aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
    </div>
  );
};

export default PullToRefresh;
