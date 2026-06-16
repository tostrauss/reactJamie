// The official JAMIE wordmark, rendered as the actual logo image so it looks
// IDENTICAL everywhere it appears (replaces the old CSS-text wordmarks).
// Asset: public/jamie-wordmark.png (transparent, tightly trimmed).
//   size="header" → in-app top bars (Home, Explore)
//   size="splash" → auth / full-screen splashes (login, register, …)
export function JamieWordmark({ size = 'header', className = '', alt = 'JAMIE' }) {
  return (
    <img
      src="/jamie-wordmark.png"
      alt={alt}
      className={`jamie-wordmark jamie-wordmark--${size} ${className}`.trim()}
      draggable={false}
      decoding="async"
    />
  );
}

export default JamieWordmark;
