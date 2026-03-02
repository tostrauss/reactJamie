import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, directMessages, friends } from '../utils/api';
import { SocketContext } from '../context/SocketContext';
import '../styles/chat.css';
import '../styles/profile.css';

export const ChatList = () => {
  const [activeTab, setActiveTab] = useState('gruppen');
  const [showRequests, setShowRequests] = useState(false);
  const [groupChats, setGroupChats] = useState([]);
  const [privateChats, setPrivateChats] = useState([]);
  const [requests, setRequests] = useState([]);
  const [friendsList, setFriendsList] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const navigate = useNavigate();
  const { socket } = useContext(SocketContext);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('receive_message', handleNewGroupMessage);
    socket.on('new_dm_notification', handleNewDM);

    return () => {
      socket.off('receive_message', handleNewGroupMessage);
      socket.off('new_dm_notification', handleNewDM);
    };
  }, [socket]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [joinedRes, dmsRes, friendsRes, pendingRes] = await Promise.all([
        groups.getJoined().catch(() => null),
        directMessages.getConversations().catch(() => null),
        friends.getAll().catch(() => null),
        friends.getPending().catch(() => null)
      ]);

      setGroupChats((joinedRes?.data || []).map(g => {
        const senderPrefix = g.last_message_sender ? `${g.last_message_sender}: ` : '';
        return {
          id: g.id,
          name: g.name || g.title,
          lastMessage: g.last_message ? `${senderPrefix}${g.last_message}` : '',
          time: g.last_message_time ? formatTime(g.last_message_time) : '',
          unread: g.unread_count || 0,
          avatar: g.image_url,
          type: g.type
        };
      }));

      setPrivateChats((dmsRes?.data || []).map(dm => ({
        id: dm.other_user_id,
        name: dm.other_user_name,
        lastMessage: dm.last_message_text || '',
        time: dm.updated_at ? formatTime(dm.updated_at) : '',
        unread: dm.unread_count || 0,
        avatar: dm.other_user_avatar,
        isOnline: false,
        isDM: true
      })));

      if (friendsRes?.data) {
        setFriendsList(friendsRes.data);
      }

      if (pendingRes?.data) {
        setPendingRequests(pendingRes.data);
      }
    } catch (error) {
      console.error('Error loading chat data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Gestern';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('de-DE', { weekday: 'short' });
    }
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  const handleNewGroupMessage = (data) => {
    const senderPrefix = data.user_name ? `${data.user_name}: ` : '';
    setGroupChats(prev => prev.map(chat =>
      chat.id === (data.group_id || data.groupId)
        ? { ...chat, lastMessage: `${senderPrefix}${data.content}`, time: formatTime(new Date().toISOString()), unread: (chat.unread || 0) + 1 }
        : chat
    ));
  };

  const handleNewDM = (data) => {
    setPrivateChats(prev => prev.map(chat =>
      chat.id === data.senderId
        ? { ...chat, lastMessage: data.message?.content, time: formatTime(new Date().toISOString()), unread: (chat.unread || 0) + 1 }
        : chat
    ));
  };

  const totalUnread = [...groupChats, ...privateChats].reduce((sum, chat) => sum + (chat.unread || 0), 0);
  const totalRequests = requests.length;

  const handleChatClick = (chat) => {
    if (chat.isDM) {
      navigate(`/dm/${chat.id}`);
    } else {
      navigate(`/chat/${chat.id}`);
    }
  };

  const handleAcceptRequest = (requestId) => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
  };

  const handleDeclineRequest = (requestId) => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
  };

  const handleAcceptFriendRequest = async (requestId) => {
    try {
      await friends.respondRequest(requestId, 'accept');
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      // Reload friends list
      const res = await friends.getAll().catch(() => null);
      if (res?.data) setFriendsList(res.data);
    } catch (err) {
      console.error('Error accepting friend request:', err);
    }
  };

  const handleRejectFriendRequest = async (requestId) => {
    try {
      await friends.respondRequest(requestId, 'reject');
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      console.error('Error rejecting friend request:', err);
    }
  };

  const onlyGroups = groupChats.filter(c => c.type !== 'club');
  const onlyClubs = groupChats.filter(c => c.type === 'club');
  const currentChats = activeTab === 'gruppen' ? onlyGroups : activeTab === 'clubs' ? onlyClubs : privateChats;

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
          {onlyGroups.length > 0 && (
            <span className="tab-count">{onlyGroups.length}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
          onClick={() => { setActiveTab('clubs'); setShowRequests(false); }}
        >
          Clubs
          {onlyClubs.length > 0 && (
            <span className="tab-count">{onlyClubs.length}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === 'freunde' ? 'active' : ''}`}
          onClick={() => { setActiveTab('freunde'); setShowRequests(false); }}
        >
          Freunde
          {pendingRequests.length > 0 && (
            <span className="total-badge" style={{ marginLeft: '6px', fontSize: '10px', padding: '2px 6px' }}>
              {pendingRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* Action Tabs (Anfragen/Verwalten) - for Gruppen and Clubs */}
      {(activeTab === 'gruppen' || activeTab === 'clubs') && (
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

      {/* Friends Tab Content */}
      {activeTab === 'freunde' ? (
        <div>
          {/* Pending Friend Requests */}
          {pendingRequests.length > 0 && (
            <div className="pending-requests-section">
              <div className="pending-requests-header">
                <span className="pending-requests-title">Freundschaftsanfragen</span>
                <span className="pending-count">{pendingRequests.length}</span>
              </div>
              {pendingRequests.map(req => (
                <div key={req.id} className="friend-request-item">
                  {req.requester_avatar ? (
                    <img src={req.requester_avatar} alt={req.requester_name} className="friend-avatar" />
                  ) : (
                    <div className="friend-avatar-placeholder">
                      {(req.requester_name || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="friend-info" onClick={() => navigate(`/user/${req.requester_id}`)}>
                    <div className="friend-name">{req.requester_name}</div>
                    <div className="friend-location">{req.requester_location || 'Kein Standort'}</div>
                  </div>
                  <div className="friend-request-actions">
                    <button
                      className="friend-request-btn accept"
                      onClick={() => handleAcceptFriendRequest(req.id)}
                    >
                      ✓
                    </button>
                    <button
                      className="friend-request-btn decline"
                      onClick={() => handleRejectFriendRequest(req.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Friends List */}
          <div className="friends-list">
            {loading ? (
              <div className="loading">Laden...</div>
            ) : friendsList.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">👥</div>
                <p>Noch keine Freunde</p>
                <span className="empty-hint" onClick={() => navigate('/home')}>
                  Entdecke Gruppen und lerne Leute kennen!
                </span>
              </div>
            ) : (
              friendsList.map(friend => (
                <div key={friend.friend_id} className="friend-item">
                  {friend.avatar_url ? (
                    <img src={friend.avatar_url} alt={friend.name} className="friend-avatar" />
                  ) : (
                    <div className="friend-avatar-placeholder">
                      {(friend.name || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="friend-info" onClick={() => navigate(`/user/${friend.friend_id}`)}>
                    <div className="friend-name">{friend.name}</div>
                    <div className="friend-location">
                      {friend.location || 'Kein Standort'}
                    </div>
                  </div>
                  <div className="friend-actions">
                    <button
                      className="friend-action-btn"
                      onClick={() => navigate(`/dm/${friend.friend_id}`)}
                      title="Nachricht senden"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                      </svg>
                    </button>
                    <button
                      className="friend-action-btn"
                      onClick={() => navigate(`/user/${friend.friend_id}`)}
                      title="Profil anzeigen"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Chat List / Requests */
        <div className="chat-list">
          {loading ? (
            <div className="loading">Laden...</div>
          ) : showRequests ? (
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
                    <p className="request-group">{request.groupName}</p>
                    <p className="request-message">{request.message}</p>
                  </div>
                  <div className="request-actions">
                    <button className="request-btn accept" onClick={() => handleAcceptRequest(request.id)}>✓</button>
                    <button className="request-btn decline" onClick={() => handleDeclineRequest(request.id)}>✕</button>
                  </div>
                </div>
              ))
            )
          ) : (
            currentChats.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{activeTab === 'clubs' ? '🏆' : '💬'}</div>
                <p>Noch keine {activeTab === 'clubs' ? 'Club-Chats' : 'Gruppen-Chats'}</p>
                <span className="empty-hint" onClick={() => navigate('/home')}>
                  {activeTab === 'clubs' ? 'Entdecke Clubs!' : 'Tritt einer Gruppe bei!'}
                </span>
              </div>
            ) : (
              <>
                {currentChats.map(chat => (
                  <div
                    key={chat.id}
                    className="chat-item"
                    onClick={() => handleChatClick(chat)}
                  >
                    <div className="chat-avatar-wrapper">
                      {chat.avatar ? (
                        <img src={chat.avatar} alt={chat.name} className="chat-avatar" />
                      ) : (
                        <div className="chat-avatar-placeholder">
                          {(chat.name || '?')[0].toUpperCase()}
                        </div>
                      )}
                      {chat.isOnline && <span className="online-indicator" />}
                    </div>
                    <div className="chat-info">
                      <div className="chat-top-row">
                        <span className="chat-name">{chat.name}</span>
                        <span className="chat-time">{chat.time}</span>
                      </div>
                      {chat.type === 'club' && (
                        <span className="chat-type-badge club-badge">Club</span>
                      )}
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
                ))}

                {/* Ausgeblendet Toggle */}
                <div
                  className="hidden-chats-toggle"
                  onClick={() => setShowHidden(!showHidden)}
                >
                  <span>Ausgeblendet</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ transform: showHidden ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
                {showHidden && (
                  <div className="hidden-chats-content">
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px', fontSize: '14px' }}>
                      Keine ausgeblendeten Chats
                    </p>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default ChatList;
