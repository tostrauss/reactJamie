import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../utils/api";
import GroupCard from "../components/GroupCard";
import CreateActionModal from "../components/CreateActionModal"; // Import the new modal
import "../styles/home.css";

const Home = () => {
  const [groups, setGroups] = useState([]);
  const [activeTab, setActiveTab] = useState("discover"); // 'discover' or 'for-you'
  const [isModalOpen, setIsModalOpen] = useState(false); // Modal state
  const navigate = useNavigate();

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await api.get("/groups");
      setGroups(res.data);
    } catch (error) {
      console.error("Fehler beim Laden der Gruppen:", error);
    }
  };

  return (
    <div className="home-container">
      {/* Header */}
      <header className="home-header">
        <h1 className="logo-text">Jamie</h1>
        <div className="header-actions">
          {/* Notification icon could go here */}
        </div>
      </header>

      {/* Hero / Action Section */}
      <section className="hero-action">
        <h2 className="hero-title">No plans tonight?</h2>
        <p className="hero-subtitle">Start something new or join the crew.</p>
        
        {/* THE SINGLE BUTTON */}
        <button 
          className="create-activity-btn" 
          onClick={() => setIsModalOpen(true)}
        >
          + Create Activity
        </button>
      </section>

      {/* Tabs */}
      <div className="tabs-container">
        <button 
          className={`tab ${activeTab === 'discover' ? 'active' : ''}`} 
          onClick={() => setActiveTab('discover')}
        >
          Discover
        </button>
        <button 
          className={`tab ${activeTab === 'for-you' ? 'active' : ''}`} 
          onClick={() => setActiveTab('for-you')}
        >
          For You
        </button>
      </div>

      {/* Feed */}
      <div className="groups-feed">
        {groups.length > 0 ? (
          groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))
        ) : (
          <div className="empty-state">
            <p>No active groups nearby.</p>
            <span onClick={() => setIsModalOpen(true)} className="link-text">Be the first to create one!</span>
          </div>
        )}
      </div>

      {/* The Modal Component */}
      <CreateActionModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
};

export default Home;