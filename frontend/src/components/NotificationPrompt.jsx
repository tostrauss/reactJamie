import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isPushSupported, getPushPermission, subscribeToPush, syncPushSubscription, reportPushStartDiagnostics } from '../utils/pushNotifications';
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

// Contextual ask (Lea, 18.10.2026): right after joining a group or club — or
// asking to — is when a push starts to matter (the chat, the acceptance), so
// the join handlers fire this window event, like jamie:open-pro-modal: loose
// contract, no plumbing. It overrides the 14-day snooze, but never within
// 24 h of a "Später", and only while the permission was never answered.
const ASK_AFTER_JOIN_EVENT = 'jamie:push-prompt-after-join';
const ASK_AFTER_JOIN_SNOOZE_MS = 24 * 60 * 60 * 1000;
// A beat after the join so its own result (button, toast) is seen first.
const ASK_AFTER_JOIN_DELAY_MS = 1200;

export const NotificationPrompt = () => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    let tid = null;
    const onJoin = () => {
      if (!isPushSupported() || getPushPermission() !== 'default') return;
      const dismissedAt = parseInt(safeStorage.getItem(DISMISS_KEY) || '0', 10);
      if (dismissedAt && Date.now() - dismissedAt < ASK_AFTER_JOIN_SNOOZE_MS) return;
      clearTimeout(tid);
      tid = setTimeout(() => setShow(true), ASK_AFTER_JOIN_DELAY_MS);
    };
    window.addEventListener(ASK_AFTER_JOIN_EVENT, onJoin);
    return () => { window.removeEventListener(ASK_AFTER_JOIN_EVENT, onJoin); clearTimeout(tid); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Once a day per device: what this start found ([push-diag], Lea
      // 18.10.2026) — read BEFORE the repair below changes the subscription.
      await reportPushStartDiagnostics();
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
      // Blocked: WebPushDeniedBanner explains the way back (Android), the
      // Settings row everywhere.
      if (perm !== 'default') return;
      const dismissedAt = parseInt(safeStorage.getItem(DISMISS_KEY) || '0', 10);
      if (dismissedAt && Date.now() - dismissedAt < SNOOZE_MS) return;
      // No "already subscribed?" check any more: without the permission a
      // leftover subscription delivers nothing, yet it used to keep this
      // banner away for good (Lea, 18.10.2026).
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
      // Clear the 60px nav + its safe-space floor — must match the
      // update/install banners, else the prompt's lower edge hides behind the
      // nav on 0-inset Android (Tobi 2026-07-28: "abgeschnitten"). Single
      // knob: var(--nav-safe-bottom) in global.css :root (2026-08-04).
      bottom: 'calc(70px + var(--nav-safe-bottom))',
      // 9000 = same magnitude as its sibling banners (ConsentBanner 9000,
      // update 9999, install 9998). The old 900 sat BELOW .bottom-nav (1000)
      // — one layout tweak away from rendering behind the nav icons.
      zIndex: 9000, maxWidth: 480, margin: '0 auto',
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
