import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { groups } from '../utils/api';
import '../styles/home.css'; // Reuse basic styles

export const ChatList = () => {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadChats = async () => {
      try {
        const response = await groups.getJoined();
        setChats(response.data);
      } catch (error) {
        console.error('Error loading chats:', error);
      } finally {
        setLoading(false);
      }
    };
    loadChats();
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="home">
      <div className="home-header">
        <h1>Your Chats 💬</h1>
      </div>

      <div className="groups-grid">
        {chats.map(chat => (
          <Link to={`/chat/${chat.id}`} key={chat.id} style={{ textDecoration: 'none' }}>
            <div className="group-card" style={{ display: 'flex', alignItems: 'center', padding: '15px', height: 'auto' }}>
              <div className="card-image" style={{ width: '60px', height: '60px', borderRadius: '50%', flexShrink: 0 }}></div>
              <div className="card-content" style={{ padding: '0 0 0 15px', flex: 1 }}>
                <div className="card-header" style={{ marginBottom: '5px' }}>
                  <h3 style={{ margin: 0 }}>{chat.title}</h3>
                </div>
                <p className="card-meta">Last active: Recently</p>
              </div>
              <div style={{ color: '#ff6b6b' }}>➜</div>
            </div>
          </Link>
        ))}
        {chats.length === 0 && <p style={{textAlign: 'center', color: '#999'}}>You haven't joined any groups yet.</p>}
      </div>
    </div>
  );
};