import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { users } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

export const UserProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useContext(AuthContext);
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('about');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    loadProfile();
  }, [id]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await users.getById(id);
      const data = response.data;
      
      // Parse JSON strings if they come back as strings from SQLite
      if (typeof data.interests === 'string') {
        try { data.interests = JSON.parse(data.interests); } 
        catch { data.interests = []; }
      }
      if (typeof data.photos === 'string') {
        try { data.photos = JSON.parse(data.photos); } 
        catch { data.photos = []; }
      }
      
      setProfile(data);
    } catch (err) {
      console.error('Error loading profile:', err);
      setError('User not found');
    } finally {
      setLoading(false);
    }
  };

  // Check if viewing own profile - redirect to /profile
  useEffect(() => {
    if (currentUser && profile && currentUser.id === profile.id) {
      navigate('/profile', { replace: true });
    }
  }, [currentUser, profile, navigate]);

  if (loading) {
    return (
      <div className="loading">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '15px' }}>👤</div>
          <p>Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="home" style={{ paddingBottom: '100px' }}>
        <button 
          onClick={() => navigate(-1)} 
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: '24px', marginBottom: '20px', cursor: 'pointer' }}
        >
          ← Back
        </button>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '60px', marginBottom: '20px' }}>😕</div>
          <h2 style={{ marginBottom: '10px' }}>User Not Found</h2>
          <p style={{ color: '#999' }}>This profile doesn't exist or has been removed.</p>
          <button 
            onClick={() => navigate('/home')} 
            className="btn-primary" 
            style={{ marginTop: '30px' }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      {/* Back Button */}
      <button 
        onClick={() => navigate(-1)} 
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '24px', marginBottom: '10px', cursor: 'pointer' }}
      >
        ← Back
      </button>

      {/* Profile Header Card */}
      <div className="profile-header-card" style={{ 
        textAlign: 'center', 
        marginBottom: '20px',
        padding: '25px 20px',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: '20px',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        {/* Avatar */}
        <div className="profile-avatar-large" style={{
          width: '120px', 
          height: '120px', 
          borderRadius: '50%', 
          background: 'linear-gradient(135deg, #ff6b6b, #ff8585)',
          margin: '0 auto 15px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          fontSize: '42px', 
          fontWeight: 'bold', 
          color: '#fff', 
          overflow: 'hidden',
          border: '4px solid rgba(255,255,255,0.1)'
        }}>
          {profile.avatar_url ? (
            <img 
              src={profile.avatar_url} 
              alt={profile.name} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
          ) : (
            profile.name?.[0]?.toUpperCase()
          )}
        </div>
        
        {/* Name & Location */}
        <h2 style={{ marginBottom: '5px', fontSize: '24px' }}>{profile.name}</h2>
        
        {profile.gender && (
          <p style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '5px', textTransform: 'capitalize' }}>
            {profile.gender === 'male' ? '♂️' : profile.gender === 'female' ? '♀️' : '⚧️'} {profile.gender}
          </p>
        )}
        
        <p style={{ color: '#999', fontSize: '14px', marginTop: '8px' }}>
          📍 {profile.location || 'Location not set'}
        </p>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'center' }}>
          <button 
            className="btn-primary" 
            style={{ padding: '10px 25px', fontSize: '13px' }}
            onClick={() => {
              // Future: Implement direct messaging
              alert('Direct messaging coming soon!');
            }}
          >
            💬 Message
          </button>
          <button 
            className="btn-secondary" 
            style={{ padding: '10px 25px', fontSize: '13px' }}
            onClick={() => {
              // Future: Implement friend/follow system
              alert('Follow feature coming soon!');
            }}
          >
            ➕ Follow
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'about' ? 'active' : ''}`} 
          onClick={() => setActiveTab('about')}
        >
          About
        </button>
        <button 
          className={`tab ${activeTab === 'photos' ? 'active' : ''}`} 
          onClick={() => setActiveTab('photos')}
        >
          Photos
        </button>
        <button 
          className={`tab ${activeTab === 'groups' ? 'active' : ''}`} 
          onClick={() => setActiveTab('groups')}
        >
          Groups
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
        
        {/* ABOUT TAB */}
        {activeTab === 'about' && (
          <div className="about-section">
            {/* Bio */}
            <div style={{ 
              background: 'rgba(255,255,255,0.05)', 
              borderRadius: '15px', 
              padding: '20px', 
              marginBottom: '20px' 
            }}>
              <h3 style={{ marginBottom: '12px', color: '#ff6b6b', fontSize: '16px' }}>
                About {profile.name?.split(' ')[0]}
              </h3>
              <p style={{ lineHeight: '1.7', color: '#ddd', fontSize: '14px' }}>
                {profile.bio || `${profile.name} hasn't written a bio yet.`}
              </p>
            </div>

            {/* Interests */}
            <div style={{ 
              background: 'rgba(255,255,255,0.05)', 
              borderRadius: '15px', 
              padding: '20px' 
            }}>
              <h3 style={{ marginBottom: '15px', color: '#ff6b6b', fontSize: '16px' }}>
                Interests
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {profile.interests && profile.interests.length > 0 ? (
                  profile.interests.map((interest, i) => (
                    <span 
                      key={i} 
                      style={{ 
                        background: 'rgba(255,255,255,0.1)', 
                        padding: '8px 16px', 
                        borderRadius: '20px', 
                        fontSize: '13px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {interest}
                    </span>
                  ))
                ) : (
                  <p style={{ color: '#666', fontSize: '13px' }}>
                    No interests listed yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PHOTOS TAB */}
        {activeTab === 'photos' && (
          <div>
            {profile.photos && profile.photos.length > 0 ? (
              <div className="photos-grid" style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '12px' 
              }}>
                {profile.photos.map((photo, i) => (
                  <div 
                    key={i} 
                    onClick={() => setSelectedPhoto(photo)}
                    style={{ 
                      aspectRatio: '3/4', 
                      borderRadius: '15px', 
                      overflow: 'hidden', 
                      background: '#000',
                      border: '1px solid rgba(255,255,255,0.1)',
                      cursor: 'pointer',
                      transition: 'transform 0.2s ease'
                    }}
                  >
                    <img 
                      src={photo} 
                      alt={`${profile.name}'s photo ${i + 1}`} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                padding: '50px 20px', 
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '15px'
              }}>
                <div style={{ fontSize: '40px', marginBottom: '15px' }}>📷</div>
                <p style={{ color: '#666' }}>No photos yet</p>
              </div>
            )}
          </div>
        )}

        {/* GROUPS TAB */}
        {activeTab === 'groups' && (
          <div style={{ 
            textAlign: 'center', 
            padding: '50px 20px', 
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '15px'
          }}>
            <div style={{ fontSize: '40px', marginBottom: '15px' }}>👥</div>
            <h3 style={{ marginBottom: '10px' }}>Shared Groups</h3>
            <p style={{ color: '#999', fontSize: '14px' }}>
              See groups you have in common with {profile.name?.split(' ')[0]}.
            </p>
            <p style={{ color: '#666', fontSize: '13px', marginTop: '15px' }}>
              Coming soon!
            </p>
          </div>
        )}
      </div>

      {/* Photo Lightbox Modal */}
      {selectedPhoto && (
        <div 
          onClick={() => setSelectedPhoto(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            cursor: 'pointer',
            padding: '20px'
          }}
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              fontSize: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >X
          </button>
          <img 
            src={selectedPhoto} 
            alt="Full size" 
            style={{ 
              maxWidth: '100%', 
              maxHeight: '90vh', 
              borderRadius: '10px',
              objectFit: 'contain'
            }} 
          />
        </div>
      )}
    </div>
  );
};