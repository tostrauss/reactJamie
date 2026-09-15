import { useTranslation } from 'react-i18next';

/**
 * The quoted message shown above a reply, in the bubble.
 *
 * Tapping it jumps to the original — the behaviour people expect from
 * WhatsApp. The jump is best-effort: the quoted message may be older than the
 * loaded page, in which case `onJump` finds nothing and we simply do nothing
 * rather than yanking the view somewhere arbitrary or firing a fetch the user
 * did not ask for.
 *
 * `quote.content` is null for a voice message (the row stores a URL, which is
 * not something to show a person) — the type renders a label instead.
 */
export function MessageQuote({ quote, onJump }) {
  const { t } = useTranslation();
  if (!quote) return null;

  const isVoice = quote.message_type === 'voice';
  const isImage = quote.message_type === 'image';

  return (
    <button
      type="button"
      className="msg-quote"
      onClick={(e) => { e.stopPropagation(); onJump?.(); }}
      // The bubble carries a long-press handler for reply/report; a press that
      // starts here must not also open that sheet.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <span className="msg-quote-name">{quote.user_name || t('chat.reply.unknownAuthor')}</span>
      <span className="msg-quote-text">
        {isVoice ? t('chat.voice.label')
          : isImage ? t('chat.photo.label')
          : (quote.content || t('chat.reply.deleted'))}
      </span>
    </button>
  );
}

export default MessageQuote;
