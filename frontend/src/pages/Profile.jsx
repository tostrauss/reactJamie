import { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth, subscription as subscriptionApi } from '../utils/api';
import SpotifySongPicker from '../components/SpotifySongPicker';
import { ProModal } from '../components/ProModal';
import '../styles/home.css';
import '../styles/profile.css';

export const Profile = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pinnwand');
  const [savingSong, setSavingSong] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [showProModal, setShowProModal] = useState(false);

  useEffect(() => {
    subscriptionApi.getStatus()
      .then(res => setIsPro(res.data?.is_pro || false))
      .catch(() => {});
  }, []);

  const handleSongSelect = async (song) => {
    setSavingSong(true);
    try {
      const res = await auth.updateProfile({ favorite_song: song });
      setUser(res.data);
    } catch (err) {
      console.error('Error saving song:', err);
    } finally {
      setSavingSong(false);
    }
  };

  const handleSongRemove = async () => {
    setSavingSong(true);
    try {
      const res = await auth.updateProfile({ favorite_song: null });
      setUser(res.data);
    } catch (err) {
      console.error('Error removing song:', err);
    } finally {
      setSavingSong(false);
    }
  };

  const profilePhotos = user?.photos || [];
  const interests = user?.interests || [];
  const coverPhoto = profilePhotos[0] || user?.avatar_url || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800';
  const avatarPhoto = user?.avatar_url || profilePhotos[0];
  const completion = user?.profile_completion || 0;

  return (
    <>
    <div className="profile-page">
      {/* Cover */}
      <div className="profile-header-image">
        <img src={coverPhoto} alt={user?.name} className="profile-cover" />
        <div className="profile-cover-gradient" />

        {/* Overlay Buttons */}
        <div className="profile-header-actions">
          <button className="profile-action-btn" onClick={() => navigate(-1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="profile-edit-actions">
            <button className="profile-action-btn" onClick={() => navigate('/settings')} title="Einstellungen">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            </button>
            <button className="profile-action-btn" onClick={() => navigate('/profile/edit')} title="Profil bearbeiten">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Floating Avatar */}
        <div className="profile-avatar-float">
          {avatarPhoto ? (
            <img src={avatarPhoto} alt={user?.name} />
          ) : (
            <span>{user?.name?.[0]?.toUpperCase() || '?'}</span>
          )}
          {user?.is_trusted_user && (
            <div className="profile-trusted-badge" title="Vertrauenswürdiger Nutzer">✓</div>
          )}
        </div>
      </div>

      {/* Info Section */}
      <div className="profile-info-section">
        {/* Name & Location */}
        <div className="profile-name-row">
          <h1 className="profile-name">
            {user?.name || 'Nutzer'}
            {isPro && (
              <span
                title="JAMIE Pro"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                  color: '#1a1a2e',
                  fontSize: '11px',
                  fontWeight: '800',
                  borderRadius: '8px',
                  padding: '2px 8px',
                  marginLeft: '8px',
                  verticalAlign: 'middle',
                  letterSpacing: '0.5px',
                }}
              >
                👑 PRO
              </span>
            )}
          </h1>
          {user?.location && (
            <div className="profile-location">
              <span className="location-icon">📍</span>
              {user.location}
            </div>
          )}
        </div>

        {/* Pro CTA banner */}
        {!isPro && (
          <button
            onClick={() => setShowProModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              width: '100%', textAlign: 'left', cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(255,215,0,0.08) 0%, rgba(255,140,0,0.05) 100%)',
              border: '1px solid rgba(255,215,0,0.22)',
              borderRadius: '16px', padding: '14px 16px', marginBottom: '4px',
            }}
          >
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
              background: 'rgba(255,215,0,0.15)', border: '1px solid rgba(255,215,0,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
            }}>👑</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#FFD700', fontWeight: '800', fontSize: '14px', marginBottom: '2px' }}>
                JAMIE Pro — 5 € / Monat
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px' }}>
                Kostenlose Boosts für Gruppen & Clubs
              </div>
            </div>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'rgba(255,215,0,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FFD700', fontSize: '14px', flexShrink: 0,
            }}>→</div>
          </button>
        )}

        {/* Pro active banner */}
        {isPro && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            background: 'linear-gradient(135deg, rgba(255,215,0,0.1) 0%, rgba(255,140,0,0.06) 100%)',
            border: '1px solid rgba(255,215,0,0.28)',
            borderRadius: '16px', padding: '14px 16px', marginBottom: '4px',
          }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
              background: 'rgba(255,215,0,0.18)', border: '1px solid rgba(255,215,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
            }}>👑</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#FFD700', fontWeight: '800', fontSize: '14px', marginBottom: '2px' }}>
                JAMIE Pro aktiv
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px' }}>
                Kostenlose Boosts für deine Gruppen & Clubs
              </div>
            </div>
            <div style={{
              width: '22px', height: '22px', borderRadius: '50%', background: '#22c55e', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20,6 9,17 4,12" />
              </svg>
            </div>
          </div>
        )}

        {/* Profile Completion Bar */}
        {completion < 100 && (
          <div className="profile-completion">
            <div className="completion-bar">
              <div className="completion-fill" style={{ width: `${completion}%` }} />
            </div>
            <span className="completion-text">{completion}% vollständig</span>
          </div>
        )}

        {/* Bio */}
        {user?.bio && (
          <div className="profile-bio-section">
            <p className="profile-bio">{user.bio}</p>
          </div>
        )}

        {/* Interests */}
        {interests.length > 0 && (
          <div className="profile-interests">
            {interests.map((interest, index) => (
              <span key={index} className="interest-chip">{interest}</span>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="profile-tabs">
          <button
            className={`profile-tab ${activeTab === 'pinnwand' ? 'active' : ''}`}
            onClick={() => setActiveTab('pinnwand')}
          >
            Pinnwand
          </button>
          <button
            className={`profile-tab ${activeTab === 'musik' ? 'active' : ''}`}
            onClick={() => setActiveTab('musik')}
          >
            Musik
          </button>
        </div>

        {/* Tab Content */}
        <div className="profile-tab-content">
          {activeTab === 'pinnwand' ? (
            <div className="pinnwand-grid">
              {profilePhotos.map((photo, index) => (
                <div
                  key={index}
                  className={`pinnwand-item${index === 0 ? ' pinnwand-item--large' : ''}`}
                >
                  <img src={photo} alt={`Foto ${index + 1}`} />
                </div>
              ))}
              <div className="pinnwand-item add-photo" onClick={() => navigate('/profile/edit')}>
                <span>+</span>
                <p>Foto hinzufügen</p>
              </div>
            </div>
          ) : (
            <div className="musik-section">
              {savingSong ? (
                <div className="empty-music">
                  <span>⏳</span>
                  <p>Wird gespeichert...</p>
                </div>
              ) : (
                <SpotifySongPicker
                  currentSong={user?.favorite_song}
                  onSelect={handleSongSelect}
                  onRemove={handleSongRemove}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>

    {showProModal && (
      <ProModal
        onClose={() => setShowProModal(false)}
        onSuccess={() => { setIsPro(true); setShowProModal(false); }}
      />
    )}
    </>
  );
};

export default Profile;
