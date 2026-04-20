import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import '../styles/explore.css';

// ─── helpers ────────────────────────────────────────────────────────────────

const getCategoryIcon = (catName) => {
  for (const cat of CATEGORY_HIERARCHY) {
    if (cat.label === catName || cat.id === catName) return cat.icon;
    const sub = cat.subs?.find(s => s.name === catName);
    if (sub) return sub.icon;
  }
  return '✨';
};

const formatDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 0) {
    // future
    return d.toLocaleDateString('de-AT', { day: '2-digit', month: 'short' });
  }
  if (diff < 86400000 * 7) return `vor ${Math.ceil(diff / 86400000)}d`;
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: 'short' });
};

const isPast = (dateStr) => {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
};

// ─── sub-components ─────────────────────────────────────────────────────────

const StoryCircle = ({ item, navigate }) => {
  return (
    <button className="story-circle" onClick={() => navigate(`/group/${item.id}`)}>
      <div className="story-ring">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="story-img" />
        ) : (
          <div className="story-placeholder">{(item.name || '?')[0]}</div>
        )}
      </div>
      <span className="story-label">{item.name}</span>
    </button>
  );
};

const ExploreCard = ({ item, navigate }) => {
  const past = isPast(item.date);
  return (
    <button className={`ec-card ${past ? 'ec-card--past' : ''}`} onClick={() => navigate(`/group/${item.id}`)}>
      <div className="ec-img-wrap">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="ec-img" />
        ) : (
          <div className="ec-img-placeholder">{(item.name || '?')[0]}</div>
        )}
        {past && <span className="ec-past-badge">Vergangen</span>}
        {item.is_boosted && <span className="ec-boost-badge">Boost</span>}
      </div>
      <div className="ec-body">
        <p className="ec-cat">{item.category}</p>
        <h3 className="ec-title">{item.name}</h3>
        <div className="ec-meta">
          <span>{item.current_members ?? 0}/{item.max_members}</span>
          {item.date && <span>{formatDate(item.date)}</span>}
        </div>
      </div>
    </button>
  );
};

const TrendingCard = ({ item, navigate }) => {
  const fillPct = item.max_members
    ? Math.round(((item.current_members ?? 0) / item.max_members) * 100)
    : 0;
  return (
    <button className="tc-card" onClick={() => navigate(`/group/${item.id}`)}>
      <div className="tc-img-wrap">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="tc-img" />
        ) : (
          <div className="tc-img-placeholder">{(item.name || '?')[0]}</div>
        )}
      </div>
      <div className="tc-body">
        <div className="tc-top">
          <span className="tc-cat-badge">{item.category}</span>
          {item.location && <span className="tc-location">{item.location}</span>}
        </div>
        <h3 className="tc-title">{item.name}</h3>
        {item.description && (
          <p className="tc-desc">{item.description}</p>
        )}
        <div className="tc-footer">
          <div className="tc-fill-bar">
            <div className="tc-fill-inner" style={{ width: `${fillPct}%` }} />
          </div>
          <span className="tc-fill-label">
            {item.current_members ?? 0} / {item.max_members} Mitglieder
          </span>
        </div>
      </div>
    </button>
  );
};

const PastEventCard = ({ item, tall, navigate }) => {
  return (
    <button
      className={`pe-card ${tall ? 'pe-card--tall' : ''}`}
      onClick={() => navigate(`/group/${item.id}`)}
    >
      {item.image_url ? (
        <img src={item.image_url} alt={item.name} className="pe-img" />
      ) : (
        <div className="pe-placeholder">{(item.name || '?')[0]}</div>
      )}
      <div className="pe-overlay">
        <span className="pe-cat">{item.category}</span>
        <div className="pe-info">
          <p className="pe-title">{item.name}</p>
          {item.date && <p className="pe-date">{formatDate(item.date)}</p>}
        </div>
      </div>
    </button>
  );
};

const SearchResults = ({ results, loading, navigate }) => {
  if (loading) {
    return (
      <div className="explore-loading">
        <div className="explore-spinner" />
      </div>
    );
  }
  if (!results.length) {
    return (
      <div className="explore-empty">
        <div className="explore-empty-icon"></div>
        <p>Keine Ergebnisse gefunden</p>
      </div>
    );
  }
  return (
    <div className="search-results-list">
      {results.map(item => {
        const icon = getCategoryIcon(item.category);
        const path = item._type === 'club' ? `/group/${item.id}` : `/group/${item.id}`;
        return (
          <button key={`${item._type}-${item.id}`} className="sr-item" onClick={() => navigate(path)}>
            <div className="sr-thumb">
              {item.image_url
                ? <img src={item.image_url} alt={item.name} />
                : <span>{icon}</span>}
            </div>
            <div className="sr-body">
              <p className="sr-name">{item.name}</p>
              <p className="sr-meta">
                {item._type === 'club' ? 'Club' : 'Gruppe'} · {item.category}
              </p>
            </div>
            <span className="sr-arrow">›</span>
          </button>
        );
      })}
    </div>
  );
};

// ─── main page ───────────────────────────────────────────────────────────────

