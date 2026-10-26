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
 *
 * Edit mode (own profile only, Tina 22.10.2026): with `editMode` a tile is
 * no link any more — it greys out and carries „Bild ändern“, „Entfernen“
 * and a round coral X (same as „Entfernen“). `busyId` marks the tile whose
 * change is on its way. Without these props the grid renders as before
 * (other people's profiles never pass them).
 */
export function HallOfFameGrid({ events, onOpen, editMode = false, onRemove, onChangeImage, busyId = null }) {
  const { t, i18n } = useTranslation();
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
        if (editMode) {
          const busy = busyId === event.id;
          return (
            <div key={key} className={`hof-card hof-card--editing${busy ? ' hof-card--busy' : ''}`} aria-busy={busy || undefined}>
              {content}
              <button
                type="button"
                className="hof-edit-x"
                onClick={() => onRemove?.(event)}
                disabled={busy}
                aria-label={t('profile.memories.removeAria', { name: event.name })}
              >
                <span className="hof-edit-x-dot" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </span>
              </button>
              <div className="hof-edit-actions">
                <button type="button" className="hof-edit-btn" onClick={() => onChangeImage?.(event)} disabled={busy}>
                  {t('profile.memories.changeImage')}
                </button>
                <button type="button" className="hof-edit-btn hof-edit-btn--remove" onClick={() => onRemove?.(event)} disabled={busy}>
                  {t('profile.memories.remove')}
                </button>
              </div>
            </div>
          );
        }
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
