import React, { useEffect, useState } from 'react';
import api from '../utils/api';

export const GroupCard = ({
  group,
  isFavorite,
  isJoined,
  onFavorite,
  onJoin,
  onChat,
  onClick,
  onWaitlist
}) => {
  const [memberAvatars, setMemberAvatars] = useState([]);
  const [waitlistStatus, setWaitlistStatus] = useState(null);

  useEffect(() => {
    const fetchAvatars = async () => {
      try {
        const res = await api.groups.getMemberAvatars(group.id, 4);
        setMemberAvatars(res.data);
      } catch (err) {
        console.error('Failed to fetch avatars:', err);
      }
    };

    const fetchWaitlistStatus = async () => {
      if (group.members_count >= (group.max_members || 10)) {
        try {
          const res = await api.groups.getWaitlistStatus(group.id);
          setWaitlistStatus(res.data);
        } catch (err) {
          console.error('Failed to fetch waitlist:', err);
        }
      }
    };

    fetchAvatars();
    fetchWaitlistStatus();
  }, [group.id, group.members_count, group.max_members]);

  const isFull = group.members_count >= (group.max_members || 10);
  const maxMembers = group.max_members || 10;
  const emptySpots = Math.max(0, 4 - memberAvatars.length);
  const displayDate = group.date || "Demnächst";

  return (
    <div className={`group-card ${isFull ? 'full' : ''}`} onClick={onClick}>
      <div className="card-image-wrapper">
        <div className="card-member-avatars">
          <div className="avatars-grid">
            {memberAvatars.map((member) => (
              <div key={member.id} className="avatar-slot">
                {member.avatar_url ? (
                  <img src={member.avatar_url} alt={member.name} />
                ) : (
                  <div className="avatar-placeholder">
                    {(member.name || '?')[0].toUpperCase()}
                  </div>
                )}
              </div>
            ))}
            {[...Array(emptySpots)].map((_, idx) => (
              <div key={`empty-${idx}`} className="avatar-slot empty">
                <div className="avatar-gamble">?</div>
              </div>
            ))}
          </div>

          <div className="card-top-badges">
            {group.type && (
              <span className={`badge ${group.type}`}>
                {group.type === 'club' ? 'Club' : 'Gruppe'}
              </span>
            )}
            {group.category && (
              <span className="category-pill">{group.category}</span>
            )}
            {group.is_private && (
              <span className="category-pill" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                🔒 Privat
              </span>
            )}
            {isFull && (
              <span className="category-pill full-badge">Voll</span>
            )}
          </div>
        </div>
      </div>

      <div className="card-content">
        <div className="card-main-info">
          <h3>{group.title || group.name}</h3>
          <div className="card-status-row">
            <span className="status-members">
              <span className="icon">👥</span> {group.members_count}/{maxMembers}
            </span>
            <span className="status-date">{displayDate}</span>
          </div>
        </div>

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
            <button className="action-btn chat" onClick={(e) => {
              e.stopPropagation();
              if(onChat) onChat(group.id);
            }}>💬</button>
          ) : isFull ? (
            waitlistStatus?.on_waitlist ? (
              <button className="action-btn waitlist active" onClick={(e) => {
                e.stopPropagation();
                if (onWaitlist) onWaitlist(group.id, 'leave');
              }} title={`Position ${waitlistStatus.position}`}>
                ⏳ #{waitlistStatus.position}
              </button>
            ) : (
              <button className="action-btn waitlist" onClick={(e) => {
                e.stopPropagation();
                if (onWaitlist) onWaitlist(group.id, 'join');
              }}>⏳</button>
            )
          ) : (
            <button className="action-btn join" onClick={(e) => {
              e.stopPropagation();
              if (onJoin) onJoin(group.id);
            }}>+</button>
          )}
        </div>
      </div>
    </div>
  );
};
