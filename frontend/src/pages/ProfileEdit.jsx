import { useState, useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { auth, upload, spotify } from '../utils/api';
import { useToast } from '../context/ToastContext';
import SpotifySongPicker from '../components/SpotifySongPicker';
import '../styles/profile.css';

const AVAILABLE_INTERESTS = [
  { name: 'Wandern', icon: '\u{1F3D4}\uFE0F' },
  { name: 'Tennis', icon: '\u{1F3BE}' },
  { name: 'Golf', icon: '\u26F3' },
  { name: 'Laufen', icon: '\u{1F3C3}' },
  { name: 'Volleyball', icon: '\u{1F3D0}' },
  { name: 'Yoga', icon: '\u{1F9D8}' },
  { name: 'Kochen', icon: '\u{1F468}\u200D\u{1F373}' },
  { name: 'Fotografie', icon: '\u{1F4F7}' },
  { name: 'Musik', icon: '\u{1F3B5}' },
  { name: 'Kunst', icon: '\u{1F3A8}' },
  { name: 'Tanzen', icon: '\u{1F483}' },
  { name: 'Brettspiele', icon: '\u{1F3B2}' },
  { name: 'Reisen', icon: '\u2708\uFE0F' },
  { name: 'Gaming', icon: '\u{1F3AE}' },
  { name: 'Fitness', icon: '\u{1F4AA}' },
  { name: 'Schwimmen', icon: '\u{1F3CA}' }
];

const GENDER_OPTIONS = [
  { value: 'male', label: 'M\u00e4nnlich' },
  { value: 'female', label: 'Weiblich' },
  { value: 'other', label: 'Divers' }
];

export const ProfileEdit = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();
  const fileInputRef = useRef(null);
  const avatarBlobRef = useRef(null);

  useEffect(() => {
    return () => { if (avatarBlobRef.current) URL.revokeObjectURL(avatarBlobRef.current); };
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    bio: '',
    location: '',
    date_of_birth: '',
    gender: '',
    interests: [],
    photos: []
  });
  const [favoriteSong, setFavoriteSong] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        bio: user.bio || '',
        location: user.location || '',
        date_of_birth: user.date_of_birth || '',
        gender: user.gender || '',
        interests: user.interests || [],
        photos: user.photos || []
      });
      setFavoriteSong(user.favorite_song || null);
      setAvatarPreview(user.avatar_url || null);
    }
  }, [user]);

  useEffect(() => {
    spotify.getStatus().then(res => {
      setSpotifyConnected(res.data.connected);
    }).catch(() => {});
  }, []);

  const handleSpotifyConnect = async () => {
    setSpotifyLoading(true);
    try {
      const res = await spotify.getAuthUrl();
      window.location.href = res.data.url;
    } catch (err) {
      toast.error('Spotify-Verbindung fehlgeschlagen');
      setSpotifyLoading(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    setSpotifyLoading(true);
    try {
      await spotify.disconnect();
      setSpotifyConnected(false);
      toast.success('Spotify getrennt');
    } catch (err) {
      toast.error('Fehler beim Trennen');
    } finally {
      setSpotifyLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await auth.updateProfile({
        ...formData,
        favorite_song: favoriteSong
      });
      setUser(res.data);
      toast.success('Profil gespeichert');
      navigate('/profile');
    } catch (error) {
      console.error('Update failed:', error);
      toast.error('Fehler beim Speichern');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (avatarBlobRef.current) URL.revokeObjectURL(avatarBlobRef.current);
    const blobUrl = URL.createObjectURL(file);
    avatarBlobRef.current = blobUrl;
    setAvatarPreview(blobUrl);
    setUploading(true);

    try {
      const res = await upload.image(file);
      await auth.updateProfile({ avatar_url: res.data.url });
      setUser(prev => ({ ...prev, avatar_url: res.data.url }));
      toast.success('Profilbild aktualisiert');
    } catch (err) {
      console.error('Avatar upload failed:', err);
      toast.error('Bild konnte nicht hochgeladen werden');
      setAvatarPreview(user?.avatar_url || null);
    } finally {
      setUploading(false);
    }
  };

  const handleInterestToggle = (interest) => {
    setFormData(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="settings-page">
      {/* Header */}
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate(-1)} aria-label="Zurück">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="settings-title">Profil bearbeiten</h1>
      </div>

      <div className="settings-body">
      {/* Avatar Section */}
      <div className="pe-avatar-section" onClick={() => fileInputRef.current?.click()}>
        <div className="pe-avatar-wrapper">
          <div className="pe-avatar">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" />
            ) : (
              <span>{(user?.name || '?')[0].toUpperCase()}</span>
            )}
          </div>
          <div className="pe-avatar-overlay">
            {uploading ? (
              <span className="pe-avatar-uploading">...</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            )}
          </div>
        </div>
        <span className="pe-avatar-hint">Foto {'\u00e4'}ndern</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          hidden
        />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Pers\u00f6nliche Daten */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Pers{'\u00f6'}nliche Daten
          </h3>

          <div className="pe-field">
            <div className="pe-field-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span>Name</span>
            </div>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="settings-input"
              placeholder="Dein Name"
            />
          </div>

          <div className="pe-field">
            <div className="pe-field-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="17" y1="10" x2="3" y2="10"/>
                <line x1="21" y1="6" x2="3" y2="6"/>
                <line x1="21" y1="14" x2="3" y2="14"/>
                <line x1="17" y1="18" x2="3" y2="18"/>
              </svg>
              <span>Bio</span>
            </div>
            <textarea
              value={formData.bio}
              onChange={(e) => handleChange('bio', e.target.value)}
              rows={3}
              className="settings-input pe-textarea"
              placeholder="Erz{'\u00e4'}hl etwas {'\u00fc'}ber dich..."
              maxLength={300}
            />
            <span className="pe-char-count">{formData.bio.length}/300</span>
          </div>

          <div className="pe-field">
            <div className="pe-field-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>Standort</span>
            </div>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => handleChange('location', e.target.value)}
              className="settings-input"
              placeholder="z.B. Wien"
            />
          </div>

          <div className="pe-field-row">
            <div className="pe-field pe-field-half">
              <div className="pe-field-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span>Geburtsdatum</span>
              </div>
              <input
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => handleChange('date_of_birth', e.target.value)}
                className="settings-input"
              />
            </div>

            <div className="pe-field pe-field-half">
              <div className="pe-field-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>Geschlecht</span>
              </div>
              <div className="pe-gender-options">
                {GENDER_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`pe-gender-chip ${formData.gender === value ? 'active' : ''}`}
                    onClick={() => handleChange('gender', value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Interessen */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            Interessen
            <span className="pe-interest-count">{formData.interests.length} ausgew{'\u00e4'}hlt</span>
          </h3>

          <div className="pe-interests-grid">
            {AVAILABLE_INTERESTS.map(({ name, icon }) => (
              <button
                key={name}
                type="button"
                className={`pe-interest-chip ${formData.interests.includes(name) ? 'active' : ''}`}
                onClick={() => handleInterestToggle(name)}
              >
                <span className="pe-interest-icon">{icon}</span>
                <span>{name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lieblingssong */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            Lieblingssong
          </h3>

          <div className="pe-song-section">
            <SpotifySongPicker
              currentSong={favoriteSong}
              onSelect={(song) => setFavoriteSong(song)}
              onRemove={() => setFavoriteSong(null)}
            />
          </div>
        </div>

        {/* Spotify Verbindung */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 15s1.5-2 4-2 4 2 4 2"/>
              <path d="M7 12s2-3 5-3 5 3 5 3"/>
              <path d="M6 9s2.5-4 6-4 6 4 6 4"/>
            </svg>
            Spotify
          </h3>

          <div className="pe-spotify-section">
            {spotifyConnected ? (
              <div className="pe-spotify-connected">
                <div className="pe-spotify-status">
                  <span className="pe-spotify-badge">Verbunden</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    Dein Spotify-Konto ist verkn{'\u00fc'}pft
                  </span>
                </div>
                <button
                  type="button"
                  className="pe-spotify-btn disconnect"
                  onClick={handleSpotifyDisconnect}
                  disabled={spotifyLoading}
                >
                  {spotifyLoading ? '...' : 'Trennen'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="pe-spotify-btn connect"
                onClick={handleSpotifyConnect}
                disabled={spotifyLoading}
              >
                {spotifyLoading ? 'Verbinde...' : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    Mit Spotify verbinden
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Save Button */}
        <button type="submit" className="pe-save-btn" disabled={loading || uploading}>
          {loading ? (
            'Speichern...'
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              {'\u00c4'}nderungen speichern
            </>
          )}
        </button>
      </form>
      </div>{/* settings-body */}
    </div>
  );
};

export default ProfileEdit;
