import { useEffect } from 'react';

/**
 * Keep a `position:fixed` chat surface pinned to the VISIBLE viewport so the
 * composer stays above the on-screen keyboard.
 *
 * iOS WKWebView / Safari do not shrink a `position:fixed; inset:0` element when
 * the keyboard opens — it keeps full height and the input bar ends up hidden
 * behind the keyboard ("man kann nicht bearbeiten was man geschrieben hat weil
 * die Tastatur drüber ist"). The VisualViewport API reports the region above the
 * keyboard; we size the element to it. No-op where VisualViewport is missing.
 */
/**
 * `active` MUST be false while the page still renders its loading/error state:
 * both chat pages attach the ref only to the LOADED surface, but this effect
 * fires on mount (loading screen, ref.current === null) and a plain `[ref]`
 * dependency never re-runs it — so the hook silently no-oped forever and the
 * iOS keyboard kept covering the composer (Mia, 2026-08-03). Flipping `active`
 * once the real surface is mounted re-runs the effect with the ref attached.
 */
export function useChatViewport(ref, active = true) {
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    const apply = () => {
      el.style.height = `${vv.height}px`;
      el.style.top = `${vv.offsetTop}px`;
      el.style.bottom = 'auto';
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.height = '';
      el.style.top = '';
      el.style.bottom = '';
    };
  }, [ref, active]);
}
