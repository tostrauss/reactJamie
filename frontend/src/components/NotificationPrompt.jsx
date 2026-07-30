import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isPushSupported, getPushPermission, isPushSubscribed, subscribeToPush, syncPushSubscription } from '../utils/pushNotifications';
import { safeStorage } from '../utils/safeStorage';

// Proactive "Benachrichtigungen aktivieren" banner. Web push is opt-in — a
// subscription only exists once the user asks for it, and the only entry point
// used to be buried in Settings, so most people never enabled notifications
// (Tina 2026-07-19: "Mitteilungen funktionieren nicht"). This surfaces a
// one-tap enable on web / Android / installed PWA. iOS native handles its own
// APNs permission prompt (useNativePush) and isPushSupported() is false there,
// so this never shows on the native iOS app.
//
// The tap on "Aktivieren" is the required user gesture for
// Notification.requestPermission() (mandatory on iOS PWA + good practice
// everywhere). Dismiss / denial snoozes the banner for 14 days.
const DISMISS_KEY = 'jamie_push_prompt_dismissed';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export const NotificationPrompt = () => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) return;                 // native / unsupported browser
      const perm = getPushPermission();
      if (perm === 'granted') {
        // Permission exists but a subscription may not: in the Play-TWA the
        // Android app-level prompt grants Notification.permission without ever
        // creating a web PushSubscription, and this banner (rightly) never
        // shows then — so nothing subscribed and "Freigabe erteilt, trotzdem
        // kein Push" (Lea, 2026-07-30). Create/repair it silently instead.
        syncPushSubscription();
        return;
      }
      if (perm !== 'default') return;                 // blocked
      const dismissedAt = parseInt(safeStorage.getItem(DISMISS_KEY) || '0', 10);
      if (dismissedAt && Date.now() - dismissedAt < SNOOZE_MS) return;
      if (await isPushSubscribed()) return;
      // Let the app settle (intro / review modals) before nudging.
      timerRef.current = setTimeout(() => { if (!cancelled) setShow(true); }, 3000);
    })();
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const snooze = () => safeStorage.setItem(DISMISS_KEY, String(Date.now()));

  const enable = async () => {
    setBusy(true);
    const ok = await subscribeToPush();
    setBusy(false);
    setShow(false);
    if (!ok) snooze(); // denied / failed → don't nag again for a while
  };
  const dismiss = () => { snooze(); setShow(false); };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', left: 12, right: 12,
      // Clear the 60px nav + its 30px/safe-area floor — must match the
      // update/install banners, else the prompt's lower edge hides behind the
      // nav on 0-inset Android (Tobi 2026-07-28: "abgeschnitten").
      bottom: 'calc(70px + max(30px, env(safe-area-inset-bottom, 0px)))',
      zIndex: 900, maxWidth: 480, margin: '0 auto',
      background: 'var(--bg-card, #1e2235)', border: '1px solid rgba(253,118,102,0.35)',
      borderRadius: 16, padding: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: 'rgba(253,118,102,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FD7666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{t('pushPrompt.title')}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{t('pushPrompt.text')}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <button onClick={enable} disabled={busy} style={{
          background: '#FD7666', color: '#1a1a2e', border: 'none', borderRadius: 999,
          padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          opacity: busy ? 0.6 : 1,
        }}>{t('pushPrompt.enable')}</button>
        <button onClick={dismiss} style={{
          background: 'none', color: 'rgba(255,255,255,0.45)', border: 'none',
          padding: 0, fontSize: 12, cursor: 'pointer',
        }}>{t('pushPrompt.later')}</button>
      </div>
    </div>
  );
};
