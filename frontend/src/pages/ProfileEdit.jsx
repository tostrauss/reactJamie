import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../utils/api';
import '../styles/home.css';

export const ProfileEdit = () => {
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    bio: '',
    location: '',
    date_of_birth: '',
    gender: '',
    interests: [],
    photos: []
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        bio: user.bio || '',
        location: user.location || '',
        date_of_birth: user.date_of_birth || '',
        gender: user.gender || '',
        interests: user.interests || [],
        photos: user.photos || []
      });
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.auth.updateProfile(formData);
      setUser(res.data);
      alert('Profil aktualisiert!');
      navigate('/profile');
    } catch (error) {
      console.error('Update failed:', error);
      alert('Fehler beim Speichern');
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

  const AVAILABLE_INTERESTS = [
    'Hiking', 'Tennis', 'Golf', 'Running', 'Volleyball', 'Yoga',
    'Kochen', 'Fotografie', 'Musik', 'Kunst', 'Tanzen', 'Brettspiele'
  ];

  return (
    <div className="profile-edit-page">
      <header className="edit-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1>Profil bearbeiten</h1>
        <button className="save-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? '...' : 'Speichern'}
        </button>
      </header>

      <form onSubmit={handleSubmit} className="edit-form">
        <div className="form-section">
          <label>Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            className="form-input"
          />
        </div>

        <div className="form-section">
          <label>Bio</label>
          <textarea
            value={formData.bio}
            onChange={(e) => setFormData({...formData, bio: e.target.value})}
            rows={4}
            className="form-input"
            placeholder="Erzähl etwas über dich..."
          />
        </div>

        <div className="form-section">
          <label>Standort</label>
          <input
            type="text"
            value={formData.location}
            onChange={(e) => setFormData({...formData, location: e.target.value})}
            className="form-input"
            placeholder="Wien"
          />
        </div>

        <div className="form-section">
          <label>Geburtsdatum</label>
          <input
            type="date"
            value={formData.date_of_birth}
            onChange={(e) => setFormData({...formData, date_of_birth: e.target.value})}
            className="form-input"
          />
        </div>

        <div className="form-section">
          <label>Geschlecht</label>
          <select
            value={formData.gender}
            onChange={(e) => setFormData({...formData, gender: e.target.value})}
            className="form-input"
          >
            <option value="">Bitte wählen</option>
            <option value="male">Männlich</option>
            <option value="female">Weiblich</option>
            <option value="other">Divers</option>
          </select>
        </div>

        <div className="form-section">
          <label>Interessen</label>
          <div className="interests-select">
            {AVAILABLE_INTERESTS.map(interest => (
              <button
                key={interest}
                type="button"
                className={`interest-chip ${formData.interests.includes(interest) ? 'active' : ''}`}
                onClick={() => handleInterestToggle(interest)}
              >
                {interest}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
};

export default ProfileEdit;
