import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { TIER_EMOJI, TIER_MIN_EVENTS, normalizeTier, progressOf } from '../utils/attendanceTiers';
import '../styles/attendance.css';

/**
 * The "Abzeichen" card — the ladder 🏅 5 / 🏆 10 / 🎆 100 with the reached
 * steps highlighted, and how a meetup comes to count. Lives in the
 * Hall-of-Fame tab of a profile.
 *
 * own   — the person's own numbers from GET /reviews/attendance: status line,
 *         then exactly one of "top reached" / "needs more different people" /
 *         "Noch X bis 🏆" with a progress bar. Shown at 0 too ("Noch 5 bis 🏅"):
 *         the tester's point was that steps make people WANT to show up.
 * other — only the level the server sent; never a "no badge" state for
 *         somebody else, and never their counts.
 * windowDays — own only: a meetup counts once its "Wer war dabei?" round has
 *         closed (server REVIEW_WINDOW_DAYS), so yesterday's meetup is not
 *         missing — the note says when it will show.
 * The heading takes focus after the pill's jump (tabIndex -1, not in the tab
 * order), so screen readers and keyboards follow the scroll.
 */
export const AttendanceTiersCard = ({ tier, own = false, confirmedEvents = 0, confirmers = 0, next = null, windowDays = null }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const level = normalizeTier(tier);
  const events = Number(confirmedEvents) || 0;
  const progress = own ? progressOf({ confirmed_events: events, confirmers, tier: level, next }) : null;

  return (
    <section className="attend-card" aria-labelledby={titleId}>
      <h3 id={titleId} className="attend-card-title" tabIndex={-1}>{t('attendance.cardTitle')}</h3>
      <ol className="attend-ladder">
        {TIER_MIN_EVENTS.map((n, i) => {
          const on = level >= i + 1;
          const stepText = t('attendance.stepFmt', { n });
          return (
            <li
              key={n}
              className={`attend-step${on ? ' attend-step--on' : ''}`}
              aria-label={on ? `${TIER_EMOJI[i]} ${stepText}, ${t('attendance.stepDone')}` : `${TIER_EMOJI[i]} ${stepText}`}
            >
              <span className="attend-step-emoji" aria-hidden="true">{TIER_EMOJI[i]}</span>
              <span className="attend-step-label" aria-hidden="true">{stepText}</span>
            </li>
          );
        })}
      </ol>

      {own ? (
        <>
          <p className="attend-status">
            {events > 0 ? t('attendance.ownCount', { count: events }) : t('attendance.ownNone')}
          </p>
          {level >= TIER_MIN_EVENTS.length || !progress ? (
            level >= TIER_MIN_EVENTS.length && <p className="attend-next">{t('attendance.maxReached')}</p>
          ) : progress.needsPeople ? (
            <p className="attend-next">{t('attendance.needPeopleFmt', { emoji: progress.emoji, n: progress.minPeople })}</p>
          ) : (
            <>
              <p className="attend-next">{t('attendance.toNext', { count: progress.remaining, emoji: progress.emoji })}</p>
              <div
                className="attend-progress"
                role="progressbar"
                aria-label={t('attendance.progressAria', { emoji: progress.emoji })}
                aria-valuemin={progress.prevMin}
                aria-valuemax={progress.min}
                aria-valuenow={Math.min(events, progress.min)}
              >
                <div className="attend-progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
            </>
          )}
          <p className="attend-how">{t('attendance.how')}</p>
          {Number(windowDays) > 0 && (
            <p className="attend-how">{t('attendance.delayFmt', { days: Number(windowDays) })}</p>
          )}
        </>
      ) : (
        <>
          {level > 0 && <p className="attend-status">{t('attendance.otherFmt', { n: TIER_MIN_EVENTS[level - 1] })}</p>}
          <p className="attend-how">{t('attendance.howOther')}</p>
        </>
      )}
    </section>
  );
};

export default AttendanceTiersCard;
