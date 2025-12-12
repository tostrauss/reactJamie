import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { auth, api } from '../utils/api';
import { ImageUpload } from '../components/ImageUpload';
import '../styles/home.css';
import '../styles/auth.css';

export const Profile = () => {
  const { user, logout } = useContext(AuthContext);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('about');
  
  // Spotify State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    bio: '',
    gender: '',
    interests: [],
    photos: [],
    avatar_url: ''
  });

  const [newInterest, setNewInterest] = useState('');
  const [newPhotoUrl, setNewPhotoUrl] = useState('');

  const handleAvatarUpload = (url) => {
    setFormData(prev => ({ ...prev, avatar_url: url }));
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const response = await auth.getProfile();
      const data = response.data;
      
      if (typeof data.interests === 'string') data.interests = JSON.parse(data.interests);
      if (typeof data.photos === 'string') data.photos = JSON.parse(data.photos);
      if (typeof data.favorite_song === 'string') data.favorite_song = JSON.parse(data.favorite_song);
      
      setProfile(data);
      setFormData({
        name: data.name || '',
        location: data.location || '',
        bio: data.bio || '',
        gender: data.gender || '',
        interests: data.interests || [],
        photos: data.photos || [],
        avatar_url: data.avatar_url || ''
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
      const response = await auth.updateProfile(formData);
      let data = response.data;
      
      // Handle JSON parsing
      if (typeof data.interests === 'string') data.interests = JSON.parse(data.interests);
      if (typeof data.photos === 'string') data.photos = JSON.parse(data.photos);
      if (typeof data.favorite_song === 'string') data.favorite_song = JSON.parse(data.favorite_song);

      setProfile(data);
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  // ... Interest and Photo handlers ...
  const addInterest = () => {
    if (newInterest && !formData.interests.includes(newInterest)) {
      setFormData(prev => ({ ...prev, interests: [...prev.interests, newInterest] }));
      setNewInterest('');
    }
  };

  const removeInterest = (interest) => {
    setFormData(prev => ({ ...prev, interests: prev.interests.filter(i => i !== interest) }));
  };

  const addPhoto = () => {
    if (newPhotoUrl) {
      setFormData(prev => ({ ...prev, photos: [...prev.photos, newPhotoUrl] }));
      setNewPhotoUrl('');
    }
  };

  const removePhoto = (index) => {
    setFormData(prev => ({ ...prev, photos: prev.photos.filter((_, i) => i !== index) }));
  };

  // Spotify Logic
  const handleSpotifySearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await api.spotify.search(searchQuery);
      setSearchResults(res.data);
    } catch (err) {
      console.error("Spotify Search Error", err);
    } finally {
      setSearching(false);
    }
  };

  const selectSong = async (song) => {
    try {
      // Save song to profile
      const response = await auth.updateProfile({ 
        favorite_song: song 
      });
      
      // Update local profile state
      let data = response.data;
      if (typeof data.favorite_song === 'string') data.favorite_song = JSON.parse(data.favorite_song);
      
      setProfile(prev => ({ ...prev, favorite_song: data.favorite_song }));
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      alert("Failed to save song");
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      {/* Header */}
      <div className="profile-header-card" style={{ 
        textAlign: 'center', marginBottom: '20px', padding: '20px',
        background: 'rgba(255,255,255,0.05)', borderRadius: '20px',
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

      {isEditing ? (
        // Edit Form (same as before but using updated formData)
        <div className="auth-box" style={{ maxWidth: '100%', marginBottom: '20px' }}>
          <h3>Edit Profile</h3>
          <form onSubmit={handleUpdate}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <ImageUpload onUpload={handleAvatarUpload} label="Change Photo" />
            </div>
            {/* ... other inputs ... */}
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Bio</label>
              <textarea value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} style={{ minHeight: '80px' }} />
            </div>
            {/* ... Interests & Photos inputs (kept compact for brevity) ... */}
            <div className="form-group">
                <label>Interests</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input type="text" value={newInterest} onChange={e => setNewInterest(e.target.value)} />
                    <button type="button" onClick={addInterest} className="btn-secondary">Add</button>
                </div>
                <div className="tags-container" style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {formData.interests.map(i => <span key={i} className="badge" onClick={() => removeInterest(i)}>{i} ×</span>)}
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
          <div className="tabs">
            <button className={`tab ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>About</button>
            <button className={`tab ${activeTab === 'photos' ? 'active' : ''}`} onClick={() => setActiveTab('photos')}>Pinnwand</button>
            <button className={`tab ${activeTab === 'music' ? 'active' : ''}`} onClick={() => setActiveTab('music')}>Music</button>
          </div>

          <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
            {activeTab === 'about' && (
              <div className="about-section">
                <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px', marginBottom: '20px' }}>
                  <h3 style={{ marginBottom: '10px', color: '#ff6b6b' }}>About Me</h3>
                  <p style={{ lineHeight: '1.6', color: '#ddd' }}>{profile?.bio || "No bio yet."}</p>
                </div>
                <div className="card-content" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '15px', padding: '20px' }}>
                  <h3 style={{ marginBottom: '15px', color: '#ff6b6b' }}>Interests</h3>
                  <div className="tags-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {profile?.interests?.map((interest, i) => (
                      <span key={i} style={{ background: 'rgba(255,255,255,0.1)', padding: '8px 16px', borderRadius: '20px', fontSize: '14px' }}>{interest}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'photos' && (
              <div className="photos-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
                {profile?.photos?.map((photo, i) => (
                  <div key={i} style={{ aspectRatio: '3/4', borderRadius: '15px', overflow: 'hidden' }}>
                    <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'music' && (
              <div className="music-section">
                {profile?.favorite_song && !showSearch ? (
                  <div style={{ textAlign: 'center', padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '15px' }}>
                    <h3 style={{ marginBottom: '15px', color: '#1DB954' }}>My Anthem 🎵</h3>
                    <img src={profile.favorite_song.cover_url} alt="Cover" style={{ width: '150px', borderRadius: '10px', marginBottom: '15px' }} />
                    <h4 style={{ margin: '0' }}>{profile.favorite_song.title}</h4>
                    <p style={{ color: '#999', marginTop: '5px' }}>{profile.favorite_song.artist}</p>
                    <button className="btn-secondary" style={{ marginTop: '20px' }} onClick={() => setShowSearch(true)}>Change Song</button>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', background: 'rgba(255,255,255,0.05)', borderRadius: '15px' }}>
                    {!showSearch ? (
                      <>
                        <span style={{ fontSize: '40px', display: 'block', marginBottom: '10px' }}>🎵</span>
                        <h3>Spotify Integration</h3>
                        <p style={{ color: '#999', marginTop: '10px' }}>Connect your account to share your favorite anthem.</p>
                        <button className="btn-primary" style={{ marginTop: '20px', background: '#1DB954' }} onClick={() => setShowSearch(true)}>
                          Connect Spotify
                        </button>
                      </>
                    ) : (
                      <div className="spotify-search">
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                          <input 
                            type="text" 
                            placeholder="Search songs..." 
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && handleSpotifySearch()}
                            autoFocus
                          />
                          <button className="btn-primary" onClick={handleSpotifySearch} disabled={searching}>
                            {searching ? '...' : '🔍'}
                          </button>
                        </div>
                        
                        <div className="search-results" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {searchResults.map(track => (
                            <div key={track.id} onClick={() => selectSong(track)} style={{ 
                              display: 'flex', gap: '10px', alignItems: 'center', 
                              padding: '10px', background: 'rgba(255,255,255,0.1)', 
                              borderRadius: '10px', cursor: 'pointer' 
                            }}>
                              <img src={track.cover_url} alt="" style={{ width: '50px', height: '50px', borderRadius: '5px' }} />
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 'bold' }}>{track.title}</div>
                                <div style={{ fontSize: '12px', color: '#ccc' }}>{track.artist}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <button className="btn-secondary" style={{ marginTop: '20px', width: '100%' }} onClick={() => setShowSearch(false)}>Cancel</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {!isEditing && (
        <button onClick={logout} className="btn-secondary" style={{ marginTop: '40px', width: '100%', borderColor: '#ff6b6b', color: '#ff6b6b' }}>
          Sign Out
        </button>
      )}
    </div>
  );
};