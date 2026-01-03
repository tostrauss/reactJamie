import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { users } from '../utils/api';
import { AuthContext } from '../context/AuthContext';

export const UserProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useContext(AuthContext);
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('about');

  useEffect(() => {
    // Redirect to own profile if viewing self
    if (currentUser && currentUser.id === parseInt(id)) {
      navigate('/profile', { replace: true });
      return;
    }
    loadProfile();
  }, [id, currentUser]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const response = await users.getById(id);
      const data = response.data;
      
      // Parse JSON fields
      if (typeof data.interests === 'string') data.interests = JSON.parse(data.interests);
      if (typeof data.photos === 'string') data.photos = JSON.parse(data.photos);
      
      setProfile(data);
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>😕</div>
        <h2>User nicht gefunden</h2>
        <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: '20px' }}>
          Zurück
        </button>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: '100px' }}>
      {/* Back Button */}
      <button 
        onClick={() => navigate(-1)} 
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '24px', marginBottom: '16px', cursor: 'pointer' }}
      >
        ← Zurück
      </button>

      {/* Header Card */}
      <div style={{ 
        textAlign: 'center', 
        marginBottom: '24px', 
        padding: '24px',
        background: 'var(--bg-card)', 
        borderRadius: '20px'
      }}>
        <div style={{
          width: '120px', 
          height: '120px', 
          borderRadius: '50%', 
          background: 'linear-gradient(135deg, #ff6b6b, #ff8585)',
          margin: '0 auto 16px', 
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
            <img src={profile.avatar_url} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            profile.name?.[0]?.toUpperCase()
          )}
        </div>
        
        <h2 style={{ marginBottom: '4px', fontSize: '24px' }}>{profile.name}</h2>
        
        {profile.gender && (
          <p style={{ color: 'var(--accent-coral)', fontSize: '13px', marginBottom: '4px' }}>
            {profile.gender === 'männlich' ? '♂️' : profile.gender === 'weiblich' ? '♀️' : '⚧️'} {profile.gender}
          </p>
        )}
        
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          📍 {profile.location || 'Kein Standort'}
        </p>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'center' }}>
          <button 
            className="btn btn-primary"
            onClick={() => alert('Direct Messages coming soon!')}
          >
            💬 Nachricht
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => alert('Follow feature coming soon!')}
          >
            ➕ Folgen
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>
          Über
        </button>
        <button className={`tab ${activeTab === 'photos' ? 'active' : ''}`} onClick={() => setActiveTab('photos')}>
          Fotos
        </button>
      </div>

      {/* Content */}
      {activeTab === 'about' && (
        <div>
          {profile.bio && (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '12px', color: 'var(--accent-coral)', fontSize: '16px' }}>Über {profile.name?.split(' ')[0]}</h3>
              <p style={{ lineHeight: '1.6', color: 'var(--text-light)' }}>{profile.bio}</p>
            </div>
          )}
          
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--accent-coral)', fontSize: '16px' }}>Interessen</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {profile.interests?.length > 0 ? (
                profile.interests.map((interest, i) => (
                  <span key={i} style={{ background: 'var(--bg-input)', padding: '8px 16px', borderRadius: '20px', fontSize: '13px' }}>
                    {interest}
                  </span>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Keine Interessen</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'photos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {profile.photos?.length > 0 ? (
            profile.photos.map((photo, i) => (
              <div key={i} style={{ aspectRatio: '3/4', borderRadius: '16px', overflow: 'hidden', background: 'var(--bg-card)' }}>
                <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '40px' }}>
              Keine Fotos
            </p>
          )}
        </div>
      )}
    </div>
  );
};