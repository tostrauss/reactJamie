import React, { useEffect, useState } from 'react';
import api from '../utils/api';

// Format ISO date → German readable string
function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day   = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff  = Math.round((day - today) / 86400000);
    const time  = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return `Heute · ${time} Uhr`;
    if (diff === 1) return `Morgen · ${time} Uhr`;
    if (diff === -1) return `Gestern · ${time} Uhr`;
    const date  = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
    return `${date} · ${time} Uhr`;
  } catch {
    return null;
  }
}

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

  const isFull     = group.members_count >= (group.max_members || 10);
  const maxMembers = group.max_members || 10;
  const emptySpots = Math.max(0, 4 - memberAvatars.length);
  const displayDate = formatDate(group.date);

  return (
    <div className={`group-card ${isFull ? 'full' : ''}`} onClick={onClick}>

      {/* ── Full-card 2×2 avatar grid ─────────────────── */}
      <div className="card-avatars-full">
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

      {/* ── Gradient overlay ──────────────────────────── */}
      <div className="card-overlay">

        {/* Top: badges */}
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
          {group.is_boosted && (
            <span className="category-pill boost-badge">🚀 Boost</span>
          )}
        </div>

        {/* Bottom: title, date, actions */}
        <div className="card-bottom-info">
          <h3 className="card-title">{group.title || group.name}</h3>

          <div className="card-status-row">
            <span className="status-members">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              {group.members_count}/{maxMembers}
            </span>
            {displayDate && (
              <span className="status-date">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12,6 12,12 16,14"/>
                </svg>
                {displayDate}
              </span>
            )}
          </div>

          <div className="card-actions">
            <button
              className={`fav-btn-small ${isFavorite ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (onFavorite) onFavorite(group.id); }}
            >
              {isFavorite
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="#FD7666" stroke="#FD7666" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              }
            </button>

            {isJoined ? (
              <button className="action-btn chat" onClick={(e) => {
                e.stopPropagation();
                if (onChat) onChat(group.id);
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
              </button>
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
    </div>
  );
};

export default GroupCard;
