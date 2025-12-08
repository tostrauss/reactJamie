import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups } from '../utils/api';
import { GroupCard } from '../components/GroupCard';
import '../styles/home.css';

export const Favorites = () => {
  const [favoriteGroups, setFavoriteGroups] = useState([]);
  const [joined, setJoined] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [favResponse, joinedResponse] = await Promise.all([
        groups.getFavorites(),
        groups.getJoined()
      ]);
      
      setFavoriteGroups(favResponse.data);
      setJoined(new Set(joinedResponse.data.map(g => g.id)));
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (groupId) => {
    try {
      await groups.toggleFavorite(groupId);
      // Remove from list immediately
      setFavoriteGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (error) {
      console.error('Error removing favorite:', error);
    }
  };

  const handleJoin = async (groupId) => {
    try {
      await groups.join(groupId);
      setJoined(prev => new Set(prev).add(groupId));
    } catch (error) {
      console.error('Error joining group:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="home">
      <div className="home-header">
        <h1>Your Favorites ❤️</h1>
        <p>Groups and clubs you saved</p>
      </div>

      {favoriteGroups.length === 0 ? (
        <div className="empty-state">
          <p>No favorites yet. Go explore!</p>
        </div>
      ) : (
        <div className="groups-grid">
          {favoriteGroups.map(group => (
            <GroupCard
              key={group.id}
              group={group}
              isFavorite={true}
              isJoined={joined.has(group.id)}
              onFavorite={handleFavorite}
              onJoin={handleJoin}
              onChat={(id) => navigate(`/chat/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};