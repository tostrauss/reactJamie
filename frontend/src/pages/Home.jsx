import React, { useState, useEffect, useContext } from 'react';
import { groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import '../styles/home.css';

export const Home = () => {
  const [allGroups, setAllGroups] = useState([]);
  const [filteredGroups, setFilteredGroups] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [joined, setJoined] = useState(new Set());
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('group');
  const { user } = useContext(AuthContext);

  useEffect(() => {
    loadGroups();
    loadUserGroups();
  }, []);

  useEffect(() => {
    filterGroups();
  }, [filter, allGroups]);

  const loadGroups = async () => {
    try {
      setLoading(true);
      const response = await groups.getAll();
      setAllGroups(response.data);
    } catch (error) {
      console.error('Error loading groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserGroups = async () => {
    try {
      const favResponse = await groups.getFavorites();
      const favIds = new Set(favResponse.data.map(g => g.id));
      setFavorites(favIds);

      const joinedResponse = await groups.getJoined();
      const joinedIds = new Set(joinedResponse.data.map(g => g.id));
      setJoined(joinedIds);
    } catch (error) {
      console.error('Error loading user groups:', error);
    }
  };

  const filterGroups = () => {
    if (filter === 'all') {
      setFilteredGroups(allGroups);
    } else {
      setFilteredGroups(allGroups.filter(g => g.type === filter));
    }
  };

  const handleJoin = async (groupId) => {
    try {
      if (joined.has(groupId)) {
        await groups.leave(groupId);
        setJoined(prev => {
          const newSet = new Set(prev);
          newSet.delete(groupId);
          return newSet;
        });
      } else {
        await groups.join(groupId);
        setJoined(prev => new Set(prev).add(groupId));
      }
    } catch (error) {
      console.error('Error joining group:', error);
    }
  };

  const handleFavorite = async (groupId) => {
    try {
      await groups.toggleFavorite(groupId);
      setFavorites(prev => {
        const newSet = new Set(prev);
        if (newSet.has(groupId)) {
          newSet.delete(groupId);
        } else {
          newSet.add(groupId);
        }
        return newSet;
      });
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await groups.create(title, description, type);
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      setType('group');
      loadGroups();
    } catch (error) {
      console.error('Error creating group:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="home">
      <div className="home-header">
        <h1>Welcome, {user?.name}! 👋</h1>
        <p>Discover groups & clubs near you</p>
      </div>

      <div className="tabs">
        {['all', 'group', 'club'].map(tab => (
          <button
            key={tab}
            className={`tab ${filter === tab ? 'active' : ''}`}
            onClick={() => setFilter(tab)}
          >
            {tab === 'all' ? 'All' : tab === 'group' ? 'Groups' : 'Clubs'}
          </button>
        ))}
      </div>

      <div className="groups-grid">
        {filteredGroups.map(group => (
          <div key={group.id} className="group-card">
            <div className="card-image" style={{
              background: `linear-gradient(135deg, #ff6b6b, #ff8585)`
            }}></div>
            
            <div className="card-content">
              <div className="card-header">
                <h3>{group.title}</h3>
                <span className={`badge ${group.type}`}>{group.type}</span>
              </div>
              <p className="card-meta">👥 {group.member_count} members • by {group.owner_name}</p>
              <p className="card-desc">{group.description}</p>
              
              <div className="card-footer">
                <button
                  className={`fav-btn ${favorites.has(group.id) ? 'active' : ''}`}
                  onClick={() => handleFavorite(group.id)}
                >
                  ❤️
                </button>
                <button
                  className={`join-btn ${joined.has(group.id) ? 'joined' : ''}`}
                  onClick={() => handleJoin(group.id)}
                >
                  {joined.has(group.id) ? '✓ Joined' : 'Join'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="create-btn" onClick={() => setShowCreateModal(true)}>
        + Create
      </button>

      {showCreateModal && (
        <div className="modal active">
          <div className="modal-content">
            <button className="close-btn" onClick={() => setShowCreateModal(false)}>×</button>
            <h2>Create Group/Club</h2>
            
            <form onSubmit={handleCreate}>
              <input
                type="text"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <textarea
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              ></textarea>
              
              <div className="type-selector">
                <label>
                  <input
                    type="radio"
                    value="group"
                    checked={type === 'group'}
                    onChange={(e) => setType(e.target.value)}
                  />
                  Group (3-10 people)
                </label>
                <label>
                  <input
                    type="radio"
                    value="club"
                    checked={type === 'club'}
                    onChange={(e) => setType(e.target.value)}
                  />
                  Club (20+ people)
                </label>
              </div>

              <button type="submit" className="submit-btn">Create</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
