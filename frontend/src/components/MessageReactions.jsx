import { useTranslation } from 'react-i18next';

/**
 * The reaction chips under a chat bubble — „👍 3  ❤️ 1".
 *
 * Rendered by both ChatPage and DirectMessagePage from the server summary
 * [{ emoji, count, user_ids }]. Own reaction gets the coral outline, and
 * tapping a chip toggles it: tap yours to remove it, tap another to move it
 * (one reaction per person, like WhatsApp — the server enforces the same rule
 * via the table's primary key, this is only the affordance).
 *
 * Deliberately NOT inside the bubble: the bubble is a press target for the
 * action sheet, and nesting a second tap target in it made a mis-tap toggle a
 * reaction when someone meant to long-press. The strip sits under the bubble,
 * aligned to the bubble's own side.
 */
export const MessageReactions = ({ reactions, mine, myEmoji, onToggle }) => {
  const { t } = useTranslation();
  if (!Array.isArray(reactions) || reactions.length === 0) return null;

  return (
    <div className={`msg-reactions ${mine ? 'msg-reactions--sent' : 'msg-reactions--received'}`}>
      {reactions.map(r => {
        const active = r.emoji === myEmoji;
        return (
          <button
            key={r.emoji}
            type="button"
            className={`msg-reaction-chip${active ? ' msg-reaction-chip--active' : ''}`}
            // Toggle: tapping the one you already have clears it.
            onClick={() => onToggle(active ? null : r.emoji)}
            aria-pressed={active}
            aria-label={t('chat.reactions.chipAria', { emoji: r.emoji, count: r.count })}
          >
            <span className="msg-reaction-emoji">{r.emoji}</span>
            {r.count > 1 && <span className="msg-reaction-count">{r.count}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default MessageReactions;
