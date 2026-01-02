import React from 'react';
import '../styles/home.css';

export const GroupCard = ({ group, isFavorite, isJoined, onFavorite, onJoin, onChat, customImage, onClick }) => {
  // Use uploaded image OR fallback to gradient
  const imageUrl = customImage || group.image_url;
  const bgStyle = imageUrl
    ? { backgroundImage: `url(${imageUrl})` }
    : { background: `linear-gradient(135deg, #ff6b6b, #ff8585)` };

  // Format members text "4/6 Members" (Mocking max if missing)
  const maxMembers = group.max_members || group.maxMembers || 6; 
  const memberRatio = `${group.member_count || 0}/${maxMembers} Members`;

  // Format Date (e.g. "Heute" or specific date)
  const displayDate = group.date || "Demnächst";

  return (
    <div className="group-card" onClick={onClick}>
      <div className="card-image-wrapper">
        <div className="card-image" style={bgStyle}>
          {/* Category Pill Overlay */}
          <div className="card-image-overlay">
            <div className="card-top-badges">
              {group.category && (
                <span className="category-pill">{group.category}</span>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="card-content">
        <div className="card-main-info">
          <h3>{group.title}</h3>
          
          <div className="card-status-row">
            <span className="status-members">
              <span className="icon">👥</span> {memberRatio}
            </span>
            <span className="status-date">
              {displayDate}
            </span>
          </div>
        </div>
        
        {/* Action Button (Join/Chat/Fav) */}
        <div className="card-actions">
           <button
            className={`fav-btn-small ${isFavorite ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (onFavorite) onFavorite(group.id);
            }}
          >
            {isFavorite ? '❤️' : '🤍'}
          </button>

          {isJoined ? (
            <button 
              className="action-btn chat"
              onClick={(e) => {
                e.stopPropagation();
                if(onChat) onChat(group.id);
              }}
            >
              💬
            </button>
          ) : (
            <button
              className="action-btn join"
              onClick={(e) => {
                e.stopPropagation();
                if (onJoin) onJoin(group.id);
              }}
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
};