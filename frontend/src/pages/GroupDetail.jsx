import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

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
      try {
        const [groupRes, joinedRes, membersRes] = await Promise.all([
          groups.getById(id),
          groups.getJoined(),
          groups.getMembers(id)
        ]);
        
        setGroup(groupRes.data);
        // Check if current user is in the joined list
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
    try {
      if (isJoined) {
        await groups.leave(id);
        setIsJoined(false);
        // Remove self from members list locally
        setMembers(prev => prev.filter(m => m.id !== user.id));
      } else {
        await groups.join(id);
        setIsJoined(true);
        // Add self to members list locally (optional, or re-fetch)
        const newMember = {
            id: user.id,
            name: user.name,
            avatar_url: user.avatar_url, // Assuming user context has this or it's fetched
            location: 'You'
        };
        setMembers(prev => [newMember, ...prev]);
      }
      
      // Refresh group data to ensure member count is accurate from server
      const response = await groups.getById(id);
      setGroup(response.data);
    } catch (error) {
      console.error("Error toggling join:", error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="error">Group not found</div>;

  // Determine header background
  const headerStyle = group.image_url 
    ? { backgroundImage: `url(${group.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(135deg, #ff6b6b, #ff8585)` };

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      {/* Back Button */}
      <button 
        onClick={() => navigate(-1)} 
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '24px', marginBottom: '10px', cursor: 'pointer' }}
      >
        ← Back
      </button>

      {/* Header Image/Gradient */}
      <div className="group-detail-header" style={{ position: 'relative', height: '250px', borderRadius: '20px', overflow: 'hidden', marginBottom: '20px' }}>
        <div style={{ 
          width: '100%', 
          height: '100%', 
          ...headerStyle
        }}></div>
        
        {/* Overlay Content */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '20px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)'
        }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '5px' }}>
            <span className={`badge ${group.type}`}>{group.type}</span>
            {group.category && (
              <span style={{ 
                background: 'rgba(255,255,255,0.2)', 
                color: '#fff', 
                padding: '3px 8px', 
                borderRadius: '10px', 
                fontSize: '9px',
                textTransform: 'capitalize'
              }}>
                {group.category}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: '28px', margin: '0', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{group.title}</h1>
        </div>
      </div>

      <div className="card-content" style={{ padding: '0 10px' }}>
        {/* Meta Info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <p style={{ color: '#999', fontSize: '14px' }}>Organized by</p>
            <p style={{ fontWeight: 'bold' }}>{group.owner_name}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#999', fontSize: '14px' }}>Members</p>
            <p style={{ fontWeight: 'bold' }}>{group.member_count}</p>
          </div>
        </div>

        {/* Description */}
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '10px' }}>About this {group.type}</h3>
          <p style={{ lineHeight: '1.6', color: '#ddd' }}>{group.description}</p>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons" style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
          {isJoined ? (
            <>
              <button 
                className="btn-primary" 
                style={{ flex: 2 }}
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
              style={{ width: '100%' }}
              onClick={handleJoinToggle}
            >
              Join {group.type === 'club' ? 'Club' : 'Group'}
            </button>
          )}
        </div>

        {/* Members List */}
        <div className="members-section">
          <h3 style={{ marginBottom: '15px' }}>Members ({members.length})</h3>
          {members.length === 0 ? (
            <p style={{ color: '#666', fontSize: '14px' }}>No members yet. Be the first to join!</p>
          ) : (
            <div className="members-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {members.map(member => (
                <Link 
                  to={`/user/${member.id}`} 
                  key={member.id}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ 
                    display: 'flex', alignItems: 'center', gap: '15px', 
                    padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px',
                    transition: 'background 0.2s ease'
                  }}>
                    <div style={{ 
                      width: '40px', height: '40px', borderRadius: '50%', 
                      background: '#444', overflow: 'hidden', flexShrink: 0 
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
                      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{member.name}</div>
                      <div style={{ fontSize: '11px', color: '#999' }}>{member.location || 'Unknown location'}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};