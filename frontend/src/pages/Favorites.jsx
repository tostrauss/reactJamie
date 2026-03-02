import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [favGroupsRes, favClubsRes, joinedGroupsRes, joinedClubsRes] =
        await Promise.all([
          groups.getFavorites(),
          clubs.getFavorites(),
          groups.getJoined(),
          clubs.getJoined()
        ]);

      setFavoriteGroups(favGroupsRes.data || []);
      setFavoriteClubs(favClubsRes.data || []);

      const joinedIds = [
        ...(joinedGroupsRes.data || []).map((g) => g.id),
        ...(joinedClubsRes.data || []).map((c) => c.id)
      ];
      setJoined(new Set(joinedIds));
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (groupId) => {
    // Check if this is a club or group based on which tab/list it's in
    const isClub = favoriteClubs.some(c => c.id === groupId);

    // Aus Favoriten entfernen
    setFavoriteGroups(prev => prev.filter(g => g.id !== groupId));
    setFavoriteClubs(prev => prev.filter(g => g.id !== groupId));

    try {
      if (isClub) {
        await clubs.toggleFavorite(groupId);
      } else {
        await groups.toggleFavorite(groupId);
      }
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
      console.error('Waitlist error:', error);
      toast.error(error.response?.data?.error || 'Fehler bei Warteliste');
    }
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
                onWaitlist={handleWaitlist}
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