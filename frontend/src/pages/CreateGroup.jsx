import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, api as axiosInstance } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import { loadGoogleMaps, onGoogleMapsReady } from '../utils/googleMaps';
import { ImageCropModal } from '../components/ImageCropModal';
import '../styles/create.css';

const LEVELS = [
  { value: 'Anfänger',        key: 'beginner' },
  { value: 'Alle Levels',     key: 'all' },
  { value: 'Fortgeschritten', key: 'advanced' },
  { value: 'Experte',         key: 'expert' },
];

export const CreateGroup = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-AT';
  const months = t('profileEdit.months', { returnObjects: true });
  const imageBlobRef    = useRef(null);
  const locationRef     = useRef(null);
  const autocompleteRef = useRef(null);

  // State — declared before all useEffects
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Picked cover photo awaiting crop to the 16:9 banner frame.
  const [cropFile, setCropFile] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    mainCategory: '',
    activity: '',
    description: '',
    date: '',
    dateDay: '',
    dateMonth: '',
    dateYear: '',
    // The exact time is decided in the chat — Tina's call. We keep only the
    // calendar day and let members coordinate the rest. The backend tolerates
    // date-only payloads (no `time` key sent → stored as midnight).
    location: '',
    // Set to 'AT' only when the user picks a place from the Google
    // autocomplete dropdown that resolves to Austria. Any manual edit to the
    // location field clears it. step 2 advance is blocked unless this is 'AT'
    // — that gives a hard guarantee, since restricting the dropdown alone
    // doesn't stop someone typing/pasting a foreign address by hand.
    locationCountry: '',
    maxMembers: 20,
    level: 'Alle Levels',
    isPublic: true,
    // Default target age range — Tina's call (2026-06-09): most JAMIE events
    // skew 20-35, so pre-filling reduces friction for the typical creator.
    // Users can clear the fields if they don't want an age restriction.
    targetAgeMin: '20',
    targetAgeMax: '35',
    image: null,
    imagePreview: null,
  });

  // Skill level only makes sense for sport — a Bar-Hopping or Brunch group has
  // no "Anfänger/Experte". Show the picker (and submit a real level) only for
  // the Sport category; everything else stays 'Alle Levels' (hidden everywhere).
  const showLevel = formData.mainCategory === 'sport';

  const handleDateChange = (field, value) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      const d = field === 'dateDay'   ? value : next.dateDay;
      const m = field === 'dateMonth' ? value : next.dateMonth;
      const y = field === 'dateYear'  ? value : next.dateYear;
      const date = d && m && y ? `${y}-${m}-${d}` : '';
      return { ...next, date };
    });
  };

  useEffect(() => {
    return () => { if (imageBlobRef.current) URL.revokeObjectURL(imageBlobRef.current); };
  }, []);

  // Start loading the Google Maps script immediately on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);

  // Attach autocomplete once the location input is rendered (step 2)
  useEffect(() => {
    if (step !== 2) return;

    const attach = () => {
      if (!window.google?.maps?.places) return;
      if (autocompleteRef.current) return;
      if (!locationRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(locationRef.current, {
        componentRestrictions: { country: ['at'] },
        fields: ['formatted_address', 'name', 'address_components'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || '';
        const countryComp = (place.address_components || []).find(c => c.types?.includes('country'));
        const country = countryComp?.short_name || '';
        if (val && country === 'AT') {
          setFormData(prev => ({ ...prev, location: val, locationCountry: 'AT' }));
        } else if (val) {
          // componentRestrictions usually prevents this, but Place IDs can
          // still resolve outside the restriction in edge cases — refuse them.
          toast.error(t('createGroup.step2.locationNotATError'));
          setFormData(prev => ({ ...prev, location: '', locationCountry: '' }));
          if (locationRef.current) locationRef.current.value = '';
        }
      });
      autocompleteRef.current = ac;
    };

    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    return () => clearTimeout(timer);
  }, [step]);


  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      // Any manual edit to the location field invalidates the verified-AT flag
      // — user has to re-pick from the dropdown to advance.
      if (name === 'location') next.locationCountry = '';
      return next;
    });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('createGroup.imageTooLarge'));
      return;
    }
    // Crop to the 16:9 banner before storing it for upload at submit.
    setCropFile(file);
  };

  const applyCover = (file) => {
    if (imageBlobRef.current) URL.revokeObjectURL(imageBlobRef.current);
    const blobUrl = URL.createObjectURL(file);
    imageBlobRef.current = blobUrl;
    setFormData(prev => ({ ...prev, image: file, imagePreview: blobUrl }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      // Step 1: upload image first if selected
      let imageUrl = null;
      if (formData.image) {
        const uploadData = new FormData();
        uploadData.append('image', formData.image);
        const uploadRes = await axiosInstance.post('/upload', uploadData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        imageUrl = uploadRes.data.url;
        if (!imageUrl) throw new Error(t('createGroup.imageUploadError'));
      }

      // Step 2: create group as JSON
      const payload = {
        name: formData.name,
        category: formData.activity,
        description: formData.description,
        date: formData.date,
        location: formData.location,
        max_members: formData.maxMembers,
        skill_level: showLevel ? formData.level : 'Alle Levels',
        is_private: !formData.isPublic,
        type: 'group',
        image_url: imageUrl,
        target_age_min: formData.targetAgeMin === '' ? null : parseInt(formData.targetAgeMin, 10),
        target_age_max: formData.targetAgeMax === '' ? null : parseInt(formData.targetAgeMax, 10),
        // Weekly repetition is a club-events-only feature now (Tina, 2026-06-11):
        // standalone groups never repeat. We send false explicitly so the
        // backend never reads an undefined field as truthy.
        is_recurring_weekly: false,
      };

      const response = await groups.create(payload);
      // replace, don't push: the create flow must not stay in the history —
      // back on the new group's page should lead home, not into the wizard.
      navigate(`/group/${response.data.id}`, { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || err.message || t('createGroup.createError');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const isDateInFuture = () => {
    if (!formData.date) return true;
    // Date-only events: "today" is valid. Compare YYYY-MM-DD against today's
    // YYYY-MM-DD so a user creating a group on the day-of doesn't get blocked.
    const todayStr = new Date().toISOString().slice(0, 10);
    return formData.date >= todayStr;
  };

  // The day select always offers 01–31, so impossible combos (31 Sept, 30 Feb)
  // can be assembled. Re-construct via the local Date constructor and confirm
  // each component round-trips (tz-safe: local constructor + local getters).
  const isValidCalendarDate = () => {
    if (!formData.date) return true;
    const [y, m, d] = formData.date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  };

  // Optional target-age range — both empty is fine; otherwise both must be
  // 14–99 and min ≤ max. Mirrors the backend so it can't fail only at submit.
  const ageRangeValid = () => {
    const min = formData.targetAgeMin === '' || formData.targetAgeMin == null ? null : Number(formData.targetAgeMin);
    const max = formData.targetAgeMax === '' || formData.targetAgeMax == null ? null : Number(formData.targetAgeMax);
    if (min == null && max == null) return true;
    if (min == null || max == null) return false;
    if (Number.isNaN(min) || Number.isNaN(max)) return false;
    return min >= 14 && max <= 99 && min <= max;
  };

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name && formData.mainCategory && formData.activity;
      case 2: return formData.date && formData.location && formData.locationCountry === 'AT'
        && isDateInFuture() && isValidCalendarDate() && ageRangeValid();
      case 3: return true;
      default: return false;
    }
  };

  const dateError = step === 2 && formData.date && !isValidCalendarDate()
    ? t('createGroup.step2.dateInvalid')
    : step === 2 && formData.date && !isDateInFuture()
    ? t('groups.detail.events.errorDateFuture')
    : step === 2 && !ageRangeValid()
    ? t('createGroup.step2.ageRangeInvalid')
    : '';

  const stepLabels = t('createGroup.stepsTitles', { returnObjects: true });

  return (
    // NOT className="page": .page adds its own safe-area top padding and the
    // .create-header inside adds another — stacked, that pushed the header
    // ~150pt down the screen (huge dead band above "Gruppe erstellen").
    <div className="create-page">

      {/* Header */}
      <div className="create-header">
        <button className="create-back-btn" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="create-header-center">
          <h1 className="create-title">{t('createGroup.title')}</h1>
          <p className="create-subtitle">{stepLabels[step - 1]}</p>
        </div>
        <div className="create-step-badge">{t('createGroup.stepFmt', { current: step })}</div>
      </div>

      {/* Progress Steps */}
      <div className="create-steps">
        {stepLabels.map((label, i) => (
          <React.Fragment key={i}>
            <div className={`create-step ${i + 1 < step ? 'done' : ''} ${i + 1 === step ? 'active' : ''}`}>
              <div className="create-step-dot">
                {i + 1 < step ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span className="create-step-label">{label}</span>
            </div>
            {i < stepLabels.length - 1 && (
              <div className={`create-step-line ${i + 1 < step ? 'done' : ''}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Step 1 */}
      {step === 1 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">✏️</span> {t('createGroup.step1.titleLabel')}
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder={t('createGroup.step1.titlePlaceholder')}
              className="input"
              maxLength={100}
            />
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">🏷️</span> {t('createGroup.step1.categoryLabel')}
            </label>
            <div className="main-category-grid">
              {CATEGORY_HIERARCHY.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  className={`main-category-chip ${formData.mainCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, mainCategory: cat.id, activity: '' }))}
                >
                  <span className="chip-icon">{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {formData.mainCategory && (
            <div className="form-section">
              <label className="form-label">
                <span className="form-label-icon">🎯</span> {t('createGroup.step1.subCategoryLabel')}
              </label>
              <div className="activity-grid">
                {CATEGORY_HIERARCHY.find(c => c.id === formData.mainCategory)?.subs.map(sub => (
                  <button
                    key={sub.name}
                    type="button"
                    className={`activity-chip ${formData.activity === sub.name ? 'active' : ''}`}
                    onClick={() => setFormData(prev => ({ ...prev, activity: sub.name }))}
                  >
                    {sub.icon} {sub.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">📝</span> {t('createGroup.step1.descLabel')}
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder={t('createGroup.step1.descPlaceholder')}
              className="input textarea"
              rows={4}
            />
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">📸</span> {t('createGroup.step1.imageLabel')}
            </label>
            <div className="image-upload-area">
              {formData.imagePreview ? (
                <div className="image-preview">
                  <img src={formData.imagePreview} alt="" decoding="async" />
                  <button
                    className="remove-image"
                    onClick={() => {
                      if (imageBlobRef.current) { URL.revokeObjectURL(imageBlobRef.current); imageBlobRef.current = null; }
                      setFormData(prev => ({ ...prev, image: null, imagePreview: null }));
                    }}
                  >×</button>
                </div>
              ) : (
                <label className="upload-placeholder">
                  <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                  <div className="upload-icon-wrapper">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="3"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  </div>
                  <span className="upload-label-text">{t('createGroup.step1.addImage')}</span>
                  <span className="upload-label-hint">{t('createGroup.step1.imageHint')}</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="create-content">
          {dateError && <div className="error-message" style={{ marginBottom: 12 }}>{dateError}</div>}

          {/* Date */}
          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">📅</span> {t('createGroup.step2.whenLabel')}
            </label>
            <div className="time-picker-box">
              <div className="time-picker-col">
                <select
                  className="time-picker-select"
                  value={formData.dateDay}
                  onChange={e => handleDateChange('dateDay', e.target.value)}
                >
                  <option value="">--</option>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <span className="time-picker-label">{t('createGroup.step2.day')}</span>
              </div>
              <span className="time-picker-colon">.</span>
              <div className="time-picker-col time-picker-col--wide">
                <select
                  className="time-picker-select"
                  value={formData.dateMonth}
                  onChange={e => handleDateChange('dateMonth', e.target.value)}
                >
                  <option value="">--</option>
                  {months.map((m, i) => (
                    <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
                  ))}
                </select>
                <span className="time-picker-label">{t('createGroup.step2.month')}</span>
              </div>
              <span className="time-picker-colon">.</span>
              <div className="time-picker-col">
                <select
                  className="time-picker-select time-picker-select--year"
                  value={formData.dateYear}
                  onChange={e => handleDateChange('dateYear', e.target.value)}
                >
                  <option value="">----</option>
                  {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <span className="time-picker-label">{t('createGroup.step2.year')}</span>
              </div>
            </div>
          </div>

          {/* Time picker removed (2026-06-09): exact times are coordinated in
              the group chat, so the form just captures the calendar day. */}

          <p className="form-hint-row">{t('createGroup.step2.timeInChatHint')}</p>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">📍</span> {t('createGroup.step2.locationLabel')}
            </label>
            <input
              ref={locationRef}
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              placeholder={t('createGroup.step2.locationPlaceholder')}
              className="input"
              autoComplete="off"
            />
            <p className="form-hint">{t('createGroup.step2.locationOnlyATHint')}</p>
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">👥</span> {t('createGroup.step2.maxLabel')}
            </label>
            <div className="counter-input">
              <button
                type="button"
                className="counter-btn"
                onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.max(2, prev.maxMembers - 1) }))}
              >−</button>
              <div className="counter-display">
                <span className="counter-value">{formData.maxMembers}</span>
                <span className="counter-unit">{t('createGroup.step2.peopleUnit')}</span>
              </div>
              <button
                type="button"
                className="counter-btn"
                onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.min(20, prev.maxMembers + 1) }))}
              >+</button>
            </div>
          </div>

          {showLevel && (
            <div className="form-section">
              <label className="form-label">
                <span className="form-label-icon">⚡</span> {t('createGroup.step2.levelLabel')}
              </label>
              <div className="level-options">
                {LEVELS.map(({ value, key }) => (
                  <button
                    key={key}
                    className={`level-chip ${formData.level === value ? 'active' : ''}`}
                    onClick={() => setFormData(prev => ({ ...prev, level: value }))}
                  >
                    {t(`createGroup.step2.levels.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">🎯</span> {t('createGroup.step2.ageLabel')}
            </label>
            <p className="form-hint">{t('createGroup.step2.ageHint')}</p>
            <div className="age-range-row">
              <div className="age-range-input-wrap">
                <input
                  type="number"
                  inputMode="numeric"
                  min={14}
                  max={99}
                  placeholder={t('createGroup.step2.ageFromPlaceholder')}
                  value={formData.targetAgeMin}
                  onChange={(e) => setFormData(prev => ({ ...prev, targetAgeMin: e.target.value }))}
                  className="input age-range-input"
                />
                <span className="age-range-label">{t('createGroup.step2.ageFromLabel')}</span>
              </div>
              <span className="age-range-separator">–</span>
              <div className="age-range-input-wrap">
                <input
                  type="number"
                  inputMode="numeric"
                  min={14}
                  max={99}
                  placeholder={t('createGroup.step2.ageToPlaceholder')}
                  value={formData.targetAgeMax}
                  onChange={(e) => setFormData(prev => ({ ...prev, targetAgeMax: e.target.value }))}
                  className="input age-range-input"
                />
                <span className="age-range-label">{t('createGroup.step2.ageToLabel')}</span>
              </div>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">🔒</span> {t('createGroup.step2.visibilityLabel')}
            </label>
            <div className="visibility-toggle">
              <button
                className={`visibility-option ${formData.isPublic ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isPublic: true }))}
              >
                <span className="visibility-icon">🌍</span>
                <div className="visibility-text">
                  <span className="visibility-title">{t('createGroup.step2.public')}</span>
                  <span className="visibility-desc">{t('createGroup.step2.publicDesc')}</span>
                </div>
              </button>
              <button
                className={`visibility-option ${!formData.isPublic ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isPublic: false }))}
              >
                <span className="visibility-icon">🔒</span>
                <div className="visibility-text">
                  <span className="visibility-title">{t('createGroup.step2.private')}</span>
                  <span className="visibility-desc">{t('createGroup.step2.privateDesc')}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Preview */}
      {step === 3 && (
        <div className="create-content">
          <p className="preview-intro">{t('createGroup.step3.title')} 👀</p>
          <div className="preview-card">
            {formData.imagePreview ? (
              <img src={formData.imagePreview} alt="" className="preview-image" decoding="async" />
            ) : (
              <div className="preview-image-placeholder">🏃</div>
            )}
            <div className="preview-content">
              <div className="preview-badges">
                <span className="preview-badge type">{t('map.popupGroup')}</span>
                {formData.activity && <span className="preview-badge category">{formData.activity}</span>}
                {!formData.isPublic && <span className="preview-badge private">{t('createGroup.step3.privateBadge')}</span>}
              </div>
              <h4 className="preview-name">{formData.name || t('createGroup.step3.fallbackTitle')}</h4>
              {formData.description && <p className="preview-desc">{formData.description}</p>}
              <div className="preview-details">
                {formData.date && <span className="preview-detail">📅 {new Date(formData.date).toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })}{formData.time ? ` · ${formData.time} ${t('createGroup.step2.uhr')}` : ''}</span>}
                {formData.location && <span className="preview-detail">📍 {formData.location}</span>}
                <span className="preview-detail">👥 {t('createGroup.step3.participantsFmt', { count: formData.maxMembers })}</span>
                {showLevel && <span className="preview-detail">⚡ {t(`createGroup.step2.levels.${(LEVELS.find(l => l.value === formData.level) || { key: 'all' }).key}`)}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="create-footer">
        {step < 3 ? (
          <button
            className="btn btn-primary btn-block"
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
          >
            {t('createGroup.next')}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        ) : (
          <button
            className="btn btn-primary btn-block"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? t('createGroup.submitting') : t('createGroup.submit')}
          </button>
        )}
      </div>

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          aspect={16 / 9}
          onConfirm={(cropped) => { setCropFile(null); applyCover(cropped); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
};

export default CreateGroup;
