import React, { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';
import { ImageUpload } from '../components/ImageUpload';
import '../styles/auth.css';

const INTEREST_OPTIONS = [
  'Sport', 'Musik', 'Technik', 'Kunst', 'Soziales', 'Gaming',
  'Fitness', 'Reisen', 'Essen', 'Filme', 'Lesen', 'Fotografie',
  'Wandern', 'Yoga', 'Tanzen', 'Kochen', 'Mode', 'Natur', 'Clubbing'
];

const STEPS = ['Geschlecht', 'Profil', 'Interessen', 'Fotos', 'Fertig'];

const GENDER_OPTIONS = [
  { value: 'm\u00e4nnlich', label: 'M\u00e4nnlich', icon: '\u2642' },
  { value: 'weiblich', label: 'Weiblich', icon: '\u2640' },
  { value: 'divers', label: 'Divers', icon: '\u26A7' }
];

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useContext(AuthContext);
  const [currentStep, setCurrentStep] = useState(0);
  const locationRef     = useRef(null);
  const autocompleteRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [customInterest, setCustomInterest] = useState('');
  const [categorySuggestion, setCategorySuggestion] = useState('');
  const [suggestionSent, setSuggestionSent] = useState(false);

  const [formData, setFormData] = useState({
    gender: '',
    location: '',
    bio: '',
    interests: [],
    photos: [],
    avatar_url: null
  });

  // Load Google Maps on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    if (window.__gmLoaded) return;
    if (window.__gmLoading) return;
    window.__gmLoading = true;
    window.__gmOnReady = () => { window.__gmLoaded = true; window.__gmLoading = false; };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=de&callback=__gmOnReady`;
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // Attach autocomplete when step 1 (location field) renders
  useEffect(() => {
    if (currentStep !== 1) return;

    const attach = () => {
      if (!window.google?.maps?.places) return;
      if (autocompleteRef.current) return;
      if (!locationRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(locationRef.current, {
        componentRestrictions: { country: ['at', 'de', 'ch'] },
        fields: ['formatted_address', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || '';
        if (val) setFormData(prev => ({ ...prev, location: val }));
      });
      autocompleteRef.current = ac;
    };

    const timer = setTimeout(() => {
      if (window.__gmLoaded) attach();
      else { window.__gmOnReady = () => { window.__gmLoaded = true; attach(); }; }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentStep]);

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  const toggleInterest = (interest) => {
    setFormData(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  const addCustomInterest = (e) => {
    e?.preventDefault();
    if (customInterest.trim() && !formData.interests.includes(customInterest.trim())) {
      toggleInterest(customInterest.trim());
      setCustomInterest('');
    }
  };

  const sendCategorySuggestion = async (e) => {
    e?.preventDefault();
    const text = categorySuggestion.trim();
    if (!text || suggestionSent) return;
    try {
      await api.post('/analytics/suggest-category', { suggestion: text });
      setSuggestionSent(true);
      setCategorySuggestion('');
    } catch {
      // non-blocking — ignore errors
    }
  };

  const handlePhotoUpload = (url) => {
    if (formData.photos.length < 6) {
      setFormData(prev => {
        const newPhotos = [...prev.photos, url];
        const newAvatar = prev.avatar_url || url;
        return { ...prev, photos: newPhotos, avatar_url: newAvatar };
      });
    }
  };

  const setMainPhoto = (url) => {
    setFormData(prev => ({ ...prev, avatar_url: url }));
  };

  const removePhoto = (index) => {
    setFormData(prev => {
      const photoToRemove = prev.photos[index];
      const newPhotos = prev.photos.filter((_, i) => i !== index);
      let newAvatar = prev.avatar_url;
      if (photoToRemove === prev.avatar_url) {
        newAvatar = newPhotos.length > 0 ? newPhotos[0] : null;
      }
      return { ...prev, photos: newPhotos, avatar_url: newAvatar };
    });
  };

  const handleComplete = async () => {
    setLoading(true);
    setError('');
    try {
      await api.put('/auth/onboarding', formData);
      if (typeof refreshProfile === 'function') await refreshProfile();
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Profil konnte nicht gespeichert werden');
    } finally {
      setLoading(false);
    }
  };

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="onboarding-container">
      {/* Progress */}
      <div className="onboarding-header">
        {currentStep > 0 && (
          <button className="onboarding-back" onClick={handleBack}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span className="onboarding-step-text">
          {currentStep + 1} / {STEPS.length}
        </span>
      </div>
      <div className="onboarding-progress">
        <div className="onboarding-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {/* Step 0: Gender Selection */}
      {currentStep === 0 && (
        <div className="onboarding-content">
          <h1 className="onboarding-title">W&auml;hle dein<br/>Geschlecht</h1>
          <p className="onboarding-subtitle">
            Damit wir dir passendere Gruppen vorschlagen k&ouml;nnen
          </p>
          <div className="onboarding-options">
            {GENDER_OPTIONS.map(({ value, label, icon }) => (
              <button
                key={value}
                className={`onboarding-option ${formData.gender === value ? 'selected' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, gender: value }))}
              >
                <span className="option-icon">{icon}</span>
                <span className="option-label">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Basic Profile */}
      {currentStep === 1 && (
        <div className="onboarding-content" style={{ justifyContent: 'flex-start', paddingTop: '20px' }}>
          <h1 className="onboarding-title">Erzähl uns<br/>etwas über dich</h1>
          <p className="onboarding-subtitle">
            Damit schlagen wir dir später passendere Gruppen vor
          </p>
          <div className="onboarding-form">
            <div className="onboarding-field">
              <label>📍 Wohnort</label>
              <input
                ref={locationRef}
                type="text"
                placeholder="z.B. Wien, Österreich"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="onboarding-field">
              <label>✍️ Kurzbeschreibung (optional)</label>
              <textarea
                placeholder="Erzähl kurz, wer du bist und worauf du Lust hast..."
                value={formData.bio}
                onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                rows={4}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Interests */}
      {currentStep === 2 && (
        <div className="onboarding-content" style={{ justifyContent: 'flex-start', paddingTop: '20px' }}>
          <h1 className="onboarding-title">Worauf hast<br/>du Lust?</h1>
          <p className="onboarding-subtitle">
            Wähle mindestens 3 Interessen
          </p>
          <div className="onboarding-field" style={{ marginBottom: '16px', width: '100%', maxWidth: '400px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                placeholder="Eigenes Interesse..."
                value={customInterest}
                onChange={(e) => setCustomInterest(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomInterest(e)}
              />
              <button onClick={addCustomInterest} className="onboarding-add-btn">+</button>
            </div>
          </div>
          <div className="interests-grid">
            {[...new Set([...INTEREST_OPTIONS, ...formData.interests])].map(interest => (
              <button
                key={interest}
                className={`interest-tag ${formData.interests.includes(interest) ? 'selected' : ''}`}
                onClick={() => toggleInterest(interest)}
              >
                {interest}
              </button>
            ))}
          </div>
          <p className="interest-counter">
            {formData.interests.length} ausgewählt
            {formData.interests.length < 3 && ` (noch ${3 - formData.interests.length} nötig)`}
          </p>

          {/* Category suggestion */}
          <div style={{ width: '100%', maxWidth: '400px', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Kategorie vermissen? Vorschlag abgeben:
            </p>
            {suggestionSent ? (
              <p style={{ fontSize: '13px', color: '#4ade80' }}>✓ Danke für deinen Vorschlag!</p>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="z.B. Volleyball, Fotografie…"
                  value={categorySuggestion}
                  onChange={(e) => setCategorySuggestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendCategorySuggestion(e)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={sendCategorySuggestion}
                  disabled={!categorySuggestion.trim()}
                  className="onboarding-add-btn"
                >
                  Senden
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Photos */}
      {currentStep === 3 && (
        <div className="onboarding-content" style={{ justifyContent: 'flex-start', paddingTop: '20px' }}>
          <h1 className="onboarding-title">Füge Fotos<br/>hinzu</h1>
          <p className="onboarding-subtitle">
            Tippe auf ein Foto, um es als Profilbild zu setzen
          </p>
          <div className="photos-grid">
            {[...Array(6)].map((_, index) => (
              <div
                key={index}
                className={`photo-slot ${formData.photos[index] === formData.avatar_url ? 'main' : ''}`}
                onClick={() => formData.photos[index] && setMainPhoto(formData.photos[index])}
              >
                {formData.photos[index] ? (
                  <>
                    <img src={formData.photos[index]} alt={`Foto ${index + 1}`} />
                    {formData.photos[index] === formData.avatar_url && (
                      <div className="main-badge">Profilbild</div>
                    )}
                    <button
                      className="photo-remove"
                      onClick={(e) => { e.stopPropagation(); removePhoto(index); }}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span className="photo-add">+</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '20px' }}>
            <ImageUpload
              onUpload={handlePhotoUpload}
              label={`Foto hinzufügen (${formData.photos.length}/6)`}
            />
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {currentStep === 4 && (
        <div className="onboarding-content">
          <div className="complete-icon">🎊</div>
          <h1 className="onboarding-title">Du bist bereit!</h1>
          <p className="onboarding-subtitle">
            Dein Profil ist fertig. Du kannst jetzt Gruppen beitreten und mit anderen schreiben.
          </p>
          <div className="profile-preview-card">
            <div className="preview-avatar">
              {formData.avatar_url ? (
                <img src={formData.avatar_url} alt="Profil" />
              ) : (
                <span>👤</span>
              )}
            </div>
            <div className="preview-info">
              {formData.location && <p>📍 {formData.location}</p>}
              {formData.bio && <p className="preview-bio">"{formData.bio}"</p>}
              {formData.interests.length > 0 && (
                <div className="preview-interests">
                  {formData.interests.slice(0, 5).map(i => (
                    <span key={i} className="preview-interest-tag">{i}</span>
                  ))}
                  {formData.interests.length > 5 && (
                    <span className="preview-more">+{formData.interests.length - 5}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          {error && <p className="error-message">{error}</p>}
        </div>
      )}

      {/* Footer */}
      <div className="onboarding-footer">
        {currentStep === 0 ? (
          <button
            className="auth-btn auth-btn-primary"
            onClick={handleNext}
            disabled={!formData.gender}
          >
            Bestätigen
          </button>
        ) : currentStep < 4 ? (
          <button
            className="auth-btn auth-btn-primary"
            onClick={handleNext}
            disabled={currentStep === 2 && formData.interests.length < 3}
          >
            Weiter
          </button>
        ) : (
          <button
            className="auth-btn auth-btn-primary"
            onClick={handleComplete}
            disabled={loading}
          >
            {loading ? 'Speichere...' : "Los geht's! 🚀"}
          </button>
        )}
      </div>
    </div>
  );
};
export default Onboarding;
