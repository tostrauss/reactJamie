import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { users, friends, subscription as subscriptionApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import { ProModal } from '../components/ProModal';
import '../styles/user-profile.css';

const calcAge = (dob) => {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / 31557600000);
};

export const UserProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useContext(AuthContext);
  const toast = useToast();

  const [profile, setProfile]               = useState(null);
  const [loading, setLoading]               = useState(true);
  const [activeTab, setActiveTab]           = useState('pinnwand');
  const [friendshipStatus, setFriendshipStatus] = useState('none');
  const [friendshipId, setFriendshipId]     = useState(null);
  const [isRequester, setIsRequester]       = useState(false);
  const [actionLoading, setActionLoading]   = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showProModal, setShowProModal]     = useState(false);
  const [isPro, setIsPro]                   = useState(false);

  useEffect(() => {
    if (currentUser && currentUser.id === parseInt(id)) {
      navigate('/profile', { replace: true });
      return;
    }
    loadProfile();
    checkFriendship();
    subscriptionApi.getStatus().then(r => setIsPro(r.data.is_pro)).catch(() => {});
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
      toast.error('Profil konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  const checkFriendship = async () => {
    try {
      const res = await friends.getStatus(id);
      setFriendshipStatus(res.data.status || 'none');
      setFriendshipId(res.data.friendship_id || null);
      setIsRequester(res.data.is_requester || false);
    } catch {}
  };

  const handleSendFriendRequest = async () => {
    setActionLoading(true);
    try {
      await friends.sendRequest(parseInt(id));
      setFriendshipStatus('pending');
      setIsRequester(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Senden');
    } finally { setActionLoading(false); }
  };

  const handleAcceptRequest = async () => {
    if (!friendshipId) return;
    setActionLoading(true);
    try { await friends.respondRequest(friendshipId, 'accept'); setFriendshipStatus('accepted'); }
    catch { toast.error('Fehler beim Annehmen'); }
    finally { setActionLoading(false); }
  };

  const handleRejectRequest = async () => {
    if (!friendshipId) return;
    setActionLoading(true);
    try { await friends.respondRequest(friendshipId, 'reject'); setFriendshipStatus('none'); setFriendshipId(null); }
    catch { toast.error('Fehler beim Ablehnen'); }
    finally { setActionLoading(false); }
  };

  const handleRemoveFriend = async () => {
    setActionLoading(true);
    try { await friends.remove(id); setFriendshipStatus('none'); setFriendshipId(null); }
    catch { toast.error('Fehler beim Entfernen'); }
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
          <p>Nutzer nicht gefunden</p>
          <button className="up-cta-btn" onClick={() => navigate(-1)}>Zurück</button>
        </div>
      </div>
    );
  }

  const age = calcAge(profile.date_of_birth);
  const heroImg = profile.photos?.[0] || profile.avatar_url;
  const extraPhotos = profile.photos?.slice(1) || [];
  const song = profile.favorite_song;

  const renderBottomAction = () => {
    if (actionLoading) return <button className="up-cta-btn" disabled>Laden…</button>;

    switch (friendshipStatus) {
      case 'accepted':
        return (
          <div className="up-cta-row">
            <button
              className="up-cta-btn up-cta-msg"
              onClick={isPro ? () => navigate(`/dm/${id}`) : () => setShowProModal(true)}
            >
              {isPro ? 'Nachricht senden' : '👑 Nachricht (Pro)'}
            </button>
            <button className="up-cta-btn up-cta-ghost" onClick={handleRemoveFriend}>
              Freund entfernen
            </button>
          </div>
        );
      case 'pending':
        if (isRequester) return <button className="up-cta-btn up-cta-muted" disabled>Anfrage gesendet ✓</button>;
        return (
          <div className="up-cta-row">
            <button className="up-cta-btn" onClick={handleAcceptRequest}>Annehmen</button>
            <button className="up-cta-btn up-cta-ghost" onClick={handleRejectRequest}>Ablehnen</button>
          </div>
        );
      default:
        return (
          <button className="up-cta-btn" onClick={handleSendFriendRequest}>
            + Freundschaftsanfrage
          </button>
        );
    }
  };

  return (
    <div className="up-page">
    <div className="up-scroll-body">

      {/* ── Hero image ── */}
      <div className="up-hero">
        {heroImg
          ? <img src={heroImg} alt={profile.name} className="up-hero-img" loading="lazy" />
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
          <span>{profile.location || 'Wien'}</span>
        </div>
        <div className="up-name-age">
          <span className="up-name">{profile.name?.toUpperCase()}</span>
          {age && <span className="up-age">{age}</span>}
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
          <h3 className="up-bio-label">Über Dich!</h3>
          <p className="up-bio-text">{profile.bio}</p>
        </div>
      )}

      {/* ── Tabs: Pinnwand / Hall of Fame ── */}
      <div className="up-tabs">
        <button
          className={`up-tab ${activeTab === 'pinnwand' ? 'up-tab-active' : ''}`}
          onClick={() => setActiveTab('pinnwand')}
        >
          Pinnwand
        </button>
        <button
          className={`up-tab ${activeTab === 'halloffame' ? 'up-tab-active' : ''}`}
          onClick={() => setActiveTab('halloffame')}
        >
          Hall of Fame
        </button>
      </div>

      {/* ── Photo grid ── */}
      {activeTab === 'pinnwand' && (
        <div className="up-photo-grid">
          {extraPhotos.length > 0 ? (
            extraPhotos.map((photo, i) => (
              <div key={i} className="up-photo-cell">
                <img src={photo} alt="" loading="lazy" />
              </div>
            ))
          ) : (
            <p className="up-empty-photos">Keine weiteren Fotos</p>
          )}
        </div>
      )}

      {activeTab === 'halloffame' && (
        <div className="up-photo-grid">
          <p className="up-empty-photos">Noch nichts hier</p>
        </div>
      )}

      {/* ── Favorite song ── */}
      {song && (
        <div className="up-song-card">
          {song.image
            ? <img src={song.image} alt="" className="up-song-art" />
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
        <button className="up-report-link" onClick={() => setShowReportModal(true)}>
          Nutzer melden
        </button>
      </div>

      {showReportModal && (
        <ReportModal type="user" id={parseInt(id)} name={profile.name} onClose={() => setShowReportModal(false)} />
      )}
      {showProModal && (
        <ProModal onClose={() => setShowProModal(false)} onSuccess={() => setIsPro(true)} />
      )}
    </div>
  );
};

export default UserProfile;
