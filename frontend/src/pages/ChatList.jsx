import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, directMessages, friends } from '../utils/api';
import { SocketContext } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import '../styles/chat.css';
import '../styles/profile.css';

export const ChatList = () => {
  // Tab held in the URL (?tab=clubs|freunde) so swiping back from a chat
  // or DM restores the tab the user was on. replace:true keeps the back stack
  // clean — switching tabs doesn't pile up history entries.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'gruppen';
  const setActiveTab = (tab) => setSearchParams(prev => {
    const sp = new URLSearchParams(prev);
    if (tab === 'gruppen') sp.delete('tab');
    else sp.set('tab', tab);
    return sp;
  }, { replace: true });
  const [groupChats, setGroupChats]         = useState([]);
  const [privateChats, setPrivateChats]     = useState([]);
  const [friendsList, setFriendsList]       = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [showHidden, setShowHidden]         = useState(false);
  const [menuChat, setMenuChat]             = useState(null); // long-pressed chat: { chat, kind }
  const longPress                           = useRef({ timer: null, fired: false, x: 0, y: 0 });
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
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!socket) return;
    // receive_message is room-scoped (only fires with the chat OPEN, i.e.
    // never on this page) — group_message_notification is the per-user nudge
    // the backend sends to every member and is what actually updates rows here.
    socket.on('receive_message', handleNewGroupMessage);
    socket.on('group_message_notification', handleGroupNotification);
    socket.on('new_dm_notification', handleNewDM);
    return () => {
      socket.off('receive_message', handleNewGroupMessage);
      socket.off('group_message_notification', handleGroupNotification);
      socket.off('new_dm_notification', handleNewDM);
    };
  }, [socket]);

  const loadData = async () => {
    setLoading(true);
    try {
      // friends.getAll()/getPending() were fetched here but never rendered —
      // the friends UI lives in the profile area now, and the group-request
      // swipe modal loads its own data via groups.getRequests. Dropped to save
      // two requests on every chat-list open.
      const [joinedRes, dmsRes] = await Promise.all([
        groups.getJoined().catch(() => null),
        directMessages.getConversations().catch(() => null),
      ]);

      // Events (type='event') live under a parent club and shouldn't surface
      // as a top-level chat row — that would duplicate the club entry and
      // confuse users who joined an event but didn't think they'd see a chat.
      setGroupChats((joinedRes?.data || [])
        .filter(g => g.type !== 'event')
        .map(g => {
          const prefix = g.last_message_sender ? `${g.last_message_sender}: ` : '';
          return {
            id: g.id,
            name: g.name || g.title,
            lastMessage: g.last_message ? `${prefix}${g.last_message}` : '',
            time: g.last_message_time ? formatTime(g.last_message_time) : '',
            unread: g.unread_count || 0,
            avatar: g.image_url,
            type: g.type,
            isOwner: g.role === 'owner',
            archived: !!g.archived,
          };
        }));

      setPrivateChats((dmsRes?.data || []).map(dm => ({
        id: dm.other_user_id,
        name: dm.other_user_name,
        lastMessage: dm.last_message_text || '',
        // last_message_at = the last message's timestamp (sent/received), not
        // dc.updated_at which the read-trigger bumps when you merely open a chat.
        time: dm.last_message_at ? formatTime(dm.last_message_at) : '',
        unread: dm.unread_count || 0,
        avatar: dm.other_user_avatar,
        isOnline: false,
        isDM: true,
        archived: !!dm.is_archived,
      })));
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return t('chat.list.dateYesterday');
    if (diffDays < 7)  return date.toLocaleDateString(dateLocale, { weekday: 'short' });
    return date.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' });
  };

  // Patch a chat row AND move it to the top — the lists are ordered by
  // last-message time (backend: updated_at / lm.created_at DESC), so a chat
  // that just received a message belongs at position 0. Updating in place
  // left the order stale while the list was open (tester feedback).
  const bumpToTop = (list, id, patch) => {
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return list;
    return [
      { ...list[idx], ...patch },
      ...list.slice(0, idx),
      ...list.slice(idx + 1),
    ];
  };

  const handleNewGroupMessage = (data) => {
    setGroupChats(prev => {
      const id = data.group_id || data.groupId;
      const row = prev.find(c => c.id === id);
      if (!row) return prev;
      return bumpToTop(prev, id, {
        lastMessage: `${data.user_name ? `${data.user_name}: ` : ''}${data.content}`,
        time: formatTime(new Date().toISOString()),
        unread: (row.unread || 0) + 1,
      });
    });
  };

  // Per-user nudge from the backend (reaches us without being in the room).
  const handleGroupNotification = (data) => {
    setGroupChats(prev => {
      const row = prev.find(c => c.id === data.group_id);
      if (!row) return prev;
      return bumpToTop(prev, data.group_id, {
        lastMessage: `${data.user_name ? `${data.user_name}: ` : ''}${data.content || ''}`,
        time: formatTime(new Date().toISOString()),
        unread: (row.unread || 0) + 1,
      });
    });
  };

  const handleNewDM = (data) => {
    // new_dm_notification sends `message` as a plain string (socket.js); the
    // old `data.message?.content` was always undefined → blank preview row.
    const preview = typeof data.message === 'string'
      ? data.message
      : (data.message?.content || '');
    setPrivateChats(prev => {
      const row = prev.find(c => c.id === data.senderId);
      // First-ever DM from a new friend has no row yet — refetch so it appears
      // instead of being silently dropped until a manual reload.
      if (!row) { loadData(); return prev; }
      return bumpToTop(prev, data.senderId, {
        lastMessage: preview,
        time: formatTime(new Date().toISOString()),
        unread: (row.unread || 0) + 1,
      });
    });
  };

  const handleChatClick = (chat) => {
    if (chat.isDM) {
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
    }
  };

  const handleRejectFriendRequest = async (requestId) => {
    try {
      await friends.respondRequest(requestId, 'reject');
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
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
      toast.error(t('chat.list.toast.requestsLoadError'));
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
      toast.success(t('chat.list.toast.requestAccepted', { name: req.user_name }));
      setModalSwipeDir('right'); setModalOffsetX(300);
      setTimeout(() => { modalGoNext(); setModalProcessing(false); }, 300);
    } catch (err) {
      toast.error(err.response?.data?.error || t('chat.list.toast.requestAcceptError'));
      setModalOffsetX(0); setModalSwipeDir(null); setModalProcessing(false);
    }
  };
  const modalHandleDecline = async () => {
    if (modalProcessing) return;
    const req = modalRequests[modalIndex];
    setModalProcessing(true);
    try {
      await groups.handleRequest(requestsModal.groupId, req.id, 'reject');
      toast.info(t('chat.list.toast.requestDeclined', { name: req.user_name }));
      setModalSwipeDir('left'); setModalOffsetX(-300);
      setTimeout(() => { modalGoNext(); setModalProcessing(false); }, 300);
    } catch (err) {
      toast.error(err.response?.data?.error || t('chat.list.toast.requestDeclineError'));
      setModalOffsetX(0); setModalSwipeDir(null); setModalProcessing(false);
    }
  };

  // ── Long-press to hide ────────────────────────────────────────────────
  // Press-and-hold any chat row (~450ms) opens the hide menu. A move >10px or
  // an early release cancels it, so scrolling and normal taps are unaffected.
  const startPress = (chat, kind, e) => {
    longPress.current.fired = false;
    const pt = e.touches?.[0] || e;
    longPress.current.x = pt?.clientX ?? 0;
    longPress.current.y = pt?.clientY ?? 0;
    clearTimeout(longPress.current.timer);
    longPress.current.timer = setTimeout(() => {
      longPress.current.fired = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
      setMenuChat({ chat, kind });
    }, 450);
  };
  const movePress = (e) => {
    const pt = e.touches?.[0] || e;
    if (Math.abs((pt?.clientX ?? 0) - longPress.current.x) > 10 ||
        Math.abs((pt?.clientY ?? 0) - longPress.current.y) > 10) {
      clearTimeout(longPress.current.timer);
    }
  };
  const endPress = () => clearTimeout(longPress.current.timer);
  // Swallow the click that follows a long-press so the row doesn't also open.
  const guardedOpen = (chat) => () => {
    if (longPress.current.fired) { longPress.current.fired = false; return; }
    openChat(chat);
  };
  const pressProps = (chat, kind) => ({
    onPointerDown: (e) => startPress(chat, kind, e),
    onPointerMove: movePress,
    onPointerUp: endPress,
    onPointerLeave: endPress,
  });

  const openChat = (chat) => chat.isDM ? navigate(`/dm/${chat.id}`) : handleChatClick(chat);

  const setChatArchivedLocal = (chat, archived) => {
    if (chat.isDM) setPrivateChats(prev => prev.map(c => c.id === chat.id ? { ...c, archived } : c));
    else setGroupChats(prev => prev.map(c => c.id === chat.id ? { ...c, archived } : c));
  };

  const archiveChat = async (chat, archived) => {
    setMenuChat(null);
    setChatArchivedLocal(chat, archived); // optimistic
    try {
      if (chat.isDM) await directMessages.archiveConversation(chat.id, archived);
      else await groups.archiveChat(chat.id, archived);
    } catch {
      setChatArchivedLocal(chat, !archived); // revert
      toast.error(t('chat.list.toast.archiveError'));
    }
  };

  const onlyGroups     = groupChats.filter(c => c.type !== 'club');
  const onlyClubs      = groupChats.filter(c => c.type === 'club');
  const currentChats   = activeTab === 'gruppen' ? onlyGroups : activeTab === 'clubs' ? onlyClubs : privateChats;
  const visibleChats   = currentChats.filter(c => !c.archived);
  const hiddenChats    = currentChats.filter(c => c.archived);

  // Collapsible "Ausgeblendet" section — shared by all tabs, shows the current
  // tab's hidden chats with an inline unhide button.
  const renderHiddenSection = () => hiddenChats.length > 0 && (
    <div className="hidden-chats">
      <button className="hidden-chats-toggle" onClick={() => setShowHidden(s => !s)}>
        <span>{t('chat.list.sections.hidden')} ({hiddenChats.length})</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             className={showHidden ? 'chevron-up' : ''}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {showHidden && (
        <div className="hidden-chats-content">
          {hiddenChats.map(chat => (
            <div key={chat.id} className="chat-item chat-item--hidden">
              <div className="chat-item-main" onClick={() => openChat(chat)}>
                <div className="chat-avatar-wrapper">
                  {chat.avatar
                    ? <img src={chat.avatar} alt={chat.name} className="chat-avatar" loading="lazy" />
                    : <div className="chat-avatar-placeholder">{(chat.name || '?')[0].toUpperCase()}</div>}
                </div>
                <div className="chat-info">
                  <div className="chat-top-row"><span className="chat-name">{chat.name}</span></div>
                  <div className="chat-bottom-row"><p className="chat-last-message">{chat.lastMessage}</p></div>
                </div>
              </div>
              <button className="chat-unhide-btn" onClick={() => archiveChat(chat, false)}>
                {t('chat.list.unhide')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  // Tab pills show UNREAD sums, not chat counts: a number next to a tab
  // universally reads as "new messages" — testers kept asking why "Gruppen 10"
  // never went away (it was the number of group chats). Pills vanish at 0.
  const sumUnread      = (list) => list.reduce((sum, c) => sum + (c.unread || 0), 0);
  const groupsUnread   = sumUnread(onlyGroups);
  const clubsUnread    = sumUnread(onlyClubs);
  const dmsUnread      = sumUnread(privateChats);
  const isGroupOrClub  = activeTab === 'gruppen' || activeTab === 'clubs';

  return (
    <div className="home-container chat-list-page">

      {/* ── Sticky header ───────────────────────────────────────────── */}
      <div className="home-sticky-header">
        {/* The total-unread badge that used to float here was redundant with
            the per-tab counts below + the bottom-nav chat badge — removed. */}
        <div className="tabs-container chat-tabs-container">
          <button
            className={`tab ${activeTab === 'gruppen' ? 'active' : ''}`}
            onClick={() => setActiveTab('gruppen')}
          >
            {t('chat.list.tabs.groups')}
            {groupsUnread > 0 && <span className="tab-count">{groupsUnread}</span>}
          </button>
          <button
            className={`tab ${activeTab === 'clubs' ? 'active' : ''}`}
            onClick={() => setActiveTab('clubs')}
          >
            {t('chat.list.tabs.clubs')}
            {clubsUnread > 0 && <span className="tab-count">{clubsUnread}</span>}
          </button>
          <button
            className={`tab ${activeTab === 'freunde' ? 'active' : ''}`}
            onClick={() => setActiveTab('freunde')}
          >
            {t('chat.list.tabs.chats')}
            {dmsUnread > 0 && (
              <span className="tab-count">{dmsUnread}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────── */}
      <div className="home-content">

        {/* ── Chats (DM) tab ──────────────────────────────────────── */}
        {/* Friend list + pending requests live under Profil → Freunde now —
            this tab only shows real DM conversations to keep it focused. */}
        {activeTab === 'freunde' && (
          <div className="chat-friends-section">

            {/* Private DM conversations */}
            {loading ? (
              <div className="home-loading"><div className="home-spinner" /></div>
            ) : currentChats.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💬</div>
                <p>{t('chat.list.empty.noChats')}</p>
                <button className="empty-hint" onClick={() => navigate('/friends')}>
                  {t('chat.list.empty.toFriends')}
                </button>
              </div>
            ) : (
              <>
                <div className="chat-list">
                  {visibleChats.map(chat => (
                    <div key={chat.id} className="chat-item" {...pressProps(chat, 'dm')} onClick={guardedOpen(chat)}>
                      <div className="chat-avatar-wrapper">
                        {chat.avatar
                          ? <img src={chat.avatar} alt={chat.name} className="chat-avatar" loading="lazy" />
                          : <div className="chat-avatar-placeholder">{(chat.name || '?')[0].toUpperCase()}</div>
                        }
                      </div>
                      <div className="chat-info">
                        <div className="chat-top-row">
                          <span className="chat-name">{chat.name}</span>
                          <span className="chat-time">{chat.time}</span>
                        </div>
                        <div className="chat-bottom-row">
                          <p className="chat-last-message">{chat.lastMessage}</p>
                          {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {renderHiddenSection()}
              </>
            )}
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
                <p>{activeTab === 'clubs' ? t('chat.list.empty.noClubChats') : t('chat.list.empty.noGroupChats')}</p>
                <button className="empty-hint" onClick={() => navigate('/home')}>
                  {activeTab === 'clubs' ? t('chat.list.empty.discoverClubsHint') : t('chat.list.empty.joinGroupHint')}
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const owned = visibleChats.filter(c => c.isOwner);
                  const others = visibleChats.filter(c => !c.isOwner);
                  return (
                    <>
                      {owned.length > 0 && (
                        <>
                          <div className="chat-section-label">{t('chat.list.sections.createdByYou')}</div>
                          {owned.map(chat => (
                            <div key={chat.id} className="chat-item chat-item--owner">
                              <div className="chat-item-main" {...pressProps(chat, 'group')} onClick={guardedOpen(chat)}>
                                <div className="chat-avatar-wrapper">
                                  {chat.avatar
                                    ? <img src={chat.avatar} alt={chat.name} className="chat-avatar" loading="lazy" />
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
                                  {t('chat.list.ownerActions.requests')}
                                </button>
                                <button
                                  className="chat-owner-btn chat-owner-btn--manage"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Clubs and groups/events are all edited via GroupEdit;
                                    // keep the type-specific URL so deep links + analytics stay correct.
                                    navigate(chat.type === 'club' ? `/club/${chat.id}/edit` : `/group/${chat.id}/edit`);
                                  }}
                                >
                                  {t('chat.list.ownerActions.manage')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                      {others.length > 0 && (
                        <>
                          {owned.length > 0 && <div className="chat-section-label">{t('chat.list.sections.others')}</div>}
                          {others.map(chat => (
                            <div key={chat.id} className="chat-item" {...pressProps(chat, 'group')} onClick={guardedOpen(chat)}>
                              <div className="chat-avatar-wrapper">
                                {chat.avatar
                                  ? <img src={chat.avatar} alt={chat.name} className="chat-avatar" loading="lazy" />
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
                {renderHiddenSection()}
              </>
            )}
          </div>
        )}

      </div>

      {/* ── Long-press action sheet (hide chat) ─────────────────────── */}
      {menuChat && (
        <div className="chat-menu-overlay" onClick={() => setMenuChat(null)}>
          <div className="chat-menu-sheet" onClick={e => e.stopPropagation()}>
            <p className="chat-menu-title">{menuChat.chat.name}</p>
            <button className="chat-menu-action" onClick={() => archiveChat(menuChat.chat, true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
              </svg>
              {t('chat.list.hide')}
            </button>
            <button className="chat-menu-cancel" onClick={() => setMenuChat(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Anfragen Modal ──────────────────────────────────────────── */}
      {requestsModal && (
        <div className="requests-modal-overlay" onClick={() => setRequestsModal(null)}>
          <div className="requests-modal" onClick={e => e.stopPropagation()}>
            <div className="requests-modal-header">
              <span className="requests-modal-title">
                {modalLoading
                  ? t('chat.list.requestsModal.loading')
                  : modalIndex < modalRequests.length
                    ? t('chat.list.requestsModal.count', { count: modalRequests.length - modalIndex })
                    : t('chat.list.requestsModal.empty')}
              </span>
              <button className="requests-modal-close" onClick={() => setRequestsModal(null)}>✕</button>
            </div>

            <div className="requests-modal-body">
              {modalLoading ? (
                <div className="home-loading"><div className="home-spinner" /></div>
              ) : modalIndex >= modalRequests.length ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-icon">✅</div>
                  <p>{t('chat.list.requestsModal.allDone')}</p>
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
                        <span>✓</span><span>{t('chat.list.requestsModal.accept')}</span>
                      </div>
                      <div className={`swipe-indicator swipe-decline ${modalSwipeDir === 'left' ? 'visible' : ''}`}>
                        <span>✕</span><span>{t('chat.list.requestsModal.decline')}</span>
                      </div>
                      <div className="request-card">
                        <div className="request-image-container request-image-tall">
                          {req.user_avatar
                            ? <img src={req.user_avatar} alt={req.user_name} className="request-user-image" loading="lazy" />
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
                            ? <img src={nextReq.user_avatar} alt="" loading="lazy" decoding="async" />
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
