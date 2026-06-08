import React, { memo, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';

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

// Parse a date string into a locale-agnostic descriptor. Returns one of:
//   { kind: 'today'|'tomorrow'|'yesterday', time }
//   { kind: 'date', date, time }
// Locale-specific text composition happens in the component using t().
function parseDateDescriptor(dateStr, locale) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day   = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff  = Math.round((day - today) / 86400000);
    const time  = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    if (diff === 0)  return { kind: 'today',     time };
    if (diff === 1)  return { kind: 'tomorrow',  time };
    if (diff === -1) return { kind: 'yesterday', time };
    return {
      kind: 'date',
      date: d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
      time,
    };
  } catch {
    return null;
  }
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
  const { t, i18n } = useTranslation();
  const { isPro } = useContext(AuthContext) || {};
  const isClub = group.type === 'club';

  // member_previews is embedded by the backend — non-Pro callers get 3 entries,
  // Pro callers get 4. We render a Pro-gated blurry 4th slot whenever the group
  // has more members than the caller is allowed to preview.
  const memberAvatars = Array.isArray(group.member_previews) ? group.member_previews : [];

  const maxMembers  = group.max_members || 10;
  const isFull      = group.members_count >= maxMembers;
  const hiddenCount = Math.max(0, (group.members_count || 0) - memberAvatars.length);
  const showProGate = !isClub && !isPro && hiddenCount > 0;
  const emptySpots  = isClub ? 0 : Math.max(0, 4 - memberAvatars.length - (showProGate ? 1 : 0));
  // Clubs render an 8-slot (4×2) member grid when previews exist, falling back
  // to the full club image otherwise (e.g. a brand-new club with 0 joined members).
  const clubAvatars  = isClub ? memberAvatars.slice(0, 8) : [];
  const clubEmpty    = isClub ? Math.max(0, 8 - clubAvatars.length) : 0;

  const locale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';
  const descriptor = parseDateDescriptor(group.date, locale);
  // Badge sits in the corner of the card and shows just the "when" — Heute,
  // Morgen, Gestern, or a short month/day chip for other dates.
  let badgeLabel = null;
  if (descriptor) {
    if (descriptor.kind === 'today')     badgeLabel = t('groups.card.dateHeute');
    else if (descriptor.kind === 'tomorrow')  badgeLabel = t('groups.card.dateMorgen');
    else if (descriptor.kind === 'yesterday') badgeLabel = t('groups.card.dateGestern');
    else                                      badgeLabel = descriptor.date;
  }

  return (
    <div className={`group-card ${isFull ? 'full' : ''}${badgeLabel ? ' has-badge' : ''}`} onClick={onClick}>

      {/* ── Date badge ── */}
      {badgeLabel && <span className="card-badge">{badgeLabel}</span>}

      {/* ── Top text section ── */}
      <div className="card-header">
        <div className="card-text-area">
          <h3 className="card-title">
            {/* "Sonstiges" as a subcategory tells the user nothing about the
                actual group — fall back to the user-entered title in that case. */}
            {group.category && group.category.toLowerCase() !== 'sonstiges'
              ? group.category
              : (group.name || group.title || group.category)}
          </h3>
          <div className="card-subtitle-row">
            {isClub ? (
              <>
                <span>{group.members_count || 0} {t('groups.card.members')}</span>
                {group.location && (
                  <span className="card-club-location">📍 {group.location}</span>
                )}
              </>
            ) : (
              <span>{group.members_count}/{maxMembers} {t('groups.card.members')}</span>
            )}
            {!isClub && group.is_private && <span className="card-private-badge">🔒</span>}
            {!isClub && isFull && <span className="card-private-badge">{t('groups.card.full')}</span>}
            {group.is_boosted && <span className="card-private-badge">🚀</span>}
          </div>
        </div>
        {isClub && (
          <span className={`card-visibility-badge ${group.is_private ? 'private' : 'public'}`}>
            {group.is_private ? t('groups.card.privateBadge') : t('groups.card.publicBadge')}
          </span>
        )}
      </div>

      {/* ── Photo grid ── */}
      <div className="card-photo-grid">
        {isClub ? (
          <div className="avatar-slot card-club-full-image" style={{ gridColumn: '1 / -1', gridRow: '1 / -1', borderRadius: '9px' }}>
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
            {showProGate && (
              <div className="avatar-slot pro-gate">
                <div className="avatar-pro-gate-blur" aria-hidden="true" />
                <button
                  className="avatar-gamble pro-gate-plus"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/group/${group.id}`);
                  }}
                  aria-label={t('groups.card.proGateAria')}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
              </div>
            )}
            {[...Array(emptySpots)].map((_, idx) => (
              <div key={`empty-${idx}`} className="avatar-slot empty">
                <button
                  className="avatar-gamble"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/group/${group.id}`);
                  }}
                  aria-label={t('groups.card.joinAria')}
                >
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M5 1v8M1 5h8"/>
                  </svg>
                </button>
              </div>
            ))}
          </>
        )}
      </div>

    </div>
  );
});

export default GroupCard;
