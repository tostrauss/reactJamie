import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { users, friends } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import { UserName } from '../components/UserName';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { ProfilePhotoCarousel } from '../components/ProfilePhotoCarousel';
import '../styles/user-profile.css';

export const UserProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useContext(AuthContext);
  const toast = useToast();
  const { t } = useTranslation();

  const [profile, setProfile]               = useState(null);
  const [loading, setLoading]               = useState(true);
  // Tab held in the URL (?tab=halloffame) so opening a past event and swiping
  // back restores the tab. replace:true keeps the back stack clean.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'halloffame' ? 'halloffame' : 'pinnwand';
  const setActiveTab = (tab) => setSearchParams(prev => {
    const sp = new URLSearchParams(prev);
    if (tab === 'pinnwand') sp.delete('tab');
    else sp.set('tab', tab);
    return sp;
  }, { replace: true });
  const [friendshipStatus, setFriendshipStatus] = useState('none');
  const [friendshipId, setFriendshipId]     = useState(null);
  const [isRequester, setIsRequester]       = useState(false);
  const [actionLoading, setActionLoading]   = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  // Index into `allPhotos` for the fullscreen viewer; null = closed.
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    if (currentUser && currentUser.id === parseInt(id)) {
      navigate('/profile', { replace: true });
      return;
    }
    loadProfile();
    checkFriendship();
  }, [id, currentUser]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await users.getById(id);
      const data = res.data;
      if (typeof data.interests === 'string') { try { data.interests = JSON.parse(data.interests); } catch { data.interests = []; } }
      if (typeof data.photos === 'string')    { try { data.photos    = JSON.parse(data.photos);    } catch { data.photos = []; } }
      if (typeof data.favorite_song === 'string' && data.favorite_song.startsWith('{')) {
        try { data.favorite_song = JSON.parse(data.favorite_song); } catch {}
      }
      setProfile(data);
    } catch {
      toast.error(t('userProfile.toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const [blockedByMe, setBlockedByMe] = useState(false);

  const checkFriendship = async () => {
    try {
      const res = await friends.getStatus(id);
      setFriendshipStatus(res.data.status || 'none');
      setFriendshipId(res.data.friendship_id || null);
      setIsRequester(res.data.is_requester || false);
      setBlockedByMe(!!res.data.blocked_by_me);
    } catch {}
  };

  const handleBlock = async () => {
    setActionLoading(true);
    try {
      await friends.block(parseInt(id));
      setFriendshipStatus('blocked');
      setBlockedByMe(true);
      setShowBlockConfirm(false);
      toast.success(t('userProfile.toast.blocked', { name: profile?.name || '' }));
    } catch (err) {
      toast.error(err.response?.data?.error || t('userProfile.toast.blockError'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnblock = async () => {
    setActionLoading(true);
    try {
      await friends.unblock(parseInt(id));
      setFriendshipStatus('none');
      setBlockedByMe(false);
      toast.success(t('userProfile.toast.unblocked'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('userProfile.toast.blockError'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendFriendRequest = async () => {
    setActionLoading(true);
    try {
      await friends.sendRequest(parseInt(id));
      setFriendshipStatus('pending');
      setIsRequester(true);
    } catch (err) {
      toast.error(err.response?.data?.error || t('userProfile.toast.sendError'));
    } finally { setActionLoading(false); }
  };

  const handleAcceptRequest = async () => {
    if (!friendshipId) return;
    setActionLoading(true);
    try { await friends.respondRequest(friendshipId, 'accept'); setFriendshipStatus('accepted'); }
    catch { toast.error(t('userProfile.toast.acceptError')); }
    finally { setActionLoading(false); }
  };

  const handleRejectRequest = async () => {
    if (!friendshipId) return;
    setActionLoading(true);
    try { await friends.respondRequest(friendshipId, 'reject'); setFriendshipStatus('none'); setFriendshipId(null); }
    catch { toast.error(t('userProfile.toast.rejectError')); }
    finally { setActionLoading(false); }
  };

  const handleRemoveFriend = async () => {
    setActionLoading(true);
    try { await friends.remove(id); setFriendshipStatus('none'); setFriendshipId(null); }
    catch { toast.error(t('userProfile.toast.removeError')); }
    finally { setActionLoading(false); }
  };

  if (loading) {
    return (
      <div className="up-page up-loading">
        <div className="up-spinner" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="up-page up-loading">
        <div className="up-not-found">
          <div style={{ fontSize: 48 }}>😕</div>
          <p>{t('userProfile.notFound')}</p>
          <button className="up-cta-btn" onClick={() => navigate(-1)}>{t('userProfile.backBtn')}</button>
        </div>
      </div>
    );
  }

  // Age now comes from the API as a computed integer; DOB is never sent.
  const age = profile.age;
  // Header gallery, swiped Tinder-style — profile picture (avatar) first, then
  // wall photos. Deduped so an avatar also saved as photos[0] (new unified
  // model) isn't shown twice. First photo IS the profile picture.
  const allPhotos = [...new Set([profile.avatar_url, ...(profile.photos || [])].filter(Boolean))];
  // Pinnwand grid below: all wall photos. When there's no avatar, photos[0] is
  // the hero, so the grid skips it to avoid duplicating the hero.
  const extraPhotos = profile.avatar_url
    ? (profile.photos || [])
    : (profile.photos?.slice(1) || []);
  const song = profile.favorite_song;

  const renderBottomAction = () => {
    if (actionLoading) return <button className="up-cta-btn" disabled>{t('userProfile.actions.loading')}</button>;

    if (blockedByMe) {
      return (
        <button className="up-cta-btn up-cta-ghost" onClick={handleUnblock}>
          {t('userProfile.actions.unblock')}
        </button>
      );
    }

    switch (friendshipStatus) {
      case 'accepted':
        return (
          <div className="up-cta-row">
            {/* "Nachricht senden" now uses the brand-standard coral .up-cta-btn
                (was a one-off purple gradient that stood out) — matches the
                Freund-anfrage / Accept buttons throughout the rest of the app. */}
            <button
              className="up-cta-btn"
              onClick={() => navigate(`/dm/${id}`)}
            >
              {t('userProfile.actions.message')}
            </button>
            <button className="up-cta-btn up-cta-ghost" onClick={handleRemoveFriend}>
              {t('userProfile.actions.removeFriend')}
            </button>
          </div>
        );
      case 'pending':
        if (isRequester) return <button className="up-cta-btn up-cta-muted" disabled>{t('userProfile.actions.requestSent')}</button>;
        return (
          <div className="up-cta-row">
            <button className="up-cta-btn" onClick={handleAcceptRequest}>{t('userProfile.actions.accept')}</button>
            <button className="up-cta-btn up-cta-ghost" onClick={handleRejectRequest}>{t('userProfile.actions.reject')}</button>
          </div>
        );
      default:
        return (
          <button className="up-cta-btn" onClick={handleSendFriendRequest}>
            {t('userProfile.actions.sendRequest')}
          </button>
        );
    }
  };

  return (
    <div className="up-page">
    <div className="up-scroll-body">

      {/* ── Hero image / swipeable photo gallery ── */}
      <div className="up-hero">
        {allPhotos.length > 0
          ? <ProfilePhotoCarousel
              photos={allPhotos}
              imgClassName="up-hero-img"
              onPhotoTap={(i) => setLightboxIndex(i)}
            />
          : <div className="up-hero-placeholder">
              <span>{profile.name?.[0]?.toUpperCase()}</span>
            </div>
        }
        <div className="up-hero-gradient" />

        {/* Floating back button */}
        <button className="up-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>

        {/* Trusted badge */}
        {profile.is_trusted_user && (
          <div className="up-trusted-overlay">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <polyline points="20,6 9,17 4,12"/>
            </svg>
          </div>
        )}
      </div>

      {/* ── Identity row ── */}
      <div className="up-identity">
        <div className="up-location">
          <span>{profile.location || t('userProfile.locationFallback')}</span>
        </div>
        <div className="up-name-age">
          <UserName className="up-name" name={profile.name?.toUpperCase()} age={age} />
        </div>
      </div>

      {/* ── Interest tags ── */}
      {profile.interests?.length > 0 && (
        <div className="up-tags">
          {profile.interests.map((tag, i) => (
            <span key={i} className="up-tag">{tag}</span>
          ))}
        </div>
      )}

      {/* ── Bio card ── */}
      {profile.bio && (
        <div className="up-bio-card">
          <h3 className="up-bio-label">{t('userProfile.bioCardTitle')}</h3>
          <p className="up-bio-text">{profile.bio}</p>
        </div>
      )}

      {/* ── Tabs: Pinnwand / Hall of Fame ── */}
      <div className="up-tabs">
        <button
          className={`up-tab ${activeTab === 'pinnwand' ? 'up-tab-active' : ''}`}
          onClick={() => setActiveTab('pinnwand')}
        >
          {t('userProfile.tabs.pinnwand')}
        </button>
        <button
          className={`up-tab ${activeTab === 'halloffame' ? 'up-tab-active' : ''}`}
          onClick={() => setActiveTab('halloffame')}
        >
          {t('userProfile.tabs.halloffame')}
        </button>
      </div>

      {/* ── Photo grid ── */}
      {activeTab === 'pinnwand' && (
        <div className="up-photo-grid">
          {extraPhotos.length > 0 ? (
            extraPhotos.map((photo, i) => (
              <button
                key={i}
                type="button"
                className="up-photo-cell"
                onClick={() => setLightboxIndex(allPhotos.indexOf(photo) === -1 ? i + 1 : allPhotos.indexOf(photo))}
                aria-label={t('userProfile.viewPhotoAria')}
              >
                <img src={photo} alt="" loading="lazy" />
              </button>
            ))
          ) : (
            <p className="up-empty-photos">{t('userProfile.emptyPhotos')}</p>
          )}
        </div>
      )}

      {activeTab === 'halloffame' && (
        <div className="up-photo-grid">
          <p className="up-empty-photos">{t('userProfile.emptyHof')}</p>
        </div>
      )}

      {/* ── Favorite song ── */}
      {song && (
        <div className="up-song-card">
          {(song.cover || song.image)
            ? <img src={song.cover || song.image} alt="" className="up-song-art" loading="lazy" decoding="async" />
            : <div className="up-song-art up-song-art-placeholder">♪</div>
          }
          <div className="up-song-info">
            <p className="up-song-title">{song.name || song.title || (typeof song === 'string' ? song : '')}</p>
            {song.artist && <p className="up-song-artist">{song.artist}</p>}
          </div>
          <svg className="up-song-spotify" width="20" height="20" viewBox="0 0 24 24" fill="#1DB954">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        </div>
      )}

    </div>{/* end up-scroll-body */}

      {/* ── Bottom action ── */}
      <div className="up-footer">
        {renderBottomAction()}
        <div className="up-footer-links">
          <button className="up-report-link" onClick={() => setShowReportModal(true)}>
            {t('userProfile.reportBtn')}
          </button>
          {!blockedByMe && (
            <>
              <span className="up-footer-sep">·</span>
              <button className="up-report-link" onClick={() => setShowBlockConfirm(true)}>
                {t('userProfile.blockBtn')}
              </button>
            </>
          )}
        </div>
      </div>

      {showReportModal && (
        <ReportModal type="user" id={parseInt(id)} name={profile.name} onClose={() => setShowReportModal(false)} />
      )}
      {showBlockConfirm && (
        <div className="modal-overlay" onClick={() => setShowBlockConfirm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <h2 className="modal-title">{t('userProfile.blockConfirm.title', { name: profile.name })}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
              {t('userProfile.blockConfirm.body')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="up-cta-btn" onClick={handleBlock} disabled={actionLoading} style={{ background: '#e23b3b' }}>
                {actionLoading ? t('userProfile.actions.loading') : t('userProfile.blockConfirm.confirm')}
              </button>
              <button className="up-cta-btn up-cta-ghost" onClick={() => setShowBlockConfirm(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <PhotoLightbox
        photos={allPhotos}
        index={lightboxIndex}
        onIndex={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
};

export default UserProfile;
