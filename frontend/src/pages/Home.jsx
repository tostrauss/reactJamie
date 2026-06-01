import { useState, useEffect, useContext, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import api, { groups, clubs } from "../utils/api";
import { GroupCard } from "../components/GroupCard";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import "../styles/home.css";

const MapView = lazy(() => import("../components/MapView"));

const AgeRangeSlider = ({ value, onChange }) => {
  const MIN = 18, MAX = 70;
  const [lo, hi] = value;
  const trackRef = useRef(null);
  const dragging = useRef(null);
  const loRef = useRef(lo);
  const hiRef = useRef(hi);
  const onChangeRef = useRef(onChange);
  loRef.current = lo;
  hiRef.current = hi;
  onChangeRef.current = onChange;

  const loPercent = ((lo - MIN) / (MAX - MIN)) * 100;
  const hiPercent = ((hi - MIN) / (MAX - MIN)) * 100;

  const handlePointerDown = useCallback((e) => {
    if (!trackRef.current) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.round(MIN + pct * (MAX - MIN));
    dragging.current = Math.abs(v - loRef.current) <= Math.abs(v - hiRef.current) ? 'lo' : 'hi';

    const onMove = (e2) => {
      if (!trackRef.current || !dragging.current) return;
      const r = trackRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e2.clientX - r.left) / r.width));
      const val = Math.round(MIN + p * (MAX - MIN));
      if (dragging.current === 'lo') {
        onChangeRef.current([Math.min(val, hiRef.current - 1), hiRef.current]);
      } else {
        onChangeRef.current([loRef.current, Math.max(val, loRef.current + 1)]);
      }
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  return (
    <div className="age-range-slider" ref={trackRef} onPointerDown={handlePointerDown}>
      <div className="age-range-track">
        <div className="age-range-fill" style={{ left: `${loPercent}%`, right: `${100 - hiPercent}%` }} />
      </div>
      <div className="age-range-thumb" style={{ left: `${loPercent}%` }} />
      <div className="age-range-thumb" style={{ left: `${hiPercent}%` }} />
    </div>
  );
};

export const Home = () => {
  const [groupList, setGroupList] = useState([]);
  const [clubList, setClubList] = useState([]);
  const [myClubs, setMyClubs] = useState([]);
  const [activeTab, setActiveTab] = useState("gruppen");
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState(new Set());
  const [joined, setJoined] = useState(new Set());
  const [loading, setLoading] = useState(true);

  // Committed filters (actively applied to lists)
  const [zeitFilter, setZeitFilter] = useState('alle');
  const [zeitFrom, setZeitFrom] = useState('');
  const [zeitTo, setZeitTo] = useState('');
  const [alterFilter, setAlterFilter] = useState([18, 70]);
  const [sichtFilter, setSichtFilter] = useState('alle');

  // Staged filters (selected inside open panel, not yet applied)
  const [showFilters, setShowFilters] = useState(false);
  const [stagedZeit, setStagedZeit] = useState('alle');
  const [stagedZeitFrom, setStagedZeitFrom] = useState('');
  const [stagedZeitTo, setStagedZeitTo] = useState('');
  const [stagedAlter, setStagedAlter] = useState([18, 70]);
  const [stagedSicht, setStagedSicht] = useState('alle');
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  const activeFilterCount = [
    zeitFilter !== 'alle',
    alterFilter[0] !== 18 || alterFilter[1] !== 70,
    sichtFilter !== 'alle',
  ].filter(Boolean).length;

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === "gruppen") {
        const [groupsRes, favGroupsRes, joinedGroupsRes, joinedClubsRes] = await Promise.all([
          api.get("/groups", { params: { type: "group" } }),
          groups.getFavorites().catch(() => ({ data: [] })),
          groups.getJoined().catch(() => ({ data: [] })),
          clubs.getJoined().catch(() => ({ data: [] })),
        ]);
        setGroupList(groupsRes.data || []);
        setFavorites(new Set((favGroupsRes.data || []).map(g => g.id)));
        setJoined(new Set([
          ...(joinedGroupsRes.data || []).map(g => g.id),
          ...(joinedClubsRes.data || []).map(c => c.id),
        ]));
      } else {
        const [allClubsRes, myClubsRes, favClubsRes, joinedGroupsRes] = await Promise.all([
          clubs.getAll(),
          clubs.getJoined().catch(() => ({ data: [] })),
          clubs.getFavorites().catch(() => ({ data: [] })),
          groups.getJoined().catch(() => ({ data: [] })),
        ]);
        setClubList(allClubsRes.data || []);
        setMyClubs(myClubsRes.data || []);
        setFavorites(new Set((favClubsRes.data || []).map(c => c.id)));
        setJoined(new Set([
          ...(joinedGroupsRes.data || []).map(g => g.id),
          ...(myClubsRes.data || []).map(c => c.id),
        ]));
      }
    } catch (error) {
      if (!error.response) {
        toast.error('Server nicht erreichbar');
      } else {
        toast.error('Inhalte konnten nicht geladen werden. Bitte neu laden.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Filter helpers ───────────────────────────────────────────────
  const matchesZeit = (item) => {
    if (zeitFilter === 'alle') return true;
    if (!item.date) return true;
    const d = new Date(item.date);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (zeitFilter === 'zeitraum') {
      if (zeitFrom) {
        const from = new Date(zeitFrom);
        if (d < from) return false;
      }
      if (zeitTo) {
        const to = new Date(zeitTo);
        to.setHours(23, 59, 59, 999);
        if (d > to) return false;
      }
      return true;
    }
    if (zeitFilter === 'heute') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return d >= today && d < tomorrow;
    }
    if (zeitFilter === 'woche') {
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return d >= today && d < weekEnd;
    }
    if (zeitFilter === 'wochenende') {
      const day = today.getDay();
      let sat;
      if (day === 6) sat = today;
      else if (day === 0) { sat = new Date(today); sat.setDate(today.getDate() - 1); }
      else { sat = new Date(today); sat.setDate(today.getDate() + (6 - day)); }
      const monAfter = new Date(sat);
      monAfter.setDate(sat.getDate() + 2);
      return d >= sat && d < monAfter;
    }
    if (zeitFilter === 'monat') {
      const monthEnd = new Date(today);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      return d >= today && d < monthEnd;
    }
    if (zeitFilter === 'ganztags') {
      if (!item.date) return true;
      return d.getHours() === 0 && d.getMinutes() === 0;
    }
    return true;
  };

  const matchesAlter = (item) => {
    const [filterMin, filterMax] = alterFilter;
    if (filterMin === 18 && filterMax === 70) return true;
    if (!item.min_age && !item.max_age) return true;
    const gMin = item.min_age || 0;
    const gMax = item.max_age || 150;
    return gMin <= filterMax && gMax >= filterMin;
  };

  const matchesSicht = (item) => {
    if (sichtFilter === 'alle') return true;
    if (sichtFilter === 'oeffentlich') return !item.is_private;
    return !!item.is_private;
  };

  const filteredGroups = useMemo(() => groupList.filter(g =>
    (g.name || '').toLowerCase().includes(searchQuery.toLowerCase()) &&
    matchesZeit(g) && matchesAlter(g) && matchesSicht(g)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [groupList, searchQuery, zeitFilter, zeitFrom, zeitTo, alterFilter, sichtFilter]);

  const filteredClubs = useMemo(() => clubList.filter(c =>
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) &&
    matchesAlter(c) && matchesSicht(c)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [clubList, searchQuery, alterFilter, sichtFilter]);

  // ── Filter panel actions ─────────────────────────────────────────
  const openFilters = () => {
    setStagedZeit(zeitFilter);
    setStagedZeitFrom(zeitFrom);
    setStagedZeitTo(zeitTo);
    setStagedAlter(alterFilter);
    setStagedSicht(sichtFilter);
    setShowFilters(true);
  };

  const applyFilters = () => {
    setZeitFilter(stagedZeit);
    setZeitFrom(stagedZeitFrom);
    setZeitTo(stagedZeitTo);
    setAlterFilter(stagedAlter);
    setSichtFilter(stagedSicht);
    setShowFilters(false);
  };

  const resetFilters = () => {
    // Reset and immediately apply — no extra "Anwenden" click needed
    setZeitFilter('alle');
    setZeitFrom('');
    setZeitTo('');
    setAlterFilter([18, 70]);
    setSichtFilter('alle');
    setStagedZeit('alle');
    setStagedZeitFrom('');
    setStagedZeitTo('');
    setStagedAlter([18, 70]);
    setStagedSicht('alle');
    setShowFilters(false);
  };

  // ── Event handlers ───────────────────────────────────────────────
  const handleFavorite = async (groupId) => {
    const wasAlreadyFav = favorites.has(groupId);
    setFavorites(prev => {
      const n = new Set(prev);
      n.has(groupId) ? n.delete(groupId) : n.add(groupId);
      return n;
    });
    try {
      if (activeTab === 'clubs') await clubs.toggleFavorite(groupId);
      else await groups.toggleFavorite(groupId);
    } catch {
      setFavorites(prev => {
        const n = new Set(prev);
        wasAlreadyFav ? n.add(groupId) : n.delete(groupId);
        return n;
      });
      toast.error('Favorit konnte nicht gespeichert werden');
    }
  };

  const handleJoin = async (groupId) => {
    try {
      if (activeTab === 'clubs') await clubs.join(groupId);
      else await groups.join(groupId);
      setJoined(prev => new Set(prev).add(groupId));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Beitreten');
    }
  };

  const handleChat = (groupId) => navigate(`/chat/${groupId}`);

  const handleWaitlist = async (groupId, action) => {
    try {
      if (action === 'join') {
        const res = await groups.joinWaitlist(groupId);
        toast.success(`Auf Warteliste! Position: ${res.data.position}`);
      } else {
        await groups.leaveWaitlist(groupId);
        toast.info('Von Warteliste entfernt');
      }
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Fehler bei Warteliste');
    }
  };

  const handleCardClick = (groupId) => navigate(`/group/${groupId}`);

  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    setSelectedMain('all');
    setSelectedSub(null);
    if (tab !== 'karte') setSearchQuery('');
  };

  // ── Render helpers ───────────────────────────────────────────────
  const FilterPill = ({ value, label, current, onSelect }) => (
    <button
      className={`filter-pill${current === value ? ' active' : ''}`}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );

  return (
    <div className={`home-container${activeTab === 'karte' ? ' home-container--map' : ''}`}>

      {/* ── Sticky header (logo + tabs + search + categories) ──────── */}
      <div className="home-sticky-header">
        <div className="home-header">
          <span className="logo-text">JAMIE</span>
        </div>
        <div className="tabs-container">
          <button
            className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('gruppen')}
          >
            Gruppen
          </button>
          <button
            className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('clubs')}
          >
            Clubs
          </button>
          <button
            className={`tab ${activeTab === 'karte' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('karte')}
          >
            Karte
          </button>
        </div>

        {/* Search + categories — sticky, only shown for non-map tabs */}
        {activeTab !== 'karte' && (
          <div className="home-search-area">
            <div className="search-container">
              <div className="search-input-wrapper">
                <input
                  type="search"
                  placeholder="Suchen"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
                <button
                  className={`search-filter-btn${activeFilterCount > 0 ? ' has-active' : ''}`}
                  onClick={openFilters}
                  aria-label="Filter öffnen"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="4" y1="6" x2="20" y2="6"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                    <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3"/>
                    <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/>
                    <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>
                  </svg>
                  {activeFilterCount > 0 && (
                    <span className="filter-active-badge">{activeFilterCount}</span>
                  )}
                </button>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── Scrollable content ─────────────────────────────────────── */}
      <div className={`home-content${activeTab === 'karte' ? ' home-content--map' : ''}`}>

        {user && user.onboarding_completed === false && (
          <div className="profile-warning-banner">
            <div className="profile-warning-title">Profil noch nicht vollständig</div>
            <p className="profile-warning-text">
              Vervollständige dein Profil, um Gruppen beizutreten.
            </p>
            <button className="profile-warning-button" onClick={() => navigate("/onboarding")}>
              Profil jetzt abschließen
            </button>
          </div>
        )}

        {/* GRUPPEN */}
        {activeTab === 'gruppen' && (
          <div className="groups-feed">
            {loading ? (
              <div className="home-loading">
                <div className="home-spinner" />
              </div>
            ) : filteredGroups.length > 0 ? (
              <div className="groups-grid">
                {filteredGroups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    isFavorite={favorites.has(group.id)}
                    isJoined={joined.has(group.id)}
                    onFavorite={handleFavorite}
                    onJoin={handleJoin}
                    onChat={handleChat}
                    onWaitlist={handleWaitlist}
                    onClick={() => handleCardClick(group.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <p>Keine Gruppen gefunden.</p>
                <button className="empty-hint" onClick={() => navigate('/create-group')}>
                  Erstelle selbst eine!
                </button>
              </div>
            )}
          </div>
        )}

        {/* CLUBS */}
        {activeTab === 'clubs' && (
          <div className="clubs-feed">
            {myClubs.length > 0 && (
              <div className="clubs-section">
                <div className="section-header">
                  <h2 className="section-heading">Meine Clubs</h2>
                  <span className="section-count">{myClubs.length}</span>
                </div>
                <div className="my-clubs-scroll">
                  {myClubs.map(club => (
                    <div key={club.id} className="my-club-card" onClick={() => handleCardClick(club.id)}>
                      <div className="my-club-image">
                        {club.image_url
                          ? <img src={club.image_url} alt={club.name || club.title} loading="lazy" decoding="async" />
                          : <div className="my-club-placeholder"><span>{(club.name || club.title || 'C')[0]}</span></div>
                        }
                      </div>
                      <div className="my-club-info">
                        <h4>{club.name || club.title}</h4>
                        <span className="my-club-members">👥 {club.member_count || club.members_count || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="clubs-section">
              <div className="section-header">
                <h2 className="section-heading">Im Trend</h2>
              </div>
              {loading ? (
                <div className="home-loading">
                  <div className="home-spinner" />
                </div>
              ) : filteredClubs.length > 0 ? (
                <div className="groups-grid clubs-grid">
                  {filteredClubs.map(club => (
                    <GroupCard
                      key={club.id}
                      group={{ ...club, members_count: club.member_count || club.members_count || 0 }}
                      isFavorite={favorites.has(club.id)}
                      isJoined={joined.has(club.id)}
                      onFavorite={handleFavorite}
                      onJoin={handleJoin}
                      onChat={handleChat}
                      onWaitlist={handleWaitlist}
                      onClick={() => handleCardClick(club.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">🏆</div>
                  <p>Keine Clubs gefunden.</p>
                  <button className="empty-hint" onClick={() => navigate('/create-club')}>
                    Gründe deinen eigenen!
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* KARTE */}
        {activeTab === 'karte' && (
          <Suspense fallback={<div className="home-loading"><div className="home-spinner" /></div>}>
            <MapView />
          </Suspense>
        )}

      </div>


      {/* ── Filter bottom sheet ─────────────────────────────────────── */}
      {showFilters && (
        <div className="filter-overlay" onClick={() => setShowFilters(false)}>
          <div className="filter-sheet" onClick={e => e.stopPropagation()}>

            {/* Drag handle */}
            <div className="filter-sheet-handle" />

            {/* Scrollable header + sections */}
            <div className="filter-sheet-scroll">
              <div className="filter-sheet-header">
                <h2 className="filter-sheet-title">Filter</h2>
                <button className="filter-close-btn" onClick={() => setShowFilters(false)} aria-label="Schließen">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Zeitraum — groups only */}
              {activeTab === 'gruppen' && (
                <div className="filter-section">
                  <h3 className="filter-section-title">Zeitraum</h3>
                  <div className="filter-pills">
                    {[
                      { value: 'alle', label: 'Alle' },
                      { value: 'heute', label: 'Heute' },
                      { value: 'woche', label: 'Diese Woche' },
                      { value: 'wochenende', label: 'Wochenende' },
                      { value: 'monat', label: 'Dieser Monat' },
                      { value: 'ganztags', label: 'Ganztags' },
                      { value: 'zeitraum', label: 'Zeitraum wählen' },
                    ].map(opt => (
                      <FilterPill key={opt.value} value={opt.value} label={opt.label} current={stagedZeit} onSelect={setStagedZeit} />
                    ))}
                  </div>
                  {stagedZeit === 'zeitraum' && (
                    <div className="filter-date-range">
                      <div className="filter-date-field">
                        <label>Von</label>
                        <input type="date" value={stagedZeitFrom} onChange={e => setStagedZeitFrom(e.target.value)} className="filter-date-input" />
                      </div>
                      <div className="filter-date-field">
                        <label>Bis</label>
                        <input type="date" value={stagedZeitTo} onChange={e => setStagedZeitTo(e.target.value)} className="filter-date-input" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Alter — Regler */}
              <div className="filter-section">
                <div className="filter-section-title-row">
                  <h3 className="filter-section-title">Alter</h3>
                  <span className="filter-age-value">
                    {stagedAlter[0] === 18 && stagedAlter[1] === 70
                      ? 'Alle'
                      : `${stagedAlter[0]} – ${stagedAlter[1] === 70 ? '70+' : stagedAlter[1]}`}
                  </span>
                </div>
                <AgeRangeSlider value={stagedAlter} onChange={setStagedAlter} />
              </div>

              {/* Sichtbarkeit */}
              <div className="filter-section">
                <h3 className="filter-section-title">Sichtbarkeit</h3>
                <div className="filter-pills">
                  {[
                    { value: 'alle', label: 'Alle' },
                    { value: 'oeffentlich', label: 'Öffentlich' },
                    { value: 'privat', label: 'Privat' },
                  ].map(opt => (
                    <FilterPill key={opt.value} value={opt.value} label={opt.label} current={stagedSicht} onSelect={setStagedSicht} />
                  ))}
                </div>
              </div>
            </div>

            {/* Actions — sticky at bottom, always visible */}
            <div className="filter-actions">
              <button className="filter-reset-btn" onClick={resetFilters}>
                Zurücksetzen
              </button>
              <button className="filter-apply-btn" onClick={applyFilters}>
                Anwenden
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default Home;
