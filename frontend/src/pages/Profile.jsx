import { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth, subscription as subscriptionApi } from '../utils/api';
import SpotifySongPicker from '../components/SpotifySongPicker';
import { ProModal } from '../components/ProModal';
import '../styles/home.css';
import '../styles/profile.css';

const INTEREST_DE = {
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
    } finally {
      setSavingSong(false);
    }
  };

  const profilePhotos = user?.photos || [];
  const interests     = user?.interests || [];
  const coverPhoto    = user?.avatar_url || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800';
  const completion    = user?.profile_completion || 0;
  const age = (() => {
    const dob = user?.date_of_birth;
    if (!dob) return null;
    const birth = new Date(dob);
    if (isNaN(birth)) return null;
    const today = new Date();
    let a = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a--;
    return a > 0 ? a : null;
  })();

  return (
    <>
      <div className="profile-page">

        {/* ── Cover image ───────────────────────────────────────────── */}
        <div className="profile-header-image">
          <img src={coverPhoto} alt={user?.name} className="profile-cover" />
          <div className="profile-cover-gradient" />
          <div className="profile-cover-top-gradient" />

          <div className="profile-header-actions">
            <button className="profile-action-btn" onClick={() => navigate(-1)} aria-label="Zurück">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
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

          {/* Trusted / verified badge bottom-right */}
          {user?.is_trusted_user && (
            <div className="profile-verified-cover">✓</div>
          )}
        </div>

        {/* ── Progress bar ──────────────────────────────────────────── */}
        {completion < 100 && (
          <div className="profile-progress-bar-wrap">
            <div className="profile-progress-bar">
              <div className="profile-progress-fill" style={{ width: `${completion}%` }} />
            </div>
            <span className="profile-progress-label">{completion}% Profil vollständig</span>
          </div>
        )}

        {/* ── Info section ──────────────────────────────────────────── */}
        <div className="profile-info-section">

          {/* Location left — Name + Age right */}
          <div className="profile-identity-row">
            {user?.location ? (
              <div className="profile-location-left">{user.location}</div>
            ) : <div />}
            <div className="profile-name-age">
              <span className="profile-name-cap">{(user?.name || 'Nutzer').toUpperCase()}</span>
              {age && <span className="profile-age-sup">{age}</span>}
              {isPro && <span className="pro-name-badge">👑</span>}
            </div>
          </div>

          {/* Interests */}
          {interests.length > 0 && (
            <div className="profile-interests">
              {interests.map((interest, i) => (
                <span key={i} className="interest-chip">{translateInterest(interest)}</span>
              ))}
            </div>
          )}

          {/* Bio card */}
          {user?.bio && (
            <div className="profile-bio-card">
              <p className="profile-bio-card-title">Über Dich!</p>
              <p className="profile-bio">{user.bio}</p>
            </div>
          )}

          {/* Pro CTA */}
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

          {/* Friends shortcut */}
          <button className="profile-friends-btn" onClick={() => navigate('/friends')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Freunde &amp; Anfragen
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>

          {/* Pinnwand */}
          <div className="profile-tab-content">
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

            {/* Lieblingssong below pinnwand */}
            <div className="profile-song-section">
              {savingSong ? (
                <div className="empty-music"><p>Wird gespeichert…</p></div>
              ) : (
                <SpotifySongPicker
                  currentSong={user?.favorite_song}
                  onSelect={handleSongSelect}
                  onRemove={handleSongRemove}
                />
              )}
            </div>
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
