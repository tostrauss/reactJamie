import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

export const GroupDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [groupRes, joinedRes] = await Promise.all([
          groups.getById(id),
          groups.getJoined()
        ]);
        setGroup(groupRes.data);
        setIsJoined(joinedRes.data.some(g => g.id === parseInt(id)));
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
      } else {
        await groups.join(id);
        setIsJoined(true);
      }
      // Refresh group data to update member count
      const response = await groups.getById(id);
      setGroup(response.data);
    } catch (error) {
      console.error("Error toggling join:", error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="error">Group not found</div>;

  return (
    <div className="home" style={{ paddingBottom: '100px' }}>
      <button 
        onClick={() => navigate(-1)} 
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: '24px', marginBottom: '10px', cursor: 'pointer' }}
      >
        ← Back
      </button>

      <div className="group-detail-header" style={{ position: 'relative', height: '250px', borderRadius: '20px', overflow: 'hidden', marginBottom: '20px' }}>
        <div style={{ 
          width: '100%', 
          height: '100%', 
          background: `linear-gradient(135deg, #ff6b6b, #ff8585)` 
        }}></div>
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '20px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)'
        }}>
          <span className={`badge ${group.type}`} style={{marginBottom: '10px', display: 'inline-block'}}>{group.type}</span>
          <h1 style={{ fontSize: '28px', margin: '0' }}>{group.title}</h1>
        </div>
      </div>

      <div className="card-content" style={{ padding: '0 10px' }}>
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

        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '10px' }}>About this {group.type}</h3>
          <p style={{ lineHeight: '1.6', color: '#ddd' }}>{group.description}</p>
        </div>

        <div className="action-buttons" style={{ display: 'flex', gap: '10px' }}>
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
      </div>
    </div>
  );
};