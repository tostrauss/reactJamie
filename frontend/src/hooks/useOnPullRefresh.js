import { useEffect, useRef } from 'react';

/**
 * Subscribe a page's reload function to the global pull-to-refresh gesture
 * (components/PullToRefresh.jsx). The returned promise keeps the top spinner
 * visible until the reload settles.
 *
 * The handler lives in a ref so the latest closure always runs (Home's
 * loadData, for example, closes over the active tab) — callers don't need
 * useCallback.
 */
export default function useOnPullRefresh(handler) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const onPull = (e) => {
      try {
        e.detail?.register?.(ref.current?.());
      } catch { /* a failing reload must never break the gesture */ }
    };
    window.addEventListener('jamie:pull-refresh', onPull);
    return () => window.removeEventListener('jamie:pull-refresh', onPull);
  }, []);
}
