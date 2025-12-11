import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

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

  useEffect(() => {
    loadData();
  }, [activeTab, activeFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'gruppen') {
        const response = await api.groups.getAll({ category: activeFilter });
        setGroupsData(response.groups || response || getMockGroups());
      } else {
        setMyClubs(getMockClubs().slice(0, 2));
        setTrendingClubs(getMockClubs());
      }
    } catch (error) {
      console.error('Error loading data:', error);
      if (activeTab === 'gruppen') {
        setGroupsData(getMockGroups());
      } else {
        setMyClubs(getMockClubs().slice(0, 2));
        setTrendingClubs(getMockClubs());
      }
    } finally {
      setLoading(false);
    }
  };

  const getMockGroups = () => [
    { id: 1, name: 'Wandern', memberCount: 4, maxMembers: 6, date: 'Heute', image: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400', members: [1,2,3,4] },
    { id: 2, name: 'Volleyball', memberCount: 4, maxMembers: 8, date: 'Heute', image: 'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=400', members: [1,2,3,4] },
    { id: 3, name: 'Wandern', memberCount: 4, maxMembers: 6, date: 'Heute', image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400', members: [5,6,7,8] },
    { id: 4, name: 'Volleyball', memberCount: 4, maxMembers: 8, date: 'Heute', image: 'https://images.unsplash.com/photo-1592656094267-764a45160876?w=400', members: [9,10,11,12] },
    { id: 5, name: 'Wandern', memberCount: 3, maxMembers: 5, date: 'Morgen', image: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?w=400', members: [13,14,15] },
    { id: 6, name: 'Volleyball', memberCount: 5, maxMembers: 8, date: 'Morgen', image: 'https://images.unsplash.com/photo-1547347298-4074fc3086f0?w=400', members: [16,17,18,19,20] },
  ];

  const getMockClubs = () => [
    { id: 101, name: 'Der Super Club', memberCount: 40, location: 'Wien', image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400', isPublic: true },
    { id: 102, name: 'Hiking Austria', memberCount: 120, location: 'Wien', image: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400', isPublic: true },
    { id: 103, name: 'Beach Sports', memberCount: 85, location: 'Wien', image: 'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=400', isPublic: false },
  ];

  const filteredGroups = activeFilter 
    ? groupsData.filter(g => g.name?.toLowerCase().includes(activeFilter.toLowerCase()) || g.activity?.toLowerCase().includes(activeFilter.toLowerCase()))
    : groupsData;

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
          <input type="text" className="search-input" placeholder="Suchen" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <div className="search-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </div>
        </div>

        <div className="filter-pills">
          {CATEGORIES.map(cat => (
            <button key={cat} className={`filter-pill ${activeFilter === cat ? 'active' : ''}`} onClick={() => setActiveFilter(activeFilter === cat ? null : cat)}>
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
            {filteredGroups.map(group => (
              <div key={group.id} className="group-card" onClick={() => navigate(`/group/${group.id}`)}>
                <div className="group-card-inner">
                  <img src={group.image} alt={group.name} className="group-card-img" />
                  <div className="group-card-overlay" />
                  {group.date && <span className="group-card-badge">{group.date}</span>}
                  <div className="group-card-info">
                    <h3 className="group-card-title">{group.name}</h3>
                    <p className="group-card-members">{group.memberCount}/{group.maxMembers} Members</p>
                    <div className="group-card-avatars">
                      {group.members?.slice(0, 3).map((m, i) => (
                        <img key={i} src={`https://i.pravatar.cc/40?img=${m}`} alt="" className="avatar-mini" />
                      ))}
                      {(group.members?.length || 0) > 3 && <span className="avatar-more">+</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="clubs-view">
            {myClubs.length > 0 && (
              <section className="clubs-section">
                <h2 className="section-label">Meine Clubs</h2>
                <div className="clubs-scroll">
                  {myClubs.map(club => (
                    <div key={club.id} className="my-club-card" onClick={() => navigate(`/group/${club.id}`)}>
                      <img src={club.image} alt={club.name} />
                      <span>{club.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="clubs-section">
              <h2 className="section-label">Im Trend</h2>
              {trendingClubs.map(club => (
                <div key={club.id} className="trending-club-card" onClick={() => navigate(`/group/${club.id}`)}>
                  <div className="trending-club-header">
                    <h3 className="trending-club-name">{club.name}</h3>
                    <span className={`club-badge ${club.isPublic ? 'public' : 'private'}`}>
                      {club.isPublic ? 'Öffentlich' : 'Privat'}
                    </span>
                  </div>
                  <div className="trending-club-meta">
                    <span>{club.memberCount} Mitglieder</span>
                    <span>📍 {club.location}</span>
                  </div>
                  <div className="trending-club-members">
                    {[1,2,3,4].map(i => (
                      <img key={i} src={`https://i.pravatar.cc/60?img=${club.id + i}`} alt="" />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>

      <style>{`
        .home-page { padding-bottom: calc(var(--nav-height) + 20px); }
        .home-header { padding: 16px; padding-top: calc(env(safe-area-inset-top, 20px) + 16px); position: sticky; top: 0; z-index: 10; background: var(--bg-dark); }
        .tabs { display: flex; justify-content: center; gap: 32px; margin-bottom: 16px; }
        .tab { position: relative; font-size: 16px; font-weight: 500; color: var(--text-muted); background: none; border: none; padding: 8px 0; cursor: pointer; }
        .tab.active { color: var(--text-white); }
        .tab.active::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--accent-coral); border-radius: 1px; }
        .search-container { position: relative; margin-bottom: 16px; }
        .search-input { width: 100%; padding: 12px 16px; padding-right: 48px; background: var(--bg-input); border: none; border-radius: 12px; color: var(--text-white); font-size: 15px; outline: none; }
        .search-input::placeholder { color: var(--text-muted); }
        .search-icon { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
        .filter-pills { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; }
        .filter-pills::-webkit-scrollbar { display: none; }
        .filter-pill { padding: 8px 16px; background: var(--bg-input); border: 1px solid transparent; border-radius: 20px; color: var(--text-light); font-size: 14px; cursor: pointer; white-space: nowrap; transition: all 0.2s; }
        .filter-pill:hover { background: var(--bg-card-hover); }
        .filter-pill.active { background: var(--accent-coral); color: white; }
        .page-content { padding: 0 16px; }
        .groups-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .group-card { border-radius: 12px; overflow: hidden; cursor: pointer; transition: transform 0.2s; }
        .group-card:hover { transform: translateY(-2px); }
        .group-card-inner { position: relative; }
        .group-card-img { width: 100%; aspect-ratio: 1; object-fit: cover; }
        .group-card-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.8) 100%); }
        .group-card-badge { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 12px; font-size: 11px; color: white; }
        .group-card-info { position: absolute; bottom: 0; left: 0; right: 0; padding: 12px; }
        .group-card-title { font-size: 16px; font-weight: 600; color: var(--accent-coral); margin-bottom: 2px; }
        .group-card-members { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
        .group-card-avatars { display: flex; }
        .avatar-mini { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--bg-dark); margin-left: -8px; object-fit: cover; }
        .avatar-mini:first-child { margin-left: 0; }
        .avatar-more { width: 28px; height: 28px; border-radius: 50%; background: var(--bg-input); display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-muted); margin-left: -8px; border: 2px solid var(--bg-dark); }
        .clubs-view { }
        .clubs-section { margin-bottom: 24px; }
        .section-label { font-size: 14px; font-weight: 500; color: var(--text-muted); margin-bottom: 12px; }
        .clubs-scroll { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
        .clubs-scroll::-webkit-scrollbar { display: none; }
        .my-club-card { flex-shrink: 0; width: 120px; cursor: pointer; }
        .my-club-card img { width: 120px; height: 120px; border-radius: 12px; object-fit: cover; margin-bottom: 8px; }
        .my-club-card span { font-size: 13px; color: var(--text-light); display: block; text-align: center; }
        .trending-club-card { background: var(--bg-card); border-radius: 16px; padding: 16px; margin-bottom: 12px; cursor: pointer; transition: background 0.2s; }
        .trending-club-card:hover { background: var(--bg-card-hover); }
        .trending-club-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
        .trending-club-name { font-size: 18px; font-weight: 600; color: var(--accent-coral); }
        .club-badge { font-size: 11px; padding: 4px 10px; border-radius: 12px; background: var(--bg-input); color: var(--text-muted); }
        .club-badge.public { background: rgba(76, 217, 100, 0.2); color: var(--accent-green); }
        .trending-club-meta { display: flex; gap: 16px; font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }
        .trending-club-members { display: flex; gap: 8px; }
        .trending-club-members img { width: 50px; height: 50px; border-radius: 12px; object-fit: cover; }
      `}</style>
    </div>
  );
};