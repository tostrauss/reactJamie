import { useTranslation } from 'react-i18next';
import { normalizeTier, tierEmoji, tierMinEvents } from '../utils/attendanceTiers';
import '../styles/attendance.css';

/**
 * Abzeichen-Stufe — 🏅 from 5, 🏆 from 10, 🎆 from 100 CONFIRMED meetups
 * (tester 06.10.2026). Confirmed = other participants ticked "war dabei"
 * after the event; sign-ups never count. The level comes from the server —
 * this only renders it, and renders nothing for 0 or an unknown value.
 *
 * Independent of the purple VerifiedBadge (the trusted seal): someone can have
 * a step without the seal and the seal without a step, so this never positions
 * itself relative to it.
 *
 * Variants:
 *   pill   — emoji + "5+ mal dabei" (profiles, request cards/lists)
 *   chip   — emoji + "10+", language-neutral (roster rows, admin list)
 *   corner — emoji on a dark disc (photo tiles); never intercepts the tap
 * With onClick the pill becomes a button (own/other profile → the badge card).
 */
export const AttendanceTierBadge = ({ tier, variant = 'pill', className = '', onClick }) => {
  const { t } = useTranslation();
  const level = normalizeTier(tier);
  if (!level) return null;
  const n = tierMinEvents(level);
  const label = t('attendance.tierAriaFmt', { n });
  const cls = `attend-tier attend-tier--${variant} ${className}`.trim();
  const emoji = <span className="attend-tier-emoji" aria-hidden="true">{tierEmoji(level)}</span>;
  const text = variant === 'pill'
    ? <span className="attend-tier-label">{t('attendance.pillFmt', { n })}</span>
    : variant === 'chip' ? <span className="attend-tier-label">{`${n}+`}</span> : null;

  // The button's name starts with exactly what it shows ("5+ mal dabei"), so
  // a voice command that reads the pill out finds it (WCAG 2.5.3 Label in
  // Name); the full sentence stays available as its description.
  if (onClick && variant === 'pill') {
    return (
      <button
        type="button"
        className={cls}
        aria-label={`${t('attendance.pillFmt', { n })} – ${t('attendance.openAria')}`}
        title={label}
        onClick={(e) => { e.stopPropagation(); onClick(e); }}
      >
        {emoji}{text}
      </button>
    );
  }
  return (
    <span className={cls} role="img" aria-label={label} title={label}>
      {emoji}{text}
    </span>
  );
};

export default AttendanceTierBadge;
