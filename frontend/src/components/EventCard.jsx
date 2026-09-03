import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { nextOccurrence } from '../utils/recurrence';

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Map the i18n language to a full BCP-47 locale for date formatting.
const DATE_LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', it: 'it-IT' };

/**
 * Discover-event card used in the "Events für dich" row (Home → Clubs) and the
 * standalone Events page. Events are group rows (type='event'), so tapping one
 * opens the existing /group/:id detail page.
 *
 * Events carry no image of their own → fall back to the parent club's image.
 */
export function EventCard({ event }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const occ = nextOccurrence(event);
  const isToday = occ ? isSameDay(occ, new Date()) : false;
  const image = event.image_url || event.club_image;

  // Date + location on the card — so people can judge an event at a glance
  // without opening it (Tina, 03.09).
  const locale = DATE_LOCALES[i18n.language?.slice(0, 2)] || 'de-DE';
  let dateLabel = null;
  if (occ) {
    dateLabel = occ.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    // Append the time only when one was actually set (date-only events store 00:00).
    if (occ.getHours() !== 0 || occ.getMinutes() !== 0) {
      dateLabel += ', ' + occ.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
  }

  return (
    <button className="event-card" onClick={() => navigate(`/group/${event.id}`)}>
      <div className="event-card-head">
        <h4 className="event-card-title">{event.name}</h4>
        {isToday && <span className="event-card-badge">{t('events.todayBadge')}</span>}
      </div>
      {event.club_name && <p className="event-card-club">{event.club_name}</p>}
      {(dateLabel || event.location) && (
        <div className="event-card-meta">
          {dateLabel && <span className="event-card-meta-item">📅 {dateLabel}</span>}
          {event.location && (
            <span className="event-card-meta-item event-card-meta-loc">📍 {event.location}</span>
          )}
        </div>
      )}
      <div className="event-card-media">
        {image
          ? <img src={image} alt="" loading="lazy" decoding="async" />
          : <div className="event-card-media-ph">📅</div>}
      </div>
    </button>
  );
}

export default EventCard;
