import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

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
    return displayDate.split(' · ')[0];
  }
  return null;
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
  const navigate = useNavigate();
  const [memberAvatars, setMemberAvatars] = useState([]);
  const isClub = group.type === 'club';

  useEffect(() => {
    if (isClub) return; // clubs show creator image, no member avatars needed
    const fetchAvatars = async () => {
      try {
        const res = await api.groups.getMemberAvatars(group.id, 4);
        setMemberAvatars(res.data);
      } catch {}
    };
    fetchAvatars();
  }, [group.id, isClub]);

  const maxMembers  = group.max_members || 10;
  const isFull      = group.members_count >= maxMembers;
  const emptySpots  = isClub ? 0 : Math.max(0, 4 - memberAvatars.length);
  const displayDate = formatDate(group.date);
  const badgeLabel  = getBadgeLabel(displayDate);

  return (
    <div className={`group-card ${isFull ? 'full' : ''}${badgeLabel ? ' has-badge' : ''}`} onClick={onClick}>

      {/* ── Date badge — absolute top-right corner ───────── */}
      {badgeLabel && <span className="card-badge">{badgeLabel}</span>}

      {/* ── Top text section ─────────────────────────────── */}
      <div className="card-header">
        <div className="card-text-area">
          <h3 className="card-title">{group.category || group.title || group.name}</h3>
          <div className="card-subtitle-row">
            <span>{group.members_count}/{maxMembers} Members</span>
            {group.is_private && <span className="card-private-badge">🔒</span>}
            {isFull && <span className="card-private-badge">Voll</span>}
            {group.is_boosted && <span className="card-private-badge">🚀</span>}
          </div>
        </div>
      </div>

      {/* ── Photo grid (bottom) ──────────────────────────── */}
      <div className="card-photo-grid">
        {isClub ? (
          <div className="avatar-slot card-club-full-image" style={{ gridColumn: '1 / -1', gridRow: '1 / -1', borderRadius: '12px' }}>
            {group.image_url ? (
              <img src={group.image_url} alt={group.name || group.title} loading="lazy" />
            ) : (
              <div className="avatar-placeholder" style={{ fontSize: 48, fontWeight: 700 }}>
                {(group.category || group.name || group.title || '?')[0].toUpperCase()}
              </div>
            )}
          </div>
        ) : (
          <>
            {memberAvatars.map((member) => (
              <div key={member.id} className="avatar-slot">
                {member.avatar_url ? (
                  <img src={member.avatar_url} alt={member.name} loading="lazy" />
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
                    navigate(`/group/${group.id}`);
                  }}
                >+</button>
              </div>
            ))}
          </>
        )}
      </div>

    </div>
  );
};

export default GroupCard;
