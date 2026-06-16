import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs, upload } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import { loadGoogleMaps, onGoogleMapsReady } from '../utils/googleMaps';
import { ImageCropModal } from '../components/ImageCropModal';
import '../styles/create.css';

export const CreateClub = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // Picked cover photo awaiting crop to the 16:9 banner frame.
  const [cropFile, setCropFile] = useState(null);

  const locationRef     = useRef(null);
  const autocompleteRef = useRef(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    mainCategory: '',
    category: '',
    location: '',
    // 'AT' only after the user picks an Austrian place from the autocomplete
    // dropdown. Manual edits to the location input clear it. step 2 advance
    // is blocked unless this is 'AT' — restricting the dropdown alone doesn't
    // stop someone typing/pasting a foreign address by hand.
    locationCountry: '',
    max_members: 50,
    is_public: true,
    requires_approval: false,
    rules: '',
    image_url: null,
    chat_only_owner: false,
    events_owner_only: true
  });

  const [imagePreview, setImagePreview] = useState(null);
  const imageBlobRef = useRef(null);

  useEffect(() => {
    return () => { if (imageBlobRef.current) URL.revokeObjectURL(imageBlobRef.current); };
  }, []);

  // Start loading the Google Maps script (with places library) on mount so
  // it's ready by the time the user reaches the Standort field on step 2.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);

  // Attach Places Autocomplete to the Standort input once it renders.
  // Restricted to Austria — clubs are an Austrian product for now.
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
          toast.error(t('createClub.step2.locationNotATError'));
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
      // Manual edits to the location field invalidate the verified-AT flag
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
      toast.error(t('createClub.imageTooLarge'));
      return;
    }

    // Let the user frame it in the 16:9 banner before uploading.
    setCropFile(file);
  };

  const uploadCover = async (file) => {
    if (imageBlobRef.current) URL.revokeObjectURL(imageBlobRef.current);
    const blobUrl = URL.createObjectURL(file);
    imageBlobRef.current = blobUrl;
    setImagePreview(blobUrl);
    setUploading(true);

    try {
      const res = await upload.image(file);
      setFormData(prev => ({ ...prev, image_url: res.data.url }));
    } catch (err) {
      setError(t('createClub.imageUploadError'));
      toast.error(t('createClub.imageUploadError'));
      // Clear the phantom preview so the user doesn't believe a failed upload
      // attached — formData.image_url stayed null, so the club would be created
      // imageless while the tile still showed the photo.
      if (imageBlobRef.current) { URL.revokeObjectURL(imageBlobRef.current); imageBlobRef.current = null; }
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      // Map frontend field names to backend field names
      const response = await clubs.create({
        name: formData.title,
        description: formData.description,
        category: formData.category,
        location: formData.location,
        max_members: formData.max_members,
        is_private: !formData.is_public,
        image_url: formData.image_url,
        chat_only_owner: formData.chat_only_owner,
        events_owner_only: formData.events_owner_only,
        type: 'club'
      });

      // Backend stamps approval_status='pending' for non-admin owners.
      // Route them home with an explanatory toast instead of into the
      // newly-created (but invisible to everyone else) club detail page.
      // replace, don't push: the create flow must not stay in the history —
      // back on the destination page should lead home, not into the wizard.
      if (response.data?.approval_status === 'pending') {
        toast.success(t('createClub.pendingToast'));
        navigate('/home', { replace: true });
      } else {
        navigate(`/group/${response.data.id}`, { replace: true });
      }
    } catch (err) {
      const msg = err.response?.data?.error || t('createClub.createError');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch(step) {
      case 1: return formData.title.trim() && formData.mainCategory && formData.category && !uploading;
      case 2: return formData.location.trim() && formData.locationCountry === 'AT';
      case 3: return true;
      default: return false;
    }
  };

  return (
    // NOT className="page" — see CreateGroup: .page + .create-header would
    // double-count the safe-area inset and leave a dead band above the header.
    <div className="create-page">
      {/* Header */}
      <div className="create-header">
        {/* create-back-btn (create.css) — "back-btn" exists in no stylesheet
            this page loads; CreateGroup uses the styled circle button. */}
        <button className="create-back-btn" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="create-title">{t('createClub.title')}</h1>
        <div className="step-indicator">{t('createClub.stepFmt', { current: step })}</div>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {error && <div className="error-message">⚠️ {error}</div>}

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">{t('createClub.step1.nameLabel')}</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              placeholder={t('createClub.step1.namePlaceholder')}
              className="input"
              maxLength={100}
            />
          </div>

          <div className="form-section">
            <label className="form-label">{t('createClub.step1.categoryLabel')}</label>
            <div className="main-category-grid">
              {CATEGORY_HIERARCHY.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  className={`main-category-chip ${formData.mainCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, mainCategory: cat.id, category: '' }))}
                >
                  <span className="chip-icon">{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {formData.mainCategory && (
            <div className="form-section">
              <label className="form-label">{t('createClub.step1.subCategoryLabel')}</label>
              <div className="category-grid">
                {CATEGORY_HIERARCHY.find(c => c.id === formData.mainCategory)?.subs.map(sub => (
                  <button
                    key={sub.name}
                    type="button"
                    className={`category-chip ${formData.category === sub.name ? 'active' : ''}`}
                    onClick={() => setFormData(prev => ({ ...prev, category: sub.name }))}
                  >
                    <span className="chip-icon">{sub.icon}</span>
                    <span>{sub.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-section">
            <label className="form-label">{t('createClub.step1.descLabel')}</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder={t('createClub.step1.descPlaceholder')}
              className="input textarea"
              rows={4}
            />
          </div>

          <div className="form-section">
            <label className="form-label">{t('createClub.step1.imageLabel')}</label>
            <div className="image-upload-area">
              {imagePreview ? (
                <div className="image-preview">
                  <img src={imagePreview} alt="" decoding="async" />
                  <button className="remove-image" onClick={() => { if (imageBlobRef.current) { URL.revokeObjectURL(imageBlobRef.current); imageBlobRef.current = null; } setImagePreview(null); setFormData(prev => ({ ...prev, image_url: null })); }}>×</button>
                </div>
              ) : (
                <label className="upload-placeholder">
                  <input type="file" accept="image/*" onChange={handleImageUpload} hidden disabled={uploading} />
                  <span className="upload-icon">🏆</span>
                  <span>{uploading ? t('createClub.step1.uploading') : t('createClub.step1.addImage')}</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Settings */}
      {step === 2 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">{t('createClub.step2.locationLabel')}</label>
            <input
              ref={locationRef}
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              placeholder={t('createClub.step2.locationPlaceholder')}
              className="input"
              autoComplete="off"
            />
            <p className="form-hint">{t('createClub.step2.locationOnlyATHint')}</p>
          </div>

          <div className="form-section">
            <label className="form-label">{t('createClub.step2.maxLabel')}</label>
            <div className="counter-input">
              <button type="button" className="counter-btn" onClick={() => setFormData(prev => ({ ...prev, max_members: Math.max(5, prev.max_members - 5) }))}>−</button>
              <span className="counter-value">{formData.max_members}</span>
              <button type="button" className="counter-btn" onClick={() => setFormData(prev => ({ ...prev, max_members: Math.min(500, prev.max_members + 5) }))}>+</button>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">{t('createClub.step2.visibilityLabel')}</label>
            <div className="visibility-toggle">
              <button
                type="button"
                className={`visibility-option ${formData.is_public ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, is_public: true, requires_approval: false }))}
              >
                <span className="visibility-icon">🌍</span>
                <div className="visibility-text">
                  <span className="visibility-title">{t('createClub.step2.public')}</span>
                  <span className="visibility-desc">{t('createClub.step2.publicDesc')}</span>
                </div>
              </button>
              <button
                type="button"
                className={`visibility-option ${!formData.is_public ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, is_public: false, requires_approval: true }))}
              >
                <span className="visibility-icon">🔒</span>
                <div className="visibility-text">
                  <span className="visibility-title">{t('createClub.step2.private')}</span>
                  <span className="visibility-desc">{t('createClub.step2.privateDesc')}</span>
                </div>
              </button>
            </div>
          </div>

          {/* Regeln textarea removed 2026-06: the value was collected into
              formData.rules but never sent to the backend (no rules column),
              so users lost what they typed. Re-add as a real feature (rules
              column + createClub/updateClub + ClubDetail render) when wanted. */}

          <div className="form-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-white)', marginBottom: 2 }}>
                {t('createClub.step2.chatTitle')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formData.chat_only_owner ? t('createClub.step2.chatOwnerOnly') : t('createClub.step2.chatAll')}
              </div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={formData.chat_only_owner}
                onChange={(e) => setFormData(prev => ({ ...prev, chat_only_owner: e.target.checked }))}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>

          <div className="form-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-white)', marginBottom: 2 }}>
                {t('createClub.step2.eventsTitle')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formData.events_owner_only ? t('createClub.step2.eventsOwnerOnly') : t('createClub.step2.eventsAll')}
              </div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={formData.events_owner_only}
                onChange={(e) => setFormData(prev => ({ ...prev, events_owner_only: e.target.checked }))}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && (
        <div className="create-content">
          <h2 className="preview-title">{t('createClub.step3.title')}</h2>

          <div className="preview-card">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="preview-image" decoding="async" />
            ) : (
              <div className="preview-image-placeholder"><span>🏆</span></div>
            )}

            <div className="preview-content">
              <div className="preview-badges">
                <span className="preview-badge type">{t('createClub.step3.clubBadge')}</span>
                {formData.category && <span className="preview-badge category">{formData.category}</span>}
                {!formData.is_public && <span className="preview-badge private">{t('createClub.step3.privateBadge')}</span>}
              </div>

              <h3 className="preview-name">{formData.title || t('createClub.step3.fallbackName')}</h3>

              <div className="preview-details">
                <div className="preview-detail">
                  <span className="detail-icon">📍</span>
                  <span>{formData.location || t('createClub.step3.fallbackLocation')}</span>
                </div>
                <div className="preview-detail">
                  <span className="detail-icon">👥</span>
                  <span>{t('createClub.step3.membersMaxFmt', { count: formData.max_members })}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="create-footer">
        {step < 3 ? (
          <button className="btn btn-primary btn-block" onClick={() => setStep(step + 1)} disabled={!canProceed()}>
            {t('createClub.next')}
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={handleSubmit} disabled={loading}>
            {loading ? t('createClub.submitting') : t('createClub.submit')}
          </button>
        )}
      </div>

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          aspect={16 / 9}
          onConfirm={(cropped) => { setCropFile(null); uploadCover(cropped); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
};export default CreateClub;
