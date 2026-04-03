import { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth, subscription as subscriptionApi } from '../utils/api';
import SpotifySongPicker from '../components/SpotifySongPicker';
import { ProModal } from '../components/ProModal';
import '../styles/home.css';
import '../styles/profile.css';

const INTEREST_DE = {
  // English → Deutsch
  'Sports': 'Sport', 'Sport': 'Sport',
  'Music': 'Musik', 'Musik': 'Musik',
  'Tech': 'Technik', 'Technology': 'Technik', 'Technik': 'Technik',
  'Art': 'Kunst', 'Kunst': 'Kunst',
  'Gaming': 'Gaming',
  'Fitness': 'Fitness',
  'Travel': 'Reisen', 'Reisen': 'Reisen',
  'Food': 'Essen', 'Essen': 'Essen',
  'Movies': 'Filme', 'Filme': 'Filme',
  'Reading': 'Lesen', 'Lesen': 'Lesen',
  'Photography': 'Fotografie', 'Fotografie': 'Fotografie',
  'Hiking': 'Wandern', 'Wandern': 'Wandern',
  'Yoga': 'Yoga',
  'Dancing': 'Tanzen', 'Tanzen': 'Tanzen',
  'Cooking': 'Kochen', 'Kochen': 'Kochen',
  'Fashion': 'Mode', 'Mode': 'Mode',
  'Nature': 'Natur', 'Natur': 'Natur',
  'Clubbing': 'Clubbing',
  'Social': 'Soziales', 'Soziales': 'Soziales',
  'Tennis': 'Tennis', 'Golf': 'Golf',
  'Volleyball': 'Volleyball', 'Swimming': 'Schwimmen', 'Schwimmen': 'Schwimmen',
  'Board Games': 'Brettspiele', 'Brettspiele': 'Brettspiele',
};

const translateInterest = (i) => INTEREST_DE[i] ?? i;

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
  const interests     = user?.interests || [];
  const coverPhoto    = profilePhotos[0] || user?.avatar_url || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800';
  const avatarPhoto   = user?.avatar_url || profilePhotos[0];
  const completion    = user?.profile_completion || 0;

  return (
    <>
      <div className="profile-page">

        {/* ── Cover image + overlay buttons ───────────────────────── */}
        <div className="profile-header-image">
          <img src={coverPhoto} alt={user?.name} className="profile-cover" />
          <div className="profile-cover-gradient" />
          <div className="profile-cover-top-gradient" />
          <h1 className="profile-logo-overlay">jamie</h1>

          <div className="profile-header-actions">
            <button className="profile-action-btn" onClick={() => navigate(-1)} aria-label="Zurück">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <div className="profile-edit-actions">
              <button className="profile-action-btn" onClick={() => navigate('/settings')} aria-label="Einstellungen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
              </button>
              <button className="profile-action-btn" onClick={() => navigate('/profile/edit')} aria-label="Profil bearbeiten">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Floating avatar */}
          <div className="profile-avatar-float">
            {avatarPhoto
              ? <img src={avatarPhoto} alt={user?.name} />
              : <span>{user?.name?.[0]?.toUpperCase() || '?'}</span>
            }
            {user?.is_trusted_user && (
              <div className="profile-trusted-badge" title="Vertrauenswürdiger Nutzer">✓</div>
            )}
          </div>
        </div>

        {/* ── Info section ────────────────────────────────────────── */}
        <div className="profile-info-section">

          {/* Name + location */}
          <div className="profile-name-row">
            <h1 className="profile-name">
              {user?.name || 'Nutzer'}
              {isPro && <span className="pro-name-badge">👑 PRO</span>}
            </h1>
            {user?.location && (
              <div className="profile-location">
                <span className="location-icon">📍</span>
                {user.location}
              </div>
            )}
          </div>

          {/* Pro CTA (non-pro) */}
          {!isPro && (
            <button className="pro-cta-card" onClick={() => setShowProModal(true)}>
              <div className="pro-card-icon">👑</div>
              <div className="pro-card-body">
                <div className="pro-card-title">JAMIE Pro — 5 € / Monat</div>
                <div className="pro-card-sub">Kostenlose Boosts für Gruppen &amp; Clubs</div>
              </div>
              <div className="pro-card-arrow">→</div>
            </button>
          )}

          {/* Pro active */}
          {isPro && (
            <div className="pro-active-card">
              <div className="pro-card-icon">👑</div>
              <div className="pro-card-body">
                <div className="pro-card-title">JAMIE Pro aktiv</div>
                <div className="pro-card-sub">Kostenlose Boosts für deine Gruppen &amp; Clubs</div>
              </div>
              <div className="pro-card-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20,6 9,17 4,12"/>
                </svg>
              </div>
            </div>
          )}

          {/* Profile completion bar */}
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
              {interests.map((interest, i) => (
                <span key={i} className="interest-chip">{translateInterest(interest)}</span>
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

          {/* Tab content */}
          <div className="profile-tab-content">
            {activeTab === 'pinnwand' ? (
              <div className="pinnwand-grid">
                {profilePhotos.map((photo, i) => (
                  <div key={i} className={`pinnwand-item${i === 0 ? ' pinnwand-item--large' : ''}`}>
                    <img src={photo} alt={`Foto ${i + 1}`} />
                  </div>
                ))}
                <button className="pinnwand-item add-photo" onClick={() => navigate('/profile/edit')}>
                  <span>+</span>
                  <p>Foto hinzufügen</p>
                </button>
              </div>
            ) : (
              <div className="musik-section">
                {savingSong ? (
                  <div className="empty-music">
                    <span>⏳</span>
                    <p>Wird gespeichert…</p>
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
