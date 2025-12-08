import React from 'react';
import '../styles/home.css';

export const GroupCard = ({ group, isFavorite, isJoined, onFavorite, onJoin, onChat, customImage }) => {
  // Use uploaded image OR fallback to gradient
  const bgStyle = (customImage || group.image_url) 
    ? { backgroundImage: `url(${customImage || group.image_url})` }
    : { background: `linear-gradient(135deg, #ff6b6b, #ff8585)` };

  return (
    <div className="group-card">
      <div className="card-image" style={bgStyle}></div>
      
      <div className="card-content">
        <div className="card-header">
          <h3>{group.title}</h3>
          <span className={`badge ${group.type}`}>{group.type}</span>
        </div>
        
        {/* ADDED Category Badge if exists */}
        {group.category && (
          <span style={{ fontSize: '10px', color: '#ccc', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', marginBottom: '5px', display: 'inline-block' }}>
            {group.category}
          </span>
        )}

        <p className="card-meta">👥 {group.member_count} members • by {group.owner_name}</p>
        <p className="card-desc">{group.description}</p>
        
        <div className="card-footer">
          <button
            className={`fav-btn ${isFavorite ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onFavorite(group.id);
            }}
          >
            ❤️
          </button>
          
          {isJoined ? (
            <button 
              className="join-btn joined"
              onClick={(e) => {
                e.stopPropagation();
                if(onChat) onChat(group.id);
              }}
            >
              💬 Chat
            </button>
          ) : (
            <button
              className="join-btn"
              onClick={(e) => {
                e.stopPropagation();
                onJoin(group.id);
              }}
            >
              Join
            </button>
          )}
        </div>
      </div>
    </div>
  );
};