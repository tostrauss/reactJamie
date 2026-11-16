import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSwipeDismiss from '../hooks/useSwipeDismiss';

const NetworkContext = createContext({ isOnline: true });

export const useNetwork = () => useContext(NetworkContext);

export const NetworkProvider = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline }}>
      {children}
      <OfflineStatus isOnline={isOnline} />
      {!isOnline && <OfflineBanner />}
    </NetworkContext.Provider>
  );
};

// What a screen reader says (review 16.11.2026). Always mounted, like
// .toast-container: a live region that appears together with its text is
// often not announced at all by VoiceOver/TalkBack. Empty while online; once
// per offline spell it reads „Keine Internetverbindung“, whatever happens to
// the banner. Visually hidden (global.css .offline-status).
// The text only ever comes after the region is in the page — also on a cold
// start without a network, where isOnline is false from the first render and
// the region used to arrive together with its text after all.
const OfflineStatus = ({ isOnline }) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  useEffect(() => { setText(isOnline ? '' : t('app.connection.offline')); }, [isOnline, t]);
  return (
    <div className="sr-only offline-status" role="status" aria-live="polite">
      {text}
    </div>
  );
};

const OfflineBanner = () => {
  const { t } = useTranslation();
  // Swiped up or tapped away (Tina 16.11.2026): gone for THIS offline spell
  // only. The banner unmounts when the network is back, so the next spell
  // starts with it showing again. Local state on purpose, not in the context
  // value: AuthProvider reads that context, and a new value would re-render
  // every auth consumer on a swipe.
  const [dismissed, setDismissed] = useState(false);
  const { ref, handlers } = useSwipeDismiss({ onDismiss: () => setDismissed(true) });
  // Where the focus was before it came onto the banner (Tab, Shift+Tab):
  // closing it by keyboard hands it back there instead of dropping it onto
  // <body>, where the next Tab starts over at the top (review 16.11.2026).
  const focusFrom = useRef(null);

  // While it shows, the toasts start below it instead of covering it: its
  // measured height goes onto <html> (global.css, :root[data-offline-banner]).
  // Measured, not a fixed 36px — the text wraps on narrow screens and in
  // longer languages.
  useEffect(() => {
    const el = ref.current;
    if (dismissed || !el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--offline-banner-h', `${el.offsetHeight}px`);
    measure();
    root.setAttribute('data-offline-banner', '');
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.removeAttribute('data-offline-banner');
      root.style.removeProperty('--offline-banner-h');
    };
  }, [dismissed, ref]);

  if (dismissed) return null;

  // A button for keyboards and screen readers too (review 16.11.2026): Enter
  // or Space closes it like a tap, and its name says so. The announcement is
  // OfflineStatus's — a button cannot be a live region as well.
  return (
    <div
      ref={ref}
      className="offline-banner"
      role="button"
      tabIndex={0}
      aria-label={t('app.connection.offlineHide')}
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 015.17-2.39"/>
        <path d="M10.71 5.05A16 16 0 0122.56 9"/>
        <path d="M1.42 9a15.91 15.91 0 014.7-2.88"/>
        <path d="M8.53 16.11a6 6 0 016.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
      <span>{t('app.connection.offline')}</span>
    </div>
  );
};

export default NetworkProvider;
