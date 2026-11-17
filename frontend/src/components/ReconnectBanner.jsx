import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSwipeDismiss from '../hooks/useSwipeDismiss';

// „Verbindung unterbrochen – Wiederverbindung...“ under the header of a group
// chat or a direct message. It was the one network notice that could not be
// swiped away (Tina 16./17.11.2026: „Wenn was lädt kommt ja zB ‚Rückgängig
// machen‘ oder ‚Kein Netzwerk‘ – diese Mitteilung sollte man nach oben swipen
// können“; audit S1-chat-reconnect-leiste) — the toasts and the offline
// banner already could.
//
// Built like the offline banner (context/NetworkContext.jsx): swipe up or tap
// and it is gone for THIS disconnect only — the pages unmount it when the
// socket is back, so the next disconnect starts with it showing again. A
// button for keyboards and screen readers too: Enter or Space closes it and
// hands the focus back to where it came from. No live region here — the same
// sentence is already announced as a toast (SocketContext), and a button
// cannot be one as well.
export default function ReconnectBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const { ref, handlers } = useSwipeDismiss({ onDismiss: () => setDismissed(true) });
  const focusFrom = useRef(null);

  if (dismissed) return null;

  return (
    <div
      ref={ref}
      className="reconnect-banner"
      role="button"
      tabIndex={0}
      aria-label={t('chat.shared.reconnectHide')}
      {...handlers}
      // A tap works too — the one-finger alternative to the swipe.
      onClick={() => setDismissed(true)}
      onFocus={(e) => { focusFrom.current = e.relatedTarget; }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setDismissed(true);
          if (focusFrom.current?.isConnected) focusFrom.current.focus();
        }
      }}
    >
      {t('chat.shared.reconnectBanner')}
    </div>
  );
}
