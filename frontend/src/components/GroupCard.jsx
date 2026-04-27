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

function getBadgeLabel(displayDate) {
  if (displayDate) {
    if (displayDate.startsWith('Heute')) return 'Heute';
    if (displayDate.startsWith('Morgen')) return 'Morgen';
    if (displayDate.startsWith('Gestern')) return 'Gestern';
    // Extract just the date part (e.g. "12. Apr")
    return displayDate.split(' · ')[0];
  }
  return 'Für Dich';
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
      }
    };

    const fetchWaitlistStatus = async () => {
      if (group.members_count >= (group.max_members || 10)) {
        try {
          const res = await api.groups.getWaitlistStatus(group.id);
          setWaitlistStatus(res.data);
        } catch (err) {
        }
      }
    };

    fetchAvatars();
    fetchWaitlistStatus();
  }, [group.id, group.members_count, group.max_members]);

  const isFull      = group.members_count >= (group.max_members || 10);
  const maxMembers  = group.max_members || 10;
  const emptySpots  = Math.max(0, 4 - memberAvatars.length);
  const displayDate = formatDate(group.date);
  const badgeLabel  = getBadgeLabel(displayDate);

  return (
    <div className={`group-card ${isFull ? 'full' : ''}`} onClick={onClick}>

      {/* ── Top text section ─────────────────────────────── */}
      <div className="card-header">
        <div className="card-text-area">
          <h3 className="card-title">{group.category || group.title || group.name}</h3>
          <div className="card-subtitle-row">
            <span>{group.members_count}/{maxMembers} Members</span>
            {group.is_private && <span className="card-private-badge">🔒</span>}
            {group.is_boosted && <span className="card-private-badge">🚀</span>}
            {isFull && <span className="card-private-badge">Voll</span>}
          </div>
        </div>

        <span className="card-badge">{badgeLabel}</span>
      </div>

      {/* ── Photo grid ───────────────────────────────────── */}
      <div className="card-photo-grid">
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
            <button
              className="avatar-gamble"
              onClick={(e) => {
                e.stopPropagation();
                isJoined ? onChat?.(group.id) : onJoin?.(group.id);
              }}
            >+</button>
          </div>
        ))}

      </div>

    </div>
  );
};

export default GroupCard;
