import { useState } from 'react';

// Geometry in viewBox units. The circular slot is 168 of the 216-unit box,
// so the ticks sit 9 units outside its edge and are 12 long.
const VIEW = 216;
const CENTER = VIEW / 2;
const R_INNER = 93;
const R_OUTER = 105;
// Stagger per tick: the arrival sweep and the „complete" fill.
const SWEEP_MS = 10;
const FILL_MS = 16;

/**
 * Face-ID-style tick ring around the profile-picture slot of the last
 * onboarding step (Tina's checklist 10.10.2026: „Face-Scan mäßig? Schritte
 * nach Vervollständigung komplett grün").
 *
 *   done / total  green share of the ring: the onboarding steps already done
 *                 (3 of 4 on arrival at the photo step). The ticks sweep in
 *                 clockwise from 12 o'clock on mount.
 *   complete      every tick green — the remaining ones fill in order —
 *                 plus a green check badge. Set once there is a picture.
 *   ticks         number of radial ticks (default 56).
 *   size          slot diameter in px; default 168 via CSS (--fsr-slot),
 *                 which the stylesheet may shrink on short screens.
 *   children      the slot's content (the picture or a placeholder).
 *
 * Purely visual: the svg is aria-hidden and the parent says the state in
 * words (caption) and makes the ring tappable. Motion is CSS-only and switched
 * off under prefers-reduced-motion (styles/onboarding.css). Phrasing elements
 * only (span/svg), so it may sit inside a <button>.
 */
export function FaceScanRing({ done = 0, total = 1, complete = false, ticks = 56, size, children, className = '' }) {
  const n = Math.max(1, Math.floor(Number(ticks)) || 56);
  const ratio = Number(total) > 0 ? Math.min(1, Math.max(0, Number(done) / Number(total))) : 0;
  const base = Math.round(n * ratio);
  const on = complete ? n : base;
  // Arriving complete (a Google picture, a restored draft): ONE continuous
  // sweep instead of the arrival sweep plus a second fill running at once.
  const [arrivedComplete] = useState(complete);

  return (
    <span
      className={`fsr${complete ? ' fsr--complete' : ''}${className ? ` ${className}` : ''}`}
      style={size ? { '--fsr-slot': `${size}px` } : undefined}
    >
      <svg className="fsr-ring" viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" focusable="false">
        {Array.from({ length: n }, (_, i) => {
          const isOn = i < on;
          const delay = arrivedComplete || i < base ? i * SWEEP_MS : (i - base) * FILL_MS;
          return (
            <line
              key={i}
              className={`fsr-tick${isOn ? ' fsr-tick--on' : ''}`}
              x1={CENTER}
              y1={CENTER - R_INNER}
              x2={CENTER}
              y2={CENTER - R_OUTER}
              transform={`rotate(${((360 / n) * i).toFixed(3)} ${CENTER} ${CENTER})`}
              style={isOn ? { animationDelay: `${delay}ms` } : undefined}
            />
          );
        })}
      </svg>
      <span className="fsr-slot">{children}</span>
      {complete && (
        <span className="fsr-badge" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
    </span>
  );
}

export default FaceScanRing;
