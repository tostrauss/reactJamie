import React, { useState, useEffect, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';

export const ChatList = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState('groups');
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);

  // Mock data
  const mockGroupChats = [
    {
      id: 1,
      name: 'Volleyball',
      lastMessage: 'Eva: Hey where do we meet?',
      avatar: 'https://i.pravatar.cc/100?img=20',
      unread: 1,
      time: '14:32',
      hasRequests: true,
      requestCount: 3
    },
    {
      id: 2,
      name: 'Bar-Hopping Wien',
      lastMessage: 'Ben: Hey guys!!:)',
      avatar: 'https://i.pravatar.cc/100?img=21',
      unread: 1,
      time: '12:15',
      section: 'andere'
    },
    {
      id: 3,
      name: 'Spiele Abend im Bukowski',
      lastMessage: 'Great idea!',
      avatar: 'https://i.pravatar.cc/100?img=22',
      unread: 0,
      time: 'Gestern',
      section: 'andere'
    }
  ];

  const mockDirectChats = [
    {
      id: 101,
      name: 'Lisa',
      lastMessage: 'Ja klar, bis dann!',
      avatar: 'https://i.pravatar.cc/100?img=5',
      unread: 2,
      time: '15:45',
      online: true
    },
    {
      id: 102,
      name: 'Max',
      lastMessage: 'Cool, freut mich!',
      avatar: 'https://i.pravatar.cc/100?img=8',
      unread: 0,
      time: '11:20',
      online: false
    }
  ];

  const hiddenChats = [
    {
      id: 201,
      name: 'Alter Chat',
      lastMessage: 'Das war lustig',
      avatar: 'https://i.pravatar.cc/100?img=30',
      unread: 0,
      time: '2 Wochen'
    }
  ];

  useEffect(() => {
    loadChats();
  }, [activeTab]);

  const loadChats = async () => {
    setLoading(true);
    try {
      // Replace with actual API call
      setTimeout(() => {
        setChats(activeTab === 'groups' ? mockGroupChats : mockDirectChats);
        setLoading(false);
      }, 300);
    } catch (err) {
      console.error('Failed to load chats:', err);
      setLoading(false);
    }
  };

  const groupedChats = chats.reduce((acc, chat) => {
    if (chat.hasRequests) {
      if (!acc.withRequests) acc.withRequests = [];
      acc.withRequests.push(chat);
    } else if (chat.section === 'andere') {
      if (!acc.andere) acc.andere = [];
      acc.andere.push(chat);
    } else {
      if (!acc.main) acc.main = [];
      acc.main.push(chat);
    }
    return acc;
  }, {});

  return (
    <div className="page chat-list-page">
      {/* Header with Tabs */}
      <div className="chat-header">
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'groups' ? 'active' : ''}`}
            onClick={() => setActiveTab('groups')}
          >
            Gruppen
          </button>
          <button 
            className={`tab ${activeTab === 'direct' ? 'active' : ''}`}
            onClick={() => setActiveTab('direct')}
          >
            Deine Chats
            {mockDirectChats.some(c => c.unread > 0) && (
              <span className="tab-badge">●</span>
            )}
          </button>
        </div>
      </div>

      {/* Chat List */}
      <div className="chat-list-content">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        ) : (
          <>
            {/* Chats with Requests (Group tab only) */}
            {activeTab === 'groups' && groupedChats.withRequests?.map(chat => (
              <div key={chat.id} className="chat-item-wrapper">
                <Link to={`/chat/${chat.id}`} className="chat-item">
                  <div className="chat-avatar">
                    <img src={chat.avatar} alt={chat.name} />
                    {chat.unread > 0 && (
                      <span className="unread-badge">{chat.unread}</span>
                    )}
                  </div>
                  <div className="chat-info">
                    <div className="chat-name-row">
                      <span className="chat-name">{chat.name}</span>
                      <span className="chat-time">{chat.time}</span>
                    </div>
                    <p className="chat-preview">{chat.lastMessage}</p>
                  </div>
                </Link>
                
                {/* Request/Manage Buttons */}
                <div className="chat-actions">
                  <button 
                    className="chat-action-btn requests"
                    onClick={() => navigate(`/group/${chat.id}/requests`)}
                  >
                    Anfragen
                    {chat.requestCount > 0 && (
                      <span className="action-badge">{chat.requestCount}</span>
                    )}
                  </button>
                  <button className="chat-action-btn manage">
                    Verwalten
                  </button>
                </div>
              </div>
            ))}

            {/* Andere Section */}
            {activeTab === 'groups' && groupedChats.andere && (
              <div className="chat-section">
                <h3 className="section-title">Andere</h3>
                {groupedChats.andere.map(chat => (
                  <Link key={chat.id} to={`/chat/${chat.id}`} className="chat-item">
                    <div className="chat-avatar">
                      <img src={chat.avatar} alt={chat.name} />
                      {chat.unread > 0 && (
                        <span className="unread-badge">{chat.unread}</span>
                      )}
                    </div>
                    <div className="chat-info">
                      <div className="chat-name-row">
                        <span className="chat-name">{chat.name}</span>
                        <span className="chat-time">{chat.time}</span>
                      </div>
                      <p className="chat-preview">{chat.lastMessage}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Direct Chats */}
            {activeTab === 'direct' && chats.map(chat => (
              <Link key={chat.id} to={`/chat/${chat.id}`} className="chat-item">
                <div className="chat-avatar">
                  <img src={chat.avatar} alt={chat.name} />
                  {chat.online && <span className="online-indicator" />}
                  {chat.unread > 0 && (
                    <span className="unread-badge">{chat.unread}</span>
                  )}
                </div>
                <div className="chat-info">
                  <div className="chat-name-row">
                    <span className="chat-name">{chat.name}</span>
                    <span className="chat-time">{chat.time}</span>
                  </div>
                  <p className="chat-preview">{chat.lastMessage}</p>
                </div>
              </Link>
            ))}

            {/* Hidden Chats */}
            {hiddenChats.length > 0 && (
              <div className="hidden-section">
                <button 
                  className="hidden-toggle"
                  onClick={() => setHiddenExpanded(!hiddenExpanded)}
                >
                  <span>Ausgeblendet</span>
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                    style={{ transform: hiddenExpanded ? 'rotate(180deg)' : 'none' }}
                  >
                    <polyline points="6,9 12,15 18,9"/>
                  </svg>
                </button>
                
                {hiddenExpanded && hiddenChats.map(chat => (
                  <Link key={chat.id} to={`/chat/${chat.id}`} className="chat-item hidden">
                    <div className="chat-avatar">
                      <img src={chat.avatar} alt={chat.name} />
                    </div>
                    <div className="chat-info">
                      <div className="chat-name-row">
                        <span className="chat-name">{chat.name}</span>
                        <span className="chat-time">{chat.time}</span>
                      </div>
                      <p className="chat-preview">{chat.lastMessage}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Empty State */}
            {chats.length === 0 && !loading && (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <h2 className="empty-state-title">Keine Chats</h2>
                <p className="empty-state-text">
                  {activeTab === 'groups' 
                    ? 'Tritt einer Gruppe bei, um zu chatten!'
                    : 'Starte eine Unterhaltung mit jemandem!'
                  }
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        .chat-list-page {
          padding-bottom: calc(var(--nav-height) + 20px);
        }
        .chat-header {
          padding: 16px;
          padding-top: calc(env(safe-area-inset-top, 20px) + 16px);
          background: var(--bg-dark);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .tabs {
          display: flex;
          justify-content: center;
          gap: 32px;
        }
        .tab {
          position: relative;
          font-size: 16px;
          font-weight: 500;
          color: var(--text-muted);
          background: none;
          border: none;
          padding: 8px 0;
          cursor: pointer;
          transition: color 0.2s;
        }
        .tab.active {
          color: var(--text-white);
        }
        .tab.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent-coral);
          border-radius: 1px;
        }
        .tab-badge {
          color: var(--accent-coral);
          margin-left: 4px;
        }
        .chat-list-content {
          padding: 0 16px;
        }
        .chat-item-wrapper {
          margin-bottom: 16px;
        }
        .chat-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--bg-card);
          border-radius: 12px;
          text-decoration: none;
          transition: background 0.2s;
        }
        .chat-item:hover {
          background: var(--bg-card-hover);
        }
        .chat-item.hidden {
          opacity: 0.6;
        }
        .chat-avatar {
          position: relative;
          width: 50px;
          height: 50px;
          flex-shrink: 0;
        }
        .chat-avatar img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }
        .online-indicator {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: 12px;
          height: 12px;
          background: var(--accent-green);
          border: 2px solid var(--bg-card);
          border-radius: 50%;
        }
        .unread-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 20px;
          height: 20px;
          background: var(--accent-coral);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: white;
          padding: 0 6px;
        }
        .chat-info {
          flex: 1;
          min-width: 0;
        }
        .chat-name-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .chat-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-white);
        }
        .chat-time {
          font-size: 12px;
          color: var(--text-muted);
        }
        .chat-preview {
          font-size: 13px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chat-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
          padding-left: 62px;
        }
        .chat-action-btn {
          position: relative;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          cursor: pointer;
          transition: all 0.2s;
        }
        .chat-action-btn.requests {
          background: var(--accent-coral);
          color: white;
        }
        .chat-action-btn.manage {
          background: var(--bg-input);
          color: var(--text-light);
        }
        .chat-action-btn:hover {
          transform: translateY(-1px);
        }
        .action-badge {
          position: absolute;
          top: -6px;
          right: -6px;
          min-width: 18px;
          height: 18px;
          background: var(--accent-green);
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
          color: white;
        }
        .chat-section {
          margin-top: 24px;
        }
        .section-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-muted);
          margin-bottom: 12px;
        }
        .chat-section .chat-item {
          margin-bottom: 8px;
        }
        .hidden-section {
          margin-top: 24px;
        }
        .hidden-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 12px 0;
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          cursor: pointer;
        }
        .hidden-toggle svg {
          transition: transform 0.2s;
        }
        .empty-state {
          text-align: center;
          padding: 60px 20px;
        }
        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        .empty-state-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-white);
          margin-bottom: 8px;
        }
        .empty-state-text {
          font-size: 14px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
};