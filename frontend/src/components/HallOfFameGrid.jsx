import { useTranslation } from 'react-i18next';
import '../styles/hall-of-fame.css';

const dateLocaleFor = (lng = 'de') => {
  if (lng.startsWith('en')) return 'en-US';
  if (lng.startsWith('it')) return 'it-IT';
  if (lng.startsWith('fr')) return 'fr-FR';
  if (lng.startsWith('es')) return 'es-ES';
  return 'de-AT';
};

/**
 * The events someone took part in, as a two-column grid — shared by the own
 * profile and other people's (Lea, 18.10.2026: „die anderen sehen die Hall of
 * Fame von einem nicht"). Rows come from GET /api/users/:id/hall-of-fame;
 * cover_url is already the best photo (own photo → moment → event image).
 *
 * An event its owner deleted after the day stays in the list — it happened —
 * but has no page left to open, so that card is not a button.
 */
export function HallOfFameGrid({ events, onOpen }) {
  const { i18n } = useTranslation();
  const dateLocale = dateLocaleFor(i18n.resolvedLanguage || i18n.language);

  return (
    <div className="hof-grid">
      {events.map((event) => {
        const content = (
          <>
            <div className="hof-card-img">
              {event.cover_url
                ? <img src={event.cover_url} alt={event.name} loading="lazy" decoding="async" />
                : <div className="hof-card-placeholder">🏆</div>}
              <div className="hof-card-overlay" />
            </div>
            <div className="hof-card-body">
              <p className="hof-card-name">{event.name}</p>
              <p className="hof-card-date">
                {new Date(event.date).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              {event.location && <p className="hof-card-loc">📍 {event.location}</p>}
            </div>
          </>
        );
        const key = `hof-${event.id}`;
        if (event.is_deleted || !onOpen) {
          return <div key={key} className="hof-card hof-card--static">{content}</div>;
        }
        return (
          <button key={key} type="button" className="hof-card" onClick={() => onOpen(event)}>
            {content}
          </button>
        );
      })}
    </div>
  );
}

export default HallOfFameGrid;
