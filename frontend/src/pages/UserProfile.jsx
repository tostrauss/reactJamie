import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { users, friends, subscription as subscriptionApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ReportModal } from '../components/ReportModal';
import { ProModal } from '../components/ProModal';
import '../styles/profile.css';

export const UserProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useContext(AuthContext);
  const toast = useToast();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('about');
  const [friendshipStatus, setFriendshipStatus] = useState('none');
  const [friendshipId, setFriendshipId] = useState(null);
  const [isRequester, setIsRequester] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [isPro, setIsPro] = useState(false);

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
      const response = await users.getById(id);
      const data = response.data;

      if (typeof data.interests === 'string') {
        try { data.interests = JSON.parse(data.interests); } catch { data.interests = []; }
      }
      if (typeof data.photos === 'string') {
        try { data.photos = JSON.parse(data.photos); } catch { data.photos = []; }
      }

      setProfile(data);
    } catch (err) {
      console.error('Error loading profile:', err);
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
    } catch (err) {
      console.error('Error checking friendship:', err);
    }
  };

  const handleSendFriendRequest = async () => {
    setActionLoading(true);
    try {
      await friends.sendRequest(parseInt(id));
      setFriendshipStatus('pending');
      setIsRequester(true);
    } catch (err) {
      const msg = err.response?.data?.error || 'Fehler beim Senden';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!friendshipId) return;
    setActionLoading(true);
    try {
      await friends.respondRequest(friendshipId, 'accept');
      setFriendshipStatus('accepted');
    } catch (err) {
      toast.error('Fehler beim Annehmen');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectRequest = async () => {
    if (!friendshipId) return;
    setActionLoading(true);
    try {
      await friends.respondRequest(friendshipId, 'reject');
      setFriendshipStatus('none');
      setFriendshipId(null);
    } catch (err) {
      toast.error('Fehler beim Ablehnen');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    setActionLoading(true);
    try {
      await friends.remove(id);
      setFriendshipStatus('none');
      setFriendshipId(null);
    } catch (err) {
      toast.error('Fehler beim Entfernen');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendMessage = () => {
    navigate(`/dm/${id}`);
  };

  if (loading) {
    return (
      <div className="notif-page">
        <div className="notif-loading"><div className="home-spinner" /></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="notif-page">
        <div className="notif-empty">
          <div className="notif-empty-icon">😕</div>
          <h2 className="notif-empty-title">Nutzer nicht gefunden</h2>
          <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: '20px' }}>
            Zurück
          </button>
        </div>
      </div>
    );
  }

  const renderFriendshipActions = () => {
    if (actionLoading) {
      return (
        <div className="user-profile-actions">
          <button className="user-action-btn primary" disabled>Laden...</button>
        </div>
      );
    }

    switch (friendshipStatus) {
      case 'accepted':
        return (
          <div className="user-profile-actions">
            <button
              className="user-action-btn primary"
              onClick={isPro ? handleSendMessage : () => setShowProModal(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
              {isPro ? 'Nachricht' : '👑 Nachricht (Pro)'}
            </button>
            <button className="user-action-btn danger" onClick={handleRemoveFriend}>
              Freund entfernen
            </button>
          </div>
        );

      case 'pending':
        if (isRequester) {
          return (
            <div className="user-profile-actions">
              <button className="user-action-btn secondary" disabled>
                Anfrage gesendet
              </button>
            </div>
          );
        }
        return (
          <div className="user-profile-actions">
            <button className="user-action-btn accept" onClick={handleAcceptRequest}>
              Annehmen
            </button>
            <button className="user-action-btn decline" onClick={handleRejectRequest}>
              Ablehnen
            </button>
          </div>
        );

      default:
        return (
          <div className="user-profile-actions">
            <button
              className="user-action-btn primary"
              onClick={isPro ? handleSendFriendRequest : () => setShowProModal(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
              {isPro ? 'Freund hinzufügen' : '👑 Freund hinzufügen (Pro)'}
            </button>
          </div>
        );
    }
  };

  return (
    <div className="page">
      {/* Back Button */}
      <button
        onClick={() => navigate(-1)}
        className="user-profile-back"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Zurück
      </button>

      {/* Header Card */}
      <div className="user-profile-header">
        <div className="user-profile-avatar">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.name} />
          ) : (
            <span>{profile.name?.[0]?.toUpperCase()}</span>
          )}
        </div>

        <h2 className="user-profile-name">
          {profile.name}
          {profile.is_trusted_user && (
            <span className="up-trusted-badge" title="Vertrauenswürdiger Nutzer">✓</span>
          )}
        </h2>

        {profile.gender && (
          <p className="user-profile-gender">
            {profile.gender === 'männlich' ? '♂' : profile.gender === 'weiblich' ? '♀' : '⚧'} {profile.gender}
          </p>
        )}

        <p className="user-profile-location">
          📍 {profile.location || 'Kein Standort'}
        </p>

        {/* Friendship Status Badge */}
        {friendshipStatus === 'accepted' && (
          <div className="friendship-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            Befreundet
          </div>
        )}

        {/* Action Buttons */}
        {renderFriendshipActions()}

        <button className="up-report-btn" onClick={() => setShowReportModal(true)}>
          Nutzer melden
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
        <button className={`tab ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>
          Über
        </button>
        <button className={`tab ${activeTab === 'photos' ? 'active' : ''}`} onClick={() => setActiveTab('photos')}>
          Fotos
        </button>
      </div>

      {/* Content */}
      {activeTab === 'about' && (
        <div style={{ padding: '16px 0' }}>
          {profile.bio && (
            <div className="up-card">
              <h3 className="up-card-title">Über {profile.name?.split(' ')[0]}</h3>
              <p style={{ lineHeight: '1.6', color: 'var(--text-light)' }}>{profile.bio}</p>
            </div>
          )}
          <div className="up-card">
            <h3 className="up-card-title">Interessen</h3>
            <div className="up-interests">
              {profile.interests?.length > 0 ? (
                profile.interests.map((interest, i) => (
                  <span key={i} className="interest-chip">{interest}</span>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Keine Interessen</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'photos' && (
        <div className="up-photos-grid">
          {profile.photos?.length > 0 ? (
            profile.photos.map((photo, i) => (
              <div key={i} className="up-photo-item">
                <img src={photo} alt="" />
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '40px' }}>
              Keine Fotos
            </p>
          )}
        </div>
      )}
      {showReportModal && (
        <ReportModal
          type="user"
          id={parseInt(id)}
          name={profile.name}
          onClose={() => setShowReportModal(false)}
        />
      )}
      {showProModal && (
        <ProModal
          onClose={() => setShowProModal(false)}
          onSuccess={() => setIsPro(true)}
        />
      )}
    </div>
  );
};
export default UserProfile;
