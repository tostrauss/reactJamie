import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { safeStorage } from '../utils/safeStorage';

export const CONSENT_KEY = 'jamie_analytics_consent';

export function ConsentBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => !safeStorage.getItem(CONSENT_KEY));

  if (!visible) return null;

  const accept = () => {
    safeStorage.setItem(CONSENT_KEY, 'true');
    setVisible(false);
  };

  const decline = () => {
    safeStorage.setItem(CONSENT_KEY, 'false');
    setVisible(false);
  };

  return (
    <div style={{
      position: 'fixed',
      // Sit flush ON TOP of .bottom-nav — its full height is the 60px
      // .bottom-nav-items strip PLUS padding-bottom: max(30px, env(...)).
      // A bare env() here read 0 on every device without a home indicator
      // (most Android, desktop), so the banner sat at 64px and covered the
      // top 26px of the 90px nav — and at z-index 9000 it won, hiding the
      // nav icons behind the first-run consent prompt. Must track the same
      // max(30px, env(…)) floor as .update-banner / .install-banner.
      bottom: 'calc(60px + max(30px, env(safe-area-inset-bottom, 0px)))',
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
        {t('consent.text')}{' '}
        <a href="/privacy" style={{ color: '#FD7666', textDecoration: 'none' }}>{t('consent.privacy')}</a>
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
          {t('consent.accept')}
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
          {t('consent.decline')}
        </button>
      </div>
    </div>
  );
}
