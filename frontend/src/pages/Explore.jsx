import { useState, useEffect, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import '../styles/explore.css';

const getCategoryIcon = (catName) => {
  if (!catName) return '✨';
  for (const cat of CATEGORY_HIERARCHY) {
    if (cat.label === catName || cat.id === catName) return cat.icon;
    const sub = cat.subs?.find(s => s.name === catName);
    if (sub) return sub.icon;
  }
  return '✨';
};

const formatTimeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Gerade eben';
  if (mins < 60) return `Vor ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Vor ${hrs} h`;
  return `Vor ${Math.floor(hrs / 24)}d`;
};

const formatCameraDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const isPast = (dateStr) => !!dateStr && new Date(dateStr) < new Date();

// Stable pastel color from a numeric seed
const seedColor = (id, offset = 0) =>
  `hsl(${((id + offset) * 137) % 360}, 55%, 52%)`;

// ─── FeedCard ────────────────────────────────────────────────────────────────

const FeedCard = memo(({ item, hallOfFame, navigate }) => {
  const icon = getCategoryIcon(item.category);
  const timeAgo = formatTimeAgo(item.created_at);

  return (
    <button className="ef-card" onClick={() => navigate(`/group/${item.id}`)}>
      {/* Photo */}
      <div className="ef-media">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} loading="lazy" className="ef-media-img" />
        ) : (
          <div className="ef-media-placeholder">
            <span className="ef-ph-icon">{icon}</span>
          </div>
        )}

        {/* Bottom-left: likes or timestamp */}
        {hallOfFame ? (
          <span className="ef-timestamp">{formatCameraDate(item.date || item.created_at)}</span>
        ) : (
          <span className="ef-likes">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            {item.members_count || 0}
          </span>
        )}

        {/* Bottom-right: stacked member avatars */}
        <div className="ef-avatars">
          <div className="ef-av" style={{ background: seedColor(item.id, 7) }} />
          <div className="ef-av" style={{ background: seedColor(item.id, 3) }} />
          <div className="ef-av ef-av--front">
            {item.owner_avatar
              ? <img src={item.owner_avatar} alt="" />
              : (item.owner_name || '?')[0].toUpperCase()}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="ef-footer">
        <div className="ef-user">
          <div className="ef-user-av">
            {item.owner_avatar
              ? <img src={item.owner_avatar} alt={item.owner_name} />
              : <span style={{ background: seedColor(item.id) }}>{(item.owner_name || '?')[0].toUpperCase()}</span>}
          </div>
          <div className="ef-user-meta">
            <p className="ef-user-name">{item.owner_name || 'Unbekannt'}</p>
            <p className="ef-user-time">{timeAgo}</p>
          </div>
        </div>
        {item.category && <span className="ef-cat">{item.category}</span>}
      </div>
    </button>
  );
});

// ─── Search results (kept from previous design) ──────────────────────────────

const SearchResults = memo(({ results, loading, navigate }) => {
  if (loading) return <div className="explore-loading"><div className="explore-spinner" /></div>;
  if (!results.length) return (
    <div className="explore-empty">
      <div className="explore-empty-icon">🔍</div>
      <p>Keine Ergebnisse gefunden</p>
    </div>
  );
  return (
    <div className="search-results-list">
      {results.map(item => {
        const icon = getCategoryIcon(item.category);
        return (
          <button key={`${item._type}-${item.id}`} className="sr-item" onClick={() => navigate(`/group/${item.id}`)}>
            <div className="sr-thumb">
              {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" /> : <span>{icon}</span>}
            </div>
            <div className="sr-body">
              <p className="sr-name">{item.name}</p>
              <p className="sr-meta">
                <span className={`sr-type-badge ${item._type}`}>{item._type === 'club' ? 'Club' : 'Gruppe'}</span>
                {' · '}{item.category}
              </p>
            </div>
            <svg className="sr-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        );
      })}
    </div>
  );
});

// ─── Main ────────────────────────────────────────────────────────────────────

export const Explore = () => {
  const navigate = useNavigate();

  const [activeTab, setActiveTab]     = useState('trend');
  const [loading, setLoading]         = useState(true);
  const [trendItems, setTrendItems]   = useState([]);
  const [hallItems, setHallItems]     = useState([]);

  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const searchRef  = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await groups.getAll({ limit: 50 });
        const all = res.data || [];
        if (!cancelled) {
          setTrendItems(all.filter(g => !isPast(g.date) || !g.date));
          setHallItems(all.filter(g => isPast(g.date)));
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const [gRes, cRes] = await Promise.all([
          groups.getAll({ search: searchQuery, limit: 10 }),
          clubs.getAll({ search: searchQuery, limit: 5 }),
        ]);
        setSearchResults([
          ...(gRes.data || []).map(g => ({ ...g, _type: 'group' })),
          ...(cRes.data || []).map(c => ({ ...c, _type: 'club' })),
        ]);
      } catch { /* silent */ }
      finally { setSearchLoading(false); }
    }, 380);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const feedItems = activeTab === 'trend' ? trendItems : hallItems;

  return (
    <div className="explore-container">

      {/* ── Sticky header ─────────────────────────────────────────── */}
      <div className="ef-sticky">
        <div className="ef-top">
          <h1 className="ef-logo">JAMIE</h1>
        </div>

        {/* Tabs */}
        <div className="ef-tabs">
          <button
            className={`ef-tab${activeTab === 'trend' ? ' active' : ''}`}
            onClick={() => setActiveTab('trend')}
          >
            Im Trend
          </button>
          <button
            className={`ef-tab${activeTab === 'halloffame' ? ' active' : ''}`}
            onClick={() => setActiveTab('halloffame')}
          >
            Hall of Fame
          </button>
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────────────────────── */}
      <div className="explore-content">

        {loading ? (
          <div className="explore-loading"><div className="explore-spinner" /></div>
        ) : feedItems.length === 0 ? (
          <div className="explore-empty">
            <div className="explore-empty-icon">{activeTab === 'halloffame' ? '🏆' : '🔥'}</div>
            <p>{activeTab === 'halloffame' ? 'Noch keine vergangenen Events' : 'Noch keine Gruppen'}</p>
          </div>
        ) : (
          <div className="ef-feed">
            {feedItems.map(item => (
              <FeedCard
                key={item.id}
                item={item}
                hallOfFame={activeTab === 'halloffame'}
                navigate={navigate}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
};

export default Explore;
