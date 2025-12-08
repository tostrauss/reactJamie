import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/api';
import '../styles/home.css'; // Reusing tab/grid styles
import '../styles/auth.css'; // Reusing form styles

export const Profile = () => {
  const { user, logout } = useContext(AuthContext);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('about');
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    bio: '',
    gender: '',
    interests: [],
    photos: []
  });

  const [newInterest, setNewInterest] = useState('');
  const [newPhotoUrl, setNewPhotoUrl] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const response = await auth.getProfile();
      const data = response.data;
      
      // Parse JSON strings if they come back as strings from SQLite
      if (typeof data.interests === 'string') data.interests = JSON.parse(data.interests);
      if (typeof data.photos === 'string') data.photos = JSON.parse(data.photos);
      
      setProfile(data);
      setFormData({
        name: data.name || '',
        location: data.location || '',
        bio: data.bio || '',
        gender: data.gender || '',
        interests: data.interests || [],
        photos: data.photos || []
      });
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      // Send updates to backend
      // Note: We might need to use the 'completeOnboarding' endpoint or update 'updateProfile' 
      // to handle all these fields. For now using updateProfile.
      const response = await auth.updateProfile(formData);
      
      let data = response.data;
      if (typeof data.interests === 'string') data.interests = JSON.parse(data.interests);
      if (typeof data.photos === 'string') data.photos = JSON.parse(data.photos);

      setProfile(data);
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  const addInterest = () => {
    if (newInterest && !formData.interests.includes(newInterest)) {
      setFormData(prev => ({ ...prev, interests: [...prev.interests, newInterest] }));
      setNewInterest('');
    }
  };

  const removeInterest = (interest) => {
    setFormData(prev => ({ 
      ...prev, 
      interests: prev.interests.filter(i => i !== interest) 
    }));
  };

  const addPhoto = () => {
    if (newPhotoUrl) {
      setFormData(prev => ({ ...prev, photos: [...prev.photos, newPhotoUrl] }));
      setNewPhotoUrl('');
    }
  };

  const removePhoto = (index) => {
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index)
    }));
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      {/* --- Header Section --- */}
      <div className="profile-header-card" style={{ 
        textAlign: 'center', 
        marginBottom: '20px',
        padding: '20px',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: '20px',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div className="profile-avatar-large" style={{
          width: '100px', height: '100px', borderRadius: '50%', 
          background: 'linear-gradient(135deg, #ff6b6b, #ff8585)',
          margin: '0 auto 15px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '36px', fontWeight: 'bold', color: '#fff', overflow: 'hidden'
        }}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="Profile" style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            profile?.name?.[0]?.toUpperCase()
          )}
        </div>
        
        <h2>{profile?.name}</h2>
        <p style={{ color: '#999', fontSize: '14px', marginTop: '5px' }}>
          📍 {profile?.location || 'No location set'}
        </p>

        {!isEditing && (
          <button 
            className="btn-secondary" 
            onClick={() => setIsEditing(true)}
            style={{ marginTop: '15px', padding: '8px 20px', fontSize: '12px' }}
          >
            Edit Profile
          </button>
        )}
      </div>

      {/* --- Edit Mode --- */}
      {isEditing ? (
        <div className="auth-box" style={{ maxWidth: '100%', marginBottom: '20px' }}>
          <h3>Edit Profile</h3>
          <form onSubmit={handleUpdate}>
            <div className="form-group">
              <label>Name</label>
              <input 
                type="text" 
                value={formData.name} 
                onChange={e => setFormData({...formData, name: e.target.value})} 
              />
            </div>
            
            <div className="form-group">
              <label>Location</label>
              <input 
                type="text" 
                value={formData.location} 
                onChange={e => setFormData({...formData, location: e.target.value})} 
              />
            </div>

            <div className="form-group">
              <label>Bio</label>
              <textarea 
                value={formData.bio} 
                onChange={e => setFormData({...formData, bio: e.target.value})}
                style={{ minHeight: '80px' }}
              />
            </div>

            <div className="form-group">
              <label>Interests (Press Enter to add)</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  value={newInterest}
                  onChange={e => setNewInterest(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addInterest())}
                  placeholder="Add interest..."
                />
                <button type="button" onClick={addInterest} className="btn-secondary" style={{width: 'auto'}}>Add</button>
              </div>
              <div className="tags-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {formData.interests.map(interest => (
                  <span key={interest} className="badge group" style={{ padding: '8px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {interest}
                    <span onClick={() => removeInterest(interest)} style={{ cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Photos (URL)</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  value={newPhotoUrl}
                  onChange={e => setNewPhotoUrl(e.target.value)}
                  placeholder="Image URL..."
                />
                <button type="button" onClick={addPhoto} className="btn-secondary" style={{width: 'auto'}}>Add</button>
              </div>
              <div className="photos-preview" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px' }}>
                {formData.photos.map((url, idx) => (
                  <div key={idx} style={{ position: 'relative', aspectRatio: '1', borderRadius: '8px', overflow: 'hidden' }}>
                    <img src={url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button 
                      type="button"
                      onClick={() => removePhoto(idx)}
                      style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>Save Changes</button>
              <button type="button" onClick={() => setIsEditing(false)} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* --- Navigation Tabs --- */}
          <div className="tabs">
            <button className={`tab ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>About</button>
            <button className={`tab ${activeTab === 'photos' ? 'active' : ''}`} onClick={() => setActiveTab('photos')}>Pinnwand</button>
            <button className={`tab ${activeTab === 'music' ? 'active' : ''}`} onClick={() => setActiveTab('music')}>Music</button>
          </div>

          {/* --- Tab Content --- */}
          <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
            
            {/* ABOUT TAB */}
            {activeTab === 'about' && (
              <div className="about-section">
                <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px', marginBottom: '20px' }}>
                  <h3 style={{ marginBottom: '10px', color: '#ff6b6b' }}>About Me</h3>
                  <p style={{ lineHeight: '1.6', color: '#ddd' }}>
                    {profile?.bio || "Hey! I haven't written a bio yet."}
                  </p>
                </div>

                <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px' }}>
                  <h3 style={{ marginBottom: '15px', color: '#ff6b6b' }}>Interests</h3>
                  <div className="tags-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {profile?.interests && profile.interests.length > 0 ? (
                      profile.interests.map((interest, i) => (
                        <span key={i} style={{ 
                          background: 'rgba(255,255,255,0.1)', 
                          padding: '8px 16px', 
                          borderRadius: '20px', 
                          fontSize: '14px',
                          border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                          {interest}
                        </span>
                      ))
                    ) : (
                      <p style={{ color: '#666', fontSize: '13px' }}>No interests added yet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* PHOTOS TAB */}
            {activeTab === 'photos' && (
              <div className="photos-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
                {profile?.photos && profile.photos.length > 0 ? (
                  profile.photos.map((photo, i) => (
                    <div key={i} style={{ 
                      aspectRatio: '3/4', 
                      borderRadius: '15px', 
                      overflow: 'hidden', 
                      background: '#000',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <img src={photo} alt={`User photo ${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))
                ) : (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: '#666' }}>
                    No photos on your Pinnwand yet.
                  </div>
                )}
              </div>
            )}

            {/* MUSIC TAB (Placeholder) */}
            {activeTab === 'music' && (
              <div className="music-section">
                <div style={{ textAlign: 'center', padding: '40px', background: 'rgba(255,255,255,0.05)', borderRadius: '15px' }}>
                  <span style={{ fontSize: '40px', display: 'block', marginBottom: '10px' }}>🎵</span>
                  <h3>Spotify Integration</h3>
                  <p style={{ color: '#999', marginTop: '10px' }}>Connect your account to share your favorite anthems.</p>
                  <button className="btn-primary" style={{ marginTop: '20px', background: '#1DB954' }}>Connect Spotify</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Logout Button */}
      {!isEditing && (
        <button 
          onClick={logout} 
          className="btn-secondary"
          style={{ 
            marginTop: '40px', 
            width: '100%', 
            borderColor: '#ff6b6b', 
            color: '#ff6b6b' 
          }}
        >
          Sign Out
        </button>
      )}
    </div>
  );
};