import { useState, useEffect, useContext, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, clubs, directMessages } from '../utils/api';
import { SocketContext } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { RequestCard } from '../components/RequestCard';
import useOnPullRefresh from '../hooks/useOnPullRefresh';
import '../styles/chat.css';
import '../styles/profile.css';

// Neubau 2026-08-04 (Tina/Tobi meeting): the old Gruppen/Clubs/Freunde top
// tabs are GONE. Three main tabs instead:
//   Chats     — ONE merged list (groups + clubs + DMs) with 5 filter bubbles:
//               Alle · Gruppen · Clubs · Freunde · Ungelesen
//   Anfragen  — aggregated join-request swipe deck across every owned/managed
//               group+club ("swipen soll süchtig machen" — Tina)
//   Verwalten — the caller's own groups/clubs with edit + request shortcuts
const MAIN_TABS = ['chats', 'anfragen', 'verwalten'];
const FILTERS = ['alle', 'gruppen', 'clubs', 'freunde', 'ungelesen'];
// Old deep links / back-navigation used ?tab=gruppen|clubs|freunde — map them
// onto the Chats tab with the matching filter bubble so nothing 404s.
const LEGACY_TAB_TO_FILTER = { gruppen: 'gruppen', clubs: 'clubs', freunde: 'freunde' };

