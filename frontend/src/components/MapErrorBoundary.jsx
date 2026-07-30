import { Component } from 'react';

/**
 * Containment boundary for everything Google-Maps-rendered.
 *
 * The Maps JS API crashes in ways we cannot prevent from app code: content
 * blockers strip the script ("Can't find variable: google"), frozen WebViews
 * resume with half-executed SDK state (`new Ma.lG` internals), and
 * @react-google-maps' useLoadScript throws its "marked as loaded, but
 * window.google is not present" invariant when its module flag survives a
 * context the script didn't. Sentry issues JAMIE-REACT-F/G/E/M/K (2026-07).
 * Without a boundary, React unmounts the WHOLE page over a decorative map.
 *
 * Fallback is a quiet placeholder box; the surrounding page keeps working.
 */
export class MapErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Deferred import keeps Sentry off the critical path (see utils/sentry.js).
    import('../utils/sentry').then(({ captureException }) =>
      captureException(error, { tags: { boundary: 'map' } })
    ).catch(() => {});
  }

  render() {
    if (this.state.failed) {
      // Match the mini-map's footprint so the layout doesn't jump. `fallback`
      // (an element) wins over `fallbackClassName` — pages whose skeleton is
      // inline-styled (DealDetail) can't express theirs as a class.
      if (this.props.fallback) return this.props.fallback;
      return <div className={this.props.fallbackClassName || 'gd-mini-map gd-mini-map--loading'} />;
    }
    return this.props.children;
  }
}

export default MapErrorBoundary;
