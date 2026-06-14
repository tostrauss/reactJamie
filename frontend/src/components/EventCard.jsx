import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { nextOccurrence } from '../utils/recurrence';

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Discover-event card used in the "Events für dich" row (Home → Clubs) and the
 * standalone Events page. Events are group rows (type='event'), so tapping one
 * opens the existing /group/:id detail page.
 *
 * Events carry no image of their own → fall back to the parent club's image.
 */
export function EventCard({ event }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const occ = nextOccurrence(event);
  const isToday = occ ? isSameDay(occ, new Date()) : false;
  const image = event.image_url || event.club_image;

  return (
    <button className="event-card" onClick={() => navigate(`/group/${event.id}`)}>
      <div className="event-card-head">
        <h4 className="event-card-title">{event.name}</h4>
        {isToday && <span className="event-card-badge">{t('events.todayBadge')}</span>}
      </div>
      {event.club_name && <p className="event-card-club">{event.club_name}</p>}
      <div className="event-card-media">
        {image
          ? <img src={image} alt="" loading="lazy" decoding="async" />
          : <div className="event-card-media-ph">📅</div>}
      </div>
    </button>
  );
}

export default EventCard;
