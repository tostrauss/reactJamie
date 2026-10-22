import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coverCardUrl } from '../utils/images';

/**
 * A community in the Communities segment of Entdecken (Tina, 22.10.2026):
 * orange category bubble on top, then the title, then the member count, then
 * the cover.
 *
 * Its own component rather than another branch in GroupCard: that one belongs
 * to the Gruppen feed (dates, waitlists, the Pro gate on the 4th avatar tile)
 * and carries its own test file. Nothing here needs any of it, and this card
 * deliberately has NO join or plus affordance — tapping it opens the community,
 * where joining is a decision with context.
 */
const CoverImage = memo(({ src, alt, fallbackChar }) => {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!src || broken) {
    return (
      <div className="avatar-placeholder" style={{ fontSize: 48, fontWeight: 700 }}>
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

export const CommunityCard = memo(({ community, emojiFor, onClick }) => {
  const { t } = useTranslation();

  const name = community.name || community.title || '';
  // Multi-category clubs keep up to 3 in `categories`; categories[0] is the
  // primary and the only one that fits a bubble.
  const category = (Array.isArray(community.categories) && community.categories[0])
    || community.category
    || null;
  // The server sends member_count on some surfaces and members_count on
  // others — renderClubCard normalised this before, so keep both.
  const members = community.member_count ?? community.members_count ?? 0;

  return (
    <div
      className="group-card community-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      <div className="card-header">
        <div className="card-text-area">
          {category && (
            <span className="community-card-category">
              {emojiFor ? `${emojiFor(category)} ` : ''}{category}
            </span>
          )}
          {/* Hyphens → U+2011 so a name like "Bar-Hopping" does not wrap
              (same treatment as GroupCard). */}
          <h3 className="card-title community-card-title">{name.replace(/-/g, '‑')}</h3>
          <div className="community-card-meta">
            <span>{t('home.clubRow.members', { count: members })}</span>
            {/* A private community needs a request, which is worth knowing
                BEFORE tapping — the only badge this layout keeps. */}
            {community.is_private && (
              <span className="community-card-lock" title={t('home.clubRow.privateHint')}>
                🔒
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card-photo-grid">
        <div
          className="avatar-slot card-club-full-image"
          style={{ gridColumn: '1 / -1', gridRow: '1 / -1', borderRadius: '9px' }}
        >
          <CoverImage src={coverCardUrl(community.image_url)} alt={name} fallbackChar={category || name} />
        </div>
      </div>
    </div>
  );
});

export default CommunityCard;
