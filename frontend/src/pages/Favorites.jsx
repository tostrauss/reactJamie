import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, clubs } from '../utils/api';
import { GroupCard } from '../components/GroupCard';
import '../styles/home.css';

// Demo-Daten für Favoriten
const DEMO_FAV_GROUPS = [
  {
    id: 1,
    title: "Wandern am Kahlenberg",
    type: "group",
    category: "Hiking",
    date: "Sa, 25. Jan",
    location: "Wien",
    member_count: 4,
    max_members: 6,
    image_url: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=400"
  },
  {
    id: 3,
    title: "Fotografie Walk",
    type: "group",
    category: "Kreativ",
    date: "Mo, 27. Jan",
    location: "Wien",
    member_count: 3,
    max_members: 5,
    image_url: "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=400"
  }
];

const DEMO_FAV_CLUBS = [
  {
    id: 101,
    title: "Tennis Club Wien",
    type: "club",
    category: "Tennis",
    location: "Wien",
    member_count: 45,
    max_members: 100,
    image_url: "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=400"
  },
  {
    id: 103,
    title: "Wiener Buchclub",
    type: "club",
    category: "Kultur",
    location: "Wien",
    member_count: 32,
    max_members: 50,
    image_url: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400"
  }
];

export const Favorites = () => {
  const [activeTab, setActiveTab] = useState('gruppen');
  const [favoriteGroups, setFavoriteGroups] = useState([]);
  const [favoriteClubs, setFavoriteClubs] = useState([]);
  const [joined, setJoined] = useState(new Set([1, 101]));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    
    // Demo-Daten verwenden
    setFavoriteGroups(DEMO_FAV_GROUPS);
    setFavoriteClubs(DEMO_FAV_CLUBS);
    
    // Versuche echte Daten zu laden
    try {
      const [favGroupsRes, favClubsRes, joinedGroupsRes, joinedClubsRes] =
        await Promise.all([
          groups.getFavorites(),
          clubs.getFavorites(),
          groups.getJoined(),
          clubs.getJoined()
        ]);

      if (favGroupsRes.data && favGroupsRes.data.length > 0) {
        setFavoriteGroups(favGroupsRes.data);
      }
      if (favClubsRes.data && favClubsRes.data.length > 0) {
        setFavoriteClubs(favClubsRes.data);
      }
      const joinedIds = [
        ...(joinedGroupsRes.data || []).map((g) => g.id),
        ...(joinedClubsRes.data || []).map((c) => c.id)
      ];
      if (joinedIds.length) {
        setJoined(new Set(joinedIds));
      }
    } catch (error) {
      console.log('Backend nicht verfügbar, verwende Demo-Daten');
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (groupId) => {
    // Aus Favoriten entfernen
    setFavoriteGroups(prev => prev.filter(g => g.id !== groupId));
    setFavoriteClubs(prev => prev.filter(g => g.id !== groupId));
    
    try {
      await groups.toggleFavorite(groupId);
    } catch (error) {
      console.log('Backend nicht verfügbar');
    }
  };

  const handleJoin = async (groupId) => {
    setJoined(prev => new Set(prev).add(groupId));
    try {
      await groups.join(groupId);
    } catch (error) {
      console.log('Backend nicht verfügbar');
    }
  };

  const handleChat = (groupId) => {
    navigate(`/chat/${groupId}`);
  };

  const handleCardClick = (groupId) => {
    navigate(`/group/${groupId}`);
  };

  const currentFavorites = activeTab === 'gruppen' ? favoriteGroups : favoriteClubs;

  if (loading) {
    return (
      <div className="home-container">
        <div className="loading">Laden...</div>
      </div>
    );
  }

  return (
    <div className="home-container">
      {/* Header */}
      <header className="home-header">
        <h1 className="page-title">Deine Favoriten</h1>
      </header>

      {/* Tabs */}
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

      {/* Content */}
      <div className="groups-feed">
        {currentFavorites.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⭐</div>
            <p>Noch keine {activeTab === 'gruppen' ? 'Gruppen' : 'Clubs'} gespeichert</p>
            <span className="empty-hint" onClick={() => navigate('/home')}>
              Entdecke neue {activeTab === 'gruppen' ? 'Gruppen' : 'Clubs'}!
            </span>
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
                onChat={handleChat}
                onClick={() => handleCardClick(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Favorites;