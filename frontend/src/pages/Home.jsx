import React, { useState, useEffect, useContext, useRef, useCallback, useMemo, Suspense } from "react";
import { lazyWithReload } from "../utils/lazyRetry";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api, { groups, clubs, deals as dealsApi } from "../utils/api";
import { GroupCard } from "../components/GroupCard";
import { DealCard } from "../components/DealCard";
import { EventCard } from "../components/EventCard";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { CATEGORY_HIERARCHY } from "../utils/categories";
import { nextOccurrence } from "../utils/recurrence";
import "../styles/home.css";

// Robert's spec: every 8th group on the Home/Gruppen tab is a sponsored deal.
// Only kicks in when the user is browsing (no active search/filters) so deal
// slots don't get in the way when someone is hunting for a specific group.
const DEAL_INTERVAL_HOME = 8;

const MapView = lazyWithReload(() => import("../components/MapView"));

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
  const [dealList, setDealList] = useState([]);
  const [myClubs, setMyClubs] = useState([]);
  const [discoverEvents, setDiscoverEvents] = useState([]);
  // Tab held in the URL (?tab=clubs) so swiping back from a club/group detail
  // restores the tab the user was on. `replace: true` keeps the back stack tidy
  // — tab switches don't add history entries, only cross-page navigations do.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "gruppen";
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
  const [kategorieFilter, setKategorieFilter] = useState(() => new Set());

  // Staged filters (selected inside open panel, not yet applied)
  const [showFilters, setShowFilters] = useState(false);
  const [stagedZeit, setStagedZeit] = useState('alle');
  const [stagedZeitFrom, setStagedZeitFrom] = useState('');
  const [stagedZeitTo, setStagedZeitTo] = useState('');
  const [stagedAlter, setStagedAlter] = useState([18, 70]);
  const [stagedSicht, setStagedSicht] = useState('alle');
  const [stagedKategorie, setStagedKategorie] = useState(() => new Set());
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  const activeFilterCount = [
    // Zeit only applies to the Gruppen/Karte feeds — clubs have no date filter,
    // so it must not inflate the badge on the Clubs tab.
    activeTab !== 'clubs' && zeitFilter !== 'alle',
    alterFilter[0] !== 18 || alterFilter[1] !== 70,
    sichtFilter !== 'alle',
    kategorieFilter.size > 0,
  ].filter(Boolean).length;

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    // The Karte tab renders MapView, which fetches its own pins — the four
    // club/group calls below were fired and their results thrown away.
    if (activeTab === 'karte') { setLoading(false); return; }
    setLoading(true);
    try {
      if (activeTab === "gruppen") {
        const [groupsRes, favGroupsRes, joinedGroupsRes, joinedClubsRes, dealsRes] = await Promise.all([
          // upcoming:true so past one-off events leave the feed (the backend
          // keeps weekly-recurring groups via their next occurrence).
          api.get("/groups", { params: { type: "group", upcoming: "true" } }),
          groups.getFavorites().catch(() => ({ data: [] })),
          groups.getJoined().catch(() => ({ data: [] })),
          clubs.getJoined().catch(() => ({ data: [] })),
          dealsApi.getAll().catch(() => ({ data: [] })),
        ]);
        setGroupList(groupsRes.data || []);
        setDealList(dealsRes.data || []);
        setFavorites(new Set((favGroupsRes.data || []).map(g => g.id)));
        setJoined(new Set([
          ...(joinedGroupsRes.data || []).map(g => g.id),
          ...(joinedClubsRes.data || []).map(c => c.id),
        ]));
      } else {
        // Discover-events loads on its own promise — NOT inside the Promise.all
        // that gates the loading spinner. A slow events query must never hold
        // the whole clubs list hostage; the "Events für dich" row just pops in
        // when ready.
        clubs.discoverEvents()
          .then(res => setDiscoverEvents(res.data || []))
          .catch(() => setDiscoverEvents([]));

        const [allClubsRes, myClubsRes, favClubsRes, joinedGroupsRes] = await Promise.all([
          // Default server limit is 20; the client-side search/filter then can
          // never reach clubs 21+. Pull a full page so local filtering is real.
          clubs.getAll({ limit: 100 }),
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
        toast.error(t('home.toast.serverDown'));
      } else {
        toast.error(t('home.toast.loadError'));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Filter helpers ───────────────────────────────────────────────
  const matchesZeit = (item) => {
    if (zeitFilter === 'alle') return true;
    if (!item.date) return true;
    // Use the NEXT occurrence so weekly-recurring groups (whose stored date is
    // in the past but whose card badge reads "Heute"/"Morgen") are matched by
    // the date filters instead of silently dropped.
    const d = nextOccurrence(item) || new Date(item.date);
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
      // Date-only events are stored at UTC midnight; local getHours() shifts by
      // the Vienna offset and made every all-day event fail this check (empty
      // list). UTC accessors correctly identify "no specific time" events.
      return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
    }
    return true;
  };

  const matchesAlter = (item) => {
    const [filterMin, filterMax] = alterFilter;
    if (filterMin === 18 && filterMax === 70) return true;
    // The API never returns min_age/max_age — it returns the group's target
    // range (target_age_min/max) and the actual member-age range (age_min/max).
    // The old code read the non-existent fields, so the slider did nothing.
    const gMin = item.target_age_min ?? item.age_min;
    const gMax = item.target_age_max ?? item.age_max;
    if (gMin == null && gMax == null) return true;
    return (gMin ?? 0) <= filterMax && (gMax ?? 150) >= filterMin;
  };

  const matchesSicht = (item) => {
    if (sichtFilter === 'alle') return true;
    if (sichtFilter === 'oeffentlich') return !item.is_private;
    return !!item.is_private;
  };

  // A group's `category` is a free-text string like "Tennis" or "Brettspiele".
  // We map selected MAIN-category ids (e.g. 'sport') to their sub-category
  // names + main label and check membership case-insensitively.
  const matchesKategorie = (item) => {
    if (kategorieFilter.size === 0) return true;
    if (!item.category) return false;
    const itemCat = item.category.toLowerCase();
    for (const mainCatId of kategorieFilter) {
      const cat = CATEGORY_HIERARCHY.find(c => c.id === mainCatId);
      if (!cat) continue;
      if (cat.label.toLowerCase() === itemCat) return true;
      // Every main category has a generic "Sonstiges" sub, so a group literally
      // categorized "Sonstiges" would match ANY selected main category. Only
      // the dedicated 'sonstiges' main category should claim those.
      if (cat.subs.some(s =>
        (s.name !== 'Sonstiges' || cat.id === 'sonstiges') &&
        s.name.toLowerCase() === itemCat
      )) return true;
    }
    return false;
  };

  // Search matches both the user-entered name and the category (e.g.
  // "Beachvolleyball") because the visible card title comes from category for
  // non-Sonstiges groups — typing the visible word has to find the group.
  const matchesSearch = (item) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (item.name || '').toLowerCase().includes(q)
        || (item.category || '').toLowerCase().includes(q);
  };

  const filteredGroups = useMemo(() => groupList.filter(g =>
    matchesSearch(g) &&
    matchesZeit(g) && matchesAlter(g) && matchesSicht(g) && matchesKategorie(g)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [groupList, searchQuery, zeitFilter, zeitFrom, zeitTo, alterFilter, sichtFilter, kategorieFilter]);

  const filteredClubs = useMemo(() => clubList.filter(c =>
    matchesSearch(c) &&
    matchesAlter(c) && matchesSicht(c) && matchesKategorie(c)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [clubList, searchQuery, alterFilter, sichtFilter, kategorieFilter]);

  // ── Filter panel actions ─────────────────────────────────────────
  const openFilters = () => {
    setStagedZeit(zeitFilter);
    setStagedZeitFrom(zeitFrom);
    setStagedZeitTo(zeitTo);
    setStagedAlter(alterFilter);
    setStagedSicht(sichtFilter);
    setStagedKategorie(new Set(kategorieFilter));
    setShowFilters(true);
  };

  const applyFilters = () => {
    setZeitFilter(stagedZeit);
    setZeitFrom(stagedZeitFrom);
    setZeitTo(stagedZeitTo);
    setAlterFilter(stagedAlter);
    setSichtFilter(stagedSicht);
    setKategorieFilter(new Set(stagedKategorie));
    setShowFilters(false);
  };

  const resetFilters = () => {
    // Reset and immediately apply — no extra "Anwenden" click needed
    setZeitFilter('alle');
    setZeitFrom('');
    setZeitTo('');
    setAlterFilter([18, 70]);
    setSichtFilter('alle');
    setKategorieFilter(new Set());
    setStagedZeit('alle');
    setStagedZeitFrom('');
    setStagedZeitTo('');
    setStagedAlter([18, 70]);
    setStagedSicht('alle');
    setStagedKategorie(new Set());
    setShowFilters(false);
  };

  const toggleStagedKategorie = (catId) => {
    setStagedKategorie(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
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
      toast.error(t('home.toast.favError'));
    }
  };

  const handleJoin = async (groupId) => {
    try {
      if (activeTab === 'clubs') await clubs.join(groupId);
      else await groups.join(groupId);
      setJoined(prev => new Set(prev).add(groupId));
    } catch (err) {
      toast.error(err.response?.data?.error || t('home.toast.joinError'));
    }
  };

  const handleChat = (groupId) => navigate(`/chat/${groupId}`);

  const handleWaitlist = async (groupId, action) => {
    try {
      if (action === 'join') {
        const res = await groups.joinWaitlist(groupId);
        toast.success(t('home.toast.waitlistJoinedPos', { position: res.data.position }));
      } else {
        await groups.leaveWaitlist(groupId);
        toast.info(t('home.toast.waitlistLeft'));
      }
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.error || t('home.toast.waitlistError'));
    }
  };

  // Clubs use a dedicated detail page; groups stay on /group/:id. Without the
  // type hint we'd hit /group/:id, fetch, then redirect — wasted round-trip.
  const handleCardClick = (id, type) =>
    navigate(type === 'club' ? `/club/${id}` : `/group/${id}`);

  const handleTabSwitch = (tab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'gruppen') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
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

  // Shared so the discover-clubs grid can render in two halves (before and
  // after the "Events für dich" rail) without duplicating the card markup.
  const renderClubCard = (club) => (
    <GroupCard
      key={club.id}
      group={{ ...club, members_count: club.member_count || club.members_count || 0 }}
      isFavorite={favorites.has(club.id)}
      isJoined={joined.has(club.id)}
      onFavorite={handleFavorite}
      onJoin={handleJoin}
      onChat={handleChat}
      onWaitlist={handleWaitlist}
      onClick={() => handleCardClick(club.id, 'club')}
    />
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
            {t('home.tabs.groups')}
          </button>
          <button
            className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('clubs')}
          >
            {t('home.tabs.clubs')}
          </button>
          <button
            className={`tab ${activeTab === 'karte' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('karte')}
          >
            {t('home.tabs.map')}
          </button>
        </div>

        {/* Search + categories — sticky, only shown for non-map tabs */}
        {activeTab !== 'karte' && (
          <div className="home-search-area">
            <div className="search-container">
              <div className="search-input-wrapper">
                <input
                  type="search"
                  placeholder={t('home.search.placeholder')}
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
                  aria-label={t('home.search.filterAria')}
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
            <div className="profile-warning-title">{t('home.profileBanner.title')}</div>
            <p className="profile-warning-text">
              {t('home.profileBanner.text')}
            </p>
            <button className="profile-warning-button" onClick={() => navigate("/onboarding")}>
              {t('home.profileBanner.button')}
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
                {filteredGroups.map((group, idx) => {
                  // Deals only inject into the unfiltered browse feed — when
                  // the user searches/filters we skip the sponsored slots so
                  // they don't pollute targeted results.
                  const isPlainBrowse =
                    !searchQuery.trim() && activeFilterCount === 0;
                  const showDealAfter =
                    isPlainBrowse &&
                    dealList.length > 0 &&
                    (idx + 1) % DEAL_INTERVAL_HOME === 0;
                  const dealIdx = Math.floor((idx + 1) / DEAL_INTERVAL_HOME) - 1;
                  const deal = showDealAfter ? dealList[dealIdx % dealList.length] : null;
                  return (
                    <React.Fragment key={group.id}>
                      <GroupCard
                        group={group}
                        isFavorite={favorites.has(group.id)}
                        isJoined={joined.has(group.id)}
                        onFavorite={handleFavorite}
                        onJoin={handleJoin}
                        onChat={handleChat}
                        onWaitlist={handleWaitlist}
                        onClick={() => handleCardClick(group.id, group.type)}
                      />
                      {deal && (
                        <DealCard key={`deal-home-${idx}-${deal.id}`} deal={deal} variant="home" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <p>{t('home.empty.groups')}</p>
                <button className="empty-hint" onClick={() => navigate('/create-group')}>
                  {t('home.empty.groupsCta')}
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
                  <h2 className="section-heading">{t('home.sections.myClubs')}</h2>
                  <span className="section-count">{myClubs.length}</span>
                </div>
                <div className="my-clubs-scroll">
                  {myClubs.map(club => (
                    <div key={club.id} className="my-club-card" onClick={() => handleCardClick(club.id, 'club')}>
                      <div className="my-club-image">
                        {club.image_url
                          ? <img src={club.image_url} alt={club.name || club.title} loading="lazy" decoding="async" />
                          : <div className="my-club-placeholder"><span>{(club.name || club.title || 'C')[0]}</span></div>
                        }
                      </div>
                      <div className="my-club-info">
                        <h4>{club.name || club.title}</h4>
                        <span className="my-club-members">{club.member_count || club.members_count || 0} {t('groups.card.members')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Robert's spec: discover events from public clubs — a prominent
                CTA plus an "Events für dich" rail wedged after the first 3
                clubs. Both lead to the standalone /events page. */}
            <button className="club-events-cta" onClick={() => navigate('/events')}>
              {t('home.clubEventsDiscover')}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            <div className="clubs-section">
              <div className="section-header">
                <h2 className="section-heading">{t('home.sections.trending')}</h2>
              </div>
              {loading ? (
                <div className="home-loading">
                  <div className="home-spinner" />
                </div>
              ) : filteredClubs.length > 0 ? (
                <>
                  <div className="groups-grid clubs-grid">
                    {filteredClubs.slice(0, 3).map(renderClubCard)}
                  </div>

                  {discoverEvents.length > 0 && (
                    <div className="events-foryou-section">
                      <div className="events-foryou-header">
                        <h2 className="section-heading">{t('home.sections.eventsForYou')}</h2>
                        <button className="events-foryou-seeall" onClick={() => navigate('/events')}>
                          {t('home.sections.seeAll')}
                        </button>
                      </div>
                      <div className="events-foryou-scroll">
                        {discoverEvents.slice(0, 10).map(ev => <EventCard key={ev.id} event={ev} />)}
                      </div>
                    </div>
                  )}

                  {filteredClubs.length > 3 && (
                    <div className="groups-grid clubs-grid">
                      {filteredClubs.slice(3).map(renderClubCard)}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">🏆</div>
                  <p>{t('home.empty.clubs')}</p>
                  <button className="empty-hint" onClick={() => navigate('/create-club')}>
                    {t('home.empty.clubsCta')}
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
                <h2 className="filter-sheet-title">{t('home.filter.title')}</h2>
                <button className="filter-close-btn" onClick={() => setShowFilters(false)} aria-label={t('home.filter.close')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Kategorien — both groups and clubs */}
              <div className="filter-section">
                <h3 className="filter-section-title">{t('home.filter.categories')}</h3>
                <div className="filter-pills">
                  {CATEGORY_HIERARCHY.map(cat => {
                    const selected = stagedKategorie.has(cat.id);
                    return (
                      <button
                        key={cat.id}
                        className={`filter-pill${selected ? ' active' : ''}`}
                        onClick={() => toggleStagedKategorie(cat.id)}
                        type="button"
                      >
                        <span style={{ marginRight: 6 }}>{cat.icon}</span>{cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Zeitraum — groups only */}
              {activeTab === 'gruppen' && (
                <div className="filter-section">
                  <h3 className="filter-section-title">{t('home.filter.time.title')}</h3>
                  <div className="filter-pills">
                    {[
                      { value: 'alle',       label: t('home.filter.time.all') },
                      { value: 'heute',      label: t('home.filter.time.today') },
                      { value: 'woche',      label: t('home.filter.time.week') },
                      { value: 'wochenende', label: t('home.filter.time.weekend') },
                      { value: 'monat',      label: t('home.filter.time.month') },
                      { value: 'ganztags',   label: t('home.filter.time.allDay') },
                      { value: 'zeitraum',   label: t('home.filter.time.custom') },
                    ].map(opt => (
                      <FilterPill key={opt.value} value={opt.value} label={opt.label} current={stagedZeit} onSelect={setStagedZeit} />
                    ))}
                  </div>
                  {stagedZeit === 'zeitraum' && (
                    <div className="filter-date-range">
                      <div className="filter-date-field">
                        <label>{t('home.filter.time.from')}</label>
                        <input type="date" value={stagedZeitFrom} onChange={e => setStagedZeitFrom(e.target.value)} className="filter-date-input" />
                      </div>
                      <div className="filter-date-field">
                        <label>{t('home.filter.time.to')}</label>
                        <input type="date" value={stagedZeitTo} onChange={e => setStagedZeitTo(e.target.value)} className="filter-date-input" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Alter — Regler */}
              <div className="filter-section">
                <div className="filter-section-title-row">
                  <h3 className="filter-section-title">{t('home.filter.age.title')}</h3>
                  <span className="filter-age-value">
                    {stagedAlter[0] === 18 && stagedAlter[1] === 70
                      ? t('home.filter.age.all')
                      : `${stagedAlter[0]} – ${stagedAlter[1] === 70 ? '70+' : stagedAlter[1]}`}
                  </span>
                </div>
                <AgeRangeSlider value={stagedAlter} onChange={setStagedAlter} />
              </div>

              {/* Sichtbarkeit */}
              <div className="filter-section">
                <h3 className="filter-section-title">{t('home.filter.visibility.title')}</h3>
                <div className="filter-pills">
                  {[
                    { value: 'alle',        label: t('home.filter.visibility.all') },
                    { value: 'oeffentlich', label: t('home.filter.visibility.public') },
                    { value: 'privat',      label: t('home.filter.visibility.private') },
                  ].map(opt => (
                    <FilterPill key={opt.value} value={opt.value} label={opt.label} current={stagedSicht} onSelect={setStagedSicht} />
                  ))}
                </div>
              </div>
            </div>

            {/* Actions — sticky at bottom, always visible */}
            <div className="filter-actions">
              <button className="filter-reset-btn" onClick={resetFilters}>
                {t('home.filter.reset')}
              </button>
              <button className="filter-apply-btn" onClick={applyFilters}>
                {t('home.filter.apply')}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default Home;
