// Reusable "verified" seal — a scalloped purple rosette with a white check,
// Hinge-style (Tobi 2026-08-05). Drawn as ONE base disc + N scallop circles in
// the SAME fill with no stroke, so the union reads as a single solid seal; a
// white checkmark sits on top. Replaces the old plain coral circle badge
// everywhere is_trusted_user shows (profiles, rosters, request cards) so a
// verified user looks identical across the app.
//
// Size via the `size` prop (px); colour via the --verified-fill CSS var (falls
// back to the brand dark purple #231e43). Positioning/shadow come from the CSS
// class the caller passes. Tuned by Tobi 2026-08-05: 11 scallops, r=2.5, #231e43.

const SCALLOPS = 11;
// Scallop centres sit on a circle of radius 7.5 in the 24×24 viewBox; a bump
// radius of 2.5 makes neighbours overlap slightly → a continuous scalloped edge
// with no gaps. Computed once at module load (constant geometry).
const BUMPS = Array.from({ length: SCALLOPS }, (_, i) => {
  const a = (i / SCALLOPS) * Math.PI * 2 - Math.PI / 2;
  return {
    x: +(12 + 7.5 * Math.cos(a)).toFixed(2),
    y: +(12 + 7.5 * Math.sin(a)).toFixed(2),
  };
});

export const VerifiedBadge = ({ size = 24, className = '', title = 'Verifiziert' }) => (
  <svg
    className={`verified-badge ${className}`.trim()}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    role="img"
    aria-label={title}
  >
    <g fill="var(--verified-fill, #231e43)">
      {BUMPS.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r="2.5" />)}
      <circle cx="12" cy="12" r="7.6" />
    </g>
    <polyline
      points="8.2,12.3 10.7,14.8 15.8,9.4"
      fill="none"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default VerifiedBadge;
