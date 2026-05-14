import { useState, useEffect, useContext, useRef, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, clubs, deals } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import '../styles/explore.css';

const ProModal = lazy(() => import('../components/ProModal').then(m => ({ default: m.ProModal })));

const getCategoryIcon = (catName) => {
  if (!catName) return '✨';
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
  if (diff < 0) return d.toLocaleDateString('de-AT', { day: '2-digit', month: 'short' });
  if (diff < 86400000 * 7) return `vor ${Math.ceil(diff / 86400000)}d`;
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: 'short' });
};

const isPast = (dateStr) => {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
};

// ─── sub-components ─────────────────────────────────────────────────────────

const StoryCircle = ({ item, navigate }) => {
  const icon = getCategoryIcon(item.category);
  return (
    <button className="story-circle" onClick={() => navigate(`/group/${item.id}`)}>
      <div className="story-ring">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="story-img" loading="lazy" />
        ) : (
          <div className="story-placeholder">{icon}</div>
        )}
      </div>
      <span className="story-label">{item.name}</span>
    </button>
  );
};

const FYCard = ({ item, navigate }) => {
  const icon = getCategoryIcon(item.category);
  return (
    <button className="fy-card" onClick={() => navigate(`/group/${item.id}`)}>
      <div className="fy-img-wrap">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="fy-img" loading="lazy" />
        ) : (
          <div className="fy-img-placeholder"><span className="fy-ph-icon">{icon}</span></div>
        )}
        <div className="fy-img-gradient" />
        <div className="fy-overlay-meta">
          <span className="fy-members-pill">
            {item.current_members ?? 0}/{item.max_members || '∞'}
          </span>
        </div>
      </div>
      <div className="fy-body">
        <p className="fy-cat">{icon} {item.category}</p>
        <h3 className="fy-title">{item.name}</h3>
        {item.location && <p className="fy-loc">{item.location}</p>}
      </div>
    </button>
  );
};

const TrendingCard = ({ item, rank, navigate }) => {
  const icon = getCategoryIcon(item.category);
  const fillPct = item.max_members
    ? Math.min(100, Math.round(((item.current_members ?? 0) / item.max_members) * 100))
    : 0;
  return (
    <button className="tc-card" onClick={() => navigate(`/group/${item.id}`)}>
      <div className="tc-img-wrap">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="tc-img" loading="lazy" />
        ) : (
          <div className="tc-img-placeholder"><span>{icon}</span></div>
        )}
        <span className="tc-rank">
          {String(rank).padStart(2, '0')}
        </span>
      </div>
      <div className="tc-body">
        <div className="tc-top">
          <span className="tc-cat-badge">{icon} {item.category}</span>
          {item.location && <span className="tc-location">📍 {item.location}</span>}
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
            {item.current_members ?? 0} / {item.max_members || '∞'} Mitglieder
          </span>
        </div>
      </div>
    </button>
  );
};

