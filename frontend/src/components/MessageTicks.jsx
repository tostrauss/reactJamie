import { useTranslation } from 'react-i18next';

/**
 * Sende-Status auf der eigenen Nachricht: ✓ gesendet, ✓✓ zugestellt,
 * ✓✓ blau gelesen.
 *
 * Blue for "read" rather than the brand coral on purpose: this is a status
 * glyph people already know from every messenger they use, and recognisability
 * beats palette purity for something 8 pixels tall. Grey/blue is the language.
 *
 * `state` is derived by the caller from watermarks, never stored per message —
 * both chat pages merge refetches by appending unknown rows and never rewrite a
 * row already on screen, so a per-message flag would freeze after the first
 * reconnect.
 */
const COLORS = {
  pending: 'currentColor',
  sent: 'currentColor',
  delivered: 'currentColor',
  read: '#5BC0F8',
};

export function MessageTicks({ state }) {
  const { t } = useTranslation();
  if (!state || state === 'failed') return null;

  const double = state === 'delivered' || state === 'read';
  const label = t(`chat.receipts.state.${state}`);

  return (
    <span
      className={`msg-ticks msg-ticks--${state}`}
      style={{ color: COLORS[state] || 'currentColor' }}
      // The glyph carries real information, so it needs a name for anyone not
      // reading it visually.
      role="img"
      aria-label={label}
      title={label}
    >
      {state === 'pending' ? (
        // A clock, not a tick: nothing has reached the server yet.
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width={double ? 18 : 13} height="12" viewBox={double ? '0 0 20 12' : '0 0 14 12'} fill="none" aria-hidden="true">
          <path
            d="M1 6.6 4.2 9.8 10.4 2.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {double && (
            <path
              d="M8.6 6.6 11.8 9.8 18 2.4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </span>
  );
}

/**
 * Watermark → tick state for ONE message.
 *
 * `deliveredThrough` / `readThrough` are timestamps meaning "everything sent at
 * or before this moment has been delivered / read". Comparing the message's own
 * created_at against them re-derives every bubble from two numbers.
 *
 * Returns null for a message that is not mine — nobody gets to see receipts on
 * somebody else's message.
 */
export function tickState(msg, { mine, deliveredThrough, readThrough }) {
  if (!mine) return null;
  if (msg?._failed) return 'failed';
  if (msg?._pending || !msg?.id || String(msg.id).startsWith('temp-')) return 'pending';

  const at = new Date(msg.created_at).getTime();
  const reached = (ts) => ts != null && new Date(ts).getTime() >= at;

  // A DM carries its own per-row state from the server; a group message has
  // only the watermarks. Taking whichever is further along means a freshly
  // loaded DM is right immediately AND a row the append-only merge can never
  // rewrite still heals from the live watermark.
  if (msg.is_read === true || (Number.isFinite(at) && reached(readThrough))) return 'read';
  if (msg.delivered_at || (Number.isFinite(at) && reached(deliveredThrough))) return 'delivered';
  return 'sent';
}

export default MessageTicks;
