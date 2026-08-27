import { useState, useContext, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';
import { ImageUpload } from '../components/ImageUpload';
import '../styles/auth.css';

// Interest values are stored canonically in German on the user row — translating
// them would break category matching. Display as-is; later phases can add a
// parallel display-name map per locale.
const INTEREST_OPTIONS = [
  'Sport', 'Musik', 'Technik', 'Kunst', 'Soziales', 'Gaming',
  'Fitness', 'Reisen', 'Essen', 'Filme', 'Lesen', 'Fotografie',
  'Wandern', 'Yoga', 'Tanzen', 'Kochen', 'Mode', 'Natur', 'Clubbing'
];

// 5 steps total — used for the progress counter only; visible labels come
// from i18n at render time.
const TOTAL_STEPS = 5;

// value: backend enum (en) — must match GENDER_VALUES in authController.js.
// labelKey: i18n key for the user-facing label.
// The trailing ︎ (text variation selector) forces monochrome text
// rendering — without it iOS shows ⚧ as a full-colour emoji (blue square),
// clashing with the coral ♂/♀ glyphs. With it, all three render uniformly and
// pick up the coral colour from .option-icon.
const GENDER_OPTION_KEYS = [
  { value: 'male',    labelKey: 'onboarding.gender.male',    icon: '♂︎' },
  { value: 'female',  labelKey: 'onboarding.gender.female',  icon: '♀︎' },
  { value: 'diverse', labelKey: 'onboarding.gender.diverse', icon: '⚧︎' },
];

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useContext(AuthContext);
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const locationDebounceRef = useRef(null);
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

  // Lets the empty photo tiles open ImageUpload's file picker — testers kept
  // tapping the tiles expecting them to add photos (they're the obvious target).
  const uploadTriggerRef = useRef(null);

  const fetchLocationSuggestions = useCallback((query) => {
    clearTimeout(locationDebounceRef.current);
    if (!query || query.length < 2) { setLocationSuggestions([]); return; }
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=at,de,ch&limit=5&addressdetails=1`,
          { headers: { 'Accept-Language': 'de' } }
        );
        const data = await res.json();
        setLocationSuggestions(data.map(r => r.display_name));
      } catch { setLocationSuggestions([]); }
    }, 300);
  }, []);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) setCurrentStep(prev => prev + 1);
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
      setError(err.response?.data?.error || t('onboarding.error'));
    } finally {
      setLoading(false);
    }
  };

  const progress = ((currentStep + 1) / TOTAL_STEPS) * 100;
  const interestsNeeded = Math.max(0, 3 - formData.interests.length);

  return (
    <div className="onboarding-container">
      {/* Progress */}
      <div className="onboarding-header">
        {currentStep > 0 && (
          <button className="onboarding-back" onClick={handleBack} aria-label={t('common.back')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span className="onboarding-step-text">
          {t('onboarding.stepCounter', { current: currentStep + 1, total: TOTAL_STEPS })}
        </span>
      </div>
      <div className="onboarding-progress">
        <div className="onboarding-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {/* Step 0: Gender Selection */}
      {currentStep === 0 && (
        <div className="onboarding-content">
          <h1 className="onboarding-title">
            {t('onboarding.gender.titleLine1')}<br/>{t('onboarding.gender.titleLine2')}
          </h1>
          <p className="onboarding-subtitle">
            {t('onboarding.gender.subtitle')}
          </p>
          <div className="onboarding-options">
            {GENDER_OPTION_KEYS.map(({ value, labelKey, icon }) => (
              <button
                key={value}
                className={`onboarding-option ${formData.gender === value ? 'selected' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, gender: value }))}
              >
                <span className="option-icon">{icon}</span>
                <span className="option-label">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Basic Profile */}
      {currentStep === 1 && (
        <div className="onboarding-content" style={{ justifyContent: 'flex-start', paddingTop: '20px' }}>
          <h1 className="onboarding-title">
            {t('onboarding.profile.titleLine1')}<br/>{t('onboarding.profile.titleLine2')}
          </h1>
          <p className="onboarding-subtitle">
            {t('onboarding.profile.subtitle')}
          </p>
          <div className="onboarding-form">
            <div className="onboarding-field" style={{ position: 'relative' }}>
              <label>{t('onboarding.profile.locationLabel')}</label>
              <input
                type="text"
                placeholder={t('onboarding.profile.locationPlaceholder')}
                value={formData.location}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, location: e.target.value }));
                  fetchLocationSuggestions(e.target.value);
                }}
                onBlur={() => setTimeout(() => setLocationSuggestions([]), 150)}
                autoComplete="off"
              />
              {locationSuggestions.length > 0 && (
                <ul style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: 'var(--bg-card, #1e1e3a)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px', margin: '4px 0 0', padding: '4px 0',
                  listStyle: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  maxHeight: '220px', overflowY: 'auto',
                }}>
                  {locationSuggestions.map((s, i) => (
                    <li
                      key={i}
                      onMouseDown={() => {
                        setFormData(prev => ({ ...prev, location: s }));
                        setLocationSuggestions([]);
                      }}
                      style={{
                        padding: '10px 16px', fontSize: '13px', color: 'var(--text-white, #fff)',
                        cursor: 'pointer', lineHeight: 1.4,
                        borderBottom: i < locationSuggestions.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      📍 {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="onboarding-field">
              <label>{t('onboarding.profile.bioLabel')}</label>
              <textarea
                placeholder={t('onboarding.profile.bioPlaceholder')}
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
          <h1 className="onboarding-title">
            {t('onboarding.interests.titleLine1')}<br/>{t('onboarding.interests.titleLine2')}
          </h1>
          <p className="onboarding-subtitle">
            {t('onboarding.interests.subtitle')}
          </p>
          <div className="onboarding-field" style={{ marginBottom: '16px', width: '100%', maxWidth: '400px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                placeholder={t('onboarding.interests.customPlaceholder')}
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
            {t('onboarding.interests.counter', { count: formData.interests.length })}
            {interestsNeeded > 0 && ` ${t('onboarding.interests.needMore', { count: interestsNeeded })}`}
          </p>

          {/* Category suggestion */}
          <div style={{ width: '100%', maxWidth: '400px', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {t('onboarding.interests.suggestPrompt')}
            </p>
            {suggestionSent ? (
              <p style={{ fontSize: '13px', color: '#4ade80' }}>{t('onboarding.interests.suggestThanks')}</p>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder={t('onboarding.interests.suggestPlaceholder')}
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
                  {t('onboarding.interests.suggestSubmit')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Photos */}
      {currentStep === 3 && (
        <div className="onboarding-content" style={{ justifyContent: 'flex-start', paddingTop: '20px' }}>
          <h1 className="onboarding-title">
            {t('onboarding.photos.titleLine1')}<br/>{t('onboarding.photos.titleLine2')}
          </h1>
          <p className="onboarding-subtitle">
            {t('onboarding.photos.subtitle')}
          </p>
          <div className="photos-grid">
            {[...Array(6)].map((_, index) => (
              <div
                key={index}
                className={`photo-slot ${formData.photos[index] === formData.avatar_url ? 'main' : ''}`}
                onClick={() => formData.photos[index]
                  ? setMainPhoto(formData.photos[index])
                  : uploadTriggerRef.current?.()}
              >
                {formData.photos[index] ? (
                  <>
                    <img src={formData.photos[index]} alt="" decoding="async" />
                    {formData.photos[index] === formData.avatar_url && (
                      <div className="main-badge">{t('onboarding.photos.mainBadge')}</div>
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
              triggerRef={uploadTriggerRef}
              purpose="avatar"
              label={t('onboarding.photos.addPhoto', { current: formData.photos.length, total: 6 })}
            />
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {currentStep === 4 && (
        <div className="onboarding-content">
          <div className="complete-icon">🎊</div>
          <h1 className="onboarding-title">{t('onboarding.done.title')}</h1>
          <p className="onboarding-subtitle">
            {t('onboarding.done.subtitle')}
          </p>
          <div className="profile-preview-card">
            <div className="preview-avatar">
              {formData.avatar_url ? (
                <img src={formData.avatar_url} alt="" decoding="async" />
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
            {t('onboarding.confirm')}
          </button>
        ) : currentStep < 4 ? (
          <button
            className="auth-btn auth-btn-primary"
            onClick={handleNext}
            disabled={currentStep === 2 && formData.interests.length < 3}
          >
            {t('onboarding.next')}
          </button>
        ) : (
          <button
            className="auth-btn auth-btn-primary"
            onClick={handleComplete}
            disabled={loading}
          >
            {loading ? t('onboarding.save') : t('onboarding.finish')}
          </button>
        )}
      </div>
    </div>
  );
};
export default Onboarding;
