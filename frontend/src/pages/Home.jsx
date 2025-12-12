import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { GroupCard } from '../components/GroupCard'; // Importieren Sie die GroupCard Komponente

const CATEGORIES = ['Hiking', 'Tennis', 'Golf', 'Beachvolleyball', 'Running'];

export const Home = () => {
  const [activeTab, setActiveTab] = useState('gruppen');
  const [activeFilter, setActiveFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupsData, setGroupsData] = useState([]);
  const [myClubs, setMyClubs] = useState([]);
  const [trendingClubs, setTrendingClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Re-fetch data when tab, filter (category), or search changes
  useEffect(() => {
    // Debounce search slightly to avoid too many requests
    const timer = setTimeout(() => {
      loadData();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, activeFilter, searchQuery]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'gruppen') {
        // Correct API call: type, search, category
        // type=null (all types in this view), search=searchQuery, category=activeFilter
        const response = await api.groups.getAll(null, searchQuery, activeFilter || '');
        
        // Safety check: ensure we set an array
        setGroupsData(Array.isArray(response.data) ? response.data : []);
      } else {
        // Load Clubs (Mock for now or API if implemented)
        // For production, you should implement api.groups.getAll('club', ...)
        const response = await api.groups.getAll('club', searchQuery, activeFilter || '');
        const clubs = Array.isArray(response.data) ? response.data : [];
        
        setMyClubs(clubs.slice(0, 2)); // Just an example subset
        setTrendingClubs(clubs);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setGroupsData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (id) => {
    try {
      await api.groups.toggleFavorite(id);
      loadData(); // Refresh to update status
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoin = async (id) => {
    try {
      await api.groups.join(id);
      loadData(); // Refresh
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="page home-page">
      <div className="home-header">
        {activeTab === 'gruppen' ? (
          <h1 className="page-title">Alle Gruppen</h1>
        ) : (
          <div className="tabs">
            <button className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`} onClick={() => setActiveTab('gruppen')}>
              Gruppen
            </button>
            <button className={`tab ${activeTab === 'clubs' ? 'active' : ''}`} onClick={() => setActiveTab('clubs')}>
              Clubs
            </button>
          </div>
        )}

        {activeTab === 'gruppen' && (
          <div className="tabs">
            <button className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`} onClick={() => setActiveTab('gruppen')}>
              Gruppen
            </button>
            <button className={`tab ${activeTab === 'clubs' ? 'active' : ''}`} onClick={() => setActiveTab('clubs')}>
              Clubs
            </button>
          </div>
        )}

        <div className="search-container">
          <input 
            type="text" 
            className="search-input" 
            placeholder="Suchen" 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
          />
          <div className="search-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </div>
        </div>

        <div className="filter-pills">
          {CATEGORIES.map(cat => (
            <button 
              key={cat} 
              className={`filter-pill ${activeFilter === cat ? 'active' : ''}`} 
              onClick={() => setActiveFilter(activeFilter === cat ? null : cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /></div>
        ) : activeTab === 'gruppen' ? (
          <div className="groups-grid">
            {groupsData.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#666', marginTop: 40 }}>Keine Gruppen gefunden.</p>
            ) : (
              groupsData.map(group => (
                <GroupCard 
                  key={group.id} 
                  group={group}
                  isFavorite={false} // You would need to check user favorites here properly
                  isJoined={false} // You would need to check user joined status here properly
                  onFavorite={handleFavorite}
                  onJoin={handleJoin}
                  onChat={() => navigate(`/chat/${group.id}`)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="clubs-view">
            {/* Clubs View Logic using same GroupCard for consistency or custom Cards */}
            <section className="clubs-section">
              <h2 className="section-label">Im Trend</h2>
              <div className="groups-grid">
                {trendingClubs.map(club => (
                  <GroupCard 
                    key={club.id} 
                    group={club}
                    onFavorite={handleFavorite}
                    onJoin={handleJoin}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};