import { useTranslation } from 'react-i18next';
import '../styles/flow.css';

const toInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Segmented progress line („Strich") shared by Register, Onboarding and the
 * onboarding clubs page (Tina's checklist 10.10.2026: finished steps turn
 * green, everything green once the profile is complete).
 *
 *   total    number of segments; renders nothing below 1.
 *   current  1-based ACTIVE step: segments before it are done (green), it is
 *            active (coral), the rest upcoming. 0 / omitted = none active.
 *   done     optional count of leading segments shown as done (default
 *            current - 1). The active segment always stays coral.
 *            Clubs page without an avatar: total={4} done={3} → 3 green + 1
 *            upcoming, nothing active.
 *   complete every segment green (300 ms fill, staggered left to right).
 *
 * Announced as a progressbar named „Schritt X von Y" (onboarding.progressAria);
 * X = current, or the done count when nothing is active, or total when complete.
 */
export function StepProgress({ current = 0, total, done, complete = false, className = '' }) {
  const { t } = useTranslation();
  const n = Math.max(0, toInt(total));
  if (n < 1) return null;

  const cur = clamp(toInt(current), 0, n);
  const doneCount = complete ? n : clamp(done == null ? Math.max(0, cur - 1) : toInt(done), 0, n);
  const activeIdx = complete || cur === 0 ? -1 : cur - 1;
  const now = complete ? n : (cur || doneCount);

  return (
    <div
      className={`step-progress${complete ? ' step-progress--complete' : ''}${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-label={t('onboarding.progressAria', { current: now, total: n })}
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={now}
    >
      {Array.from({ length: n }, (_, i) => {
        const state = i === activeIdx ? 'active' : i < doneCount ? 'done' : 'upcoming';
        return (
          <span
            key={i}
            className={`step-progress-seg step-progress-seg--${state}`}
            data-state={state}
            style={{ '--seg-i': i }}
          />
        );
      })}
    </div>
  );
}

export default StepProgress;
