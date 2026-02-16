import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

// Demo User Data
const DEMO_USER = {
  name: "Emily",
  age: 20,
  location: "Wien",
  bio: "Hey ich bin Lara, 22 Jahre alt und bin gerade neu nach Wien gezogen. In meiner Freizeit gehe ich sehr gerne Wandern oder Joggen. Was Essen angeht, bin ich sehr neugierig und sage zu keinem Restaurantbesuch nein:)",
  avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
  interests: ["Hiking", "Tennis", "Golf"],
  profileCompletion: 85,
  verified: true,
  photos: [
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400"
  ],
  favoriteSong: {
    title: "Blinding Lights",
    artist: "The Weeknd",
    cover: "https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36"
  }
};

export const Profile = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pinnwand');

  // Verwende Demo-Daten 
  const profileData = user?.name ? user : DEMO_USER;

  return (
    <div className="profile-page">
      {/* Header Bild */}
      <div className="profile-header-image">
        <img 
          src={profileData.photos?.[0] || profileData.avatar || DEMO_USER.avatar} 
          alt={profileData.name}
          className="profile-cover"
        />
        
        {/* Overlay Buttons */}
        <div className="profile-header-actions">
          <button className="profile-action-btn" onClick={() => navigate(-1)}>
            ←
          </button>
          <div className="profile-edit-actions">
            <button className="profile-action-btn" onClick={() => navigate('/settings')} title="Einstellungen">
              ⚙️
            </button>
            <button className="profile-action-btn" onClick={() => navigate('/profile/edit')} title="Profil bearbeiten">
              🖌️
            </button>
          </div>
        </div>

        {/* Verified Badge */}
        {profileData.verified && (
          <div className="verified-badge-profile">✓</div>
        )}
      </div>

      {/* Profile */}
      <div className="profile-info-section">
        <div className="profile-completion">
          <div className="completion-bar">
            <div 
              className="completion-fill" 
              style={{ width: `${profileData.profileCompletion || 85}%` }}
            />
          </div>
          <span className="completion-text">
            {profileData.profileCompletion || 85}% Profil vollständig
          </span>
        </div>

        {/* Name & Location */}
        <div className="profile-name-row">
          <div className="profile-location">
            <span className="location-icon">📍</span>
            {profileData.location || 'Wien'}
          </div>
          <h1 className="profile-name">
            {profileData.name || 'Emily'} <span className="profile-age">{profileData.age || 20}</span>
          </h1>
        </div>

        {/* Bio */}
        <div className="profile-bio-section">
          <h3 className="section-title">Über Dich!</h3>
          <p className="profile-bio">
            {profileData.bio || DEMO_USER.bio}
          </p>
        </div>

        {/* Interests */}
        <div className="profile-interests">
          {(profileData.interests || DEMO_USER.interests).map((interest, index) => (
            <span key={index} className="interest-chip">
              {interest}
            </span>
          ))}
        </div>

        {/* Tabs */}
        <div className="profile-tabs">
          <button 
            className={`profile-tab ${activeTab === 'pinnwand' ? 'active' : ''}`}
            onClick={() => setActiveTab('pinnwand')}
          >
            Pinnwand
          </button>
          <button 
            className={`profile-tab ${activeTab === 'musik' ? 'active' : ''}`}
            onClick={() => setActiveTab('musik')}
          >
            Musik
          </button>
        </div>

        {/* Tab Content */}
        <div className="profile-tab-content">
          {activeTab === 'pinnwand' ? (
            <div className="pinnwand-grid">
              {(profileData.photos || DEMO_USER.photos).map((photo, index) => (
                <div key={index} className="pinnwand-item">
                  <img src={photo} alt={`Foto ${index + 1}`} />
                </div>
              ))}
              <div className="pinnwand-item add-photo">
                <span>+</span>
              </div>
            </div>
          ) : (
            <div className="musik-section">
              {profileData.favoriteSong || DEMO_USER.favoriteSong ? (
                <div className="favorite-song">
                  <img 
                    src={(profileData.favoriteSong || DEMO_USER.favoriteSong).cover} 
                    alt="Album Cover"
                    className="song-cover"
                  />
                  <div className="song-info">
                    <span className="song-title">
                      {(profileData.favoriteSong || DEMO_USER.favoriteSong).title}
                    </span>
                    <span className="song-artist">
                      {(profileData.favoriteSong || DEMO_USER.favoriteSong).artist}
                    </span>
                  </div>
                  <button className="play-btn">▶</button>
                </div>
              ) : (
                <div className="empty-music">
                  <span>🎵</span>
                  <p>Füge deinen Lieblingssong hinzu</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;