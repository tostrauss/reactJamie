import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import api, { groups, clubs } from "../utils/api";
import { GroupCard } from "../components/GroupCard";
import { AuthContext } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
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
        const res = await api.get("/groups", { params: { type: "group" } });
        setGroupList(res.data || []);
      } else {
        const [allClubsRes, myClubsRes] = await Promise.all([
          clubs.getAll(),
          clubs.getJoined().catch(() => ({ data: [] }))
        ]);
        setClubList(allClubsRes.data || []);
        setMyClubs(myClubsRes.data || []);
      }
      const joinedRes = await groups.getJoined().catch(() => ({ data: [] }));
      const joinedClubsRes = await clubs.getJoined().catch(() => ({ data: [] }));
      const joinedIds = [
        ...(joinedRes.data || []).map(g => g.id),
        ...(joinedClubsRes.data || []).map(c => c.id)
      ];
      setJoined(new Set(joinedIds));
    } catch (error) {
      console.error('Error loading data:', error);
      if (!error.response) {
        toast.error('Server nicht erreichbar');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (groupId) => {
    setFavorites(prev => {
      const newFavs = new Set(prev);
      if (newFavs.has(groupId)) newFavs.delete(groupId);
      else newFavs.add(groupId);
      return newFavs;
    });
    try { await groups.toggleFavorite(groupId); } catch (err) { /* ignore */ }
  };

  const handleJoin = async (groupId) => {
    try {
      await groups.join(groupId);
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

  const filteredGroups = groupList.filter(group => {
    const matchesSearch = (group.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch && matchesCategory(group);
  });

  const filteredClubs = clubList.filter(club => {
    const matchesSearch = (club.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch && matchesCategory(club);
  });

  return (
    <div className="home-container">
      <header className="home-header">
        <h1 className="logo-text">jamie</h1>
      </header>

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

      <div className="tabs-container">
        <button
          className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`}
          onClick={() => { setActiveTab('gruppen'); setSelectedMain('all'); setSelectedSub(null); }}
        >
          Gruppen
        </button>
        <button
          className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
          onClick={() => { setActiveTab('clubs'); setSelectedMain('all'); setSelectedSub(null); }}
        >
          Clubs
        </button>
      </div>

      {/* Search */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="categories-container">
        {/* Main category row */}
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
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Subcategory row — slides in when a main is selected */}
        {selectedMain !== 'all' && (
          <div className="categories-scroll subcategories-scroll">
            {CATEGORY_HIERARCHY.find(c => c.id === selectedMain)?.subs.map(sub => (
              <button
                key={sub.name}
                className={`category-pill sub ${selectedSub === sub.name ? 'active' : ''}`}
                onClick={() => setSelectedSub(prev => prev === sub.name ? null : sub.name)}
              >
                {sub.icon} {sub.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* GRUPPEN VIEW */}
      {activeTab === 'gruppen' && (
        <div className="groups-feed">
          <div className="section-header">
            <h2 className="section-heading">Alle Gruppen</h2>
            <span className="section-count">{filteredGroups.length}</span>
          </div>
          {loading ? (
            <div className="loading">Laden...</div>
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
              <span className="empty-hint" onClick={() => navigate('/create-group')}>Erstelle selbst eine!</span>
            </div>
          )}
        </div>
      )}

      {/* CLUBS VIEW */}
      {activeTab === 'clubs' && (
        <div className="clubs-feed">
          {/* Meine Clubs Section */}
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
                      {club.image_url ? (
                        <img src={club.image_url} alt={club.name || club.title} />
                      ) : (
                        <div className="my-club-placeholder">
                          <span>{(club.name || club.title || 'C')[0]}</span>
                        </div>
                      )}
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

          {/* Im Trend Section */}
          <div className="clubs-section">
            <div className="section-header">
              <h2 className="section-heading">Im Trend</h2>
            </div>
            {loading ? (
              <div className="loading">Laden...</div>
            ) : filteredClubs.length > 0 ? (
              <div className="trend-clubs-list">
                {filteredClubs.map(club => (
                  <div key={club.id} className="trend-club-card" onClick={() => handleCardClick(club.id)}>
                    <div className="trend-club-image">
                      {club.image_url ? (
                        <img src={club.image_url} alt={club.name || club.title} />
                      ) : (
                        <div className="trend-club-placeholder">
                          <span>{(club.category || 'C')[0]}</span>
                        </div>
                      )}
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🏆</div>
                <p>Keine Clubs gefunden.</p>
                <span className="empty-hint" onClick={() => navigate('/create-club')}>Gründe deinen eigenen!</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
