import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, upload } from '../utils/api';
import '../styles/create.css';

const CLUB_CATEGORIES = [
  { name: 'Sport', icon: '⚽' },
  { name: 'Fitness', icon: '💪' },
  { name: 'Outdoor', icon: '🏕️' },
  { name: 'Musik', icon: '🎵' },
  { name: 'Kunst', icon: '🎨' },
  { name: 'Gaming', icon: '🎮' },
  { name: 'Kochen', icon: '👨‍🍳' },
  { name: 'Bücher', icon: '📚' },
  { name: 'Film', icon: '🎬' },
  { name: 'Reisen', icon: '✈️' },
  { name: 'Tech', icon: '💻' },
  { name: 'Fotografie', icon: '📷' },
  { name: 'Sprachen', icon: '🗣️' },
  { name: 'Tanzen', icon: '💃' },
  { name: 'Wellness', icon: '🧘' }
];

export const CreateClub = () => {
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    location: '',
    max_members: 50,
    is_public: true,
    requires_approval: false,
    meeting_frequency: 'weekly',
    rules: '',
    image_url: null
  });

  const [imagePreview, setImagePreview] = useState(null);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImagePreview(URL.createObjectURL(file));
    setUploading(true);
    
    try {
      const res = await upload.image(file);
      setFormData(prev => ({ ...prev, image_url: res.data.url }));
    } catch (err) {
      setError('Bild konnte nicht hochgeladen werden');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await groups.create({
        ...formData,
        type: 'club'
      });
      
      navigate(`/group/${response.data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Erstellen');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch(step) {
      case 1: return formData.title.trim() && formData.category;
      case 2: return formData.location.trim();
      case 3: return true;
      default: return false;
    }
  };

  return (
    <div className="page create-page">
      {/* Header */}
      <div className="create-header">
        <button className="back-btn" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="create-title">Club gründen</h1>
        <div className="step-indicator">{step}/3</div>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {error && <div className="error-message">⚠️ {error}</div>}

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">Club Name *</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              placeholder="z.B. Wiener Wanderfreunde"
              className="input"
              maxLength={100}
            />
          </div>

          <div className="form-section">
            <label className="form-label">Kategorie *</label>
            <div className="category-grid">
              {CLUB_CATEGORIES.map(({ name, icon }) => (
                <button
                  key={name}
                  type="button"
                  className={`category-chip ${formData.category === name ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, category: name }))}
                >
                  <span className="chip-icon">{icon}</span>
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Beschreibung</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Worum geht es in deinem Club?"
              className="input textarea"
              rows={4}
            />
          </div>

          <div className="form-section">
            <label className="form-label">Club Bild</label>
            <div className="image-upload-area">
              {imagePreview ? (
                <div className="image-preview">
                  <img src={imagePreview} alt="Preview" />
                  <button className="remove-image" onClick={() => { setImagePreview(null); setFormData(prev => ({ ...prev, image_url: null })); }}>×</button>
                </div>
              ) : (
                <label className="upload-placeholder">
                  <input type="file" accept="image/*" onChange={handleImageUpload} hidden disabled={uploading} />
                  <span className="upload-icon">🏆</span>
                  <span>{uploading ? 'Lädt...' : 'Bild hinzufügen'}</span>
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
            <label className="form-label">Standort *</label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              placeholder="z.B. Wien"
              className="input"
            />
          </div>

          <div className="form-section">
            <label className="form-label">Maximale Mitglieder</label>
            <div className="counter-input">
              <button type="button" className="counter-btn" onClick={() => setFormData(prev => ({ ...prev, max_members: Math.max(5, prev.max_members - 5) }))}>−</button>
              <span className="counter-value">{formData.max_members}</span>
              <button type="button" className="counter-btn" onClick={() => setFormData(prev => ({ ...prev, max_members: Math.min(500, prev.max_members + 5) }))}>+</button>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Treffhäufigkeit</label>
            <div className="level-options">
              {[
                { value: 'daily', label: 'Täglich' },
                { value: 'weekly', label: 'Wöchentlich' },
                { value: 'monthly', label: 'Monatlich' },
                { value: 'flexible', label: 'Flexibel' }
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`level-chip ${formData.meeting_frequency === value ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, meeting_frequency: value }))}
                >
                  <span className="level-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Sichtbarkeit</label>
            <div className="visibility-toggle">
              <button
                type="button"
                className={`visibility-option ${formData.is_public ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, is_public: true, requires_approval: false }))}
              >
                <span className="visibility-icon">🌍</span>
                <div className="visibility-text">
                  <span className="visibility-title">Öffentlich</span>
                  <span className="visibility-desc">Jeder kann beitreten</span>
                </div>
              </button>
              <button
                type="button"
                className={`visibility-option ${!formData.is_public ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, is_public: false, requires_approval: true }))}
              >
                <span className="visibility-icon">🔒</span>
                <div className="visibility-text">
                  <span className="visibility-title">Privat</span>
                  <span className="visibility-desc">Nur mit Einladung</span>
                </div>
              </button>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Club Regeln (optional)</label>
            <textarea
              name="rules"
              value={formData.rules}
              onChange={handleInputChange}
              placeholder="Regeln für deine Mitglieder..."
              className="input textarea"
              rows={3}
            />
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && (
        <div className="create-content">
          <h2 className="preview-title">Vorschau</h2>
          
          <div className="preview-card">
            {imagePreview ? (
              <img src={imagePreview} alt="Preview" className="preview-image" />
            ) : (
              <div className="preview-image-placeholder"><span>🏆</span></div>
            )}
            
            <div className="preview-content">
              <div className="preview-badges">
                <span className="preview-badge type">Club</span>
                {formData.category && <span className="preview-badge category">{formData.category}</span>}
                {!formData.is_public && <span className="preview-badge private">🔒 Privat</span>}
              </div>
              
              <h3 className="preview-name">{formData.title || 'Club Name'}</h3>
              
              <div className="preview-details">
                <div className="preview-detail">
                  <span className="detail-icon">📍</span>
                  <span>{formData.location || 'Ort'}</span>
                </div>
                <div className="preview-detail">
                  <span className="detail-icon">👥</span>
                  <span>Max. {formData.max_members} Mitglieder</span>
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
            Weiter
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Erstelle...' : 'Club gründen 🏆'}
          </button>
        )}
      </div>
    </div>
  );
};