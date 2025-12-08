import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { GroupCard } from '../components/GroupCard';
import { ImageUpload } from '../components/ImageUpload';
import '../styles/home.css';

const CATEGORIES = ['All', 'Sports', 'Music', 'Tech', 'Art', 'Social'];

export const Home = () => {
  const [allGroups, setAllGroups] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [joined, setJoined] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  // Filter States
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'group', 'club'
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Create Form State
  const [newGroup, setNewGroup] = useState({
    title: '',
    description: '',
    type: 'group',
    category: 'Sports',
    image_url: ''
  });

  useEffect(() => {
    loadGroups();
    loadUserGroups();
  }, [typeFilter, searchQuery, categoryFilter]); // Reload when filters change

  const loadGroups = async () => {
    try {
      setLoading(true);
      // Pass filters to backend
      const cat = categoryFilter === 'All' ? '' : categoryFilter;
      const type = typeFilter === 'all' ? null : typeFilter;
      
      const response = await groups.getAll(type, searchQuery, cat);
      setAllGroups(response.data);
    } catch (error) {
      console.error('Error loading groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserGroups = async () => {
    try {
      const [favRes, joinedRes] = await Promise.all([
        groups.getFavorites(),
        groups.getJoined()
      ]);
      setFavorites(new Set(favRes.data.map(g => g.id)));
      setJoined(new Set(joinedRes.data.map(g => g.id)));
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await groups.create(newGroup);
      setShowCreateModal(false);
      setNewGroup({ title: '', description: '', type: 'group', category: 'Sports', image_url: '' });
      loadGroups(); // Refresh list
    } catch (error) {
      console.error('Error creating group:', error);
    }
  };

  // Re-using handlers from Favorites/GroupCard
  const handleJoin = async (id) => {
    if (joined.has(id)) {
      await groups.leave(id);
      setJoined(prev => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      await groups.join(id);
      setJoined(prev => new Set(prev).add(id));
    }
  };

  const handleFavorite = async (id) => {
    await groups.toggleFavorite(id);
    setFavorites(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  return (
    <div className="home">
      <div className="home-header">
        <h1>Welcome, {user?.name}! 👋</h1>
        <p>Discover groups & clubs near you</p>
      </div>

      {/* --- Search & Filter Section --- */}
      <div className="search-section" style={{ marginBottom: '20px' }}>
        <input 
          type="text" 
          placeholder="🔍 Search groups..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '12px', borderRadius: '15px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white' }}
        />
        
        <div className="category-scroll" style={{ display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{
                background: categoryFilter === cat ? '#ff6b6b' : 'rgba(255,255,255,0.1)',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '20px',
                color: 'white',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                cursor: 'pointer'
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* --- Type Tabs --- */}
      <div className="tabs">
        {['all', 'group', 'club'].map(tab => (
          <button
            key={tab}
            className={`tab ${typeFilter === tab ? 'active' : ''}`}
            onClick={() => setTypeFilter(tab)}
          >
            {tab === 'all' ? 'All' : tab === 'group' ? 'Groups' : 'Clubs'}
          </button>
        ))}
      </div>

      {/* --- Grid --- */}
      {loading ? <div className="loading">Loading...</div> : (
        <div className="groups-grid">
          {allGroups.map(group => (
            <div key={group.id} onClick={() => navigate(`/group/${group.id}`)} style={{cursor: 'pointer'}}>
               <GroupCard 
                 group={group}
                 isFavorite={favorites.has(group.id)}
                 isJoined={joined.has(group.id)}
                 onFavorite={handleFavorite}
                 onJoin={handleJoin}
                 // Override Image if available
                 customImage={group.image_url}
               />
            </div>
          ))}
          {allGroups.length === 0 && (
            <p style={{ textAlign: 'center', color: '#999', marginTop: '20px' }}>No groups found matching your search.</p>
          )}
        </div>
      )}

      {/* --- Create Button --- */}
      <button className="create-btn" onClick={() => setShowCreateModal(true)}>+</button>

      {/* --- Create Modal --- */}
      {showCreateModal && (
        <div className="modal active">
          <div className="modal-content">
            <button className="close-btn" onClick={() => setShowCreateModal(false)}>×</button>
            <h2>Create New</h2>
            
            <form onSubmit={handleCreate}>
              <ImageUpload onUpload={(url) => setNewGroup({...newGroup, image_url: url})} label="Cover Image" />
              
              <input
                type="text"
                placeholder="Title"
                value={newGroup.title}
                onChange={(e) => setNewGroup({...newGroup, title: e.target.value})}
                required
              />
              
              <select 
                value={newGroup.category}
                onChange={(e) => setNewGroup({...newGroup, category: e.target.value})}
                style={{ width: '100%', padding: '12px', marginBottom: '15px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '10px', color: '#fff' }}
              >
                {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <textarea
                placeholder="Description"
                value={newGroup.description}
                onChange={(e) => setNewGroup({...newGroup, description: e.target.value})}
                required
              ></textarea>
              
              <div className="type-selector">
                <label>
                  <input
                    type="radio"
                    checked={newGroup.type === 'group'}
                    onChange={() => setNewGroup({...newGroup, type: 'group'})}
                  />
                  Group (Small, temporary)
                </label>
                <label>
                  <input
                    type="radio"
                    checked={newGroup.type === 'club'}
                    onChange={() => setNewGroup({...newGroup, type: 'club'})}
                  />
                  Club (Large, permanent)
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