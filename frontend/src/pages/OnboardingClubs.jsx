import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { clubs as clubsApi, auth as authApi } from '../utils/api';
import { serverErrorMessage } from '../utils/apiError';
import { coverCardUrl } from '../utils/images';
import { ImageUpload } from '../components/ImageUpload';
import { FlowHeader } from '../components/FlowHeader';
import { StepTitle } from '../components/StepTitle';
import { ProfilePhotoPrompt } from '../components/ProfilePhotoPrompt';
import '../styles/auth.css';
import '../styles/onboarding.css';

// ==========================================
// „Clubs für dich" — the extra page after onboarding
// ==========================================
// Tina's checklist 10.10.2026: „Clubs anzeigen, extra Seite (Jamie Groups
// Official der erste Club, dann noch …) — wir sortieren Clubs im Admin-
// Dashboard". Unnumbered: it comes after the PUT /auth/onboarding (joining
// needs the saved profile, requireCompleteProfile reads the DB) and before
// Home. The list and its order are curated in the admin dashboard
// (GET /api/clubs/featured, featured_clubs table); no list → no page.
//
// One button per club, no leave toggle: the join cap (MAX_CLUB_JOINS = 2)
// survives a leave, so a join/leave/join here would burn the user's second
// chance. The card body does nothing — the user stays in the flow.

// Button state per club id.
const IDLE = 'idle';
const BUSY = 'busy';
const JOINED = 'joined';
const PENDING = 'pending';
const BLOCKED = 'blocked';
const FULL = 'full';

// The caller's state from the row flags getFeaturedClubs adds per caller.
const initialState = (club) => {
  if (club.is_member) return JOINED;
  if (club.join_request_status === 'pending') return PENDING;
  if (club.join_request_blocked) return BLOCKED;
  return IDLE;
};

// joinClub (clubController.js) codes its refusals since 2026-10. Codes first;
// the German / English sentences are the fallback for a server older than
// this bundle (an iOS build can be newer than the server it talks to).
const CODE_STATES = new Map([
  ['JOIN_REQUEST_BLOCKED', BLOCKED],
  ['ALREADY_MEMBER', JOINED],
  ['JOIN_REQUEST_PENDING', PENDING],
  ['CLUB_FULL', FULL],
]);
const stateFromJoinError = (err) => {
  const status = err?.response?.status;
  const data = err?.response?.data || {};
  if (data.requiresAvatar) return 'avatar';
  if (CODE_STATES.has(data.code)) return CODE_STATES.get(data.code);
  if (status === 400 && data.error === 'Already a member') return JOINED;
  if (status === 400 && /ausstehend/i.test(data.error || '')) return PENDING;
  if (status === 400 && data.error === 'Club is full') return FULL;
  return null;
};

