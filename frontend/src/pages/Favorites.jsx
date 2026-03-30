import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { GroupCard } from '../components/GroupCard';
import { useToast } from '../context/ToastContext';
import '../styles/home.css';

export const Favorites = () => {
  const [activeTab, setActiveTab] = useState('gruppen');
  const [favoriteGroups, setFavoriteGroups] = useState([]);
  const [favoriteClubs, setFavoriteClubs] = useState([]);
  const [joined, setJoined] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [favGroupsRes, favClubsRes, joinedGroupsRes, joinedClubsRes] = await Promise.all([
        groups.getFavorites(),
        clubs.getFavorites(),
        groups.getJoined(),
        clubs.getJoined()
      ]);
      setFavoriteGroups(favGroupsRes.data || []);
      setFavoriteClubs(favClubsRes.data || []);
      setJoined(new Set([
        ...(joinedGroupsRes.data || []).map(g => g.id),
        ...(joinedClubsRes.data || []).map(c => c.id)
      ]));
    } catch (err) {
      console.error('Error loading favorites:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (groupId) => {
    const isClub = favoriteClubs.some(c => c.id === groupId);
    setFavoriteGroups(prev => prev.filter(g => g.id !== groupId));
    setFavoriteClubs(prev => prev.filter(g => g.id !== groupId));
    try {
      if (isClub) await clubs.toggleFavorite(groupId);
      else await groups.toggleFavorite(groupId);
    } catch {
      toast.error('Favorit konnte nicht entfernt werden');
      loadData();
    }
  };

  const handleJoin = async (groupId) => {
    setJoined(prev => new Set(prev).add(groupId));
    const isClub = favoriteClubs.some(c => c.id === groupId);
    try {
      if (isClub) await clubs.join(groupId);
      else await groups.join(groupId);
    } catch (err) {
      setJoined(prev => { const s = new Set(prev); s.delete(groupId); return s; });
      toast.error(err.response?.data?.error || 'Beitreten fehlgeschlagen');
    }
  };

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
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler bei Warteliste');
    }
  };

  const currentFavorites = activeTab === 'gruppen' ? favoriteGroups : favoriteClubs;

  return (
    <div className="home-container">

      {/* ── Sticky header ───────────────────────────────────────────── */}
      <div className="home-sticky-header">
        <header className="home-header">
          <h1 className="page-title">Deine Favoriten</h1>
        </header>

        <div className="tabs-container">
          <button
            className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`}
            onClick={() => setActiveTab('gruppen')}
          >
            Gruppen
            {favoriteGroups.length > 0 && (
              <span className="tab-count">{favoriteGroups.length}</span>
            )}
          </button>
          <button
            className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
            onClick={() => setActiveTab('clubs')}
          >
            Clubs
            {favoriteClubs.length > 0 && (
              <span className="tab-count">{favoriteClubs.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────── */}
      <div className="home-content">
        <div className="groups-feed">
          {loading ? (
            <div className="home-loading">
              <div className="home-spinner" />
            </div>
          ) : currentFavorites.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⭐</div>
              <p>Noch keine {activeTab === 'gruppen' ? 'Gruppen' : 'Clubs'} gespeichert</p>
              <button className="empty-hint" onClick={() => navigate('/home')}>
                Entdecke neue {activeTab === 'gruppen' ? 'Gruppen' : 'Clubs'}!
              </button>
            </div>
          ) : (
            <div className="groups-grid">
              {currentFavorites.map(item => (
                <GroupCard
                  key={item.id}
                  group={item}
                  isFavorite={true}
                  isJoined={joined.has(item.id)}
                  onFavorite={handleFavorite}
                  onJoin={handleJoin}
                  onChat={(id) => navigate(`/chat/${id}`)}
                  onWaitlist={handleWaitlist}
                  onClick={() => navigate(`/group/${item.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default Favorites;
