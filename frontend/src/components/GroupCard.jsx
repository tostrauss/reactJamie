import React from 'react';
import '../styles/home.css'; // Reusing existing styles

export const GroupCard = ({ group, isFavorite, isJoined, onFavorite, onJoin, onChat }) => {
  return (
    <div className="group-card">
      <div 
        className="card-image" 
        style={{ background: `linear-gradient(135deg, #ff6b6b, #ff8585)` }}
      ></div>
      
      <div className="card-content">
        <div className="card-header">
          <h3>{group.title}</h3>
          <span className={`badge ${group.type}`}>{group.type}</span>
        </div>
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
              onClick={() => onChat ? onChat(group.id) : null}
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