import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { safeStorage } from '../utils/safeStorage';

// Native-iOS counterpart of NotificationPrompt. Shows when iOS has the app's
// notification permission set to DENIED — which is sticky: iOS asks exactly
// once per install, and every user who tapped "Nicht erlauben" on 1.2/1.3
// (when push could not work anyway) is silently push-less on 1.4 forever.
// The app can't re-prompt; it can only send the user to Settings.
//
// `window.open('app-settings:')`: Capacitor's WKUIDelegate.createWebViewWith
// hands any window.open URL to UIApplication.shared.open, and `app-settings:`
// is Apple's URL for the app's own Settings page. No extra plugin. When the
// user comes back, useNativePush re-checks on appStateChange and registers
// immediately — no force-quit required.
//
// Permission state comes from useNativePush (App.jsx), the only place that
// talks to the plugin; this component is presentational + snooze. A FRESH
// in-session denial writes the snooze key itself (in the hook), so this only
// ever nags about a denial that predates this app start.
//
// Two-row layout on purpose: the DE/FR CTA ("Einstellungen öffnen") is ~60px
// wider than the web prompt's "Aktivieren", and in a single row it squeezed
// the title into ~100px on non-Max iPhones.
export const DISMISS_KEY = 'jamie_native_push_denied_dismissed';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export const NativePushDeniedBanner = ({ permission }) => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (permission !== 'denied') { setShow(false); return; }
    const dismissedAt = parseInt(safeStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissedAt && Date.now() - dismissedAt < SNOOZE_MS) return;
    // Let the app settle (intro / review modals) before nudging.
    const t0 = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(t0);
  }, [permission]);

  const snooze = () => safeStorage.setItem(DISMISS_KEY, String(Date.now()));
  const openSettings = () => {
    try { window.open('app-settings:', '_blank'); } catch { /* not in a Capacitor shell */ }
    // Deliberately neither hidden nor snoozed: iOS backgrounds the app while
    // Settings is open. If they enable notifications, the hook flips
    // permission to 'granted' on return and the effect above hides us; if
    // they come back without enabling, the banner is simply still here.
    // (Hiding it here left it gone for the session — a same-value 'denied'
    // re-check doesn't re-run the effect.)
  };
  const dismiss = () => { snooze(); setShow(false); };

  if (!show) return null;

  return (
    <div role="status" aria-live="polite" style={{
      position: 'fixed', left: 12, right: 12,
      // Same nav clearance as NotificationPrompt — single knob in :root.
      bottom: 'calc(70px + var(--nav-safe-bottom))',
      zIndex: 9000, maxWidth: 480, margin: '0 auto',
      background: 'var(--bg-card, #1e2235)', border: '1px solid rgba(253,118,102,0.35)',
      borderRadius: 16, padding: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
      display: 'grid', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div aria-hidden="true" style={{
          width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: 'rgba(253,118,102,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FD7666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            <line x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflowWrap: 'anywhere' }}>{t('nativePushDenied.title')}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{t('nativePushDenied.text')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
        <button onClick={dismiss} style={{
          background: 'none', color: 'rgba(255,255,255,0.55)', border: 'none',
          padding: '8px 12px', minHeight: 36, fontSize: 13, cursor: 'pointer',
        }}>{t('nativePushDenied.later')}</button>
        <button onClick={openSettings} style={{
          background: '#FD7666', color: '#1a1a2e', border: 'none', borderRadius: 999,
          padding: '9px 16px', minHeight: 36, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{t('nativePushDenied.open')}</button>
      </div>
    </div>
  );
};

export default NativePushDeniedBanner;
