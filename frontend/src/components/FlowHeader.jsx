import { useTranslation } from 'react-i18next';
import { JamieWordmark } from './JamieWordmark';
import { StepProgress } from './StepProgress';
import '../styles/flow.css';

/**
 * Top bar of the sign-up flow (Register, Onboarding, onboarding clubs page),
 * matching Home: round back button · small centred wordmark · „2 / 4", with
 * the segmented StepProgress line centred below.
 *
 *   onBack       optional; no back button (an empty 44px slot keeps the
 *                wordmark centred) when absent. Called without arguments.
 *   current      1-based active step (also the counter's number).
 *   total        number of steps / segments.
 *   done         optional, passed to StepProgress (see there).
 *   complete     all segments green.
 *   showCounter  default true; false leaves the right slot empty.
 *
 * Render it as a direct child of the full-bleed screen container: it carries
 * its own 20px side padding and relies on .auth-screen / .onboarding-container
 * for the top safe-area inset.
 */
export function FlowHeader({ onBack, current, total, done, complete = false, showCounter = true, className = '' }) {
  const { t } = useTranslation();
  const n = Math.max(0, Math.floor(Number(total)) || 0);
  const cur = Math.min(n, Math.max(0, Math.floor(Number(current)) || 0));
  const counter = showCounter && n > 0 && cur > 0
    ? t('onboarding.stepCounter', { current: cur, total: n })
    : '';

  return (
    <div className={`flow-header${className ? ` ${className}` : ''}`}>
      <div className="flow-header-row">
        {onBack ? (
          // type="button": Register renders its steps inside a <form>, where a
          // bare <button> would submit it.
          <button type="button" className="flow-back" onClick={() => onBack()} aria-label={t('common.back')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <span className="flow-header-slot" aria-hidden="true" />
        )}
        <div className="flow-header-brand">
          <JamieWordmark size="header" />
        </div>
        {/* Visual only — the progressbar below announces „Schritt X von Y". */}
        <span className="flow-header-count" aria-hidden="true">{counter}</span>
      </div>
      <StepProgress current={cur} total={n} done={done} complete={complete} />
    </div>
  );
}

export default FlowHeader;
