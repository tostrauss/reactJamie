import { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';
import { loadGoogleMaps, onGoogleMapsReady } from '../utils/googleMaps';
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

// 5 steps total — used for the progress dots only; visible labels come
// from i18n at render time.
const TOTAL_STEPS = 5;

// value: backend enum (en) — must match GENDER_VALUES in authController.js.
// labelKey: i18n key for the user-facing label.
// The trailing ︎ (text variation selector) forces monochrome text
// rendering — without it iOS shows ⚧ as a full-colour emoji (blue square),
// clashing with the coral ♂/♀ glyphs. With it, all three render uniformly and
// pick up the coral colour from .ob-choice-icon.
const GENDER_OPTION_KEYS = [
  { value: 'male',    labelKey: 'onboarding.gender.male',    icon: '♂︎' },
  { value: 'female',  labelKey: 'onboarding.gender.female',  icon: '♀︎' },
  { value: 'diverse', labelKey: 'onboarding.gender.diverse', icon: '⚧︎' },
];

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PinIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

// Two-tone headline: first line white, second line coral in the wordmark's
// Archivo 900 italic. Same split the i18n keys already carry (titleLine1/2).
const StepTitle = ({ line1, line2 }) => (
  <h1 className="ob-title">
    <span className="ob-title-line">{line1}</span>
    <span className="ob-title-line ob-title-accent">{line2}</span>
  </h1>
);

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useContext(AuthContext);
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
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
    avatar_url: null,
    // Only social-login accounts reach onboarding without one: googleLogin
    // creates the user with date_of_birth = NULL, and until 2026-09-15 nothing
    // ever asked — so those accounts stayed ageless AND un-age-checked. An
    // email signup already set it at registration, so the field below is
    // hidden for them rather than asked twice.
    date_of_birth: '',
  });

  // Latest date that is still 18+ — the same rule the server enforces
  // (checkAdultDob) and the register screen already uses.
  const maxDOB = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().slice(0, 10);
  })();
  const needsDob = !user?.date_of_birth;

  // Lets the empty photo tiles open ImageUpload's file picker — testers kept
  // tapping the tiles expecting them to add photos (they're the obvious target).
  const uploadTriggerRef = useRef(null);

  // ── Wohnort: Google Places city suggestions ─────────────────────────────
  // Same loader as group/club creation (utils/googleMaps.js). Replaces the
  // old browser-side Nominatim lookup (Tobi 23.09.2026: "die Google-Maps-
  // Vorschläge fehlen"). Cities only, and no country restriction: native
  // users are worldwide, and Places accepts at most 5 countries anyway.
  // Without a key or if Google fails, the field is a plain text input —
  // the server geocodes the profile city either way.
  const locationRef = useRef(null);
  const autocompleteRef = useRef(null);
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);
  useEffect(() => {
    if (currentStep !== 1) return undefined;
    const attach = () => {
      if (!window.google?.maps?.places || autocompleteRef.current || !locationRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(locationRef.current, {
        types: ['(cities)'],
        fields: ['formatted_address', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place?.formatted_address || place?.name || '';
        if (val) setFormData(prev => ({ ...prev, location: val }));
      });
      autocompleteRef.current = ac;
    };
    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    return () => {
      clearTimeout(timer);
      // The input unmounts with the step — drop the binding so coming back
      // to this step attaches a fresh one to the new input element.
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
      autocompleteRef.current = null;
    };
  }, [currentStep]);

  const toggleInterest = (interest) => {
    setFormData(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  // Enter / „Fertig" on the keyboard adds it (the old „+" button is gone —
  // Tobi 23.09.2026). Also called on Weiter, so typed-but-not-confirmed text
  // isn't silently dropped.
  const addCustomInterest = (e) => {
    e?.preventDefault();
    const value = customInterest.trim().slice(0, 40);
    if (!value) return;
    if (!formData.interests.some(i => i.toLowerCase() === value.toLowerCase())) toggleInterest(value);
    setCustomInterest('');
  };

  const handleNext = () => {
    if (currentStep === 2) addCustomInterest();
    if (currentStep < TOTAL_STEPS - 1) setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
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
    // Fail here rather than letting the server 400 after the user has filled
    // in four steps. The server check (checkAdultDob) is still the one that
    // counts — this is only the earlier, friendlier half.
    if (needsDob && (!formData.date_of_birth || formData.date_of_birth > maxDOB)) {
      setError(t(formData.date_of_birth ? 'auth.register.validation.ageMin' : 'auth.register.validation.dobRequired'));
      return;
    }
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

  const interestsNeeded = Math.max(0, 3 - formData.interests.length);
  // Own interests first: appended at the END they landed below the fold
  // (under „Clubbing"), so adding one looked like nothing happened.
  const customInterests = formData.interests.filter(i => !INTEREST_OPTIONS.includes(i));
  const interestChips = [...customInterests, ...INTEREST_OPTIONS];

  return (
    <div className="onboarding-container">
      {/* Top bar: back · progress dots · step count */}
      <div className="ob-top">
        <button
          className="ob-back"
          onClick={handleBack}
          aria-label={t('common.back')}
          style={{ visibility: currentStep > 0 ? 'visible' : 'hidden' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="ob-dots" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`ob-dot${i === currentStep ? ' ob-dot--active' : i < currentStep ? ' ob-dot--done' : ''}`}
            />
          ))}
        </div>
        <span className="ob-step-count">
          {t('onboarding.stepCounter', { current: currentStep + 1, total: TOTAL_STEPS })}
        </span>
      </div>

      {/* key → each step mounts fresh and plays the enter animation */}
      <div className="onboarding-content ob-content" key={currentStep}>
        {/* Step 0: Gender */}
        {currentStep === 0 && (
          <div className="ob-step">
            <StepTitle line1={t('onboarding.gender.titleLine1')} line2={t('onboarding.gender.titleLine2')} />
            <p className="ob-sub">{t('onboarding.gender.subtitle')}</p>
            <div className="ob-choices" role="radiogroup">
              {GENDER_OPTION_KEYS.map(({ value, labelKey, icon }) => {
                const selected = formData.gender === value;
                return (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={selected}
                    className={`ob-choice${selected ? ' selected' : ''}`}
                    onClick={() => setFormData(prev => ({ ...prev, gender: value }))}
                  >
                    <span className="ob-choice-icon">{icon}</span>
                    <span className="ob-choice-label">{t(labelKey)}</span>
                    <span className="ob-choice-check"><CheckIcon /></span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 1: Basic profile */}
        {currentStep === 1 && (
          <div className="ob-step">
            <StepTitle line1={t('onboarding.profile.titleLine1')} line2={t('onboarding.profile.titleLine2')} />
            <p className="ob-sub">{t('onboarding.profile.subtitle')}</p>
            <div className="ob-form">
              <div className="ob-field">
                <label htmlFor="ob-location">{t('onboarding.profile.locationLabel')}</label>
                <div className="ob-input-wrap">
                  <span className="ob-input-icon"><PinIcon /></span>
                  <input
                    id="ob-location"
                    ref={locationRef}
                    type="text"
                    placeholder={t('onboarding.profile.locationPlaceholder')}
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
              </div>
              {needsDob && (
                <div className="ob-field">
                  <label htmlFor="ob-dob">{t('onboarding.profile.dobLabel')}</label>
                  <input
                    id="ob-dob"
                    type="date"
                    max={maxDOB}
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_of_birth: e.target.value }))}
                  />
                  {formData.date_of_birth && formData.date_of_birth > maxDOB && (
                    <p className="ob-field-error">{t('auth.register.validation.ageMin')}</p>
                  )}
                  <p className="ob-field-hint">{t('onboarding.profile.dobHint')}</p>
                </div>
              )}
              <div className="ob-field">
                <label htmlFor="ob-bio">{t('onboarding.profile.bioLabel')}</label>
                <textarea
                  id="ob-bio"
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
          <div className="ob-step">
            <StepTitle line1={t('onboarding.interests.titleLine1')} line2={t('onboarding.interests.titleLine2')} />
            <p className="ob-sub">{t('onboarding.interests.subtitle')}</p>

            <input
              className="ob-custom-input"
              type="text"
              enterKeyHint="done"
              maxLength={40}
              placeholder={t('onboarding.interests.customPlaceholder')}
              value={customInterest}
              onChange={(e) => setCustomInterest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomInterest(e)}
            />

            <div className="ob-chips">
              {interestChips.map(interest => {
                const selected = formData.interests.includes(interest);
                return (
                  <button
                    key={interest}
                    aria-pressed={selected}
                    className={`ob-chip${selected ? ' selected' : ''}`}
                    onClick={() => toggleInterest(interest)}
                  >
                    {selected && <CheckIcon />}
                    {interest}
                  </button>
                );
              })}
            </div>

            <p className={`ob-counter${interestsNeeded === 0 ? ' ob-counter--ok' : ''}`}>
              {t('onboarding.interests.counter', { count: formData.interests.length })}
              {interestsNeeded > 0 && ` ${t('onboarding.interests.needMore', { count: interestsNeeded })}`}
            </p>

            {/* Category suggestion */}
            <div className="ob-suggest">
              <p className="ob-suggest-prompt">{t('onboarding.interests.suggestPrompt')}</p>
              {suggestionSent ? (
                <p className="ob-suggest-thanks">{t('onboarding.interests.suggestThanks')}</p>
              ) : (
                <div className="ob-suggest-row">
                  <input
                    type="text"
                    placeholder={t('onboarding.interests.suggestPlaceholder')}
                    value={categorySuggestion}
                    onChange={(e) => setCategorySuggestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendCategorySuggestion(e)}
                  />
                  <button
                    onClick={sendCategorySuggestion}
                    disabled={!categorySuggestion.trim()}
                    className="ob-suggest-btn"
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
          <div className="ob-step">
            <StepTitle line1={t('onboarding.photos.titleLine1')} line2={t('onboarding.photos.titleLine2')} />
            <p className="ob-sub">{t('onboarding.photos.subtitle')}</p>
            <div className="ob-photos">
              {[...Array(6)].map((_, index) => {
                const photo = formData.photos[index];
                const isMain = photo && photo === formData.avatar_url;
                return (
                  <div
                    key={index}
                    className={`ob-photo${photo ? ' filled' : ''}${isMain ? ' main' : ''}${index === 0 ? ' first' : ''}`}
                    onClick={() => photo ? setMainPhoto(photo) : uploadTriggerRef.current?.()}
                  >
                    {photo ? (
                      <>
                        <img src={photo} alt="" decoding="async" />
                        {isMain && <div className="ob-photo-badge">{t('onboarding.photos.mainBadge')}</div>}
                        <button
                          className="ob-photo-remove"
                          aria-label="×"
                          onClick={(e) => { e.stopPropagation(); removePhoto(index); }}
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <span className="ob-photo-add" aria-hidden="true">+</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="ob-photo-upload">
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
          <div className="ob-step ob-step--done">
            <div className="ob-done-avatar">
              {formData.avatar_url ? (
                <img src={formData.avatar_url} alt="" decoding="async" />
              ) : (
                <span>{(user?.name || '?')[0].toUpperCase()}</span>
              )}
            </div>
            <h1 className="ob-title ob-title--center">
              <span className="ob-title-line ob-title-accent">{t('onboarding.done.title')}</span>
            </h1>
            <p className="ob-sub ob-sub--center">{t('onboarding.done.subtitle')}</p>

            <div className="ob-preview">
              {user?.name && <p className="ob-preview-name">{user.name}</p>}
              {formData.location && (
                <p className="ob-preview-location"><PinIcon size={14} /> {formData.location}</p>
              )}
              {formData.bio && <p className="ob-preview-bio">„{formData.bio}“</p>}
              {formData.interests.length > 0 && (
                <div className="ob-preview-chips">
                  {formData.interests.slice(0, 6).map(i => (
                    <span key={i} className="ob-preview-chip">{i}</span>
                  ))}
                  {formData.interests.length > 6 && (
                    <span className="ob-preview-more">+{formData.interests.length - 6}</span>
                  )}
                </div>
              )}
            </div>
            {error && <p className="error-message">{error}</p>}
          </div>
        )}
      </div>

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
