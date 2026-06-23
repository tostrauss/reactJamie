import { useTranslation } from 'react-i18next';
import { isNativeIOS } from '../utils/platform';

// Configurable targets (set in env once the store listings + form exist).
// Pre-launch these fall back to a mailto so the buttons always do something.
const APP_STORE_URL = import.meta.env.VITE_APP_STORE_URL || '';
const PLAY_STORE_URL = import.meta.env.VITE_PLAY_STORE_URL || '';
const FEEDBACK_URL = import.meta.env.VITE_FEEDBACK_URL || 'mailto:feedback@jamie-app.com?subject=JAMIE%20Feedback';

const openUrl = (url) => {
  if (!url) return;
  // mailto: must navigate (window.open leaves a blank tab on most browsers).
  if (url.startsWith('mailto:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
};

/**
 * FeedbackModal — periodic "rate us / send feedback" prompt.
 * Shown every few months (interval logic lives in App.jsx). Two actions:
 * rate in the store, or open the feedback form/email.
 */
export const FeedbackModal = ({ onClose }) => {
  const { t } = useTranslation();

  const rate = () => {
    const storeUrl = (isNativeIOS() ? APP_STORE_URL : PLAY_STORE_URL) || APP_STORE_URL || PLAY_STORE_URL;
    openUrl(storeUrl || FEEDBACK_URL);
    onClose();
  };

  const suggest = () => {
    openUrl(FEEDBACK_URL);
    onClose();
  };

  return (
    <div
      className="modal-overlay modal-overlay-center"
      style={{ zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-container create-action-modal" style={{ maxWidth: 380 }}>
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
          onClick={suggest}
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
      </div>
    </div>
  );
};

export default FeedbackModal;
