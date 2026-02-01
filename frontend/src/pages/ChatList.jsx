import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/home.css';

// Demo Chat-Daten
const DEMO_GROUP_CHATS = [
  {
    id: 1,
    name: "Volleyball im Prater",
    lastMessage: "Eva: Hey, wo treffen wir uns?",
    time: "14:32",
    unread: 3,
    avatar: "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=100",
    hasRequests: true,
    requestCount: 2
  },
  {
    id: 2,
    name: "Bar-Hopping Wien",
    lastMessage: "Ben: Hey guys!!",
    time: "12:15",
    unread: 1,
    avatar: "https://images.unsplash.com/photo-1575444758702-4a6b9222336e?w=100"
  },
  {
    id: 3,
    name: "Spiele Abend im Bukowski",
    lastMessage: "Great idea!",
    time: "Gestern",
    unread: 0,
    avatar: "https://images.unsplash.com/photo-1611371805429-8b5c1b2c34ba?w=100"
  }
];

const DEMO_PRIVATE_CHATS = [
  {
    id: 101,
    name: "Max",
    lastMessage: "Bis morgen dann! 👋",
    time: "15:20",
    unread: 0,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100",
    isOnline: true
  },
  {
    id: 102,
    name: "Lisa",
    lastMessage: "Das klingt super!",
    time: "11:45",
    unread: 2,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100",
    isOnline: false
  }
];

const DEMO_REQUESTS = [
  {
    id: 201,
    name: "Sarah",
    message: "Möchte der Wandergruppe beitreten",
    time: "vor 2 Std",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100",
    groupName: "Wandern am Kahlenberg"
  },
  {
    id: 202,
    name: "Tom",
    message: "Kann ich mitmachen?",
    time: "vor 5 Std",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100",
    groupName: "Volleyball im Prater"
  }
];

export const ChatList = () => {
  const [activeTab, setActiveTab] = useState('gruppen');
  const [showRequests, setShowRequests] = useState(false);
  const [groupChats, setGroupChats] = useState(DEMO_GROUP_CHATS);
  const [privateChats, setPrivateChats] = useState(DEMO_PRIVATE_CHATS);
  const [requests, setRequests] = useState(DEMO_REQUESTS);
  const navigate = useNavigate();

  const totalUnread = [...groupChats, ...privateChats].reduce((sum, chat) => sum + (chat.unread || 0), 0);
  const totalRequests = requests.length;

  const handleChatClick = (chatId) => {
    navigate(`/chat/${chatId}`);
  };

  const handleAcceptRequest = (requestId) => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
    // TODO: API call
  };

  const handleDeclineRequest = (requestId) => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
    // TODO: API call
  };

  const currentChats = activeTab === 'gruppen' ? groupChats : privateChats;

  return (
    <div className="home-container chat-list-page">
      {/* Header */}
      <header className="chat-header">
        <h1 className="page-title">Chats</h1>
        {totalUnread > 0 && (
          <span className="total-badge">{totalUnread}</span>
        )}
      </header>

      {/* Tabs */}
      <div className="tabs-container">
        <button 
          className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`} 
          onClick={() => { setActiveTab('gruppen'); setShowRequests(false); }}
        >
          Gruppen
        </button>
        <button 
          className={`tab ${activeTab === 'privat' ? 'active' : ''}`} 
          onClick={() => { setActiveTab('privat'); setShowRequests(false); }}
        >
          Deine Chats
        </button>
      </div>
      {activeTab === 'gruppen' && (
        <div className="chat-actions">
          <button 
            className={`action-tab ${!showRequests ? 'active' : ''}`}
            onClick={() => setShowRequests(false)}
          >
            Chats
          </button>
          <button 
            className={`action-tab ${showRequests ? 'active' : ''}`}
            onClick={() => setShowRequests(true)}
          >
            Anfragen
            {totalRequests > 0 && (
              <span className="request-badge">{totalRequests}</span>
            )}
          </button>
        </div>
      )}

      {/* Chat List oder Anfragen */}
      <div className="chat-list">
        {showRequests ? (
          /* Anfragen Liste */
          requests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📬</div>
              <p>Keine offenen Anfragen</p>
            </div>
          ) : (
            requests.map(request => (
              <div key={request.id} className="request-item">
                <img src={request.avatar} alt={request.name} className="chat-avatar" />
                <div className="request-info">
                  <div className="request-header">
                    <span className="request-name">{request.name}</span>
                    <span className="request-time">{request.time}</span>
                  </div>
                  <p className="request-group">→ {request.groupName}</p>
                  <p className="request-message">{request.message}</p>
                </div>
                <div className="request-actions">
                  <button 
                    className="request-btn accept"
                    onClick={() => handleAcceptRequest(request.id)}
                  >
                    ✓
                  </button>
                  <button 
                    className="request-btn decline"
                    onClick={() => handleDeclineRequest(request.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )
        ) : (
          /* Chat Liste */
          currentChats.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <p>Noch keine Chats</p>
              <span className="empty-hint" onClick={() => navigate('/home')}>
                Tritt einer Gruppe bei!
              </span>
            </div>
          ) : (
            currentChats.map(chat => (
              <div 
                key={chat.id} 
                className="chat-item"
                onClick={() => handleChatClick(chat.id)}
              >
                <div className="chat-avatar-wrapper">
                  <img src={chat.avatar} alt={chat.name} className="chat-avatar" />
                  {chat.isOnline && <span className="online-indicator" />}
                </div>
                <div className="chat-info">
                  <div className="chat-top-row">
                    <span className="chat-name">{chat.name}</span>
                    <span className="chat-time">{chat.time}</span>
                  </div>
                  <div className="chat-bottom-row">
                    <p className="chat-last-message">{chat.lastMessage}</p>
                    {chat.unread > 0 && (
                      <span className="unread-badge">{chat.unread}</span>
                    )}
                  </div>
                  {chat.hasRequests && chat.requestCount > 0 && (
                    <div className="chat-requests-hint">
                      <span className="request-indicator">{chat.requestCount} Anfragen</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )
        )}
        {!showRequests && currentChats.length > 0 && (
          <div className="hidden-chats-toggle">
            <span>Ausgeblendet</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatList;