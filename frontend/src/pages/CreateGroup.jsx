import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, api as axiosInstance } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import '../styles/create.css';

export const CreateGroup = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const imageBlobRef = useRef(null);

  useEffect(() => {
    return () => { if (imageBlobRef.current) URL.revokeObjectURL(imageBlobRef.current); };
  }, []);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    mainCategory: '',
    activity: '',
    description: '',
    date: '',
    time: '',
    location: '',
    maxMembers: 4,
    level: 'Alle Levels',
    isPublic: true,
    image: null,
    imagePreview: null
  });


  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (imageBlobRef.current) URL.revokeObjectURL(imageBlobRef.current);
      const blobUrl = URL.createObjectURL(file);
      imageBlobRef.current = blobUrl;
      setFormData(prev => ({ ...prev, image: file, imagePreview: blobUrl }));
    }
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
      }

      // Step 2: create group as JSON
      const payload = {
        name: formData.name,
        category: formData.activity,
        description: formData.description,
        date: formData.date,
        time: formData.time,
        location: formData.location,
        max_members: formData.maxMembers,
        skill_level: formData.level,
        is_private: !formData.isPublic,
        type: 'group',
        image_url: imageUrl,
      };

      const response = await groups.create(payload);
      navigate(`/group/${response.data.id}`);
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.error || err.message || 'Fehler beim Erstellen der Gruppe';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1: return formData.name && formData.mainCategory && formData.activity;
      case 2: return formData.date && formData.location;
      case 3: return true;
      default: return false;
    }
  };

  const stepLabels = ['Details', 'Wann & Wo', 'Vorschau'];

  return (
    <div className="page create-page">

      {/* Header */}
      <div className="create-header">
        <button className="create-back-btn" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="create-header-center">
          <h1 className="create-title">Gruppe erstellen</h1>
          <p className="create-subtitle">{stepLabels[step - 1]}</p>
        </div>
        <div className="create-step-badge">{step}/3</div>
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
              <span className="form-label-icon">✏️</span> Titel deiner Aktivität
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="z.B. Volleyball am Strand"
              className="input"
            />
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">🏷️</span> Hauptkategorie
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
                <span className="form-label-icon">🎯</span> Aktivität
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
              <span className="form-label-icon">📝</span> Beschreibung
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Erzähl etwas über deine Aktivität..."
              className="input textarea"
              rows={4}
            />
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">📸</span> Titelbild
            </label>
            <div className="image-upload-area">
              {formData.imagePreview ? (
                <div className="image-preview">
                  <img src={formData.imagePreview} alt="Vorschau" />
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
                  <span className="upload-label-text">Bild auswählen</span>
                  <span className="upload-label-hint">JPG, PNG oder HEIC · max. 10MB</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="create-content">
          <div className="form-row">
            <div className="form-section">
              <label className="form-label">
                <span className="form-label-icon">📅</span> Datum
              </label>
              <input
                type="date"
                name="date"
                value={formData.date}
                onChange={handleInputChange}
                className="input"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="form-section">
              <label className="form-label">
                <span className="form-label-icon">🕐</span> Uhrzeit
              </label>
              <input
                type="time"
                name="time"
                value={formData.time}
                onChange={handleInputChange}
                className="input"
              />
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">📍</span> Ort
            </label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              placeholder="z.B. Wien, Donauinsel"
              className="input"
            />
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">👥</span> Maximale Teilnehmer
            </label>
            <div className="counter-input">
              <button
                type="button"
                className="counter-btn"
                onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.max(2, prev.maxMembers - 1) }))}
              >−</button>
              <div className="counter-display">
                <span className="counter-value">{formData.maxMembers}</span>
                <span className="counter-unit">Personen</span>
              </div>
              <button
                type="button"
                className="counter-btn"
                onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.min(20, prev.maxMembers + 1) }))}
              >+</button>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">⚡</span> Niveau
            </label>
            <div className="level-options">
              {['Anfänger', 'Alle Levels', 'Fortgeschritten', 'Experte'].map(level => (
                <button
                  key={level}
                  className={`level-chip ${formData.level === level ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, level }))}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">
              <span className="form-label-icon">🔒</span> Sichtbarkeit
            </label>
            <div className="visibility-toggle">
              <button
                className={`visibility-option ${formData.isPublic ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isPublic: true }))}
              >
                <span className="visibility-icon">🌍</span>
                <div className="visibility-text">
                  <span className="visibility-title">Öffentlich</span>
                  <span className="visibility-desc">Jeder kann beitreten</span>
                </div>
              </button>
              <button
                className={`visibility-option ${!formData.isPublic ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isPublic: false }))}
              >
                <span className="visibility-icon">🔒</span>
                <div className="visibility-text">
                  <span className="visibility-title">Privat</span>
                  <span className="visibility-desc">Nur mit Anfrage</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Preview */}
      {step === 3 && (
        <div className="create-content">
          <p className="preview-intro">So sieht deine Gruppe aus 👀</p>
          <div className="preview-card">
            {formData.imagePreview ? (
              <img src={formData.imagePreview} alt="Vorschau" className="preview-image" />
            ) : (
              <div className="preview-image-placeholder">🏃</div>
            )}
            <div className="preview-content">
              <div className="preview-badges">
                <span className="preview-badge type">Gruppe</span>
                {formData.activity && <span className="preview-badge category">{formData.activity}</span>}
                {!formData.isPublic && <span className="preview-badge private">🔒 Privat</span>}
              </div>
              <h4 className="preview-name">{formData.name || 'Kein Titel'}</h4>
              {formData.description && <p className="preview-desc">{formData.description}</p>}
              <div className="preview-details">
                {formData.date && <span className="preview-detail">📅 {new Date(formData.date).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })}{formData.time ? ` · ${formData.time} Uhr` : ''}</span>}
                {formData.location && <span className="preview-detail">📍 {formData.location}</span>}
                <span className="preview-detail">👥 max. {formData.maxMembers} Personen</span>
                <span className="preview-detail">⚡ {formData.level}</span>
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
            Weiter
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
            {loading ? 'Erstelle...' : '🚀 Gruppe erstellen'}
          </button>
        )}
      </div>
    </div>
  );
};

export default CreateGroup;
