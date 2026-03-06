import React, { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { groups } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { CATEGORY_HIERARCHY } from '../utils/categories';

export const CreateGroup = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
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

  const [selectedFriends, setSelectedFriends] = useState([]);
  
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

  const toggleFriend = (friendId) => {
    setSelectedFriends(prev => 
      prev.includes(friendId)
        ? prev.filter(id => id !== friendId)
        : [...prev, friendId]
    );
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const data = new FormData();
      data.append('name', formData.name);
      data.append('category', formData.activity);
      data.append('description', formData.description);
      data.append('date', formData.date);
      data.append('time', formData.time);
      data.append('location', formData.location);
      data.append('max_members', formData.maxMembers);
      data.append('skill_level', formData.level);
      data.append('is_private', !formData.isPublic); // Backend expects is_private
      data.append('type', 'group');

      if (formData.image) {
        data.append('image', formData.image);
      }
      if (selectedFriends.length > 0) {
        data.append('invitedFriends', JSON.stringify(selectedFriends));
      }

      // Use groups.create which handles FormData correctly
      const response = await groups.create(data);
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
    switch(step) {
      case 1: return formData.name && formData.mainCategory && formData.activity;
      case 2: return formData.date && formData.location;
      case 3: return true;
      default: return false;
    }
  };

  // ... (Rest of the JSX remains the same, ensure you keep the UI code)
  // Returning the JSX part abbreviated here for brevity, 
  // ensure you paste the full component logic if replacing the file.
  
  return (
    <div className="page create-page">
      <div className="create-header">
        <button className="back-btn" onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="create-title">Gruppe erstellen</h1>
        <div className="step-indicator">{step}/3</div>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {error && <div className="error-message">{error}</div>}

      {step === 1 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">Titel deiner Aktivität</label>
            <input type="text" name="name" value={formData.name} onChange={handleInputChange} placeholder="z.B. Volleyball am Strand" className="input" />
          </div>
          <div className="form-section">
            <label className="form-label">Kategorie</label>
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
              <label className="form-label">Unterkategorie</label>
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
            <label className="form-label">Beschreibung</label>
            <textarea name="description" value={formData.description} onChange={handleInputChange} placeholder="Erzähl etwas über deine Aktivität..." className="input textarea" rows={4} />
          </div>
          <div className="form-section">
            <label className="form-label">Titelbild</label>
            <div className="image-upload-area">
              {formData.imagePreview ? (
                <div className="image-preview">
                  <img src={formData.imagePreview} alt="Vorschau" />
                  <button className="remove-image" onClick={() => { if (imageBlobRef.current) { URL.revokeObjectURL(imageBlobRef.current); imageBlobRef.current = null; } setFormData(prev => ({ ...prev, image: null, imagePreview: null })); }}>×</button>
                </div>
              ) : (
                <label className="upload-placeholder">
                  <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
                  <span className="upload-icon">📷</span>
                  <span>Bild hinzufügen</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">Datum</label>
            <input type="date" name="date" value={formData.date} onChange={handleInputChange} className="input" min={new Date().toISOString().split('T')[0]} />
          </div>
          <div className="form-section">
            <label className="form-label">Uhrzeit</label>
            <input type="time" name="time" value={formData.time} onChange={handleInputChange} className="input" />
          </div>
          <div className="form-section">
            <label className="form-label">Ort</label>
            <input type="text" name="location" value={formData.location} onChange={handleInputChange} placeholder="z.B. Wien, Donauinsel" className="input" />
          </div>
          <div className="form-section">
            <label className="form-label">Maximale Teilnehmer</label>
            <div className="counter-input">
              <button type="button" className="counter-btn" onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.max(2, prev.maxMembers - 1) }))}>−</button>
              <span className="counter-value">{formData.maxMembers}</span>
              <button type="button" className="counter-btn" onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.min(20, prev.maxMembers + 1) }))}>+</button>
            </div>
          </div>
          <div className="form-section">
            <label className="form-label">Niveau</label>
            <div className="level-options">
              {['Anfänger', 'Alle Levels', 'Fortgeschritten', 'Experte'].map(level => (
                <button key={level} className={`level-chip ${formData.level === level ? 'active' : ''}`} onClick={() => setFormData(prev => ({ ...prev, level }))}>{level}</button>
              ))}
            </div>
          </div>
          <div className="form-section">
            <label className="form-label">Sichtbarkeit</label>
            <div className="visibility-toggle">
              <button className={`visibility-option ${formData.isPublic ? 'active' : ''}`} onClick={() => setFormData(prev => ({ ...prev, isPublic: true }))}>
                <span className="visibility-icon">🌍</span><span>Öffentlich</span>
              </button>
              <button className={`visibility-option ${!formData.isPublic ? 'active' : ''}`} onClick={() => setFormData(prev => ({ ...prev, isPublic: false }))}>
                <span className="visibility-icon">🔒</span><span>Privat</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="create-content">
          <div className="preview-section">
            <h3>Vorschau</h3>
            <div className="preview-card">
              {formData.imagePreview && <img src={formData.imagePreview} alt="Vorschau" className="preview-image" />}
              <div className="preview-content">
                <h4>{formData.name || 'Titel'}</h4>
                <p className="preview-activity">{formData.activity}</p>
                <div className="preview-details">
                  <span>📅 {formData.date || 'Datum'}</span>
                  <span>📍 {formData.location || 'Ort'}</span>
                  <span>👥 {formData.maxMembers} Max</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="create-footer">
        {step < 3 ? (
          <button className="btn btn-primary btn-block" onClick={() => setStep(step + 1)} disabled={!canProceed()}>Weiter</button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={handleSubmit} disabled={loading}>{loading ? 'Erstelle...' : 'Gruppe erstellen'}</button>
        )}
      </div>
    </div>
  );
};export default CreateGroup;
