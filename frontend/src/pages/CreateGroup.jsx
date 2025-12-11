import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';

const ACTIVITY_CATEGORIES = [
  'Hiking', 'Tennis', 'Golf', 'Beachvolleyball', 'Running',
  'Volleyball', 'Wandern', 'Fitness', 'Yoga', 'Swimming',
  'Cycling', 'Basketball', 'Football', 'Skiing', 'Climbing'
];

export const CreateGroup = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
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

  // Selected friends for invite
  const [selectedFriends, setSelectedFriends] = useState([]);
  
  // Mock friends data (replace with API call)
  const friends = [
    { id: 1, name: 'Tom', avatar: 'https://i.pravatar.cc/100?img=1' },
    { id: 2, name: 'Helena', avatar: 'https://i.pravatar.cc/100?img=2' },
    { id: 3, name: 'Sarah', avatar: 'https://i.pravatar.cc/100?img=3' },
    { id: 4, name: 'Emma', avatar: 'https://i.pravatar.cc/100?img=4' },
    { id: 5, name: 'Max', avatar: 'https://i.pravatar.cc/100?img=5' },
    { id: 6, name: 'Lisa', avatar: 'https://i.pravatar.cc/100?img=6' },
  ];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData(prev => ({
        ...prev,
        image: file,
        imagePreview: URL.createObjectURL(file)
      }));
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
      // Create FormData for file upload
      const data = new FormData();
      data.append('name', formData.name);
      data.append('activity', formData.activity);
      data.append('description', formData.description);
      data.append('date', formData.date);
      data.append('time', formData.time);
      data.append('location', formData.location);
      data.append('maxMembers', formData.maxMembers);
      data.append('level', formData.level);
      data.append('isPublic', formData.isPublic);
      data.append('type', 'group');
      if (formData.image) {
        data.append('image', formData.image);
      }
      if (selectedFriends.length > 0) {
        data.append('invitedFriends', JSON.stringify(selectedFriends));
      }

      const response = await api.groups.create(data);
      navigate(`/group/${response.id}`);
    } catch (err) {
      setError(err.message || 'Fehler beim Erstellen der Gruppe');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch(step) {
      case 1:
        return formData.name && formData.activity;
      case 2:
        return formData.date && formData.location;
      case 3:
        return true;
      default:
        return false;
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
        <h1 className="create-title">Gruppe erstellen</h1>
        <div className="step-indicator">{step}/3</div>
      </div>

      {/* Progress Bar */}
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">Titel deiner Aktivität</label>
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
            <label className="form-label">Aktivität</label>
            <div className="activity-grid">
              {ACTIVITY_CATEGORIES.map(activity => (
                <button
                  key={activity}
                  className={`activity-chip ${formData.activity === activity ? 'active' : ''}`}
                  onClick={() => setFormData(prev => ({ ...prev, activity }))}
                >
                  {activity}
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
              placeholder="Erzähl etwas über deine Aktivität..."
              className="input textarea"
              rows={4}
            />
          </div>

          <div className="form-section">
            <label className="form-label">Titelbild</label>
            <div className="image-upload-area">
              {formData.imagePreview ? (
                <div className="image-preview">
                  <img src={formData.imagePreview} alt="Preview" />
                  <button 
                    className="remove-image"
                    onClick={() => setFormData(prev => ({ ...prev, image: null, imagePreview: null }))}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <label className="upload-placeholder">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    hidden
                  />
                  <span className="upload-icon">📷</span>
                  <span>Bild hinzufügen</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Date & Location */}
      {step === 2 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">Datum</label>
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
            <label className="form-label">Uhrzeit</label>
            <input
              type="time"
              name="time"
              value={formData.time}
              onChange={handleInputChange}
              className="input"
            />
          </div>

          <div className="form-section">
            <label className="form-label">Ort</label>
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
            <label className="form-label">Maximale Teilnehmer</label>
            <div className="counter-input">
              <button 
                className="counter-btn"
                onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.max(2, prev.maxMembers - 1) }))}
              >
                −
              </button>
              <span className="counter-value">{formData.maxMembers}</span>
              <button 
                className="counter-btn"
                onClick={() => setFormData(prev => ({ ...prev, maxMembers: Math.min(20, prev.maxMembers + 1) }))}
              >
                +
              </button>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Level</label>
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
            <label className="form-label">Sichtbarkeit</label>
            <div className="visibility-toggle">
              <button
                className={`visibility-option ${formData.isPublic ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isPublic: true }))}
              >
                <span className="visibility-icon">🌍</span>
                <span>Öffentlich</span>
              </button>
              <button
                className={`visibility-option ${!formData.isPublic ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, isPublic: false }))}
              >
                <span className="visibility-icon">🔒</span>
                <span>Privat</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Invite Friends */}
      {step === 3 && (
        <div className="create-content">
          <div className="form-section">
            <label className="form-label">Freunde einladen (optional)</label>
            <div className="search-container">
              <input
                type="text"
                placeholder="Suchen"
                className="search-input"
              />
              <span className="search-icon">🔍</span>
            </div>
          </div>

          <div className="friends-grid">
            {friends.map(friend => (
              <button
                key={friend.id}
                className={`friend-card ${selectedFriends.includes(friend.id) ? 'selected' : ''}`}
                onClick={() => toggleFriend(friend.id)}
              >
                <div className="friend-avatar">
                  <img src={friend.avatar} alt={friend.name} />
                  {selectedFriends.includes(friend.id) && (
                    <div className="friend-check">✓</div>
                  )}
                </div>
                <span className="friend-name">{friend.name}</span>
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="preview-section">
            <h3>Vorschau</h3>
            <div className="preview-card">
              {formData.imagePreview && (
                <img src={formData.imagePreview} alt="Preview" className="preview-image" />
              )}
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

      {/* Footer Actions */}
      <div className="create-footer">
        {step < 3 ? (
          <button 
            className="btn btn-primary btn-block"
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
          >
            Weiter
          </button>
        ) : (
          <button 
            className="btn btn-primary btn-block"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Erstelle...' : 'Gruppe erstellen'}
          </button>
        )}
      </div>

      <style>{`
        .create-page {
          padding-bottom: 100px;
        }
        
        .create-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          padding-top: calc(env(safe-area-inset-top, 20px) + 16px);
        }
        
        .back-btn {
          background: none;
          border: none;
          color: var(--text-white);
          cursor: pointer;
          padding: 8px;
        }
        
        .create-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-white);
        }
        
        .step-indicator {
          font-size: 14px;
          color: var(--text-muted);
        }
        
        .progress-bar {
          height: 3px;
          background: var(--bg-input);
          margin: 0 16px 24px;
          border-radius: 2px;
          overflow: hidden;
        }
        
        .progress-fill {
          height: 100%;
          background: var(--accent-coral);
          transition: width 0.3s ease;
        }
        
        .error-message {
          background: rgba(255, 59, 48, 0.1);
          border: 1px solid var(--status-busy);
          color: var(--status-busy);
          padding: 12px 16px;
          margin: 0 16px 16px;
          border-radius: 8px;
          font-size: 14px;
        }
        
        .create-content {
          padding: 0 16px;
        }
        
        .form-section {
          margin-bottom: 24px;
        }
        
        .form-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        
        .textarea {
          min-height: 100px;
          resize: vertical;
        }
        
        .activity-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        
        .activity-chip {
          padding: 8px 16px;
          background: var(--bg-input);
          border: 1px solid transparent;
          border-radius: 20px;
          color: var(--text-light);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .activity-chip:hover {
          background: var(--bg-card-hover);
        }
        
        .activity-chip.active {
          background: var(--accent-coral);
          color: white;
        }
        
        .image-upload-area {
          border: 2px dashed var(--bg-input);
          border-radius: 12px;
          overflow: hidden;
        }
        
        .upload-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          cursor: pointer;
          color: var(--text-muted);
          gap: 8px;
        }
        
        .upload-icon {
          font-size: 32px;
        }
        
        .image-preview {
          position: relative;
          width: 100%;
          aspect-ratio: 16/9;
        }
        
        .image-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .remove-image {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          background: rgba(0,0,0,0.6);
          border: none;
          border-radius: 50%;
          color: white;
          font-size: 20px;
          cursor: pointer;
        }
        
        .counter-input {
          display: flex;
          align-items: center;
          gap: 16px;
          background: var(--bg-input);
          border-radius: 12px;
          padding: 8px 16px;
          width: fit-content;
        }
        
        .counter-btn {
          width: 36px;
          height: 36px;
          background: var(--bg-dark);
          border: none;
          border-radius: 50%;
          color: var(--text-white);
          font-size: 20px;
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .counter-btn:hover {
          background: var(--accent-coral);
        }
        
        .counter-value {
          font-size: 18px;
          font-weight: 600;
          min-width: 40px;
          text-align: center;
        }
        
        .level-options {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        
        .level-chip {
          padding: 10px 16px;
          background: var(--bg-input);
          border: 1px solid transparent;
          border-radius: 8px;
          color: var(--text-light);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .level-chip.active {
          background: var(--accent-coral);
          color: white;
        }
        
        .visibility-toggle {
          display: flex;
          gap: 12px;
        }
        
        .visibility-option {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px;
          background: var(--bg-input);
          border: 2px solid transparent;
          border-radius: 12px;
          color: var(--text-light);
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .visibility-option.active {
          border-color: var(--accent-coral);
          background: rgba(253, 118, 102, 0.1);
        }
        
        .visibility-icon {
          font-size: 20px;
        }
        
        .friends-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        
        .friend-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--bg-input);
          border: 2px solid transparent;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .friend-card.selected {
          border-color: var(--accent-green);
          background: rgba(76, 217, 100, 0.1);
        }
        
        .friend-avatar {
          position: relative;
          width: 44px;
          height: 44px;
        }
        
        .friend-avatar img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }
        
        .friend-check {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 20px;
          height: 20px;
          background: var(--accent-green);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: white;
        }
        
        .friend-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-white);
        }
        
        .preview-section {
          margin-top: 24px;
        }
        
        .preview-section h3 {
          font-size: 14px;
          color: var(--text-muted);
          margin-bottom: 12px;
        }
        
        .preview-card {
          background: var(--bg-card);
          border-radius: 12px;
          overflow: hidden;
        }
        
        .preview-image {
          width: 100%;
          height: 120px;
          object-fit: cover;
        }
        
        .preview-content {
          padding: 12px;
        }
        
        .preview-content h4 {
          font-size: 16px;
          font-weight: 600;
          color: var(--accent-coral);
          margin-bottom: 4px;
        }
        
        .preview-activity {
          font-size: 14px;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        
        .preview-details {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 12px;
          color: var(--text-muted);
        }
        
        .create-footer {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 16px;
          padding-bottom: calc(env(safe-area-inset-bottom, 20px) + 16px);
          background: var(--bg-dark);
          border-top: 1px solid var(--bg-input);
        }
      `}</style>
    </div>
  );
};