export const ChatList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'chats';
  const activeTab = MAIN_TABS.includes(rawTab) ? rawTab : 'chats';
  const filter = FILTERS.includes(searchParams.get('filter'))
    ? searchParams.get('filter')
    : (LEGACY_TAB_TO_FILTER[rawTab] || 'alle');
  // Tab + filter live in the URL so swiping back from a chat restores the exact
  // view. replace:true keeps the back stack clean.
  const setParams = (tab, nextFilter) => setSearchParams(() => {
    const sp = new URLSearchParams();
    if (tab !== 'chats') sp.set('tab', tab);
    if (tab === 'chats' && nextFilter && nextFilter !== 'alle') sp.set('filter', nextFilter);
    return sp;
  }, { replace: true });

  const [groupChats, setGroupChats]     = useState([]);
  const [privateChats, setPrivateChats] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showHidden, setShowHidden]     = useState(false);
  const [search, setSearch]             = useState('');
  const [menuChat, setMenuChat]         = useState(null); // long-pressed chat
  const longPress                       = useRef({ timer: null, fired: false, x: 0, y: 0 });

  // ── Anfragen deck state ────────────────────────────────────────────────
  // `requests` is the raw server snapshot; `processedIds` are the ones handled
  // THIS session. The deck derives from both, so a live refetch (socket ping,
  // pull-to-refresh) can replace `requests` at any moment without corrupting
  // the deck position — no index to go stale.
  const [requests, setRequests]           = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [processedIds, setProcessedIds]   = useState(() => new Set());
  const [processing, setProcessing]       = useState(false);
  const [dragX, setDragX]                 = useState(0);
  const dragStartX                        = useRef(null);

  const navigate = useNavigate();
  const { socket } = useContext(SocketContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage || i18n.language || 'de';
  const dateLocale = lang.startsWith('en') ? 'en-US' : lang.startsWith('it') ? 'it-IT' : lang.startsWith('fr') ? 'fr-FR' : lang.startsWith('es') ? 'es-ES' : 'de-DE';

  useEffect(() => {
    loadData();
    loadRequests();
  }, []);

  // Pull-to-refresh: re-fetch chats + requests (stale unread/request counts
  // were the complaint — Tina 2026-08-02).
  useOnPullRefresh(() => { loadData(); loadRequests(); });

  // Clear the search when switching main tabs so each starts unfiltered.
  useEffect(() => { setSearch(''); }, [activeTab]);

  useEffect(() => {
    if (!socket) return;
    // receive_message is room-scoped (only fires with the chat OPEN, i.e.
    // never on this page) — group_message_notification is the per-user nudge
    // the backend sends to every member and is what actually updates rows here.
    socket.on('receive_message', handleNewGroupMessage);
    socket.on('group_message_notification', handleGroupNotification);
    socket.on('new_dm_notification', handleNewDM);
    // Live join-request signal (2026-08-04): backend pings the owner's user
    // room on every new request — THE fix for the frozen "Anfragen (1)" badge.
    socket.on('join_request_update', handleJoinRequestUpdate);
    return () => {
      socket.off('receive_message', handleNewGroupMessage);
      socket.off('group_message_notification', handleGroupNotification);
      socket.off('new_dm_notification', handleNewDM);
      socket.off('join_request_update', handleJoinRequestUpdate);
    };
  }, [socket]);

  // silent=true refreshes the rows WITHOUT flipping the skeleton state — used
  // by socket handlers (first-ever DM) so the visible list doesn't flash to
  // placeholders while the user is looking at it (review finding 2026-08-04).
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [joinedRes, dmsRes] = await Promise.all([
        groups.getJoined().catch(() => null),
        directMessages.getConversations().catch(() => null),
      ]);

      // Events (type='event') live under a parent club and shouldn't surface
      // as a top-level chat row — that would duplicate the club entry.
      setGroupChats((joinedRes?.data || [])
        .filter(g => g.type !== 'event')
        .map(g => {
          return {
            id: g.id,
            name: g.name || g.title,
            // Sender + text separat, damit der Absender im Preview leicht
            // fetter gerendert werden kann (Tobi 2026-08-05).
            lastSender: g.last_message ? (g.last_message_sender || '') : '',
            lastText: g.last_message || '',
            // ts = raw last-activity epoch for the merged sort across kinds.
            ts: g.last_message_time ? new Date(g.last_message_time).getTime() : 0,
            time: g.last_message_time ? formatTime(g.last_message_time) : '',
            unread: g.unread_count || 0,
            avatar: g.image_url,
            type: g.type,
            isOwner: g.role === 'owner',
            is_private: g.is_private,
            members: g.members_count || 0,
            maxMembers: g.max_members || null,
            pendingRequests: g.pending_request_count || 0,
            archived: !!g.archived,
          };
        }));

      setPrivateChats((dmsRes?.data || []).map(dm => ({
        id: dm.other_user_id,
        name: dm.other_user_name,
        lastSender: '', // 1:1-Chat — Absender ist klar, kein Prefix
        lastText: dm.last_message_text || '',
        ts: dm.last_message_at ? new Date(dm.last_message_at).getTime() : 0,
        time: dm.last_message_at ? formatTime(dm.last_message_at) : '',
        unread: dm.unread_count || 0,
        avatar: dm.other_user_avatar,
        isDM: true,
        archived: !!dm.is_archived,
      })));
    } catch {
      // Both fetches already .catch(() => null) — nothing actionable here.
    } finally {
      setLoading(false);
    }
  };

  const loadRequests = useCallback(async () => {
    try {
      const res = await groups.getAllRequests();
      setRequests(res.data || []);
    } catch {
      // Non-fatal: tab shows its empty state; toast only spams here.
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return t('chat.list.dateYesterday');
    if (diffDays < 7)  return date.toLocaleDateString(dateLocale, { weekday: 'short' });
    return date.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' });
  };

  // Patch a chat row AND move it to the top — the merged list is ordered by
  // last-message time, so a chat that just received a message belongs at 0.
  const bumpToTop = (list, id, patch) => {
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return list;
    return [
      { ...list[idx], ...patch, ts: Date.now() },
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
        lastSender: data.user_name || '',
        lastText: data.content || '',
        time: formatTime(new Date().toISOString()),
        unread: (row.unread || 0) + 1,
      });
    });
  };

  const handleGroupNotification = (data) => {
    setGroupChats(prev => {
      const row = prev.find(c => c.id === data.group_id);
      if (!row) return prev;
      return bumpToTop(prev, data.group_id, {
        lastSender: data.user_name || '',
        lastText: data.content || '',
        time: formatTime(new Date().toISOString()),
        unread: (row.unread || 0) + 1,
      });
    });
  };

  const handleNewDM = (data) => {
    const preview = typeof data.message === 'string'
      ? data.message
      : (data.message?.content || '');
    setPrivateChats(prev => {
      const row = prev.find(c => c.id === data.senderId);
      // First-ever DM from a new friend has no row yet — refetch (silently,
      // no skeleton flash over the visible list) so it appears.
      if (!row) { loadData(true); return prev; }
      return bumpToTop(prev, data.senderId, {
        lastText: preview,
        time: formatTime(new Date().toISOString()),
        unread: (row.unread || 0) + 1,
      });
    });
  };

  const handleJoinRequestUpdate = (data) => {
    // Refetch the deck (cheap, deduped by processedIds — never corrupts the
    // deck position) and bump the per-chat chip immediately.
    loadRequests();
    if (data?.group_id) {
      setGroupChats(prev => prev.map(c =>
        c.id === data.group_id ? { ...c, pendingRequests: (c.pendingRequests || 0) + 1 } : c
      ));
    }
  };

  const openChat = (chat) => chat.isDM ? navigate(`/dm/${chat.id}`) : navigate(`/chat/${chat.id}`);

  // ── Anfragen deck ──────────────────────────────────────────────────────
  // Dedupe key includes updated_at: a re-submitted request REUSES its row id
  // (backend ON CONFLICT upsert), so id alone would keep the fresh incarnation
  // invisible for the rest of the session (review finding 2026-08-04). Stale
  // refetch races still dedupe correctly — a stale row carries the OLD
  // updated_at and stays filtered.
  const reqKey = (r) => `${r.id}:${r.updated_at}`;
  const deck = useMemo(
    () => requests.filter(r => !processedIds.has(reqKey(r))),
    [requests, processedIds]
  );
  const current = deck[0];
  const nextReq = deck[1];
  const sessionDone = processedIds.size;

  const markProcessed = (id) => setProcessedIds(prev => new Set(prev).add(id));
  const unmarkProcessed = (id) => setProcessedIds(prev => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  // Route the action to the right API by entity type — club requests may be
  // handled by co-managers, which the group endpoint would 403.
  const apiFor = (r) => (r.group_type === 'club' ? clubs : groups);

  const decrementChatChip = (groupId) => setGroupChats(prev => prev.map(c =>
    c.id === groupId ? { ...c, pendingRequests: Math.max(0, (c.pendingRequests || 0) - 1) } : c
  ));

  const deckAccept = async () => {
    if (processing || !current) return;
    const r = current;
    setProcessing(true);
    try {
      await apiFor(r).handleRequest(r.group_id, r.id, 'accept');
      markProcessed(reqKey(r));
      decrementChatChip(r.group_id);
      resetDrag();
      toast.success(t('chat.list.toast.requestAccepted', { name: r.user_name }));
    } catch (err) {
      toast.error(err.response?.data?.error || t('chat.list.toast.requestAcceptError'));
    } finally {
      setProcessing(false);
    }
  };

  const deckDecline = async () => {
    if (processing || !current) return;
    const r = current;
    setProcessing(true);
    try {
      await apiFor(r).handleRequest(r.group_id, r.id, 'reject');
      markProcessed(reqKey(r));
      decrementChatChip(r.group_id);
      resetDrag();
      // Undoable — revert a mis-swipe (established pattern, Tobi 2026-07-31).
      toast.showUndo(
        t('chat.list.toast.requestDeclined', { name: r.user_name }),
        async () => {
          try {
            await apiFor(r).handleRequest(r.group_id, r.id, 'undo');
            unmarkProcessed(reqKey(r));
            // Restore the chip AND refetch: if a socket ping refreshed the
            // snapshot between decline and undo, the rejected row is gone from
            // `requests` — without the refetch the card would never reappear
            // (review finding 2026-08-04). Note the undone row keeps its
            // updated_at from the undo, so the refetched incarnation is
            // visible regardless of the local unmark.
            setGroupChats(prev => prev.map(c =>
              c.id === r.group_id ? { ...c, pendingRequests: (c.pendingRequests || 0) + 1 } : c
            ));
            loadRequests();
          } catch {
            toast.error(t('chat.list.toast.requestDeclineError'));
          }
        },
        t('common.undo')
      );
    } catch (err) {
      toast.error(err.response?.data?.error || t('chat.list.toast.requestDeclineError'));
    } finally {
      setProcessing(false);
    }
  };

  // Swipe: right = accept, left = decline (same thresholds as the old modal).
  const SWIPE_THRESHOLD = 90;
  const resetDrag = () => { dragStartX.current = null; setDragX(0); };
  const onCardDown = (e) => {
    if (processing) return;
    dragStartX.current = e.clientX;
  };
  const onCardMove = (e) => {
    if (dragStartX.current == null) return;
    setDragX(e.clientX - dragStartX.current);
  };
  const onCardEnd = () => {
    if (dragStartX.current == null) return;
    const dx = dragX;
    resetDrag();
    if (dx > SWIPE_THRESHOLD) deckAccept();
    else if (dx < -SWIPE_THRESHOLD) deckDecline();
  };

  // ── Long-press to hide (Chats tab) ─────────────────────────────────────
  const startPress = (chat, e) => {
    longPress.current.fired = false;
    const pt = e.touches?.[0] || e;
    longPress.current.x = pt?.clientX ?? 0;
    longPress.current.y = pt?.clientY ?? 0;
    clearTimeout(longPress.current.timer);
    longPress.current.timer = setTimeout(() => {
      longPress.current.fired = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
      setMenuChat({ chat });
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
  const guardedOpen = (chat) => () => {
    if (longPress.current.fired) { longPress.current.fired = false; return; }
    openChat(chat);
  };
  const pressProps = (chat) => ({
    onPointerDown: (e) => startPress(chat, e),
    onPointerMove: movePress,
    onPointerUp: endPress,
    onPointerLeave: endPress,
  });

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

  // ── Merged + filtered chat list ────────────────────────────────────────
  const allChats = useMemo(
    () => [...groupChats, ...privateChats].sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    [groupChats, privateChats]
  );
  const byFilter = (c) => {
    if (filter === 'gruppen')   return !c.isDM && c.type !== 'club';
    if (filter === 'clubs')     return c.type === 'club';
    if (filter === 'freunde')   return !!c.isDM;
    if (filter === 'ungelesen') return (c.unread || 0) > 0;
    return true; // alle
  };
  const filteredChats = allChats.filter(byFilter);
  const visibleChats  = filteredChats.filter(c => !c.archived);
  const hiddenChats   = filteredChats.filter(c => c.archived);

  const searchQuery     = search.trim().toLowerCase();
  const filteredVisible = searchQuery
    ? visibleChats.filter(c => (c.name || '').toLowerCase().includes(searchQuery))
    : visibleChats;

  // Bubble badges = unread sums (a number next to a filter universally reads
  // as "new messages"); the Ungelesen bubble counts chats instead.
  const sumUnread    = (pred) => allChats.filter(c => !c.archived && pred(c)).reduce((s, c) => s + (c.unread || 0), 0);
  const groupsUnread = sumUnread(c => !c.isDM && c.type !== 'club');
  const clubsUnread  = sumUnread(c => c.type === 'club');
  const dmsUnread    = sumUnread(c => !!c.isDM);
  const unreadChats  = allChats.filter(c => !c.archived && (c.unread || 0) > 0).length;
  // Chats-Reiter zeigt nur einen orangen Punkt (kein Zähler), wenn IRGENDWO
  // etwas Ungelesenes liegt — reines "da ist was neu"-Signal (Tobi 2026-08-05).
  // Summe deckt sich mit dem Bottom-Nav-Chat-Badge (App.jsx unreadCount).
  const hasUnread    = (groupsUnread + clubsUnread + dmsUnread) > 0;

  const ownedEntities = groupChats.filter(c => c.isOwner);

  const emptyStateForFilter = () => {
    if (filter === 'gruppen')   return { icon: '💬', text: t('chat.list.empty.noGroupChats'), cta: t('chat.list.empty.joinGroupHint'), to: '/home' };
    if (filter === 'clubs')     return { icon: '🏆', text: t('chat.list.empty.noClubChats'), cta: t('chat.list.empty.discoverClubsHint'), to: '/home' };
    if (filter === 'freunde')   return { icon: '💬', text: t('chat.list.empty.noChats'), cta: t('chat.list.empty.toFriends'), to: '/friends' };
    if (filter === 'ungelesen') return { icon: '🎉', text: t('chat.list.empty.noUnread'), cta: null };
    return { icon: '💬', text: t('chat.list.empty.noChatsAll'), cta: t('chat.list.empty.joinGroupHint'), to: '/home' };
  };

  // ── Renderers ──────────────────────────────────────────────────────────
  // Type distinction via avatar RING instead of text badges (Tobi 2026-08-05
  // after local testing): coral ring = Gruppe, lila ring = Club, DMs plain.
  // Rows get a tighter two-line layout in return.
  const avatarRing = (chat) =>
    chat.isDM ? '' : chat.type === 'club' ? ' chat-avatar--ring-club' : ' chat-avatar--ring-group';

  const renderChatRow = (chat) => (
    <div key={`${chat.isDM ? 'dm' : 'g'}-${chat.id}`} className="chat-item" {...pressProps(chat)} onClick={guardedOpen(chat)}>
      <div className="chat-avatar-wrapper">
        {chat.avatar
          ? <img src={chat.avatar} alt={chat.name} className={`chat-avatar${avatarRing(chat)}`} loading="lazy" />
          : <div className={`chat-avatar-placeholder${avatarRing(chat)}`}>{(chat.name || '?')[0].toUpperCase()}</div>}
      </div>
      <div className="chat-info">
        <div className="chat-top-row">
          <span className="chat-name">{chat.name}</span>
          <span className="chat-time">{chat.time}</span>
        </div>
        <div className="chat-bottom-row">
          <p className="chat-last-message">
            {chat.lastSender && <span className="chat-last-sender">{chat.lastSender}: </span>}
            {chat.lastText}
          </p>
          {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
        </div>
      </div>
    </div>
  );

  const renderSkeletonRows = (n = 7) => (
    <div className="chat-list" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="chat-item chat-item--skeleton">
          <div className="skeleton skeleton-avatar" />
          <div className="chat-info">
            <div className="skeleton skeleton-line" style={{ width: `${55 - (i % 3) * 10}%` }} />
            <div className="skeleton skeleton-line skeleton-line--sub" style={{ width: `${75 - (i % 4) * 8}%` }} />
          </div>
        </div>
      ))}
    </div>
  );

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
            <div key={`${chat.isDM ? 'dm' : 'g'}-${chat.id}`} className="chat-item chat-item--hidden">
              <div className="chat-item-main" onClick={() => openChat(chat)}>
                <div className="chat-avatar-wrapper">
                  {chat.avatar
                    ? <img src={chat.avatar} alt={chat.name} className={`chat-avatar${avatarRing(chat)}`} loading="lazy" />
                    : <div className={`chat-avatar-placeholder${avatarRing(chat)}`}>{(chat.name || '?')[0].toUpperCase()}</div>}
                </div>
                <div className="chat-info">
                  <div className="chat-top-row"><span className="chat-name">{chat.name}</span></div>
                  <div className="chat-bottom-row">
                    <p className="chat-last-message">
                      {chat.lastSender && <span className="chat-last-sender">{chat.lastSender}: </span>}
                      {chat.lastText}
                    </p>
                  </div>
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

  return (
    <div className="home-container chat-list-page">

      {/* ── Sticky header: 3 main tabs ─────────────────────────────── */}
      <div className="home-sticky-header">
        <div className="tabs-container chat-tabs-container">
          <button
            className={`tab ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setParams('chats', filter)}
          >
            {t('chat.list.mainTabs.chats')}
            {hasUnread && <span className="tab-dot" aria-hidden="true" />}
          </button>
          <button
            className={`tab ${activeTab === 'anfragen' ? 'active' : ''}`}
            onClick={() => setParams('anfragen')}
          >
            {t('chat.list.mainTabs.requests')}
            {deck.length > 0 && <span className="tab-dot" aria-hidden="true" />}
          </button>
          <button
            className={`tab ${activeTab === 'verwalten' ? 'active' : ''}`}
            onClick={() => setParams('verwalten')}
          >
            {t('chat.list.mainTabs.manage')}
          </button>
        </div>

        {/* Filter bubbles — Chats tab only */}
        {activeTab === 'chats' && (
          <div className="chat-filter-bubbles" role="tablist">
            {[
              { key: 'alle',      label: t('chat.list.filters.alle') },
              { key: 'gruppen',   label: t('chat.list.filters.gruppen'),   count: groupsUnread },
              { key: 'clubs',     label: t('chat.list.filters.clubs'),     count: clubsUnread },
              { key: 'freunde',   label: t('chat.list.filters.freunde'),   count: dmsUnread },
              { key: 'ungelesen', label: t('chat.list.filters.ungelesen'), count: unreadChats },
            ].map(b => (
              <button
                key={b.key}
                role="tab"
                aria-selected={filter === b.key}
                className={`chat-filter-bubble ${filter === b.key ? 'active' : ''}`}
                onClick={() => setParams('chats', b.key)}
              >
                {b.label}
                {b.count > 0 && <span className="chat-filter-bubble-count">{b.count > 99 ? '99+' : b.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Scrollable content ──────────────────────────────────────── */}
      <div className="home-content">

        {/* ════════ CHATS ════════ */}
        {activeTab === 'chats' && (
          <>
            {!loading && visibleChats.length > 0 && (
              <div className="chat-search-wrap">
                <input
                  type="text"
                  className="chat-search-input"
                  placeholder={t('chat.list.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t('chat.list.searchPlaceholder')}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
                {search && (
                  <button className="chat-search-clear" onClick={() => setSearch('')} aria-label={t('chat.list.searchClear')}>×</button>
                )}
              </div>
            )}

            {loading ? renderSkeletonRows() : visibleChats.length === 0 ? (
              (() => {
                const es = emptyStateForFilter();
                return (
                  <div className="empty-state">
                    <div className="empty-icon">{es.icon}</div>
                    <p>{es.text}</p>
                    {es.cta && (
                      <button className="empty-hint" onClick={() => navigate(es.to)}>{es.cta}</button>
                    )}
                  </div>
                );
              })()
            ) : (
              <>
                {searchQuery && filteredVisible.length === 0 && (
                  <p className="chat-search-empty">{t('chat.list.noResults')}</p>
                )}
                <div className="chat-list">
                  {filteredVisible.map(renderChatRow)}
                </div>
                {renderHiddenSection()}
              </>
            )}
          </>
        )}

        {/* ════════ ANFRAGEN ════════ */}
        {activeTab === 'anfragen' && (
          <div className="requests-tab">
            {requestsLoading ? (
              <div className="requests-tab-skeleton">
                <div className="skeleton skeleton-card" />
              </div>
            ) : current ? (
              <>
                {/* Progress: session done vs. remaining — the "one more swipe"
                    loop Tina asked for. */}
                <div className="requests-progress">
                  {/* "X offen" removed (Tobi 2026-08-05) — the tab already
                      carries the orange dot; keep only the session streak. */}
                  {sessionDone > 0 && (
                    <span className="requests-progress-done">🔥 {sessionDone}</span>
                  )}
                </div>
                <div className="requests-progress-bar">
                  <div
                    className="requests-progress-fill"
                    style={{ width: `${(sessionDone / (sessionDone + deck.length)) * 100}%` }}
                  />
                </div>

                {/* WHICH group/club the request is for */}
                <div className="requests-deck-group">
                  <span className={`chat-type-badge ${current.group_type === 'club' ? 'club-badge' : 'group-badge'}`}>
                    {current.group_type === 'club' ? t('chat.list.filters.clubOne') : t('chat.list.filters.groupOne')}
                  </span>
                  <span className="requests-deck-group-name">{current.group_name}</span>
                </div>

                <div
                  className="request-card-wrapper"
                  onPointerDown={onCardDown}
                  onPointerMove={onCardMove}
                  onPointerUp={onCardEnd}
                  onPointerCancel={resetDrag}
                  style={{
                    touchAction: 'pan-y',
                    transform: dragX ? `translateX(${dragX}px) rotate(${dragX * 0.03}deg)` : undefined,
                    transition: dragStartX.current == null ? 'transform 0.25s cubic-bezier(.25,.8,.25,1)' : 'none',
                  }}
                >
                  <div className={`swipe-indicator swipe-accept${dragX > 40 ? ' visible' : ''}`}><span>✓</span></div>
                  <div className={`swipe-indicator swipe-decline${dragX < -40 ? ' visible' : ''}`}><span>✕</span></div>
                  <RequestCard request={current} />
                  {nextReq && (
                    <div className="next-card-preview">
                      {nextReq.user_avatar
                        ? <img src={nextReq.user_avatar} alt="" loading="lazy" decoding="async" />
                        : <div className="next-card-preview-ph">{(nextReq.user_name || '?')[0].toUpperCase()}</div>}
                    </div>
                  )}
                </div>

                <div className="requests-actions" style={{ padding: '20px 0 0' }}>
                  <button className="action-btn decline" onClick={deckDecline} disabled={processing} aria-label={t('chat.list.requestsModal.decline')}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                  <button className="action-btn accept" onClick={deckAccept} disabled={processing} aria-label={t('chat.list.requestsModal.accept')}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20,6 9,17 4,12"/>
                    </svg>
                  </button>
                </div>
              </>
            ) : sessionDone > 0 ? (
              // Celebration — every request of the session handled.
              <div className="empty-state requests-celebration">
                <div className="requests-celebration-burst" aria-hidden="true">
                  {['🎉', '✨', '🎊', '💪', '⭐'].map((e, i) => (
                    <span key={i} className="requests-celebration-emoji" style={{ animationDelay: `${i * 0.12}s` }}>{e}</span>
                  ))}
                </div>
                <div className="empty-icon">🏁</div>
                <p className="requests-celebration-title">{t('chat.list.requestsTab.doneTitle')}</p>
                <p className="requests-celebration-sub">{t('chat.list.requestsTab.doneText', { count: sessionDone })}</p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>{t('chat.list.requestsTab.emptyTitle')}</p>
                <p className="requests-empty-sub">{t('chat.list.requestsTab.emptyText')}</p>
              </div>
            )}
          </div>
        )}

        {/* ════════ VERWALTEN ════════ */}
        {activeTab === 'verwalten' && (
          loading ? renderSkeletonRows(4) : ownedEntities.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🛠️</div>
              <p>{t('chat.list.manage.empty')}</p>
              <button className="empty-hint" onClick={() => navigate('/create-group')}>
                {t('chat.list.manage.emptyCta')}
              </button>
            </div>
          ) : (
            <div className="chat-list">
              {ownedEntities.map(chat => (
                <div
                  key={chat.id}
                  className="chat-item chat-item--manage"
                  onClick={() => navigate(chat.type === 'club' ? `/club/${chat.id}` : `/group/${chat.id}`)}
                >
                  <div className="chat-avatar-wrapper">
                    {chat.avatar
                      ? <img src={chat.avatar} alt={chat.name} className={`chat-avatar${avatarRing(chat)}`} loading="lazy" />
                      : <div className={`chat-avatar-placeholder${avatarRing(chat)}`}>{(chat.name || '?')[0].toUpperCase()}</div>}
                  </div>
                  <div className="chat-info">
                    <div className="chat-top-row">
                      <span className="chat-name">{chat.name}</span>
                    </div>
                    <div className="chat-manage-meta">
                      <span className="chat-manage-members">
                        {t('chat.list.manage.membersFmt', { count: chat.members })}{chat.maxMembers ? ` / ${chat.maxMembers}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="chat-manage-actions">
                    {/* Anfragen-Shortcut hier entfernt (Tobi 2026-08-05):
                        dafür gibt es den eigenen Anfragen-Reiter. */}
                    <button
                      className="chat-owner-btn chat-owner-btn--manage"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(chat.type === 'club' ? `/club/${chat.id}/edit` : `/group/${chat.id}/edit`);
                      }}
                    >
                      {t('chat.list.manage.edit')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
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
    </div>
  );
};

export default ChatList;