const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// Cover with the same fallback as GroupCard: a broken or missing picture
// shows the first letter instead of the browser's broken-image glyph.
const ClubCover = ({ club }) => {
  const [broken, setBroken] = useState(false);
  const src = coverCardUrl(club.image_url);
  if (!src || broken) {
    return (
      <span className="obc-cover-fallback" aria-hidden="true">
        {String(club.name || club.category || '?').slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
};

export const OnboardingClubs = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const { user, refreshProfile } = useContext(AuthContext);

  const [list, setList] = useState(null); // null = loading
  const [states, setStates] = useState({});
  const [promptOpen, setPromptOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  // Set as soon as the server has the new picture — before refreshProfile
  // brings it into `user`, and even if that refresh fails.
  const [savedAvatar, setSavedAvatar] = useState(null);

  const hasAvatar = !!(user?.avatar_url || savedAvatar);
  // Read by join() from async continuations (after an upload), where the
  // render's `hasAvatar` is stale.
  const hasAvatarRef = useRef(hasAvatar);
  useEffect(() => { if (hasAvatar) hasAvatarRef.current = true; }, [hasAvatar]);

  const inFlightRef = useRef(new Set());
  const pendingJoinRef = useRef(null);
  const uploadTriggerRef = useRef(null);
  // An upload can outlive the page (Weiter tapped meanwhile): the picture is
  // still saved, but the remembered join is not sent from a page that is gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Any error, an old server (no such route) or an empty curation → straight
  // to Home: this page is a bonus, never a dead end.
  useEffect(() => {
    let alive = true;
    clubsApi.getFeatured()
      .then(({ data }) => {
        if (!alive) return;
        if (!Array.isArray(data) || data.length === 0) {
          navigate('/home', { replace: true });
          return;
        }
        setStates(Object.fromEntries(data.map(c => [c.id, initialState(c)])));
        setList(data);
      })
      .catch(() => { if (alive) navigate('/home', { replace: true }); });
    return () => { alive = false; };
  }, [navigate]);

  const setClubState = (id, state) => setStates(prev => ({ ...prev, [id]: state }));

  const openPrompt = (club) => {
    pendingJoinRef.current = club;
    setPromptOpen(true);
  };

  const join = async (club) => {
    const id = club.id;
    // Single-flight per card: a ref, because a second tap in the same frame
    // still sees the old state.
    if (inFlightRef.current.has(id)) return;
    // Joining needs a profile picture (server: 403 requiresAvatar). Ask first
    // instead of sending a request that can only fail.
    if (!hasAvatarRef.current) { openPrompt(club); return; }
    inFlightRef.current.add(id);
    setClubState(id, BUSY);
    try {
      const { data } = await clubsApi.join(id);
      setClubState(id, data?.status === 'pending' ? PENDING : JOINED);
    } catch (err) {
      const next = stateFromJoinError(err);
      if (next === 'avatar') {
        setClubState(id, IDLE);
        openPrompt(club);
      } else if (next) {
        setClubState(id, next);
      } else {
        setClubState(id, IDLE);
        toast.error(serverErrorMessage(err, t, 'onboarding.clubs.joinError'));
      }
    } finally {
      inFlightRef.current.delete(id);
    }
  };

  // Achtung card / sheet → the page's hidden picker. Synchronous, FIRST:
  // this tap is the user gesture WebKit needs to open the file input.
  const openAvatarPicker = () => {
    if (uploading || savingAvatar) return;
    uploadTriggerRef.current?.();
  };

  const handlePromptAdd = () => {
    openAvatarPicker();
    setPromptOpen(false);
  };

  // Überspringen / backdrop: no picture, so the remembered join is dropped.
  const closePrompt = () => {
    pendingJoinRef.current = null;
    setPromptOpen(false);
  };

  // The picture goes straight onto the profile. avatar_url ONLY: a photos
  // field would replace the stored photo list.
  const handleAvatarUpload = async (url) => {
    setSavingAvatar(true);
    try {
      await authApi.updateProfile({ avatar_url: url });
    } catch (err) {
      pendingJoinRef.current = null;
      toast.error(serverErrorMessage(err, t, 'imageUpload.failed'));
      return;
    } finally {
      setSavingAvatar(false);
    }
    hasAvatarRef.current = true;
    setSavedAvatar(url);
    if (typeof refreshProfile === 'function') await refreshProfile();
    const club = pendingJoinRef.current;
    pendingJoinRef.current = null;
    if (club && mountedRef.current) join(club);
  };

  const finish = () => navigate('/home', { replace: true });

  const avatarBusy = uploading || savingAvatar;

  const renderButton = (club) => {
    const state = states[club.id] || IDLE;
    const idleLabel = club.is_private ? t('onboarding.clubs.request') : t('onboarding.clubs.join');
    const label = {
      [IDLE]: idleLabel,
      [BUSY]: idleLabel,
      [JOINED]: t('onboarding.clubs.joined'),
      [PENDING]: t('onboarding.clubs.pending'),
      [BLOCKED]: t('onboarding.clubs.blocked'),
      [FULL]: t('onboarding.clubs.full'),
    }[state];
    return (
      <button
        type="button"
        className={`obc-join obc-join--${state}`}
        onClick={() => join(club)}
        disabled={state !== IDLE}
        aria-busy={state === BUSY}
      >
        {state === BUSY && <span className="ob-spinner ob-spinner--sm" aria-hidden="true" />}
        {state === JOINED && <CheckIcon />}
        {label}
      </button>
    );
  };

  return (
    <div className="onboarding-container ob-flow obc-page">
      {/* No back (the profile is saved), no counter (not a numbered step):
          the line shows how far the profile got — all green with a picture. */}
      <FlowHeader
        current={0}
        total={4}
        done={hasAvatar ? 4 : 3}
        complete={hasAvatar}
        showCounter={false}
      />

      <div className="onboarding-content ob-content">
        {list && (
          <div className="ob-step">
            <StepTitle line1={t('onboarding.clubs.titleLine1')} line2={t('onboarding.clubs.titleLine2')} />
            <p className="ob-sub">{t('onboarding.clubs.subtitle')}</p>

            {!hasAvatar && (
              <div className="obc-warning" role="note">
                <p className="obc-warning-title">{t('onboarding.photoPrompt.title')}</p>
                <p className="obc-warning-text">{t('onboarding.photoPrompt.text')}</p>
                <button
                  type="button"
                  className="obc-warning-btn"
                  onClick={openAvatarPicker}
                  disabled={avatarBusy}
                  aria-busy={avatarBusy}
                >
                  {avatarBusy && <span className="ob-spinner ob-spinner--sm" aria-hidden="true" />}
                  {avatarBusy ? t('imageUpload.uploading') : t('onboarding.photoPrompt.cta')}
                </button>
              </div>
            )}

            <ul className="obc-list">
              {list.map((club) => {
                const count = Number(club.members_count ?? club.member_count) || 0;
                return (
                  <li key={club.id} className="obc-card">
                    <div className="obc-card-head">
                      <div className="obc-card-text">
                        <h3 className="obc-card-title">{(club.name || '').replace(/-/g, '‑')}</h3>
                        <p className="obc-card-meta">
                          <span>{t('onboarding.clubs.members', { count })}</span>
                          {club.location && <span className="obc-card-loc">📍 {club.location}</span>}
                        </p>
                      </div>
                      <span className={`obc-badge${club.is_private ? ' obc-badge--private' : ''}`}>
                        {club.is_private ? t('onboarding.clubs.private') : t('onboarding.clubs.public')}
                      </span>
                    </div>
                    <div className="obc-cover"><ClubCover club={club} /></div>
                    {renderButton(club)}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!list && <div className="obc-loading"><span className="ob-spinner" aria-hidden="true" /></div>}
      </div>

      <div className="onboarding-footer">
        <button type="button" className="auth-btn auth-btn-primary" onClick={finish}>
          {t('onboarding.clubs.next')}
        </button>
      </div>

      {/* Page-level picker for the banner and the sheet — mounted for the whole
          page, outside the sheet, so its change event survives the sheet
          closing. */}
      <ImageUpload
        onUpload={handleAvatarUpload}
        triggerRef={uploadTriggerRef}
        purpose="avatar"
        hideLabel
        onUploadingChange={setUploading}
      />

      <ProfilePhotoPrompt
        isOpen={promptOpen}
        onAdd={handlePromptAdd}
        onSkip={closePrompt}
        onClose={closePrompt}
      />
    </div>
  );
};

export default OnboardingClubs;
