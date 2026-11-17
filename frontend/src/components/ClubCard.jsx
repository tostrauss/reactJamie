import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { coverCardUrl } from '../utils/images';
import { CoverImage } from './CommunityCard';
import VerifiedBadge from './VerifiedBadge';
import '../styles/club-card.css';

/**
 * One official club in the Clubs segment of Entdecken (Tina 17.11.2026: „Ich
 * finde die Clubs sind leider zu klein. Lass sie uns doch auch so machen wie
 * die Community! Nur dass unter dem Bild dann der ‚Events entdecken‘ Button
 * ist. Und neben dem Namen dieser Haken. Den Haken bekommen nur Partner, die
 * bezahlen.“). It replaces the small rows of 22.10.2026 (ClubListRow).
 *
 * The same card as CommunityCard — category bubble, title, member count, the
 * cover across the full width — plus two things:
 *   ✓  beside the name, ONLY for a paying partner (club.is_paid_partner ===
 *      true, the admin's flag). An official club that does not pay has no
 *      tick; a server that does not send the field means none either.
 *   „Events entdecken“ under the picture.
 *
 * The bubble shows the club's own category line („Bar-Hopping · Rooftop“,
 * category_label) where it has one, else its first category with the emoji
 * like a community, else the plain category.
 *
 * Card and button both open /club/:id — that is where this club's own events
 * are listed. The segment's hero button is the one for the global /events.
 */
export const ClubCard = memo(({ club, emojiFor, onOpen }) => {
  const { t } = useTranslation();

  const name = club.name || club.title || '';
  const first = (Array.isArray(club.categories) && club.categories[0]) || club.category || null;
  const bubble = club.category_label
    || (first ? `${emojiFor ? `${emojiFor(first)} ` : ''}${first}` : null);
  // The server sends member_count on some surfaces and members_count on others.
  const members = club.member_count ?? club.members_count ?? 0;

  return (
    <div
      className="group-card community-card club-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card's own key press — Enter on the button inside bubbles
        // up here too and must not open the club twice.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); }
      }}
    >
      <div className="card-header">
        <div className="card-text-area">
          {bubble && <span className="community-card-category">{bubble}</span>}
          <div className="club-card-title-line">
            {/* Hyphens → U+2011 so a name like "Bar-Hopping" does not wrap
                (same treatment as CommunityCard). */}
            <h3 className="card-title community-card-title">{name.replace(/-/g, '‑')}</h3>
            {club.is_paid_partner === true && (
              <VerifiedBadge className="club-card-verified" size={18} title={t('profile.clubs.partnerAria')} />
            )}
          </div>
          <div className="community-card-meta">
            <span>{t('home.clubRow.members', { count: members })}</span>
            {club.is_private && (
              <span className="community-card-lock" title={t('home.clubRow.privateHint')}>
                🔒
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card-photo-grid club-card-photo">
        <div
          className="avatar-slot card-club-full-image"
          style={{ gridColumn: '1 / -1', gridRow: '1 / -1', borderRadius: '9px' }}
        >
          <CoverImage src={coverCardUrl(club.image_url)} alt={name} fallbackChar={first || name} />
        </div>
      </div>

      {/* stopPropagation: the card itself is clickable, and both go to the
          same place — but the button must not fire the card's handler too. */}
      <button
        type="button"
        className="club-card-cta"
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
      >
        {t('home.clubEventsDiscover')}
      </button>
    </div>
  );
});

export default ClubCard;
