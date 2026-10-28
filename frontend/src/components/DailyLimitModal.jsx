import { useTranslation } from 'react-i18next';
import { proUpsellAllowed } from '../utils/platform';

// "Tageslimit erreicht" — Tina's sheet (28.10.2026). Shown FIRST when the
// daily free limit blocks a join (3 groups/events per Vienna day) or a create
// (1 group per day): the info must come before any upsell, so nobody reads
// the refusal as "I can never join groups again". The Pro section only
// renders where buying is possible (proUpsellAllowed — Apple 3.1.1 keeps it
// off native iOS without IAP); the sheet itself works everywhere and always
// offers "Morgen wieder dabei".
//
// variant: 'join' | 'create' — same sheet, different body line.

const CORAL = '#FD7666';

function PeoplePauseIcon() {
  return (
    <div style={{ position: 'relative', width: '64px', height: '64px', margin: '0 auto 14px' }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: '18px',
        background: 'rgba(253,118,102,0.10)', border: '1px solid rgba(253,118,102,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={CORAL}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M2.8 19c.7-3 3.2-4.6 6.2-4.6s5.5 1.6 6.2 4.6" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15.4 14.6c2.6.1 4.8 1.5 5.6 4.1" />
        </svg>
      </div>
      <div style={{
        position: 'absolute', right: '-6px', bottom: '-6px',
        width: '26px', height: '26px', borderRadius: '50%',
        background: CORAL, border: '2px solid #1A1433',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff">
          <rect x="7" y="5" width="3.6" height="14" rx="1.2" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" />
        </svg>
      </div>
    </div>
  );
}

function BulletIcon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
    stroke: CORAL, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'infinity': return (
      <svg {...common}>
        <path d="M8.5 9.5c-2 0-3.5 1.1-3.5 2.5s1.5 2.5 3.5 2.5c3.5 0 3.5-5 7-5 2 0 3.5 1.1 3.5 2.5s-1.5 2.5-3.5 2.5c-3.5 0-3.5-5-7-5Z" />
      </svg>);
    case 'plus': return (
      <svg {...common}><path d="M12 5v14M5 12h14" /></svg>);
    default: return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.8 19c.7-3 3.2-4.6 6.2-4.6s5.5 1.6 6.2 4.6" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M15.4 14.6c2.6.1 4.8 1.5 5.6 4.1" />
      </svg>);
  }
}

const BULLETS = [
  { icon: 'infinity', t: 'b1T', d: 'b1D' },
  { icon: 'plus',     t: 'b2T', d: 'b2D' },
  { icon: 'people',   t: 'b3T', d: 'b3D' },
];

export const DailyLimitModal = ({ variant = 'join', onClose }) => {
  const { t } = useTranslation();
  const showPro = proUpsellAllowed();

  const openPro = () => {
    onClose?.();
    window.dispatchEvent(new CustomEvent('jamie:open-pro-modal', {
      detail: { feature: variant === 'create' ? 'creates' : 'joins' },
    }));
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('dailyLimit.title')}
        style={{
          position: 'relative', width: '100%', maxWidth: '500px',
          background: 'linear-gradient(175deg, #2E2455 0%, #1A1433 60%)',
          borderRadius: '28px 28px 0 0',
          border: '1px solid rgba(253,118,102,0.22)', borderBottom: 'none',
          // Same nav clearance as ProModal/BoostModal: the sheet is fixed to
          // the viewport bottom while .bottom-nav owns that edge.
          padding: `22px 22px calc(60px + var(--nav-safe-bottom) + 16px)`,
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
          overflowY: 'auto',
        }}
      >
        <button onClick={onClose} aria-label={t('dailyLimit.later')} style={{
          position: 'absolute', top: '18px', right: '18px',
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', lineHeight: 1,
        }}>
          ✕
        </button>

        <div style={{ textAlign: 'center', marginTop: '8px' }}>
          <PeoplePauseIcon />
          <h2 style={{ margin: '0 0 12px', fontSize: '24px', fontWeight: '900', color: '#fff' }}>
            {t('dailyLimit.title')}
          </h2>
          <p style={{
            margin: '0 auto 18px', maxWidth: '320px',
            color: 'rgba(255,255,255,0.65)', fontSize: '14.5px', lineHeight: 1.55,
          }}>
            {variant === 'create' ? t('dailyLimit.bodyCreate') : t('dailyLimit.bodyJoin')}
          </p>
        </div>

        {showPro && (
          <>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: '800', color: '#fff' }}>
              {t('dailyLimit.proHeading')}
            </h3>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '14px',
              background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '18px', padding: '16px', marginBottom: '18px',
            }}>
              {BULLETS.map((b) => (
                <div key={b.t} style={{ display: 'flex', alignItems: 'flex-start', gap: '13px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(253,118,102,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <BulletIcon name={b.icon} />
                  </div>
                  <div style={{ paddingTop: '1px' }}>
                    <div style={{ color: '#fff', fontWeight: '800', fontSize: '14.5px', lineHeight: 1.3, marginBottom: '2px' }}>
                      {t(`dailyLimit.${b.t}`)}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12.5px', lineHeight: 1.45 }}>
                      {t(`dailyLimit.${b.d}`)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={openPro} style={{
              width: '100%', padding: '17px', borderRadius: '18px', border: 'none',
              background: CORAL, color: '#fff',
              fontSize: '16px', fontWeight: '900', letterSpacing: '0.2px', cursor: 'pointer',
              boxShadow: '0 10px 32px rgba(253,118,102,0.4), 0 2px 8px rgba(0,0,0,0.3)',
              marginBottom: '14px',
            }}>
              {t('dailyLimit.cta')}
            </button>
          </>
        )}

        <button onClick={onClose} style={{
          display: 'block', margin: '0 auto', padding: '8px 12px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.6)', fontSize: '14px', fontWeight: '600',
          textDecoration: 'underline', textUnderlineOffset: '3px',
        }}>
          {t('dailyLimit.later')}
        </button>
      </div>
    </div>
  );
};

export default DailyLimitModal;
