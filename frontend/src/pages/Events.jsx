import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs as clubsApi } from '../utils/api';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import { EventCard } from '../components/EventCard';
import '../styles/home.css';

// category name (lowercase) → emoji, flattened from the shared hierarchy so the
// filter pills match the icons used everywhere else.
const CAT_EMOJI = (() => {
  const m = {};
  for (const main of CATEGORY_HIERARCHY) {
    if (main.label) m[main.label.toLowerCase()] = main.icon;
    for (const sub of (main.subs || [])) m[sub.name.toLowerCase()] = sub.icon;
  }
  return m;
})();
const emojiFor = (cat) => CAT_EMOJI[(cat || '').toLowerCase()] || '🎉';

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Standalone Events discovery page (/events). Reached from the "Club Events
 * entdecken" CTA in the Clubs tab. Shows upcoming events from ALL clubs (public
 * AND private — Robert 2026-06-17) and lets the user filter by time (today /
 * this week / all), by category, and search by event or club name.
 */
export const Events = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [time, setTime] = useState('all');         // 'all' | 'today' | 'week'
  const [category, setCategory] = useState(null);  // category name, or null = all

  useEffect(() => {
    clubsApi.discoverEvents()
      .then(res => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  // Category pills are built from the categories actually present in the feed,
  // so we never show an empty filter.
  const categories = useMemo(() => {
    const set = new Set();
    for (const e of events) if (e.category) set.add(e.category);
    return [...set].sort((a, b) => a.localeCompare(b, 'de'));
  }, [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    // "This weekend" = the Sat+Sun of the current week. On Sun the Sat already
    // passed (offset -1); clamp the start to today since past events aren't in
    // the feed anyway. End is the Monday 00:00 after that Saturday (exclusive).
    const dow = now.getDay(); // 0=Sun … 6=Sat
    const offsetToSat = dow === 0 ? -1 : (6 - dow);
    const satStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToSat);
    const weekendStart = satStart < dayStart ? dayStart : satStart;
    const weekendEnd = new Date(satStart.getFullYear(), satStart.getMonth(), satStart.getDate() + 2);
    return events.filter(e => {
      if (q && !((e.name || '').toLowerCase().includes(q) || (e.club_name || '').toLowerCase().includes(q))) return false;
      if (category && (e.category || '') !== category) return false;
      if (time !== 'all') {
        if (!e.date) return false; // undated events only show under "Alle"
        const d = new Date(e.date);
        if (time === 'today' && !sameDay(d, now)) return false;
        if (time === 'weekend' && (d < weekendStart || d >= weekendEnd)) return false;
        if (time === 'week' && (d < dayStart || d >= weekEnd)) return false;
      }
      return true;
    });
  }, [events, query, category, time]);

  const TIME_FILTERS = [
    { key: 'all',     label: t('events.filters.all') },
    { key: 'today',   label: t('events.filters.today') },
    { key: 'weekend', label: t('events.filters.weekend') },
    { key: 'week',    label: t('events.filters.week') },
  ];

  const isFiltering = !!query || !!category || time !== 'all';

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

      {/* Time filter */}
      <div className="events-filter-row">
        {TIME_FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            className={`events-filter-pill${time === f.key ? ' active' : ''}`}
            onClick={() => setTime(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Category filter — horizontally scrollable, only when categories exist */}
      {categories.length > 0 && (
        <div className="events-filter-row events-filter-row--scroll">
          <button
            type="button"
            className={`events-filter-pill${category === null ? ' active' : ''}`}
            onClick={() => setCategory(null)}
          >
            {t('events.filters.allCategories')}
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              className={`events-filter-pill${category === cat ? ' active' : ''}`}
              onClick={() => setCategory(category === cat ? null : cat)}
            >
              {emojiFor(cat)} {cat}
            </button>
          ))}
        </div>
      )}

      <h2 className="events-section-title">{t('events.forYou')}</h2>

      {loading ? (
        <div className="home-loading"><div className="home-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <p>{isFiltering ? t('events.emptyFiltered') : t('events.empty')}</p>
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