const PastEventCard = ({ item, tall, navigate }) => {
  const icon = getCategoryIcon(item.category);
  return (
    <button
      className={`pe-card ${tall ? 'pe-card--tall' : ''}`}
      onClick={() => navigate(`/group/${item.id}`)}
    >
      {item.image_url ? (
        <img src={item.image_url} alt={item.name} className="pe-img" loading="lazy" />
      ) : (
        <div className="pe-placeholder"><span className="pe-ph-icon">{icon}</span></div>
      )}
      <div className="pe-overlay">
        <span className="pe-cat">{icon}</span>
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
        <div className="explore-empty-icon">🔍</div>
        <p>Keine Ergebnisse gefunden</p>
      </div>
    );
  }
  return (
    <div className="search-results-list">
      {results.map(item => {
        const icon = getCategoryIcon(item.category);
        return (
          <button key={`${item._type}-${item.id}`} className="sr-item" onClick={() => navigate(`/group/${item.id}`)}>
            <div className="sr-thumb">
              {item.image_url
                ? <img src={item.image_url} alt={item.name} loading="lazy" />
                : <span>{icon}</span>}
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
};

// ─── Für Dich deals ─────────────────────────────────────────────────────────

const DealCard = ({ deal, navigate }) => (
  <button className="deal-card" onClick={() => navigate(`/deal/${deal.id}`)}>
    <div className="deal-card-img-wrap">
      {deal.photos?.[0] ? (
        <img src={deal.photos[0]} alt={deal.name} className="deal-card-img" loading="lazy" />
      ) : (
        <div className="deal-card-img-placeholder">🍵</div>
      )}
      <span className="deal-card-badge">Für Dich</span>
      <div className="deal-card-gradient" />
    </div>
    <div className="deal-card-body">
      <span className="deal-card-label">{deal.deal_label}</span>
      <h3 className="deal-card-name">{deal.name}</h3>
      {deal.address && <p className="deal-card-addr">{deal.address}</p>}
    </div>
  </button>
);

const ProDealsSection = ({ navigate, onProRequired }) => {
  const [dealList, setDealList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    deals.getAll()
      .then(res => setDealList(res.data || []))
      .catch(err => {
        if (err.response?.data?.code === 'PRO_REQUIRED') onProRequired?.();
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || dealList.length === 0) return null;

  return (
    <section className="explore-section">
      <div className="explore-section-header">
        <span className="explore-section-title">⭐ Für Dich</span>
        <span className="deals-pro-badge">Pro</span>
      </div>
      <div className="deals-row">
        {dealList.map(deal => (
          <DealCard key={deal.id} deal={deal} navigate={navigate} />
        ))}
      </div>
    </section>
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
  const [proRequired, setProRequired] = useState(false);
  const [showProModal, setShowProModal] = useState(false);

  const [trendingItems, setTrendingItems] = useState([]);
  const [pastEvents, setPastEvents]       = useState([]);
  const [forYouItems, setForYouItems]     = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const catParam = activeCategory ? { category: activeCategory } : {};

      const [trendRes, pastRes] = await Promise.all([
        groups.getAll({ ...catParam, limit: 20 }),
        groups.getAll({ ...catParam, limit: 12 }),
      ]);

      const all  = trendRes.data || [];
      const allB = pastRes.data  || [];

      const upcoming = all.filter(g => !isPast(g.date) || !g.date);
      const past     = allB.filter(g => isPast(g.date));

      setTrendingItems(upcoming.length ? upcoming : all);
      setPastEvents(past);

      const interests = user?.interests || user?.categories || [];
      if (interests.length && !activeCategory) {
        const pick = interests[Math.floor(Math.random() * interests.length)];
        const fyRes = await groups.getAll({ category: pick, limit: 8 });
        const fy = fyRes.data || [];
        setForYouItems(fy.length ? fy : upcoming.slice(0, 8));
      } else {
        setForYouItems(upcoming.slice(0, 8));
      }
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, [activeCategory, user]);

  useEffect(() => { loadData(); }, [loadData]);

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

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setSearchQuery('');
  }, [searchOpen]);

  const categories = [
    { id: null, label: 'Alle', icon: '✨' },
    ...CATEGORY_HIERARCHY.map(c => ({ id: c.id, label: c.label, icon: c.icon })),
  ];

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
            {searchOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            )}
          </button>
        </div>

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
              <button className="explore-search-clear" onClick={() => setSearchQuery('')}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        </div>

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

        {searchOpen && (searchQuery ? (
          <SearchResults results={searchResults} loading={searchLoading} navigate={navigate} />
        ) : (
          <div className="explore-search-hint">
            <p>Tippe um Events, Clubs oder Kategorien zu finden</p>
          </div>
        ))}

        {!searchOpen && (
          <>
            {loading ? (
              <div className="explore-loading">
                <div className="explore-spinner" />
              </div>
            ) : showEmpty ? (
              <div className="explore-empty">
                <div className="explore-empty-icon">🌍</div>
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
                    <div className="explore-fy-row">
                      {forYouItems.map(item => (
                        <FYCard key={item.id} item={item} navigate={navigate} />
                      ))}
                    </div>
                  </section>
                )}

                {/* ── Für Dich Deals (Pro) ────────────────────────────── */}
                <ProDealsSection navigate={navigate} onProRequired={() => setProRequired(true)} />

                {/* ── Gerade angesagt ─────────────────────────────────── */}
                {trendingItems.length > 0 && (
                  <section className="explore-section">
                    <div className="explore-section-header">
                      <span className="explore-section-title">🔥 Gerade angesagt</span>
                    </div>
                    <div className="explore-trending">
                      {trendingItems.slice(0, 6).map((item, i) => (
                        <TrendingCard key={item.id} item={item} rank={i + 1} navigate={navigate} />
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

      {/* ── Pro full-page overlay ─────────────────────────────────── */}
      {proRequired && (
        <div className="explore-pro-overlay">
          <div className="explore-pro-inner">
            <div className="explore-pro-icon">👑</div>
            <h2 className="explore-pro-title">Entdecken ist Pro</h2>
            <p className="explore-pro-text">
              Exklusive Deals, Highlights und Empfehlungen — nur für Pro-Mitglieder.
            </p>
            <button className="explore-pro-btn" onClick={() => setShowProModal(true)}>
              Pro werden — 5 € / Monat
            </button>
            <button className="explore-pro-skip" onClick={() => setProRequired(false)}>
              Später
            </button>
          </div>
          {showProModal && (
            <Suspense fallback={null}>
              <ProModal onClose={() => setShowProModal(false)} onSuccess={() => { setShowProModal(false); setProRequired(false); }} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
};

export default Explore;
