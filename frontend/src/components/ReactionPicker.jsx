import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QUICK_REACTIONS, MORE_REACTIONS } from '../utils/reactions';

/**
 * The emoji row at the top of the long-press action sheet.
 *
 * Six quick reactions plus a „+" that expands the rest in place. Expanding in
 * place rather than opening a second sheet keeps it one gesture deep: the chat
 * is a phone surface, and a picker stacked on a sheet stacked on the chat is
 * two taps to get back out of.
 *
 * There is no free-text input on purpose — the set is a fixed server-side
 * allowlist (utils/reactions.js), which is what keeps reactions out of the
 * moderation queue entirely.
 */
export const ReactionPicker = ({ myEmoji, onPick }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Tapping the emoji you already have removes it — same toggle rule as the
  // chips under the bubble, so the two never disagree.
  const pick = (emoji) => onPick(emoji === myEmoji ? null : emoji);

  return (
    <div className="reaction-picker">
      <div className="reaction-picker-quick">
        {QUICK_REACTIONS.map(emoji => (
          <button
            key={emoji}
            type="button"
            className={`reaction-btn${emoji === myEmoji ? ' reaction-btn--active' : ''}`}
            onClick={() => pick(emoji)}
            aria-label={emoji}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className={`reaction-btn reaction-btn--more${expanded ? ' reaction-btn--active' : ''}`}
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-label={t('chat.reactions.more')}
        >
          {expanded ? '−' : '+'}
        </button>
      </div>

      {expanded && (
        <div className="reaction-picker-grid">
          {MORE_REACTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              className={`reaction-btn${emoji === myEmoji ? ' reaction-btn--active' : ''}`}
              onClick={() => pick(emoji)}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReactionPicker;
