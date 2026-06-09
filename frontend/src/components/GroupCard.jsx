import React, { memo, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { nextOccurrence } from '../utils/recurrence';

// Dispatched on every Pro-gate click (member-preview lock on group cards).
// AppRoutes listens for this and opens <ProModal />. Using a window event
// avoids threading a "showProModal" setter through context just so a card
// deep in a virtualized list can open the upgrade sheet.
export const PRO_MODAL_EVENT = 'jamie:open-pro-modal';
const openProModal = () => window.dispatchEvent(new CustomEvent(PRO_MODAL_EVENT));

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
function parseDateDescriptor(dateInput, locale) {
  if (!dateInput) return null;
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
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

  // member_previews is embedded by the backend. Non-Pro users never see who's
  // inside: the entire photo grid is blurred and a single lock overlay sits
  // over it (the avatars are still rendered so a Pro upgrade animates from
  // "blurred silhouettes" → "real faces" instead of from black).
  const memberAvatars = Array.isArray(group.member_previews) ? group.member_previews : [];

  const maxMembers  = group.max_members || 10;
  const isFull      = group.members_count >= maxMembers;
  const emptySpots  = isClub ? 0 : Math.max(0, 4 - memberAvatars.length);
  // Show the Pro lock for every non-Pro viewer. Gamification: even an empty
  // group teases "unlock to see who joins" — the lock is the cue, not the
  // member count. Pro users see real faces with no overlay.
  const showProLock = !isPro;

  const locale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';
  // Recurring groups: badge tracks the next occurrence so a Tuesday meetup
  // never says "Gestern" on Wednesday — it just rolls forward to next Tuesday.
  const displayDate = nextOccurrence(group);
  const descriptor = parseDateDescriptor(displayDate, locale);
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
                actual group — fall back to the user-entered title in that case.
                Hyphens are replaced with U+2011 (non-breaking hyphen) so titles
                like "Bar-Hopping" don't wrap onto two lines — browsers always
                allow line breaks at a regular hyphen regardless of CSS. */}
            {(group.category && group.category.toLowerCase() !== 'sonstiges'
              ? group.category
              : (group.name || group.title || group.category) || ''
            ).replace(/-/g, '‑')}
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
            {!isClub && group.is_recurring_weekly && (
              <span className="card-private-badge card-recurring-badge" title={t('groups.card.weeklyTitle')}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                {t('groups.card.weekly')}
              </span>
            )}
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
      <div className={`card-photo-grid${showProLock ? ' is-pro-locked' : ''}`}>
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
            {[...Array(emptySpots)].map((_, idx) => (
              <div key={`empty-${idx}`} className="avatar-slot empty">
                <button
                  className="avatar-gamble"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/group/${group.id}`);
                  }}
                  aria-label={t('groups.card.joinAria')}
                  // Hide the "+" join slot behind the Pro lock so non-Pro
                  // viewers see one focal CTA (the lock) instead of two.
                  tabIndex={showProLock ? -1 : 0}
                >
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M5 1v8M1 5h8"/>
                  </svg>
                </button>
              </div>
            ))}
          </>
        )}

        {showProLock && (
          <button
            type="button"
            className="card-pro-overlay"
            onClick={(e) => {
              e.stopPropagation();
              openProModal();
            }}
            aria-label={t('groups.card.proGateAria')}
          >
            <span className="card-pro-overlay-blur" aria-hidden="true" />
            <span className="card-pro-lock-badge" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2.5" />
                <path d="M8 11V8a4 4 0 1 1 8 0v3" />
              </svg>
            </span>
            <span className="card-pro-lock-caption">{t('groups.card.proLockCaption')}</span>
          </button>
        )}
      </div>

    </div>
  );
});

export default GroupCard;
