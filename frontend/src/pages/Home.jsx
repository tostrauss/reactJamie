import { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import api, { groups, clubs } from "../utils/api";
import { GroupCard } from "../components/GroupCard";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import MapView from "../components/MapView";
import "../styles/home.css";
import { CATEGORY_HIERARCHY } from "../utils/categories";

export const Home = () => {
  const [groupList, setGroupList] = useState([]);
  const [clubList, setClubList] = useState([]);
  const [myClubs, setMyClubs] = useState([]);
  const [activeTab, setActiveTab] = useState("gruppen");
  const [selectedMain, setSelectedMain] = useState("all");
  const [selectedSub, setSelectedSub] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState(new Set());
  const [joined, setJoined] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

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
      if (!error.response) toast.error('Server nicht erreichbar');
    } finally {
      setLoading(false);
    }
  };

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
      loadData();
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

  const matchesCategory = (item) => {
    if (selectedMain === 'all') return true;
    const mainCat = CATEGORY_HIERARCHY.find(c => c.id === selectedMain);
    if (!mainCat) return true;
    const itemCat = (item.category || '').toLowerCase();
    if (selectedSub) return itemCat === selectedSub.toLowerCase();
    return mainCat.subs.some(sub => itemCat === sub.name.toLowerCase());
  };

  const filteredGroups = groupList.filter(g =>
    (g.name || '').toLowerCase().includes(searchQuery.toLowerCase()) && matchesCategory(g)
  );

  const filteredClubs = clubList.filter(c =>
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) && matchesCategory(c)
  );

  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    setSelectedMain('all');
    setSelectedSub(null);
    if (tab !== 'karte') setSearchQuery('');
  };

  return (
    <div className="home-container">

      {/* ── Sticky header (doesn't scroll) ─────────────────────────── */}
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

        {activeTab !== 'karte' && (
          <>
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
                <svg className="search-filter-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="6" x2="20" y2="6"/>
                  <line x1="8" y1="12" x2="16" y2="12"/>
                  <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3"/>
                  <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>
                </svg>
              </div>
            </div>

            <div className="categories-container">
              <div className="categories-scroll">
                <button
                  className={`category-pill ${selectedMain === 'all' ? 'active' : ''}`}
                  onClick={() => { setSelectedMain('all'); setSelectedSub(null); }}
                >
                  Alle
                </button>
                {CATEGORY_HIERARCHY.map(cat => (
                  <button
                    key={cat.id}
                    className={`category-pill ${selectedMain === cat.id ? 'active' : ''}`}
                    onClick={() => { setSelectedMain(cat.id); setSelectedSub(null); }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {selectedMain !== 'all' && (
                <div className="categories-scroll subcategories-scroll">
                  {CATEGORY_HIERARCHY.find(c => c.id === selectedMain)?.subs.map(sub => (
                    <button
                      key={sub.name}
                      className={`category-pill sub ${selectedSub === sub.name ? 'active' : ''}`}
                      onClick={() => setSelectedSub(prev => prev === sub.name ? null : sub.name)}
                    >
                      {sub.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Scrollable content ──────────────────────────────────────── */}
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
                          ? <img src={club.image_url} alt={club.name || club.title} />
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
                <div className="trend-clubs-list">
                  {filteredClubs.map(club => (
                    <div key={club.id} className="trend-club-card" onClick={() => handleCardClick(club.id)}>
                      <div className="trend-club-image">
                        {club.image_url
                          ? <img src={club.image_url} alt={club.name || club.title} />
                          : <div className="trend-club-placeholder"><span>{(club.category || 'C')[0]}</span></div>
                        }
                        <div className="trend-club-overlay">
                          {club.category && <span className="trend-club-badge">{club.category}</span>}
                        </div>
                      </div>
                      <div className="trend-club-content">
                        <h3>{club.name || club.title}</h3>
                        <div className="trend-club-meta">
                          <span className="trend-club-members">👥 {club.member_count || club.members_count || 0} Mitglieder</span>
                          {club.location && <span className="trend-club-location">📍 {club.location}</span>}
                        </div>
                        <div className="trend-club-actions">
                          {joined.has(club.id) ? (
                            <button className="trend-btn joined" onClick={(e) => { e.stopPropagation(); handleChat(club.id); }}>
                              💬 Chat
                            </button>
                          ) : (
                            <button className="trend-btn join" onClick={(e) => { e.stopPropagation(); handleJoin(club.id); }}>
                              Beitreten
                            </button>
                          )}
                          <button
                            className={`trend-btn fav${favorites.has(club.id) ? ' fav-active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); handleFavorite(club.id); }}
                            aria-label={favorites.has(club.id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24"
                              fill={favorites.has(club.id) ? '#FD7666' : 'none'}
                              stroke={favorites.has(club.id) ? '#FD7666' : 'rgba(255,255,255,0.7)'}
                              strokeWidth="2">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
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
        {activeTab === 'karte' && <MapView />}

      </div>
    </div>
  );
};

export default Home;
