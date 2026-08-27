import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Join gate: joining/creating/inviting without a profile photo routes through
// this prompt ("Weil es geht ja um Profile und Aktivitäten bei uns" — Tina
// 2026-08-02). Server-side the rule is now enforced on join, create AND owner
// invite (2026-08-27); this modal is the friendly path to fix it.
//
// soft: proactive nudge variant for existing members who are still avatar-less
// (grandfathered from before the join gate). Softer copy, same CTA — dismissible.
const AvatarGateModal = ({ isOpen, onClose, soft = false }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (!isOpen) return null;

  const ns = soft ? 'app.avatarNudge' : 'app.avatarGate';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="avatar-gate-icon" aria-hidden="true">📸</div>
        <h2 className="modal-title">{t(`${ns}.title`)}</h2>
        <p className="avatar-gate-text">{t(`${ns}.text`)}</p>
        <button
          className="btn btn-primary avatar-gate-cta"
          onClick={() => { onClose(); navigate('/profile/edit'); }}
        >
          {t(`${ns}.cta`)}
        </button>
        <button className="modal-close-btn" onClick={onClose}>
          {t(`${ns}.cancel`)}
        </button>
      </div>
    </div>
  );
};

export default AvatarGateModal;
