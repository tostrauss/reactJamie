import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// iOS draws the status bar (clock, signal, battery) straight over the web
// view (Capacitor StatusBar overlaysWebView) and the page headers scroll with
// the page, so scrolled text ran right under the clock (Robert, 1.4.4,
// 13.10.2026). This band in the background colour fades in only while
// scrolled content sits under the status bar: at the top of a page the
// header or a profile photo stays exactly as designed, and a header pinned
// to the top (sticky/fixed) covers the status bar itself. Its height is the
// top safe-area inset — 0 on web and Android, where it never shows.
const SCROLLED_PX = 4;

function contentUnderStatusBar(scroller, inset) {
  if (scroller.scrollTop <= SCROLLED_PX) return false;
  // The scrim itself is pointer-events:none, so hit-testing looks through it.
  const el = document.elementFromPoint(window.innerWidth / 2, Math.max(1, inset / 2));
  if (!el || !scroller.contains(el)) return false;
  for (let node = el; node && node !== scroller; node = node.parentElement) {
    const { position } = window.getComputedStyle(node);
    if (position === 'sticky' || position === 'fixed') return false;
  }
  return true;
}

export default function StatusBarScrim() {
  const ref = useRef(null);
  // scroller element → does its scrolled content sit under the status bar?
  // Per scroller, so a carousel or a sheet's list scrolling elsewhere never
  // switches off what the page itself decided.
  const covered = useRef(new Map());
  const { pathname } = useLocation();

  useEffect(() => {
    covered.current.clear();
    ref.current?.classList.remove('is-visible');
  }, [pathname]);

  useEffect(() => {
    const scrim = ref.current;
    if (!scrim) return undefined;
    const pending = new Set();
    let frame = 0;

    const update = () => {
      frame = 0;
      const inset = scrim.offsetHeight;
      if (!inset) { pending.clear(); return; }
      pending.forEach(scroller => covered.current.set(scroller, contentUnderStatusBar(scroller, inset)));
      pending.clear();
      let visible = false;
      covered.current.forEach((isCovered, scroller) => {
        if (!scroller.isConnected) covered.current.delete(scroller);
        else if (isCovered) visible = true;
      });
      scrim.classList.toggle('is-visible', visible);
    };

    const onScroll = (e) => {
      const scroller = e.target === document ? document.scrollingElement : e.target;
      // Horizontal scrollers (chip rows, galleries) can't move content up
      // under the status bar.
      if (!(scroller instanceof Element) || scroller.scrollHeight <= scroller.clientHeight) return;
      pending.add(scroller);
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ref} className="status-scrim" aria-hidden="true" />;
}
