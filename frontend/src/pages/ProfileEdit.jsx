import { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { auth, upload, spotify } from '../utils/api';
import { connectSpotify } from '../utils/spotifyAuth';
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

// value: backend enum (en) \u2014 must match GENDER_VALUES in authController.js
// value: backend enum (en) \u2014 must match GENDER_VALUES in authController.js.
// labelKey: i18n key for the user-facing label.
const GENDER_OPTION_KEYS = [
  { value: 'male',    labelKey: 'profileEdit.gender.male' },
  { value: 'female',  labelKey: 'profileEdit.gender.female' },
  { value: 'diverse', labelKey: 'profileEdit.gender.diverse' }
];

export const ProfileEdit = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const DE_MONTHS = t('profileEdit.months', { returnObjects: true });

  const [formData, setFormData] = useState({
    name: '',
    bio: '',
    location: '',
    date_of_birth: '',
    gender: '',
    interests: [],
    // PROFILFOTOS (carousel): avatar_url is the first photo (= profile picture
    // shown in chats/groups), `photos` holds the rest. Header swipes [avatar, ...photos].
    avatar_url: '',
    photos: [],
    // PINNWAND: separate Pinterest-style gallery for the "vibe check".
    pinnwand: []
  });
  const [dobParts, setDobParts] = useState({ y: '', m: '', d: '' });
  const [favoriteSong, setFavoriteSong] = useState(null);
  const photoInputRef = useRef(null);
  const pinnwandInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [pinnwandUploading, setPinnwandUploading] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const locationDebounceRef = useRef(null);

  useEffect(() => {
    if (user) {
      // Parse existing date_of_birth — postgres may return full ISO string
      let y = '', m = '', d = '';
      if (user.date_of_birth) {
        const raw = user.date_of_birth.substring(0, 10); // "YYYY-MM-DD"
        const parts = raw.split('-');
        y = parts[0] || '';
        m = parts[1] || '';
        d = parts[2] || '';
      }
      setDobParts({ y, m, d });
      // Normalise to the unified model: avatar_url is always the first photo.
      // Legacy profiles with photos but no avatar → promote photos[0]. Dedupe
      // the avatar out of `photos` in case it was stored in both places.
      const existingPhotos = user.photos || [];
      let avatar = user.avatar_url || '';
      let rest = existingPhotos;
      if (!avatar && existingPhotos.length) {
        avatar = existingPhotos[0];
        rest = existingPhotos.slice(1);
      }
      rest = rest.filter(p => p && p !== avatar);
      setFormData({
        name: user.name || '',
        bio: user.bio || '',
        location: user.location || '',
        date_of_birth: y && m && d ? `${y}-${m}-${d}` : '',
        gender: user.gender || '',
        interests: user.interests || [],
        avatar_url: avatar,
        photos: rest,
        pinnwand: user.pinnwand || []
      });
      setFavoriteSong(user.favorite_song || null);
    }
  }, [user]);

  useEffect(() => {
    spotify.getStatus().then(res => {
      setSpotifyConnected(res.data.connected);
    }).catch(() => {});
  }, []);

  // The Spotify connect opens an in-app browser (iOS PWA) and the main page
  // stays put — so when the user returns, re-check the status and clear the
  // stuck "Verbinde…" state. This is what flips the button to "connected"
  // after the OAuth flow completes in that separate window.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      spotify.getStatus()
        .then(res => setSpotifyConnected(res.data.connected))
        .catch(() => {})
        .finally(() => setSpotifyLoading(false));
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, []);

  const handleDobChange = (field, value) => {
    const next = { ...dobParts, [field]: value };
    setDobParts(next);
    // Always store what we have; backend CASE WHEN handles partial nulls
    if (next.y && next.m && next.d) {
      handleChange('date_of_birth', `${next.y}-${next.m.padStart(2,'0')}-${next.d.padStart(2,'0')}`);
    }
  };

  const handleSpotifyConnect = async () => {
    setSpotifyLoading(true);
    try {
      // Web path navigates away (page unloads); native resolves via callbacks.
      await connectSpotify({
        onSuccess: (data) => {
          setSpotifyConnected(true);
          setSpotifyLoading(false);
          toast.success(data?.message || t('profileEdit.toast.spotifyConnected'));
        },
        onError: (e) => {
          setSpotifyLoading(false);
          // Surface the backend's reason (e.g. "Spotify nicht konfiguriert",
          // "Ungültiger State", "Token-Austausch fehlgeschlagen") so a config
          // problem is obvious instead of a generic "didn't work".
          toast.error(e?.response?.data?.error || e?.message || t('profileEdit.toast.spotifyConnectError'));
        },
        onCancel: () => setSpotifyLoading(false),
      });
    } catch (err) {
      // getAuthUrl failure (most often missing SPOTIFY_CLIENT_ID → 500
      // "Spotify nicht konfiguriert"). Show it verbatim.
      toast.error(err?.response?.data?.error || err?.message || t('profileEdit.toast.spotifyConnectError'));
      setSpotifyLoading(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    setSpotifyLoading(true);
    try {
      await spotify.disconnect();
      setSpotifyConnected(false);
      toast.success(t('profileEdit.toast.spotifyDisconnected'));
    } catch (err) {
      toast.error(t('profileEdit.toast.spotifyDisconnectError'));
    } finally {
      setSpotifyLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Backend rejects empty-string gender ('' isn't in the enum) with a 400.
      // Normalise empty optional strings to null so the save survives when the
      // user hasn't filled every field.
      const payload = {
        ...formData,
        gender: formData.gender || null,
        date_of_birth: formData.date_of_birth || null,
        bio: formData.bio || null,
        location: formData.location || null,
        favorite_song: favoriteSong,
      };
      const res = await auth.updateProfile(payload);
      setUser(res.data);
      toast.success(t('profileEdit.toast.saved'));
      navigate('/profile');
    } catch (error) {
      // Surface the backend's German error message when available so the user
      // sees WHY it failed (e.g. "Bio max. 500 Zeichen") instead of a generic toast.
      toast.error(error.response?.data?.error || t('profileEdit.toast.saveError'));
    } finally {
      setLoading(false);
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

  const handleLocationInput = (value) => {
    handleChange('location', value);
    setLocationSuggestions([]);
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!value.trim() || value.length < 2) return;
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=5&addressdetails=1&countrycodes=at,de,ch&accept-language=de`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
        const data = await res.json();
        const suggestions = data.map(item => {
          const a = item.address || {};
          const place = a.city || a.town || a.village || a.municipality || item.name;
          const country = a.country;
          return place && country ? `${place}, ${country}` : item.display_name;
        });
        setLocationSuggestions(suggestions);
      } catch (_) {}
    }, 350);
  };

  const handlePhotoAdd = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Client-side guard so the user sees an instant error instead of waiting
    // for the upload to round-trip and the backend to reject with 413.
    const MAX_BYTES = 15 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast.error(t('profileEdit.toast.photoTooLarge'));
      e.target.value = '';
      return;
    }

    setPhotoUploading(true);
    try {
      const res = await upload.image(file);
      // First photo becomes the profile picture (avatar); the rest fill `photos`.
      setFormData(prev => prev.avatar_url
        ? { ...prev, photos: [...(prev.photos || []), res.data.url] }
        : { ...prev, avatar_url: res.data.url });
    } catch (err) {
      // Surface the backend's reason if present — moderation rejection, format,
      // size, etc. — so the user knows WHY the upload failed.
      const msg = err?.response?.data?.error || err?.message || t('profileEdit.toast.photoError');
      toast.error(msg);
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handlePhotoRemove = (index) => {
    setFormData(prev => ({ ...prev, photos: prev.photos.filter((_, i) => i !== index) }));
  };

  // Removing the profile picture promotes the next photo to be the new one,
  // so the first slot is never left empty while other photos remain.
  const handleProfilePhotoRemove = () => {
    setFormData(prev => {
      const [next, ...rest] = prev.photos || [];
      return { ...prev, avatar_url: next || '', photos: rest };
    });
  };

  // ── Pinnwand (separate Pinterest-style gallery) ──
  const handlePinnwandAdd = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error(t('profileEdit.toast.photoTooLarge'));
      e.target.value = '';
      return;
    }
    setPinnwandUploading(true);
    try {
      const res = await upload.image(file);
      setFormData(prev => ({ ...prev, pinnwand: [...(prev.pinnwand || []), res.data.url] }));
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || t('profileEdit.toast.photoError'));
    } finally {
      setPinnwandUploading(false);
      e.target.value = '';
    }
  };

  const handlePinnwandRemove = (index) => {
    setFormData(prev => ({ ...prev, pinnwand: prev.pinnwand.filter((_, i) => i !== index) }));
  };

  return (
    <div className="settings-page">
      {/* Header */}
      <div className="settings-header">
        <button className="settings-back" onClick={() => navigate(-1)} aria-label={t('profileEdit.backAria')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="settings-title">{t('profileEdit.title')}</h1>
      </div>

      <div className="settings-body">
      <form onSubmit={handleSubmit}>
        {/* Pers\u00f6nliche Daten */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            {t('profileEdit.sections.personal')}
          </h3>

          <div className="pe-field">
            <div className="pe-field-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span>{t('profileEdit.fields.name')}</span>
            </div>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="settings-input"
              placeholder={t('profileEdit.fields.namePlaceholder')}
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
              <span>{t('profileEdit.fields.bio')}</span>
            </div>
            <textarea
              value={formData.bio}
              onChange={(e) => handleChange('bio', e.target.value)}
              rows={3}
              className="settings-input pe-textarea"
              placeholder={t('profileEdit.fields.bioPlaceholder')}
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
              <span>{t('profileEdit.fields.location')}</span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleLocationInput(e.target.value)}
                className="settings-input"
                placeholder={t('profileEdit.fields.locationPlaceholder')}
                autoComplete="off"
              />
              {locationSuggestions.length > 0 && (
                <ul className="location-suggestions">
                  {locationSuggestions.map((s, i) => (
                    <li key={i} onMouseDown={() => { handleChange('location', s); setLocationSuggestions([]); }}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* DOB and Gender now stack vertically (full-width each) because the
              prior side-by-side layout cropped "Divers" to "DI" on narrow phones
              — 3 chips couldn't fit in half a screen-width. */}
          <div className="pe-field">
            <div className="pe-field-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>{t('profileEdit.fields.dob')}</span>
            </div>
            <div className="dob-select-row">
                <select className="settings-input dob-select" value={dobParts.d} onChange={e => handleDobChange('d', e.target.value)}>
                  <option value="">{t('profileEdit.fields.dobDay')}</option>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select className="settings-input dob-select dob-select--month" value={dobParts.m} onChange={e => handleDobChange('m', e.target.value)}>
                  <option value="">{t('profileEdit.fields.dobMonth')}</option>
                  {DE_MONTHS.map((mo, i) => (
                    <option key={mo} value={String(i + 1).padStart(2, '0')}>{mo}</option>
                  ))}
                </select>
              <select className="settings-input dob-select" value={dobParts.y} onChange={e => handleDobChange('y', e.target.value)}>
                <option value="">{t('profileEdit.fields.dobYear')}</option>
                {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - 10 - i).map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pe-field">
            <div className="pe-field-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span>{t('profileEdit.fields.gender')}</span>
            </div>
            <div className="pe-gender-options">
              {GENDER_OPTION_KEYS.map(({ value, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  className={`pe-gender-chip ${formData.gender === value ? 'active' : ''}`}
                  onClick={() => handleChange('gender', value)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Interessen */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            {t('profileEdit.sections.interests')}
            <span className="pe-interest-count">{t('profileEdit.interestsCountFmt', { count: formData.interests.length })}</span>
          </h3>

          <div className="pe-interests-grid">
            {/* Onboarding bietet eine andere Liste + frei eingetippte Interessen an —
                gespeicherte Interessen außerhalb von AVAILABLE_INTERESTS müssen trotzdem
                sichtbar (und abwählbar) sein, sonst stimmt der Zähler nicht mit dem Grid überein. */}
            {[
              ...AVAILABLE_INTERESTS,
              ...formData.interests
                .filter(name => !AVAILABLE_INTERESTS.some(a => a.name === name))
                .map(name => ({ name, icon: '✨' }))
            ].map(({ name, icon }) => (
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
            {t('profileEdit.sections.song')}
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
            {t('profileEdit.sections.spotify')}
          </h3>

          <div className="pe-spotify-section">
            {spotifyConnected ? (
              <div className="pe-spotify-connected">
                <div className="pe-spotify-status">
                  <span className="pe-spotify-badge">{t('profileEdit.spotify.connected')}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    {t('profileEdit.spotify.connectedDesc')}
                  </span>
                </div>
                <button
                  type="button"
                  className="pe-spotify-btn disconnect"
                  onClick={handleSpotifyDisconnect}
                  disabled={spotifyLoading}
                >
                  {spotifyLoading ? '...' : t('profileEdit.spotify.disconnect')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="pe-spotify-btn connect"
                onClick={handleSpotifyConnect}
                disabled={spotifyLoading}
              >
                {spotifyLoading ? t('profileEdit.spotify.connecting') : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    {t('profileEdit.spotify.connect')}
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Fotos / Pinnwand — first photo is the profile picture */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            {t('profileEdit.sections.photos')}
            <span className="pe-interest-count">{t('profileEdit.photosCountFmt', { current: (formData.avatar_url ? 1 : 0) + (formData.photos || []).length, total: 6 })}</span>
          </h3>

          <p className="pe-photo-hint">{t('profileEdit.photosFirstHint')}</p>

          <div className="pe-photo-grid">
            {/* Profile picture — always the first photo */}
            {formData.avatar_url && (
              <div className="pe-photo-cell pe-photo-cell--profile">
                <img src={formData.avatar_url} alt="" loading="lazy" decoding="async" />
                <span className="pe-photo-badge">{t('profileEdit.photosProfileBadge')}</span>
                <button
                  type="button"
                  className="pe-photo-remove"
                  onClick={handleProfilePhotoRemove}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            )}

            {(formData.photos || []).map((url, i) => (
              <div key={i} className="pe-photo-cell">
                <img src={url} alt="" loading="lazy" decoding="async" />
                <button
                  type="button"
                  className="pe-photo-remove"
                  onClick={() => handlePhotoRemove(i)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ))}

            {((formData.avatar_url ? 1 : 0) + (formData.photos || []).length) < 6 && (
              <button
                type="button"
                className="pe-photo-add"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
              >
                {photoUploading
                  ? <div className="pe-photo-spinner" />
                  : <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      {!formData.avatar_url && <span className="pe-photo-add-label">{t('profileEdit.photosProfileBadge')}</span>}
                    </>
                }
              </button>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoAdd}
              hidden
            />
          </div>
        </div>

        {/* Pinnwand — separate Pinterest-style gallery (vibe check) */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
            {t('profileEdit.sections.pinnwand')}
            <span className="pe-interest-count">{t('profileEdit.photosCountFmt', { current: (formData.pinnwand || []).length, total: 12 })}</span>
          </h3>

          <p className="pe-photo-hint">{t('profileEdit.pinnwandHint')}</p>

          <div className="pe-photo-grid">
            {(formData.pinnwand || []).map((url, i) => (
              <div key={i} className="pe-photo-cell">
                <img src={url} alt="" loading="lazy" decoding="async" />
                <button
                  type="button"
                  className="pe-photo-remove"
                  onClick={() => handlePinnwandRemove(i)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ))}

            {(formData.pinnwand || []).length < 12 && (
              <button
                type="button"
                className="pe-photo-add"
                onClick={() => pinnwandInputRef.current?.click()}
                disabled={pinnwandUploading}
              >
                {pinnwandUploading
                  ? <div className="pe-photo-spinner" />
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                }
              </button>
            )}
            <input
              ref={pinnwandInputRef}
              type="file"
              accept="image/*"
              onChange={handlePinnwandAdd}
              hidden
            />
          </div>
        </div>

        {/* Save Button */}
        <button type="submit" className="pe-save-btn" disabled={loading || photoUploading || pinnwandUploading}>
          {loading ? (
            t('profileEdit.saveLoading')
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              {t('profileEdit.saveBtn')}
            </>
          )}
        </button>
      </form>
      </div>{/* settings-body */}
    </div>
  );
};

export default ProfileEdit;
