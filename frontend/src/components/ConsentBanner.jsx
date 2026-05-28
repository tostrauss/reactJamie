import { useState } from 'react';

export const CONSENT_KEY = 'jamie_analytics_consent';

export function ConsentBanner() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(CONSENT_KEY));

  if (!visible) return null;

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, 'true');
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem(CONSENT_KEY, 'false');
    setVisible(false);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
      left: 0, right: 0,
      zIndex: 9000,
      background: 'rgba(18,12,34,0.97)',
      backdropFilter: 'blur(16px)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    }}>
      <p style={{
        margin: 0,
        fontSize: '13px',
        color: 'rgba(255,255,255,0.72)',
        lineHeight: 1.55,
      }}>
        JAMIE verwendet anonyme Nutzungsstatistiken, um die App zu verbessern. Keine personenbezogenen Daten werden an Dritte weitergegeben.{' '}
        <a href="/privacy" style={{ color: '#FD7666', textDecoration: 'none' }}>Datenschutz</a>
      </p>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={accept}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '10px',
            border: 'none',
            background: '#FD7666',
            color: '#fff',
            fontSize: '14px',
            fontWeight: '700',
            cursor: 'pointer',
          }}
        >
          Akzeptieren
        </button>
        <button
          onClick={decline}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
            color: 'rgba(255,255,255,0.55)',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Ablehnen
        </button>
      </div>
    </div>
  );
}
