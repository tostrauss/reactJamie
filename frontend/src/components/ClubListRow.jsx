import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { thumbUrl } from '../utils/images';
import VerifiedBadge from './VerifiedBadge';

/**
 * One official club in the Clubs segment of Entdecken (Tina, 22.10.2026):
 * image left, then title + verified badge, the free-text category line under
 * it, and the member count — or "N anstehende Events" when the club has any.
 * Where the chevron used to be sits an "Events entdecken" button.
 *
 * The badge is NOT the trusted-user seal's meaning: `is_trusted_user` says a
 * PERSON verified themselves. Here it says the club was admitted as official
 * by us, so it carries its own label ("Offizieller Club") on title and aria.
 *
 * Both the row and its button open /club/:id — that is where this club's own
 * events are listed. The segment's hero CTA is the one that opens the global
 * /events discovery.
 */
const RowImage = memo(({ src, alt, fallbackChar }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div className="club-row-placeholder">{(fallbackChar || '?').slice(0, 1).toUpperCase()}</div>;
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
});

export const ClubListRow = memo(({ club, onOpen }) => {
  const { t } = useTranslation();

  const name = club.name || club.title || '';
  // The owner-maintained line ("Sport · Laufclub"). Falls back to the picked
  // categories, so a club that has not filled it in is not left blank.
  const categoryLine = club.category_label
    || (Array.isArray(club.categories) && club.categories.length ? club.categories.join(' · ') : null)
    || club.category
    || null;
  const members = club.member_count ?? club.members_count ?? 0;
  const events = Number(club.upcoming_events_count) || 0;

  return (
    <div
      className="club-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
    >
      <div className="club-row-image">
        <RowImage src={thumbUrl(club.image_url)} alt={name} fallbackChar={name} />
      </div>

      <div className="club-row-text">
        <div className="club-row-title-line">
          <h3 className="club-row-title">{name}</h3>
          <VerifiedBadge
            className="club-row-verified"
            size={16}
            title={t('home.clubRow.official')}
          />
        </div>
        {categoryLine && <p className="club-row-category">{categoryLine}</p>}
        <p className="club-row-meta">
          {events > 0
            ? t('home.clubRow.upcomingEvents', { count: events })
            : t('home.clubRow.members', { count: members })}
        </p>
      </div>

      {/* stopPropagation: the row itself is clickable, and both go to the same
          place — but the button must not fire the row's handler as well. */}
      <button
        type="button"
        className="club-row-cta"
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
      >
        {t('home.clubEventsDiscover')}
      </button>
    </div>
  );
});

export default ClubListRow;
