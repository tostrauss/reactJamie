import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPollOption, leadingPositions, nextChoices } from '../utils/polls';

// Same as ChatPage's long-press: a press held this long opened the message
// sheet, so the click that follows it must not ALSO cast a vote.
const LONG_PRESS_MS = 500;

/**
 * A poll inside a chat bubble (B1, tester 06.10.2026: "Abstimmungsfunktion für
 * Terminfindung oder Aktivitätsplanung").
 *
 * Counts only — votes are anonymous; the viewer's own choice is `my_votes`.
 * Option buttons deliberately do NOT stop pointerdown propagation: the bubble
 * is the long-press target (react / reply / report / end poll), and a poll is
 * mostly options — swallowing the press would make it unreportable. Instead a
 * click that follows a ≥500 ms hold is ignored. Keyboard activation has no
 * pointerdown, so it always votes.
 *
 * Closed polls stay readable: aria-disabled (NOT disabled — a disabled button
 * swallows pointer events and would kill the long-press), winners marked.
 */
export function PollMessage({ poll, memberCount = 0, locale = 'de-DE', onVote }) {
  const { t } = useTranslation();
  const qid = useId();
  const downAt = useRef(0);
  const leading = leadingPositions(poll);
  const mine = Array.isArray(poll.my_votes) ? poll.my_votes : [];
  const voters = Number(poll.voter_count) || 0;

  const kicker = [
    poll.kind === 'date' ? `📅 ${t('chat.poll.kickerDate')}` : `📊 ${t('chat.poll.kickerChoice')}`,
    poll.multi ? t('chat.poll.multiHint') : t('chat.poll.singleHint'),
    poll.closed ? t('chat.poll.closedHint') : null,
  ].filter(Boolean).join(' · ');

  const foot = voters === 0
    ? t('chat.poll.noVotes')
    : memberCount > 0
      ? t('chat.poll.votersOfFmt', { count: voters, total: Math.max(memberCount, voters) })
      : t('chat.poll.votersFmt', { count: voters });

  // `detail === 0` is a keyboard or screen-reader activation: never "held",
  // even when an earlier press on this poll was aborted (right-click, drag
  // off, scroll) and left a stale downAt behind.
  const handleClick = (pos, e) => {
    const held = e?.detail !== 0 && downAt.current && Date.now() - downAt.current >= LONG_PRESS_MS;
    downAt.current = 0;
    if (held || poll.closed) return;
    onVote?.(nextChoices(poll, pos));
  };

  return (
    <div className="poll" role="group" aria-labelledby={qid}>
      <div className="poll-kicker">{kicker}</div>
      <div className="poll-question" id={qid}>{poll.question}</div>
      <div className="poll-options">
        {poll.options.map((o) => {
          const on = mine.includes(o.pos);
          const votes = Number(o.votes) || 0;
          const isLeading = leading.includes(o.pos);
          const label = formatPollOption(o, poll.kind, locale);
          const cls = ['poll-opt',
            on && 'poll-opt--on',
            !poll.closed && isLeading && 'poll-opt--leading',
            poll.closed && isLeading && 'poll-opt--winner'].filter(Boolean).join(' ');
          return (
            <button
              key={o.pos}
              type="button"
              className={cls}
              aria-pressed={on}
              aria-disabled={poll.closed || undefined}
              // The tag below is not announced (aria-label replaces the
              // content), so the winner says so in its name.
              aria-label={t('chat.poll.optionAria', { label, count: votes })
                + (poll.closed && isLeading ? `, ${t('chat.poll.result')}` : '')}
              style={{ '--share': `${Math.round((100 * votes) / Math.max(voters, 1))}%` }}
              onPointerDown={() => { downAt.current = Date.now(); }}
              onPointerCancel={() => { downAt.current = 0; }}
              onClick={(e) => handleClick(o.pos, e)}
            >
              <span className="poll-opt-bar" aria-hidden="true" />
              <span className={`poll-opt-mark${poll.multi ? ' poll-opt-mark--multi' : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
              <span className="poll-opt-label">{label}</span>
              {poll.closed && isLeading && <span className="poll-opt-tag">{t('chat.poll.result')}</span>}
              <span className="poll-opt-count" aria-hidden="true">{votes}</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">{foot}</div>
    </div>
  );
}

export default PollMessage;
