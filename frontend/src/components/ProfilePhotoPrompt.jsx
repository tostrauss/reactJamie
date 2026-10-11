import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * „Achtung: Dein Profil ist nicht vollständig" — the sheet Tina sketched for
 * the end of onboarding (checklist 10.10.2026): [Profilbild hinzufügen]
 * [Überspringen]. Shown by the final onboarding CTA and by a join on the
 * onboarding clubs page while there is no profile picture (joining needs one,
 * server-side: 403 requiresAvatar).
 *
 * Same markup and classes as AvatarGateModal, so it is the same bottom sheet
 * users already know from Home and ClubDetail. Unlike that modal it does NOT
 * navigate anywhere: the caller decides what the buttons do.
 *
 *   onAdd   the CTA. The caller opens its file picker in here, SYNCHRONOUSLY
 *           as the first statement — this click is the user gesture WebKit
 *           requires; after an await, an effect or a timer the picker stays
 *           shut. Keep the picker's <input> OUTSIDE this sheet: the sheet
 *           unmounts on close, and a detached input never reports `change`.
 *   onSkip  „Überspringen".
 *   onClose tap on the dimmed backdrop and Escape — close only, no decision.
 */
export function ProfilePhotoPrompt({ isOpen, onAdd, onSkip, onClose }) {
  const { t } = useTranslation();
  const sheetRef = useRef(null);
  // Latest onClose without re-subscribing the key listener on every render.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    // Move focus into the dialog so a screen reader starts at its title
    // instead of staying on the button underneath that opened it.
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => onClose?.()}>
      <div
        ref={sheetRef}
        className="modal-content avatar-gate-sheet profile-photo-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-photo-prompt-title"
        aria-describedby="profile-photo-prompt-text"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />
        <div className="avatar-gate-icon" aria-hidden="true">📸</div>
        <h2 className="modal-title" id="profile-photo-prompt-title">{t('onboarding.photoPrompt.title')}</h2>
        <p className="avatar-gate-text" id="profile-photo-prompt-text">{t('onboarding.photoPrompt.text')}</p>
        <button type="button" className="btn btn-primary avatar-gate-cta" onClick={onAdd}>
          {t('onboarding.photoPrompt.cta')}
        </button>
        <button type="button" className="modal-close-btn" onClick={onSkip}>
          {t('onboarding.photoPrompt.skip')}
        </button>
      </div>
    </div>
  );
}

export default ProfilePhotoPrompt;
