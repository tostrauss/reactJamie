import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { postEventApi } from '../utils/api';
import '../styles/post-event.css';

// „Wie war’s bei X?“ — stars and an optional line of feedback, a day after an
// event (Tina 17.11.2026, her Bild 16): „ALLE: Wenn man bei einem Event war,
// sollte 24h danach kommen … mit Sternen zum Bewerten. Und drunter eine Zeile
// mit ‚Feedback (optional):‘. Man kann das auch mit ‚X‘ wegdrücken.“
//
// `items` is what GET /reviews/ratings/pending answers
// (eventRatingController): the events to ask about, one after the other.
// „Feedback senden“ needs a star; the X (and Escape) closes the question for
// that event for good, on the server too. A tap on the dimmed background does
// nothing. After the last event `onDone` runs.
//
// Not to be confused with „Wer war dabei?“ (EventReviewModal) — that is the
// attendance question for the creator. Who reads these stars: the JAMIE team
// only (AdminEventRatingsSection).

const STARS = [1, 2, 3, 4, 5];

// A party popper, outlined — the icon of Tina's mock.
function PartyPopper() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.8 11.3 2 22l10.7-3.79" />
      <path d="M4 3h.01" />
      <path d="M22 8h.01" />
      <path d="M15 2h.01" />
      <path d="M22 20h.01" />
      <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" />
      <path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" />
      <path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" />
      <path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" />
    </svg>
  );
}

// One event's question. Keyed by the event, so stars and text start empty.
function RatingCard({ event, onNext }) {
  const { t } = useTranslation();
  const toast = useToast();
  const titleId = useId();
  const cardRef = useRef(null);
  const starRefs = useRef([]);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const dismiss = useCallback(() => {
    // Fire and forget: closing must never wait for, or fail on, the network.
    Promise.resolve().then(() => postEventApi.dismissRating(event.group_id)).catch(() => {});
    onNext();
  }, [event.group_id, onNext]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Keyboard and screen readers start inside the dialog.
  useEffect(() => { cardRef.current?.focus(); }, []);

  const submit = async () => {
    if (!stars || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await postEventApi.submitRating(event.group_id, stars, feedback);
      toast.success(t('feedback.form.thanksTitle'));
      onNext();
    } catch (err) {
      const status = err?.response?.status;
      // Rated before (another device) or no longer open: nothing to say, move on.
      if (status === 409 || status === 403) onNext();
      else { setFailed(true); setSending(false); }
    }
  };

  // The radio group's keys: arrows move the choice, like native radios.
  const onStarKey = (e, n) => {
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, n + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, n - 1);
    if (next == null) return;
    e.preventDefault();
    setStars(next);
    starRefs.current[next - 1]?.focus();
  };

  return (
    <div className="pe-rating-backdrop" role="presentation">
      <div
        ref={cardRef}
        className="pe-rating-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button type="button" className="pe-rating-close" onClick={dismiss} aria-label={t('eventRating.close')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="pe-rating-icon"><PartyPopper /></div>
        <h2 id={titleId} className="pe-rating-title">{t('eventRating.title', { name: event.group_name })}</h2>
        <p className="pe-rating-subtitle">{t('eventRating.subtitle')}</p>

        <div className="pe-rating-stars" role="radiogroup" aria-label={t('eventRating.starsAria')}>
          {STARS.map((n) => (
            <button
              key={n}
              ref={(el) => { starRefs.current[n - 1] = el; }}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={t('eventRating.starAria', { count: n })}
              // One tab stop for the group: the chosen star, else the first.
              tabIndex={stars === n || (!stars && n === 1) ? 0 : -1}
              className={`pe-rating-star${n <= stars ? ' is-on' : ''}`}
              onClick={() => setStars(n)}
              onKeyDown={(e) => onStarKey(e, n)}
            >
              <span aria-hidden="true">⭐</span>
            </button>
          ))}
        </div>

        {/* Two rows (72px), the height of the field in her mock; longer text
            scrolls inside. */}
        <textarea
          className="pe-rating-feedback"
          rows={2}
          maxLength={1000}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t('eventRating.feedbackPlaceholder')}
          aria-label={t('eventRating.feedbackPlaceholder')}
        />

        <button type="button" className="pe-rating-submit" disabled={!stars || sending} onClick={submit}>
          {t('eventRating.submit')}
        </button>
        {failed && <p className="pe-rating-error" role="alert">{t('eventReview.submitError')}</p>}
      </div>
    </div>
  );
}

export default function EventRatingModal({ items, onDone }) {
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  // Events answered or closed in this sitting.
  const [closed, setClosed] = useState(() => new Set());
  const current = list.find((e) => !closed.has(e.group_id)) || null;
  const currentId = current?.group_id ?? null;

  const next = useCallback(() => {
    if (currentId == null) return;
    const left = list.some((e) => e.group_id !== currentId && !closed.has(e.group_id));
    setClosed((prev) => new Set(prev).add(currentId));
    if (!left) onDone?.();
  }, [currentId, list, closed, onDone]);

  if (!current) return null;
  return <RatingCard key={currentId} event={current} onNext={next} />;
}
