import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { serverErrorMessage } from '../utils/apiError';
import {
  POLL_LIMITS, addDaysIso, formatPollOption, todayIso, toPollPayload, validatePollDraft,
} from '../utils/polls';

/**
 * "Neue Umfrage" sheet (B1). Two modes:
 *   📅 Termin finden — prefilled "Wann passt es euch?" + tomorrow and the day
 *                      after; native date + optional time pickers (the GroupEdit
 *                      overlay pattern); always multiple choice.
 *   📊 Abstimmung    — free text options, single answer unless "Mehrere
 *                      Antworten erlauben".
 * Rendered as a direct child of .chat-page (position:absolute), so
 * useChatViewport keeps it above the iOS keyboard. No <form>: Enter moves to
 * the next field, so a poll is never sent by accident.
 * Creation is not optimistic — the button shows "Wird gesendet…" through
 * moderation (up to ~2.5 s); a rejection keeps the draft and shows why.
 */
const emptyOptions = () => [{ label: '' }, { label: '' }];

export function PollComposerSheet({ locale = 'de-DE', today = todayIso(), onSubmit, onClose }) {
  const { t } = useTranslation();
  const defaultDateQuestion = t('chat.poll.defaultDateQuestion');
  const initial = useRef(null);
  if (!initial.current) {
    initial.current = {
      kind: 'date',
      question: defaultDateQuestion,
      dates: [{ date: addDaysIso(today, 1), time: '' }, { date: addDaysIso(today, 2), time: '' }],
      options: emptyOptions(),
      multi: false,
    };
  }
  const [draft, setDraft] = useState(initial.current);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const v = validatePollDraft(draft, today);
  const isDate = draft.kind === 'date';
  const rows = isDate ? draft.dates : draft.options;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  const showQuestionHint = !v.countError && v.questionError === 'empty';

  const requestClose = () => {
    if (busyRef.current) return;
    if (dirty && !window.confirm(t('chat.poll.discardConfirm'))) return;
    onClose?.();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const switchKind = (kind) => setDraft((d) => {
    if (d.kind === kind) return d;
    // A question still equal to the date default is cleared for "Abstimmung"
    // and comes back when switching back; anything typed is kept.
    let question = d.question;
    if (kind === 'choice' && question === defaultDateQuestion) question = '';
    if (kind === 'date' && !question.trim()) question = defaultDateQuestion;
    return { ...d, kind, question };
  });

  const setRow = (i, patch) => setDraft((d) => (d.kind === 'date'
    ? { ...d, dates: d.dates.map((r, j) => (j === i ? { ...r, ...patch } : r)) }
    : { ...d, options: d.options.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const removeRow = (i) => setDraft((d) => (d.kind === 'date'
    ? { ...d, dates: d.dates.filter((_, j) => j !== i) }
    : { ...d, options: d.options.filter((_, j) => j !== i) }));
  const addRow = () => setDraft((d) => {
    if (d.kind === 'date') {
      const last = [...d.dates].reverse().find((r) => r.date)?.date || today;
      return { ...d, dates: [...d.dates, { date: addDaysIso(last, 1), time: '' }] };
    }
    return { ...d, options: [...d.options, { label: '' }] };
  });

  const submit = async () => {
    if (busyRef.current || !v.ok) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit?.(toPollPayload(draft));
    } catch (err) {
      setError(serverErrorMessage(err, t, 'chat.poll.createError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const focusNext = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const fields = [...(e.currentTarget.closest('.poll-sheet')?.querySelectorAll('input:not([type="checkbox"])') || [])];
    const i = fields.indexOf(e.currentTarget);
    fields[i + 1]?.focus?.();
  };

  const rowError = (i) => {
    const code = v.rowErrors[i];
    if (code === 'duplicate') return t('chat.poll.duplicate');
    if (code === 'past') return t('chat.poll.pastDate');
    if (code === 'range') return t('chat.poll.rangeDate');
    return null;
  };

  return (
    <div className="poll-sheet-backdrop no-swipe-back" role="presentation" onClick={requestClose}>
      <div
        className="poll-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poll-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="poll-sheet-head">
          <h2 id="poll-sheet-title" className="poll-sheet-title">{t('chat.poll.title')}</h2>
          <button type="button" className="poll-sheet-x" onClick={requestClose} aria-label={t('common.cancel')}>✕</button>
        </div>

        <div className="poll-sheet-body">
          <div className="poll-kind" role="group">
            <button type="button" className="poll-kind-btn" aria-pressed={isDate} onClick={() => switchKind('date')}>
              📅 {t('chat.poll.kindDate')}
            </button>
            <button type="button" className="poll-kind-btn" aria-pressed={!isDate} onClick={() => switchKind('choice')}>
              📊 {t('chat.poll.kindChoice')}
            </button>
          </div>

          <label className="poll-sheet-label" htmlFor="poll-question">{t('chat.poll.question')}</label>
          <input
            id="poll-question"
            className="poll-input"
            type="text"
            value={draft.question}
            maxLength={POLL_LIMITS.QUESTION_MAX}
            placeholder={isDate ? undefined : t('chat.poll.questionPlaceholder')}
            aria-invalid={showQuestionHint || undefined}
            aria-describedby={showQuestionHint ? 'poll-question-hint' : undefined}
            enterKeyHint="next"
            onKeyDown={focusNext}
            onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
          />

          <div className="poll-sheet-label">{isDate ? t('chat.poll.dates') : t('chat.poll.options')}</div>
          <div className="poll-rows">
            {rows.map((r, i) => (
              <div className="poll-row-wrap" key={i}>
                <div className="poll-row">
                  {isDate ? (
                    <>
                      <div className="poll-picker">
                        <span className="poll-picker-value">
                          {r.date ? formatPollOption({ date: r.date }, 'date', locale) : '—'}
                        </span>
                        <input
                          className="poll-picker-input"
                          type="date"
                          value={r.date}
                          min={today}
                          max={addDaysIso(today, POLL_LIMITS.DATE_HORIZON_DAYS)}
                          aria-label={t('chat.poll.dateAria', { n: i + 1 })}
                          onChange={(e) => setRow(i, { date: e.target.value })}
                        />
                      </div>
                      <div className="poll-picker poll-picker--time">
                        <span className={`poll-picker-value${r.time ? '' : ' poll-picker-value--empty'}`}>
                          {r.time || t('chat.poll.timePlaceholder')}
                        </span>
                        <input
                          className="poll-picker-input"
                          type="time"
                          value={r.time}
                          aria-label={t('chat.poll.timeAria', { n: i + 1 })}
                          onChange={(e) => setRow(i, { time: e.target.value })}
                        />
                      </div>
                    </>
                  ) : (
                    <input
                      className="poll-input"
                      type="text"
                      value={r.label}
                      maxLength={POLL_LIMITS.OPTION_MAX}
                      placeholder={t('chat.poll.optionPlaceholder', { n: i + 1 })}
                      enterKeyHint="next"
                      onKeyDown={focusNext}
                      onChange={(e) => setRow(i, { label: e.target.value })}
                    />
                  )}
                  {rows.length > POLL_LIMITS.OPTIONS_MIN && (
                    <button type="button" className="poll-row-remove" onClick={() => removeRow(i)} aria-label={t('chat.poll.removeOption')}>✕</button>
                  )}
                </div>
                {rowError(i) && <div className="poll-row-error">{rowError(i)}</div>}
              </div>
            ))}
          </div>

          {rows.length < POLL_LIMITS.OPTIONS_MAX && (
            <button type="button" className="poll-add" onClick={addRow}>
              + {isDate ? t('chat.poll.addDate') : t('chat.poll.addOption')}
            </button>
          )}

          {isDate ? (
            <p className="poll-sheet-hint">{t('chat.poll.dateHint')}</p>
          ) : (
            <label className="poll-check">
              <input
                type="checkbox"
                checked={draft.multi}
                onChange={(e) => setDraft((d) => ({ ...d, multi: e.target.checked }))}
              />
              <span>{t('chat.poll.allowMulti')}</span>
            </label>
          )}

          {v.countError && <p className="poll-sheet-hint">{t('chat.poll.minOptionsFmt', { n: POLL_LIMITS.OPTIONS_MIN })}</p>}
          {/* The grey placeholder ("Was machen wir?") reads like a filled-in
              question; without this the button just stayed off, unexplained. */}
          {showQuestionHint && <p id="poll-question-hint" className="poll-sheet-hint">{t('chat.poll.questionRequired')}</p>}
          <div className="poll-sheet-error" role="alert">{error}</div>
        </div>

        <div className="poll-sheet-foot">
          <button type="button" className="poll-submit" onClick={submit} disabled={!v.ok || busy}>
            {busy ? t('common.sending') : t('chat.poll.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PollComposerSheet;