export const Explore = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  const [trendingItems, setTrendingItems] = useState([]);
  const [pastEvents, setPastEvents]       = useState([]);
  const [forYouItems, setForYouItems]     = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // ── load explore data ──────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const catParam = activeCategory ? { category: activeCategory } : {};

      const [trendRes, pastRes] = await Promise.all([
        groups.getAll({ ...catParam, limit: 20 }),
        groups.getAll({ ...catParam, limit: 12 }),
      ]);

      const all   = trendRes.data  || [];
      const allB  = pastRes.data   || [];

      // split into upcoming vs past client-side (backend may not support upcoming=false)
      const upcoming = all.filter(g => !isPast(g.date) || !g.date);
      const past     = allB.filter(g => isPast(g.date));

      setTrendingItems(upcoming.length ? upcoming : all);
      setPastEvents(past);

      // personalised "for you" — use user interests if available
      const interests = user?.interests || user?.categories || [];
      if (interests.length && !activeCategory) {
        const pick = interests[Math.floor(Math.random() * interests.length)];
        const fyRes = await groups.getAll({ category: pick, limit: 6 });
        const fy = fyRes.data || [];
        setForYouItems(fy.length ? fy : upcoming.slice(0, 6));
      } else {
        setForYouItems(upcoming.slice(0, 6));
      }
    } catch (err) {
      console.error('Explore load error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── debounced search ───────────────────────────────────────────────────────
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

  // ── auto-focus search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setSearchQuery('');
  }, [searchOpen]);

  // ── categories row ─────────────────────────────────────────────────────────
  const categories = [
    { id: null, label: 'Alle', icon: '✨' },
    ...CATEGORY_HIERARCHY.map(c => ({ id: c.id, label: c.label, icon: c.icon })),
  ];

  // stories: all items with images (or just show them all)
  const highlights = [...trendingItems].slice(0, 10);

  const showEmpty = !loading && trendingItems.length === 0 && pastEvents.length === 0;

  return (
    <div className="explore-container">

      {/* ── sticky header ──────────────────────────────────────────────── */}
      <div className="explore-sticky-header">
        <div className="explore-top-bar">
          <h1 className="explore-title">Entdecken</h1>
          <button
            className={`explore-search-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => setSearchOpen(v => !v)}
            aria-label="Suche"
          >
            {searchOpen ? '✕' : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            )}
          </button>
        </div>

        {/* ── search bar (animated) ────────────────────────────────────── */}
        <div className={`explore-search-wrap ${searchOpen ? 'open' : ''}`}>
          <div className="explore-search-inner">
            <svg className="explore-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              ref={searchRef}
              className="explore-search-input"
              placeholder="Events, Clubs, Kategorien..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="explore-search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>
        </div>

        {/* ── category chips ───────────────────────────────────────────── */}
        {!searchOpen && (
          <div className="explore-cats-wrap">
            <div className="explore-cats-scroll">
              {categories.map(cat => (
                <button
                  key={cat.id ?? 'all'}
                  className={`explore-cat-chip ${activeCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span className="chip-label">{cat.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── scrollable content ─────────────────────────────────────────── */}
      <div className="explore-content">

        {/* search mode */}
        {searchOpen && (searchQuery ? (
          <SearchResults results={searchResults} loading={searchLoading} navigate={navigate} />
        ) : (
          <div className="explore-search-hint">
            <p>Tippe um Events, Clubs oder Kategorien zu finden</p>
          </div>
        ))}

        {/* explore mode */}
        {!searchOpen && (
          <>
            {loading ? (
              <div className="explore-loading">
                <div className="explore-spinner" />
              </div>
            ) : showEmpty ? (
              <div className="explore-empty">
                <div className="explore-empty-icon"></div>
                <p>Noch keine Events in dieser Kategorie</p>
                <button className="explore-empty-btn" onClick={() => setActiveCategory(null)}>
                  Alle anzeigen
                </button>
              </div>
            ) : (
              <>
                {/* ── Highlights / Stories ────────────────────────────── */}
                {highlights.length > 0 && (
                  <section className="explore-section explore-section--stories">
                    <div className="explore-section-header">
                      <span className="explore-section-title">📸 Highlights</span>
                    </div>
                    <div className="explore-stories-row">
                      {highlights.map(item => (
                        <StoryCircle key={item.id} item={item} navigate={navigate} />
                      ))}
                    </div>
                  </section>
                )}

                {/* ── Für dich ────────────────────────────────────────── */}
                {forYouItems.length > 0 && (
                  <section className="explore-section">
                    <div className="explore-section-header">
                      <span className="explore-section-title">⚡ Für dich</span>
                      <button className="explore-see-all" onClick={() => navigate('/home')}>
                        Alle sehen →
                      </button>
                    </div>
                    <div className="explore-2col">
                      {forYouItems.map(item => (
                        <ExploreCard key={item.id} item={item} navigate={navigate} />
                      ))}
                    </div>
                  </section>
                )}

                {/* ── Gerade angesagt ─────────────────────────────────── */}
                {trendingItems.length > 0 && (
                  <section className="explore-section">
                    <div className="explore-section-header">
                      <span className="explore-section-title">🔥 Gerade angesagt</span>
                    </div>
                    <div className="explore-trending">
                      {trendingItems.slice(0, 6).map(item => (
                        <TrendingCard key={item.id} item={item} navigate={navigate} />
                      ))}
                    </div>
                  </section>
                )}

                {/* ── Vergangene Events ────────────────────────────────── */}
                {pastEvents.length > 0 && (
                  <section className="explore-section">
                    <div className="explore-section-header">
                      <span className="explore-section-title">🎉 Vergangene Events</span>
                      <span className="explore-section-sub">Schau was andere erlebt haben</span>
                    </div>
                    <div className="explore-past-grid">
                      {pastEvents.map((item, i) => (
                        <PastEventCard
                          key={item.id}
                          item={item}
                          tall={i % 5 === 0 || i % 5 === 3}
                          navigate={navigate}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Explore;
