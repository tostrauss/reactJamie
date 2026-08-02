import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Join gate: joining a group/club without a profile photo first routes through
// this prompt ("Weil es geht ja um Profile und Aktivitäten bei uns" — Tina
// 2026-08-02). UX-level gate only — invites, waitlist promotion and the raw
// API stay ungated on purpose.
const AvatarGateModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="avatar-gate-icon" aria-hidden="true">📸</div>
        <h2 className="modal-title">{t('app.avatarGate.title')}</h2>
        <p className="avatar-gate-text">{t('app.avatarGate.text')}</p>
        <button
          className="btn btn-primary avatar-gate-cta"
          onClick={() => { onClose(); navigate('/profile/edit'); }}
        >
          {t('app.avatarGate.cta')}
        </button>
        <button className="modal-close-btn" onClick={onClose}>
          {t('app.avatarGate.cancel')}
        </button>
      </div>
    </div>
  );
};

export default AvatarGateModal;
