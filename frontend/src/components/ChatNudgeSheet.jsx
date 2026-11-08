import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// Tina's notification concept (03.11.2026), „Wie bekommen wir Leute dazu, dass
// sie schreiben?": a small sheet that sends people straight into the chat —
//   variant 'created' → right after creating a group:
//                       „Deine Gruppe ist bereit! 🎉" + „Erste Nachricht schreiben"
//   variant 'joined'  → right after joining: „Du bist bei X dabei! Sag kurz Hallo 👋"
// Both only nudge; „Später" always closes. Texts are Tina's, verbatim.

const CORAL = '#FD7666';

export const ChatNudgeSheet = ({ variant, groupName, onChat, onClose }) => {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const created = variant === 'created';
  const title = created ? t('chatNudge.createdTitle') : t('chatNudge.joinedTitle', { name: groupName || '' });
  const body = created ? t('chatNudge.createdBody') : t('chatNudge.joinedBody');
  const cta = created ? t('chatNudge.createdCta') : t('chatNudge.joinedCta');

  return (
    <div
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: '100%', maxWidth: '500px', textAlign: 'center',
          background: 'linear-gradient(175deg, #2E2455 0%, #1A1433 60%)',
          borderRadius: '28px 28px 0 0',
          border: '1px solid rgba(253,118,102,0.22)', borderBottom: 'none',
          // Fixed to the viewport bottom while .bottom-nav owns that edge.
          padding: '26px 22px calc(60px + var(--nav-safe-bottom) + 16px)',
        }}
      >
        <div aria-hidden="true" style={{
          width: '60px', height: '60px', margin: '0 auto 14px', borderRadius: '50%',
          background: 'rgba(253,118,102,0.12)', color: CORAL,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: '21px', fontWeight: 900, color: '#fff', textWrap: 'balance' }}>
          {title}
        </h2>
        <p style={{ margin: '0 auto 20px', maxWidth: '320px', color: 'rgba(255,255,255,0.68)', fontSize: '15px', lineHeight: 1.5 }}>
          {body}
        </p>
        <button type="button" onClick={onChat} style={{
          width: '100%', padding: '16px', borderRadius: '18px', border: 'none',
          background: CORAL, color: '#fff', fontSize: '16px', fontWeight: 900, cursor: 'pointer',
          boxShadow: '0 10px 32px rgba(253,118,102,0.4)', marginBottom: '10px',
        }}>
          {cta}
        </button>
        <button type="button" onClick={onClose} style={{
          display: 'block', margin: '0 auto', padding: '8px 12px', background: 'none', border: 'none',
          color: 'rgba(255,255,255,0.6)', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
        }}>
          {t('chatNudge.later')}
        </button>
      </div>
    </div>
  );
};

export default ChatNudgeSheet;
