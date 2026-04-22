import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { groups, directMessages, friends, subscription as subscriptionApi } from '../utils/api';
import { SocketContext } from '../context/SocketContext';
import { ProModal } from '../components/ProModal';
import { useToast } from '../context/ToastContext';
import '../styles/chat.css';
import '../styles/profile.css';

export const ChatList = () => {
  const [activeTab, setActiveTab]           = useState('gruppen');
  const [groupChats, setGroupChats]         = useState([]);
  const [privateChats, setPrivateChats]     = useState([]);
  const [friendsList, setFriendsList]       = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [showHidden, setShowHidden]         = useState(false);
  const [isPro, setIsPro]                   = useState(false);
  const [showProModal, setShowProModal]     = useState(false);
  const [requestsModal, setRequestsModal]   = useState(null); // { groupId, groupName }
  const [modalRequests, setModalRequests]   = useState([]);
  const [modalIndex, setModalIndex]         = useState(0);
  const [modalLoading, setModalLoading]     = useState(false);
  const [modalProcessing, setModalProcessing] = useState(false);
  const [modalOffsetX, setModalOffsetX]     = useState(0);
  const [modalSwipeDir, setModalSwipeDir]   = useState(null);
  const [modalStartX, setModalStartX]       = useState(0);
  const modalCardRef = useRef(null);
  const navigate = useNavigate();
  const { socket } = useContext(SocketContext);
  const toast = useToast();

  useEffect(() => {
    loadData();
    subscriptionApi.getStatus().then(r => setIsPro(r.data.is_pro)).catch(() => {});
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
        const prefix = g.last_message_sender ? `${g.last_message_sender}: ` : '';
        return {
          id: g.id,
          name: g.name || g.title,
          lastMessage: g.last_message ? `${prefix}${g.last_message}` : '',
          time: g.last_message_time ? formatTime(g.last_message_time) : '',
          unread: g.unread_count || 0,
          avatar: g.image_url,
          type: g.type,
          isOwner: g.role === 'owner'
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

      if (friendsRes?.data) setFriendsList(friendsRes.data);
      if (pendingRes?.data) setPendingRequests(pendingRes.data);
    } catch (err) {
      console.error('Error loading chat data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Gestern';
    if (diffDays < 7)  return date.toLocaleDateString('de-DE', { weekday: 'short' });
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  const handleNewGroupMessage = (data) => {
    setGroupChats(prev => prev.map(chat =>
      chat.id === (data.group_id || data.groupId)
        ? { ...chat, lastMessage: `${data.user_name ? `${data.user_name}: ` : ''}${data.content}`, time: formatTime(new Date().toISOString()), unread: (chat.unread || 0) + 1 }
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

  const handleChatClick = (chat) => {
    if (chat.isDM) {
      if (!isPro) { setShowProModal(true); return; }
      navigate(`/dm/${chat.id}`);
    } else {
      navigate(`/chat/${chat.id}`);
    }
  };

  const handleAcceptFriendRequest = async (requestId) => {
    try {
      await friends.respondRequest(requestId, 'accept');
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
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

  const openRequestsModal = async (groupId, groupName) => {
    setRequestsModal({ groupId, groupName });
    setModalIndex(0);
    setModalOffsetX(0);
    setModalSwipeDir(null);
    setModalLoading(true);
    try {
      const res = await groups.getRequests(groupId);
      setModalRequests(res.data || []);
    } catch (err) {
      toast.error('Anfragen konnten nicht geladen werden');
      setRequestsModal(null);
    } finally {
      setModalLoading(false);
    }
  };

  const modalHandleTouchStart = (e) => setModalStartX(e.touches[0].clientX);
  const modalHandleTouchMove = (e) => {
    const diff = e.touches[0].clientX - modalStartX;
    setModalOffsetX(diff);
    if (diff > 50) setModalSwipeDir('right');
    else if (diff < -50) setModalSwipeDir('left');
    else setModalSwipeDir(null);
  };
  const modalHandleTouchEnd = () => {
    if (modalOffsetX > 100) modalHandleAccept();
    else if (modalOffsetX < -100) modalHandleDecline();
    else { setModalOffsetX(0); setModalSwipeDir(null); }
  };
  const modalGoNext = () => {
    setModalOffsetX(0);
    setModalSwipeDir(null);
    setModalIndex(prev => prev + 1);
  };
  const modalHandleAccept = async () => {
    if (modalProcessing) return;
    const req = modalRequests[modalIndex];
    setModalProcessing(true);
    try {
      await groups.handleRequest(requestsModal.groupId, req.id, 'accept');
      toast.success(`${req.user_name} wurde angenommen!`);
      setModalSwipeDir('right'); setModalOffsetX(300);
      setTimeout(() => { modalGoNext(); setModalProcessing(false); }, 300);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Annehmen');
      setModalOffsetX(0); setModalSwipeDir(null); setModalProcessing(false);
    }
  };
  const modalHandleDecline = async () => {
    if (modalProcessing) return;
    const req = modalRequests[modalIndex];
    setModalProcessing(true);
    try {
      await groups.handleRequest(requestsModal.groupId, req.id, 'reject');
      toast.info(`${req.user_name} wurde abgelehnt`);
      setModalSwipeDir('left'); setModalOffsetX(-300);
      setTimeout(() => { modalGoNext(); setModalProcessing(false); }, 300);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fehler beim Ablehnen');
      setModalOffsetX(0); setModalSwipeDir(null); setModalProcessing(false);
    }
  };

  const onlyGroups     = groupChats.filter(c => c.type !== 'club');
  const onlyClubs      = groupChats.filter(c => c.type === 'club');
  const currentChats   = activeTab === 'gruppen' ? onlyGroups : activeTab === 'clubs' ? onlyClubs : privateChats;
  const totalUnread    = [...groupChats, ...privateChats].reduce((sum, c) => sum + (c.unread || 0), 0);
  const isGroupOrClub  = activeTab === 'gruppen' || activeTab === 'clubs';

  return (
    <div className="home-container chat-list-page">

      {/* ── Sticky header ───────────────────────────────────────────── */}
      <div className="home-sticky-header">
        {totalUnread > 0 && (
          <div className="chat-header">
            <span className="total-badge">{totalUnread}</span>
          </div>
        )}

        <div className="tabs-container chat-tabs-container">
          <button
            className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`}
            onClick={() => setActiveTab('gruppen')}
          >
            Gruppen
            {onlyGroups.length > 0 && <span className="tab-count">{onlyGroups.length}</span>}
          </button>
          <button
            className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
            onClick={() => setActiveTab('clubs')}
          >
            Clubs
            {onlyClubs.length > 0 && <span className="tab-count">{onlyClubs.length}</span>}
          </button>
          <button
            className={`tab ${activeTab === 'freunde' ? 'active' : ''}`}
            onClick={() => setActiveTab('freunde')}
          >
            Deine Chats
            {pendingRequests.length > 0 && (
              <span className="tab-count">{pendingRequests.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────── */}
      <div className="home-content">

        {/* ── Freunde tab ─────────────────────────────────────────── */}
        {activeTab === 'freunde' && (
          <div className="chat-friends-section">

            {!isPro && (
              <div className="pro-banner">
                <div className="pro-banner-icon">👑</div>
                <div className="pro-banner-title">Pro-Mitgliedschaft erforderlich</div>
                <p className="pro-banner-text">
                  Freunde hinzufügen und Direktnachrichten senden ist exklusiv für Pro-Mitglieder.
                </p>
                <button className="pro-banner-btn" onClick={() => setShowProModal(true)}>
                  👑 Pro aktivieren — 5 € / Monat
                </button>
              </div>
            )}

            {pendingRequests.length > 0 && (
              <div className="pending-requests-section">
                <div className="pending-requests-header">
                  <span className="pending-requests-title">Freundschaftsanfragen</span>
                  <span className="pending-count">{pendingRequests.length}</span>
                </div>
                {pendingRequests.map(req => (
                  <div key={req.id} className="friend-request-item">
                    {req.requester_avatar
                      ? <img src={req.requester_avatar} alt={req.requester_name} className="friend-avatar" />
                      : <div className="friend-avatar-placeholder">{(req.requester_name || '?')[0].toUpperCase()}</div>
                    }
                    <div className="friend-info" onClick={() => navigate(`/user/${req.requester_id}`)}>
                      <div className="friend-name">{req.requester_name}</div>
                      <div className="friend-location">{req.requester_location || 'Kein Standort'}</div>
                    </div>
                    <div className="friend-request-actions">
                      <button className="friend-request-btn accept" onClick={() => handleAcceptFriendRequest(req.id)}>✓</button>
                      <button className="friend-request-btn decline" onClick={() => handleRejectFriendRequest(req.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="friends-list">
              {loading ? (
                <div className="home-loading"><div className="home-spinner" /></div>
              ) : !isPro ? null : friendsList.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">👥</div>
                  <p>Noch keine Freunde</p>
                  <button className="empty-hint" onClick={() => navigate('/home')}>
                    Entdecke Gruppen und lerne Leute kennen!
                  </button>
                </div>
              ) : (
                friendsList.map(friend => (
                  <div key={friend.friend_id} className="friend-item">
                    {friend.avatar_url
                      ? <img src={friend.avatar_url} alt={friend.name} className="friend-avatar" />
                      : <div className="friend-avatar-placeholder">{(friend.name || '?')[0].toUpperCase()}</div>
                    }
                    <div className="friend-info" onClick={() => navigate(`/user/${friend.friend_id}`)}>
                      <div className="friend-name">{friend.name}</div>
                      <div className="friend-location">{friend.location || 'Kein Standort'}</div>
                    </div>
                    <div className="friend-actions">
                      <button
                        className="friend-action-btn"
                        onClick={() => isPro ? navigate(`/dm/${friend.friend_id}`) : setShowProModal(true)}
                        title={isPro ? 'Nachricht senden' : 'Pro erforderlich'}
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
        )}

        {/* ── Gruppen / Clubs tab ──────────────────────────────────── */}
        {isGroupOrClub && (
          <div className="chat-list">
            {loading ? (
              <div className="home-loading"><div className="home-spinner" /></div>
            ) : currentChats.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{activeTab === 'clubs' ? '🏆' : '💬'}</div>
                <p>Noch keine {activeTab === 'clubs' ? 'Club-Chats' : 'Gruppen-Chats'}</p>
                <button className="empty-hint" onClick={() => navigate('/home')}>
                  {activeTab === 'clubs' ? 'Entdecke Clubs!' : 'Tritt einer Gruppe bei!'}
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const owned = currentChats.filter(c => c.isOwner);
                  const others = currentChats.filter(c => !c.isOwner);
                  return (
                    <>
                      {owned.length > 0 && (
                        <>
                          <div className="chat-section-label">Von dir Erstellt</div>
                          {owned.map(chat => (
                            <div key={chat.id} className="chat-item chat-item--owner">
                              <div className="chat-item-main" onClick={() => handleChatClick(chat)}>
                                <div className="chat-avatar-wrapper">
                                  {chat.avatar
                                    ? <img src={chat.avatar} alt={chat.name} className="chat-avatar" />
                                    : <div className="chat-avatar-placeholder">{(chat.name || '?')[0].toUpperCase()}</div>
                                  }
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
                                    {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="chat-owner-actions">
                                <button
                                  className="chat-owner-btn chat-owner-btn--requests"
                                  onClick={(e) => { e.stopPropagation(); openRequestsModal(chat.id, chat.name); }}
                                >
                                  Anfragen
                                </button>
                                <button
                                  className="chat-owner-btn chat-owner-btn--manage"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/group/${chat.id}/edit`); }}
                                >
                                  Verwalten
                                </button>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                      {others.length > 0 && (
                        <>
                          {owned.length > 0 && <div className="chat-section-label">Andere</div>}
                          {others.map(chat => (
                            <div key={chat.id} className="chat-item" onClick={() => handleChatClick(chat)}>
                              <div className="chat-avatar-wrapper">
                                {chat.avatar
                                  ? <img src={chat.avatar} alt={chat.name} className="chat-avatar" />
                                  : <div className="chat-avatar-placeholder">{(chat.name || '?')[0].toUpperCase()}</div>
                                }
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
                                  {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  );
                })()}

                <button className="hidden-chats-toggle" onClick={() => setShowHidden(!showHidden)}>
                  <span>Ausgeblendet</span>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                    className={showHidden ? 'chevron-up' : ''}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                {showHidden && (
                  <div className="hidden-chats-content">
                    <p className="hidden-empty-text">Keine ausgeblendeten Chats</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>

      {showProModal && (
        <ProModal onClose={() => setShowProModal(false)} onSuccess={() => setIsPro(true)} />
      )}

      {/* ── Anfragen Modal ──────────────────────────────────────────── */}
      {requestsModal && (
        <div className="requests-modal-overlay" onClick={() => setRequestsModal(null)}>
          <div className="requests-modal" onClick={e => e.stopPropagation()}>
            <div className="requests-modal-header">
              <span className="requests-modal-title">
                {modalLoading ? 'Lade…' : modalIndex < modalRequests.length
                  ? `${modalRequests.length - modalIndex} Anfragen`
                  : 'Keine Anfragen'}
              </span>
              <button className="requests-modal-close" onClick={() => setRequestsModal(null)}>✕</button>
            </div>

            <div className="requests-modal-body">
              {modalLoading ? (
                <div className="home-loading"><div className="home-spinner" /></div>
              ) : modalIndex >= modalRequests.length ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-icon">✅</div>
                  <p>Alle Anfragen bearbeitet!</p>
                </div>
              ) : (() => {
                const req = modalRequests[modalIndex];
                const age = req.user_dob
                  ? Math.floor((Date.now() - new Date(req.user_dob)) / 31557600000)
                  : null;
                let interests = [];
                try {
                  interests = req.user_interests
                    ? (typeof req.user_interests === 'string' ? JSON.parse(req.user_interests) : req.user_interests)
                    : [];
                } catch {}
                const nextReq = modalRequests[modalIndex + 1];
                return (
                  <>
                    <div
                      className="request-card-wrapper"
                      ref={modalCardRef}
                      onTouchStart={modalHandleTouchStart}
                      onTouchMove={modalHandleTouchMove}
                      onTouchEnd={modalHandleTouchEnd}
                      style={{
                        transform: `translateX(${modalOffsetX}px) rotate(${modalOffsetX * 0.05}deg)`,
                        transition: Math.abs(modalOffsetX) > 100 ? 'transform 0.3s ease' : 'none'
                      }}
                    >
                      <div className={`swipe-indicator swipe-accept ${modalSwipeDir === 'right' ? 'visible' : ''}`}>
                        <span>✓</span><span>Annehmen</span>
                      </div>
                      <div className={`swipe-indicator swipe-decline ${modalSwipeDir === 'left' ? 'visible' : ''}`}>
                        <span>✕</span><span>Ablehnen</span>
                      </div>
                      <div className="request-card">
                        <div className="request-image-container request-image-tall">
                          {req.user_avatar
                            ? <img src={req.user_avatar} alt={req.user_name} className="request-user-image" />
                            : <div className="request-avatar-placeholder">{(req.user_name || '?')[0].toUpperCase()}</div>
                          }
                          {req.user_trusted && (
                            <div className="request-trusted-badge">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <polyline points="20,6 9,17 4,12" stroke="white" strokeWidth="3" fill="none"/>
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="request-user-info">
                          <h2 className="request-name">
                            {req.user_name}{age ? `, ${age}` : ''}
                          </h2>
                          {req.message && (
                            <p className="request-bio">{req.message}</p>
                          )}
                          {interests.length > 0 && (
                            <div className="request-interests">
                              {interests.slice(0, 5).map((tag, i) => (
                                <span key={i} className="request-interest-tag">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {nextReq && (
                        <div className="next-card-preview">
                          {nextReq.user_avatar
                            ? <img src={nextReq.user_avatar} alt="" />
                            : <div style={{ width: '100%', height: '100%', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--accent-coral)' }}>
                                {(nextReq.user_name || '?')[0].toUpperCase()}
                              </div>
                          }
                        </div>
                      )}
                    </div>

                    <div className="requests-actions" style={{ padding: '20px 0 0' }}>
                      <button className="action-btn decline" onClick={modalHandleDecline} disabled={modalProcessing}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                      <button className="action-btn accept" onClick={modalHandleAccept} disabled={modalProcessing}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20,6 9,17 4,12"/>
                        </svg>
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatList;
