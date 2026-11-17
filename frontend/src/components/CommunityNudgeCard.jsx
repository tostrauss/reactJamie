import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { communityNudgeApi } from '../utils/api';
import { thumbUrl } from '../utils/images';
import '../styles/post-event.css';

// „Hey, [Community] hat Potenzial! ✨ Jetzt fehlt nur noch das erste Treffen.
// Leg los!“ — the card for somebody whose community still has no meetup about
// a week after founding it (Tina 17.11.2026, her Bild 17), with „Treffen
// erstellen“ and an X. „Statt dem Bild links hier, sollte das Bild der
// Community sein“: the community's own cover stands where her mock has the
// people icon — which stays as the fallback for a community without one.
//
// When a community is due is the server's call (jobs/communityNudges.js);
// PostEventPrompts shows the card on the home screen only, one per session.
// Both ways out close it for good (POST …/community-nudges/:id/dismiss, never
// waited for): the X — and „Treffen erstellen“, which leads to
// /club/<id>?newEvent=1, where the community page opens its event form.

// The name is never run through the translation's markup: the sentence is
// rendered around a slot, the name goes in as plain text.
const NAME_SLOT = '';
// A very long name is shortened, so the sentence keeps its point („… hat
// Potenzial! ✨“) instead of ending in the middle of the name.
const NAME_MAX = 36;
const shortName = (name) => {
  const chars = Array.from(name);
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('').trimEnd()}…` : name;
};

// Two people, outlined — the icon of the mock.
function PeopleGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.7-3 3.2-4.6 6.2-4.6s5.5 1.6 6.2 4.6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.4 14.6c2.6.1 4.8 1.5 5.6 4.1" />
    </svg>
  );
}

// The three short strokes over the picture's corner.
function Spark() {
  return (
    <svg className="pe-nudge-spark" width="28" height="28" viewBox="0 0 28 28" fill="none"
         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6 3l3 8" />
      <path d="M16.5 6l-4 7" />
      <path d="M25 14l-8 3.2" />
    </svg>
  );
}

export default function CommunityNudgeCard({ nudge, onClose }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const titleId = useId();
  const cardRef = useRef(null);
  const [broken, setBroken] = useState(false);
  const id = nudge?.id;

  const dismiss = useCallback(() => {
    // Fire and forget: closing must never wait for, or fail on, the network.
    Promise.resolve().then(() => communityNudgeApi.dismiss(id)).catch(() => {});
    onClose?.();
  }, [id, onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Keyboard and screen readers start inside the dialog.
  useEffect(() => { cardRef.current?.focus(); }, []);

  if (!nudge) return null;

  const create = () => {
    dismiss();
    navigate(`/club/${id}?newEvent=1`);
  };

  // „Hey, <1>{{name}}</1> hat Potenzial! ✨“ → before · name (coral) · after.
  const sentence = t('communityNudge.title', { name: NAME_SLOT });
  const [before = '', rest = ''] = sentence.split('<1>');
  const [slot = '', after = ''] = rest.split('</1>');
  const name = nudge.name || '';
  const showImage = !!nudge.image_url && !broken;

  return (
    <div className="pe-nudge-backdrop" role="presentation">
      <div
        ref={cardRef}
        className="pe-nudge-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button type="button" className="pe-nudge-close" onClick={dismiss} aria-label={t('communityNudge.close')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="pe-nudge-row">
          <div className="pe-nudge-pic">
            {showImage
              ? <img className="pe-nudge-img" src={thumbUrl(nudge.image_url)} alt="" decoding="async" onError={() => setBroken(true)} />
              : <span className="pe-nudge-fallback"><PeopleGlyph /></span>}
            <Spark />
          </div>
          <div className="pe-nudge-text">
            <h2 id={titleId} className="pe-nudge-title">
              {before}<span className="pe-nudge-name">{slot.replace(NAME_SLOT, shortName(name))}</span>{after}
            </h2>
            <p className="pe-nudge-body">{t('communityNudge.body')}</p>
          </div>
        </div>

        <button type="button" className="pe-nudge-cta" onClick={create}>
          {t('app.createModal.groupTitle')}
        </button>
      </div>
    </div>
  );
}
