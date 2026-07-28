import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNative, isNativeIOS } from '../utils/platform';
import { feedback as feedbackApi } from '../utils/api';

// Configurable targets (set in env once the store listings + form exist).
const APP_STORE_URL = import.meta.env.VITE_APP_STORE_URL || '';
const PLAY_STORE_URL = import.meta.env.VITE_PLAY_STORE_URL || '';

const openUrl = (url) => {
  if (!url) return;
  if (url.startsWith('mailto:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
};

const CATEGORIES = ['bug', 'idea', 'other'];

/**
 * FeedbackModal — "rate us / send feedback".
 * Shown periodically (interval logic lives in App.jsx) and on demand from
 * Settings. "Feedback & Wünsche" used to be a mailto: dead-end — during the
 * 2026-07 testing round every piece of feedback arrived via WhatsApp instead.
 * Now an in-app form: stored in app_feedback, listed in the admin dashboard,
 * forwarded to the inbox best-effort.
 */
export const FeedbackModal = ({ onClose }) => {
  const { t } = useTranslation();
  const [view, setView] = useState('menu'); // 'menu' | 'form' | 'thanks'
  const [category, setCategory] = useState('idea');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const rate = () => {
    const storeUrl = (isNativeIOS() ? APP_STORE_URL : PLAY_STORE_URL) || APP_STORE_URL || PLAY_STORE_URL;
    openUrl(storeUrl || 'mailto:feedback@jamie-app.com?subject=JAMIE%20Feedback');
    onClose();
  };

  const submit = async () => {
    if (sending || message.trim().length < 5) return;
    setSending(true);
    setError(null);
    try {
      const platform = isNativeIOS() ? 'ios' : isNative() ? 'android' : 'web';
      await feedbackApi.submit(category, message.trim(), platform);
      setView('thanks');
      setTimeout(onClose, 1600);
    } catch (err) {
      setError(err.response?.data?.error || t('feedback.form.error'));
      setSending(false);
    }
  };

  return (
    <div
      className="modal-overlay modal-overlay-center"
      style={{ zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-container create-action-modal" style={{ maxWidth: 380 }}>
        {view === 'thanks' ? (
          <>
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }} aria-hidden="true">🙏</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, textAlign: 'center', color: 'var(--text-white)' }}>
              {t('feedback.form.thanksTitle')}
            </h3>
            <p style={{ margin: 0, fontSize: 14, textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('feedback.form.thanksBody')}
            </p>
          </>
        ) : view === 'form' ? (
          <>
            <h3 style={{ margin: '0 0 14px', fontSize: 20, textAlign: 'center', color: 'var(--text-white)' }}>
              {t('feedback.form.title')}
            </h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  style={{
                    flex: 1,
                    padding: '9px 4px',
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: category === c ? '1px solid var(--coral, #FD7666)' : '1px solid rgba(255,255,255,0.15)',
                    background: category === c ? 'rgba(253,118,102,0.15)' : 'transparent',
                    color: category === c ? 'var(--coral, #FD7666)' : 'var(--text-muted)',
                  }}
                >
                  {t(`feedback.form.cat.${c}`)}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('feedback.form.placeholder')}
              rows={5}
              maxLength={5000}
              autoFocus
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'var(--bg-card)',
                color: 'var(--text-white)',
                fontSize: 16, /* 16px prevents iOS zoom on focus */
                fontFamily: 'inherit',
                lineHeight: 1.5,
                resize: 'none',
                marginBottom: 10,
                boxSizing: 'border-box',
              }}
            />
            {error && (
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#ff8a80', textAlign: 'center' }}>{error}</p>
            )}
            <button
              className="btn btn-primary btn-block"
              onClick={submit}
              disabled={sending || message.trim().length < 5}
              style={{ marginBottom: 10, opacity: sending || message.trim().length < 5 ? 0.6 : 1 }}
            >
              {sending ? t('feedback.form.sending') : t('feedback.form.send')}
            </button>
            <button
              onClick={() => setView('menu')}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', padding: 8 }}
            >
              {t('feedback.form.back')}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }} aria-hidden="true">💬</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, textAlign: 'center', color: 'var(--text-white)' }}>
              {t('feedback.title')}
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('feedback.body')}
            </p>

            <button className="btn btn-primary btn-block" onClick={rate} style={{ marginBottom: 10 }}>
              {t('feedback.rate')}
            </button>
            <button
              className="btn btn-block"
              onClick={() => setView('form')}
              style={{ marginBottom: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-white)' }}
            >
              {t('feedback.suggest')}
            </button>
            <button
              onClick={onClose}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', padding: 8 }}
            >
              {t('feedback.later')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default FeedbackModal;
