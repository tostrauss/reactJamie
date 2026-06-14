import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs as clubsApi } from '../utils/api';
import { EventCard } from '../components/EventCard';
import '../styles/home.css';

/**
 * Standalone Events discovery page (/events). Reached from the "Club Events
 * entdecken" CTA and the "Events für dich" row in the Clubs tab. Shows upcoming
 * events from PUBLIC clubs and lets the user search by event or club name.
 */
export const Events = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    clubsApi.discoverEvents()
      .then(res => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.club_name || '').toLowerCase().includes(q)
    );
  }, [events, query]);

  return (
    <div className="events-page">
      <div className="events-page-header">
        <button className="events-page-back" onClick={() => navigate(-1)} aria-label={t('common.back', { defaultValue: 'Zurück' })}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="events-page-title">{t('events.title')}</h1>
        <div style={{ width: 38 }} />
      </div>

      <div className="events-search-wrap">
        <input
          className="events-search"
          type="text"
          placeholder={t('events.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <h2 className="events-section-title">{t('events.forYou')}</h2>

      {loading ? (
        <div className="home-loading"><div className="home-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <p>{query ? t('events.emptySearch') : t('events.empty')}</p>
        </div>
      ) : (
        <div className="events-grid">
          {filtered.map(ev => <EventCard key={ev.id} event={ev} />)}
        </div>
      )}
    </div>
  );
};

export default Events;
