import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { users, friends } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
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
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>😕</div>
        <h2>User nicht gefunden</h2>
        <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: '20px' }}>
          Zurück
        </button>
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
            <button className="user-action-btn primary" onClick={handleSendMessage}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
              Nachricht
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
            <button className="user-action-btn primary" onClick={handleSendFriendRequest}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
              Freund hinzufügen
            </button>
          </div>
        );
    }
  };

  return (
    <div className="page" style={{ paddingBottom: '100px' }}>
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

        <h2 className="user-profile-name">{profile.name}</h2>

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
      </div>

      {/* Tabs */}
      <div className="tabs-container" style={{ padding: '0' }}>
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
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '12px', color: 'var(--accent-coral)', fontSize: '16px' }}>Über {profile.name?.split(' ')[0]}</h3>
              <p style={{ lineHeight: '1.6', color: 'var(--text-light)' }}>{profile.bio}</p>
            </div>
          )}

          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--accent-coral)', fontSize: '16px' }}>Interessen</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {profile.interests?.length > 0 ? (
                profile.interests.map((interest, i) => (
                  <span key={i} className="interest-chip">
                    {interest}
                  </span>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Keine Interessen</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'photos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '16px 0' }}>
          {profile.photos?.length > 0 ? (
            profile.photos.map((photo, i) => (
              <div key={i} style={{ aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', background: 'var(--bg-card)' }}>
                <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '40px' }}>
              Keine Fotos
            </p>
          )}
        </div>
      )}
    </div>
  );
};
export default UserProfile;
