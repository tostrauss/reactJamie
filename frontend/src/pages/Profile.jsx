import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import SpotifySongPicker from '../components/SpotifySongPicker';
import '../styles/home.css';
import '../styles/profile.css';

export const Profile = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pinnwand');
  const [savingSong, setSavingSong] = useState(false);

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
          <h1 className="profile-name">{user?.name || 'Nutzer'}</h1>
          {user?.location && (
            <div className="profile-location">
              <span className="location-icon">📍</span>
              {user.location}
            </div>
          )}
        </div>

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
  );
};

export default Profile;
