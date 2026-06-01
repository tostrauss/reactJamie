import React, { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Renders an avatar image with graceful fallback. If the URL is missing, fails
// to load, or returns a non-image response (e.g. SPA index.html for a stale path),
// we drop the <img> entirely and show the initial-letter placeholder instead.
const AvatarImage = memo(({ src, alt, fallbackChar, placeholderStyle }) => {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!src || broken) {
    return (
      <div className="avatar-placeholder" style={placeholderStyle}>
        {(fallbackChar || '?').slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`card-img-fade${loaded ? ' loaded' : ''}`}
      onLoad={() => setLoaded(true)}
      onError={() => setBroken(true)}
    />
  );
});

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

export const GroupCard = memo(({
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
  const isClub = group.type === 'club';

  // member_previews is embedded by the backend — no extra fetch needed
  const memberAvatars = Array.isArray(group.member_previews) ? group.member_previews : [];

  const maxMembers  = group.max_members || 10;
  const isFull      = group.members_count >= maxMembers;
  const emptySpots  = isClub ? 0 : Math.max(0, 4 - memberAvatars.length);
  const displayDate = formatDate(group.date);
  const badgeLabel  = getBadgeLabel(displayDate);

  return (
    <div className={`group-card ${isFull ? 'full' : ''}${badgeLabel ? ' has-badge' : ''}`} onClick={onClick}>

      {/* ── Date badge ── */}
      {badgeLabel && <span className="card-badge">{badgeLabel}</span>}

      {/* ── Top text section ── */}
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

      {/* ── Photo grid ── */}
      <div className="card-photo-grid">
        {isClub ? (
          <div className="avatar-slot card-club-full-image" style={{ gridColumn: '1 / -1', gridRow: '1 / -1', borderRadius: '12px' }}>
            <AvatarImage
              src={group.image_url}
              alt={group.name || group.title || ''}
              fallbackChar={group.category || group.name || group.title}
              placeholderStyle={{ fontSize: 48, fontWeight: 700 }}
            />
          </div>
        ) : (
          <>
            {memberAvatars.map((member) => (
              <div key={member.id} className="avatar-slot">
                <AvatarImage
                  src={member.avatar_url}
                  alt={member.name || ''}
                  fallbackChar={member.name}
                />
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
});

export default GroupCard;
