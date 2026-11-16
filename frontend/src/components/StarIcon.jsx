// The Feather „star" — ONE copy of the polygon for the whole app (it was
// inlined in Settings, ProfileEdit and GroupDetail). Since 16.11.2026 the
// outline ☆ also marks a Partner (Tina): an official club's own events and
// its bubble. Outline in currentColor by default; every svg attribute passed
// in wins (fill="#FD7666" stroke="none" draws the solid star).
const STAR_POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';

export default function StarIcon({ size = 16, ...svgProps }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      {...svgProps}
    >
      <polygon points={STAR_POINTS} />
    </svg>
  );
}
