import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

// Mock Data for "Perfect Styling" Demo
const MOCK_DATA = {
  991: {
    id: 991,
    title: 'Wandern am Kahlenberg',
    description: 'Wir treffen uns für eine entspannte Wanderung am Kahlenberg. Bitte festes Schuhwerk mitbringen! Wir machen Pausen für Fotos und genießen die Aussicht über Wien.',
    type: 'group',
    category: 'Hiking',
    image_url: 'https://images.unsplash.com/photo-1551632811-561732d1e306?q=80&w=2070&auto=format&fit=crop',
    owner_name: 'Max',
    member_count: 4,
    maxMembers: 6,
    created_at: new Date().toISOString()
  },
  992: {
    id: 992,
    title: 'Beachvolleyball Donauinsel',
    description: 'Lockeres Match auf der Donauinsel bei Platz 3. Anfänger sind willkommen, wir spielen hauptsächlich zum Spaß! Danach gehen wir vielleicht noch auf ein Getränk.',
    type: 'group',
    category: 'Volleyball',
    image_url: 'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?q=80&w=2007&auto=format&fit=crop',
    owner_name: 'Lisa',
    member_count: 3,
    maxMembers: 4,
    created_at: new Date().toISOString()
  }
};

export const GroupDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      // CHECK IF THIS IS A MOCK GROUP
      if (MOCK_DATA[id]) {
        setGroup(MOCK_DATA[id]);
        setIsJoined(false); // Default to not joined for demo
        // Fake members
        setMembers([
          { id: 101, name: 'Demo User 1', location: 'Wien', avatar_url: null },
          { id: 102, name: 'Demo User 2', location: 'Graz', avatar_url: null }
        ]);
        setLoading(false);
        return;
      }

      try {
        const [groupRes, joinedRes, membersRes] = await Promise.all([
          groups.getById(id),
          groups.getJoined(),
          groups.getMembers(id)
        ]);
        
        setGroup(groupRes.data);
        setIsJoined(joinedRes.data.some(g => g.id === parseInt(id)));
        setMembers(membersRes.data);
      } catch (error) {
        console.error("Error fetching group details:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleJoinToggle = async () => {
    // If mock group, just toggle state locally
    if (MOCK_DATA[id]) {
      setIsJoined(!isJoined);
      return;
    }

    try {
      if (isJoined) {
        await groups.leave(id);
        setIsJoined(false);
        setMembers(prev => prev.filter(m => m.id !== user.id));
      } else {
        await groups.join(id);
        setIsJoined(true);
        // Optimistic update
        const newMember = {
            id: user.id,
            name: user.name,
            avatar_url: user.avatar_url,
            location: 'You'
        };
        setMembers(prev => [newMember, ...prev]);
      }
      
      const response = await groups.getById(id);
      setGroup(response.data);
    } catch (error) {
      console.error("Error toggling join:", error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="error">Group not found</div>;

  const headerStyle = group.image_url 
    ? { backgroundImage: `url(${group.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(135deg, #ff6b6b, #ff8585)` };

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      <button 
        onClick={() => navigate(-1)} 
        style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: '24px', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        ←
      </button>

      {/* Header Image/Gradient */}
      <div className="group-detail-header" style={{ position: 'relative', height: '300px', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', ...headerStyle }}></div>
        
        {/* Overlay Content */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '20px',
          background: 'linear-gradient(to top, #1a1a3e, transparent)',
          paddingTop: '60px'
        }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
            <span className={`badge ${group.type}`}>{group.type}</span>
            {group.category && (
              <span className="category-pill">{group.category}</span>
            )}
          </div>
          <h1 style={{ fontSize: '32px', margin: '0', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>{group.title}</h1>
        </div>
      </div>

      <div className="card-content" style={{ padding: '20px' }}>
        {/* Meta Info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '15px' }}>
          <div>
            <p style={{ color: '#999', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>Organized by</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
               <div style={{ width: 24, height: 24, background: '#ff6b6b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'white' }}>{group.owner_name?.[0]}</div>
               <p style={{ fontWeight: 'bold' }}>{group.owner_name}</p>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#999', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>Members</p>
            <p style={{ fontWeight: 'bold', fontSize: '16px' }}>{group.member_count} <span style={{fontSize: '12px', color: '#666'}}>/ {group.maxMembers || 6}</span></p>
          </div>
        </div>

        {/* Description */}
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '10px', fontSize: '18px' }}>About this {group.type}</h3>
          <p style={{ lineHeight: '1.6', color: '#ccc', fontSize: '15px' }}>{group.description}</p>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons" style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
          {isJoined ? (
            <>
              <button 
                className="btn-primary" 
                style={{ flex: 2, background: 'rgba(100, 200, 100, 0.2)', color: '#90ee90', border: '1px solid rgba(100, 200, 100, 0.3)' }}
                onClick={() => navigate(`/chat/${group.id}`)}
              >
                Open Chat 💬
              </button>
              <button 
                className="btn-secondary" 
                style={{ flex: 1, borderColor: '#ff6b6b', color: '#ff6b6b' }}
                onClick={handleJoinToggle}
              >
                Leave
              </button>
            </>
          ) : (
            <button 
              className="btn-primary" 
              style={{ width: '100%', height: '50px', fontSize: '16px' }}
              onClick={handleJoinToggle}
            >
              Join {group.type === 'club' ? 'Club' : 'Group'}
            </button>
          )}
        </div>

        {/* Members List */}
        <div className="members-section">
          <h3 style={{ marginBottom: '15px', fontSize: '18px' }}>Members</h3>
          {members.length === 0 ? (
            <p style={{ color: '#666', fontSize: '14px' }}>No members yet. Be the first to join!</p>
          ) : (
            <div className="members-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {members.map(member => (
                <div 
                  key={member.id}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '15px', 
                    padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.05)'
                  }}
                >
                  <div style={{ 
                    width: '40px', height: '40px', borderRadius: '50%', 
                    background: '#333', overflow: 'hidden', flexShrink: 0 
                  }}>
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>
                        {member.name[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{member.name}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{member.location || 'Unknown location'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};