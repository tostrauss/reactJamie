import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../utils/api";
import { GroupCard } from "../components/GroupCard";
import "../styles/home.css";

// Demo-Daten
const DEMO_GROUPS = [
  {
    id: 1,
    title: "Wandern am Kahlenberg",
    type: "group",
    category: "Hiking",
    date: "Sa, 25. Jan",
    location: "Wien",
    member_count: 4,
    max_members: 6,
    image_url: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=400",
    owner_name: "Max"
  },
  {
    id: 2,
    title: "Volleyball im Prater",
    type: "group", 
    category: "Sport",
    date: "So, 26. Jan",
    location: "Wien",
    member_count: 5,
    max_members: 8,
    image_url: "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=400",
    owner_name: "Lisa"
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
    image_url: "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=400",
    owner_name: "Tom"
  },
  {
    id: 4,
    title: "Brettspiele Abend",
    type: "group",
    category: "Gaming",
    date: "Di, 28. Jan",
    location: "Wien",
    member_count: 4,
    max_members: 6,
    image_url: "https://images.unsplash.com/photo-1611371805429-8b5c1b2c34ba?w=400",
    owner_name: "Sarah"
  }
];

const DEMO_CLUBS = [
  {
    id: 101,
    title: "Tennis Club Wien",
    type: "club",
    category: "Tennis",
    location: "Wien",
    member_count: 45,
    max_members: 100,
    image_url: "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=400",
    owner_name: "Club"
  },
  {
    id: 102,
    title: "Lauftreff Donaukanal",
    type: "club",
    category: "Running",
    location: "Wien", 
    member_count: 78,
    max_members: 150,
    image_url: "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=400",
    owner_name: "Club"
  },
  {
    id: 103,
    title: "Wiener Buchclub",
    type: "club",
    category: "Kultur",
    location: "Wien",
    member_count: 32,
    max_members: 50,
    image_url: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400",
    owner_name: "Club"
  },
  {
    id: 104,
    title: "Yoga Community",
    type: "club",
    category: "Wellness",
    location: "Wien",
    member_count: 89,
    max_members: 200,
    image_url: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400",
    owner_name: "Club"
  }
];

const CATEGORIES = [
  { id: "all", label: "Alle" },
  { id: "hiking", label: "Wandern" },
  { id: "sport", label: "Sport" },
  { id: "tennis", label: "Tennis" },
  { id: "running", label: "Laufen" },
  { id: "gaming", label: "Gaming" },
  { id: "kultur", label: "Kultur" },
  { id: "kreativ", label: "Kreativ" }
];

export const Home = () => {
  const [groups, setGroups] = useState([]);
  const [activeTab, setActiveTab] = useState("gruppen");
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState(new Set());
  const [joined, setJoined] = useState(new Set([1, 101])); 
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    // Demo: Mock-Data!
    if (activeTab === "gruppen") {
      setGroups(DEMO_GROUPS);
    } else {
      setGroups(DEMO_CLUBS);
    }
    try {
      const res = await api.get("/groups", {
        params: { type: activeTab === "gruppen" ? "group" : "club" }
      });
      if (res.data && res.data.length > 0) {
        setGroups(res.data);
      }
    } catch (error) {
      console.log("Backend nicht verfügbar, verwende Demo-Daten");
    }
  };

  const handleFavorite = (groupId) => {
    setFavorites(prev => {
      const newFavs = new Set(prev);
      if (newFavs.has(groupId)) {
        newFavs.delete(groupId);
      } else {
        newFavs.add(groupId);
      }
      return newFavs;
    });
  };

  const handleJoin = (groupId) => {
    setJoined(prev => new Set(prev).add(groupId));
  };

  const handleChat = (groupId) => {
    navigate(`/chat/${groupId}`);
  };

  const handleCardClick = (groupId) => {
    navigate(`/group/${groupId}`);
  };

  const filteredGroups = groups.filter(group => {
    const matchesSearch = group.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "all" || 
      group.category?.toLowerCase() === activeCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="home-container">
      <header className="home-header">
        <h1 className="logo-text">Jamie</h1>
      </header>
      <div className="tabs-container">
        <button 
          className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`} 
          onClick={() => setActiveTab('gruppen')}
        >
          Gruppen
        </button>
        <button 
          className={`tab ${activeTab === 'clubs' ? 'active' : ''}`} 
          onClick={() => setActiveTab('clubs')}
        >
          Clubs
        </button>
      </div>
      {/* Suchleiste */}
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
      <div className="categories-container">
        <div className="categories-scroll">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`category-pill ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>
      <div className="groups-feed">
        {filteredGroups.length > 0 ? (
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
                onClick={() => handleCardClick(group.id)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <p>Keine {activeTab === 'gruppen' ? 'Gruppen' : 'Clubs'} gefunden.</p>
            <span className="empty-hint">Erstelle selbst eine!</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;