import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { GroupCard } from '../components/GroupCard';

const CATEGORIES = ['Hiking', 'Tennis', 'Golf', 'Beachvolleyball', 'Running'];

// MOCK DATA for "Perfect Styling"
const MOCK_GROUPS = [
  {
    id: 991,
    title: 'Wandern am Kahlenberg',
    category: 'Hiking',
    member_count: 4,
    max_members: 6,
    date: 'Heute',
    time: '14:00',
    image_url: 'https://images.unsplash.com/photo-1551632811-561732d1e306?q=80&w=2070&auto=format&fit=crop',
    owner_name: 'Max',
    type: 'group'
  },
  {
    id: 992,
    title: 'Beachvolleyball Donauinsel',
    category: 'Volleyball',
    member_count: 3,
    max_members: 4,
    date: 'Morgen',
    time: '16:30',
    image_url: 'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?q=80&w=2007&auto=format&fit=crop',
    owner_name: 'Lisa',
    type: 'group'
  }
];

export const Home = () => {
  const [activeTab, setActiveTab] = useState('gruppen');
  const [activeFilter, setActiveFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupsData, setGroupsData] = useState([]);
  const [myClubs, setMyClubs] = useState([]);
  const [trendingClubs, setTrendingClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, activeFilter, searchQuery]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'gruppen') {
        const response = await api.groups.getAll(null, searchQuery, activeFilter || '');
        // Combine MOCK data with real API data for development
        const apiData = Array.isArray(response.data) ? response.data : [];
        setGroupsData([...MOCK_GROUPS, ...apiData]);
      } else {
        const response = await api.groups.getAll('club', searchQuery, activeFilter || '');
        const clubs = Array.isArray(response.data) ? response.data : [];
        setMyClubs(clubs.slice(0, 2));
        setTrendingClubs(clubs);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      // Fallback to mock data on error
      setGroupsData(MOCK_GROUPS);
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (id) => {
    try {
      await api.groups.toggleFavorite(id);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoin = async (id) => {
    try {
      await api.groups.join(id);
      loadData();
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

        {/* Tab Switcher */}
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

        {/* Search Bar */}
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

        {/* Filters */}
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

      {/* Content */}
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
                  isFavorite={false}
                  isJoined={false}
                  onFavorite={handleFavorite}
                  onJoin={handleJoin}
                  onChat={() => navigate(`/chat/${group.id}`)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="clubs-view">
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