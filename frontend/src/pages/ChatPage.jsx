import { useState, useEffect, useContext, useRef, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, messages, upload } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { dayKey, daySeparatorLabel } from '../utils/chatDate';
import { ReportModal } from '../components/ReportModal';
import { ChatComposer } from '../components/ChatComposer';
import { VoiceMessage } from '../components/VoiceMessage';
import { ImageMessage } from '../components/ImageMessage';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { MessageQuote } from '../components/MessageQuote';
import { mediaUrl } from '../utils/chatMedia';
import { serverErrorMessage } from '../utils/apiError';
import { downscaleImageFile } from '../utils/images';
import { useChatViewport } from '../hooks/useChatViewport';
import useSwipeBack from '../hooks/useSwipeBack';
import '../styles/chat.css';

export const ChatPage = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [messageList, setMessageList] = useState([]);
  const safeSetMessageList = (val) => setMessageList(Array.isArray(val) ? val : []);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canSendMessages, setCanSendMessages] = useState(true);
  const [permissionMessage, setPermissionMessage] = useState('');
  // Per-group push mute (chat-header bell). Seeded from the group payload.
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  // Long-press (or right-click) on a message opens its action sheet. Reporting
  // a chat message was impossible in the app until 2026-09-15: ReportModal was
  // only ever opened from a profile, a group or a club, so `type="message"`
  // was unreachable product surface — even though the DB constraint, the
  // backend validation and the admin queue all supported it. Harassment
  // happens in chat, not on profiles, so this was the report that mattered
  // most and the one nobody could file.
  const [actionMsg, setActionMsg] = useState(null);
  const [reportMsg, setReportMsg] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const longPressTimer = useRef(null);

  // Long-press opens the sheet; a real press-and-hold, not a tap. Cancelled on
  // move/end so scrolling the chat never triggers it.
  const pressHandlers = (msg) => ({
    onContextMenu: (e) => { e.preventDefault(); setActionMsg(msg); },
    onPointerDown: () => {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => setActionMsg(msg), 500);
    },
    onPointerUp:    () => clearTimeout(longPressTimer.current),
    onPointerLeave: () => clearTimeout(longPressTimer.current),
    onPointerMove:  () => clearTimeout(longPressTimer.current),
  });

  // Upload first, then send the row that points at it. Two steps rather than a
  // multipart message endpoint: the upload is the slow, retryable part, and a
  // failure there must not look like a failed message.
  const handleSendVoice = async ({ blob, mimeType, durationMs }) => {
    if (!canSendMessages) return;
    try {
      const res = await upload.voice(blob, durationMs, mimeType);
      await handleSendMessage(null, { url: res.data.url, durationMs: res.data.duration_ms ?? durationMs });
    } catch (err) {
      toast.error(serverErrorMessage(err, t, 'chat.voice.uploadFailed'));
    }
  };

  // Scroll to the quoted original and flash it. Best-effort by design: if the
  // message is older than the loaded page it simply is not in the DOM, and
  // silently doing nothing beats either jumping somewhere arbitrary or firing
  // a fetch the user never asked for.
  const jumpToMessage = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('message--flash');
    setTimeout(() => el.classList.remove('message--flash'), 1200);
  };

  // Shrink client-side first (utils/images), then upload, then send the row
  // that points at it. The upload route is where Sightengine runs, so a photo
  // is moderated BEFORE it can ever reach the chat — unlike a voice note,
  // which can only be moderated reactively.
  const handleSendPhoto = async (file) => {
    try {
      const res = await upload.image(await downscaleImageFile(file));
      await handleSendMessage(null, null, { url: res.data.url });
    } catch (err) {
      toast.error(serverErrorMessage(err, t, 'chat.photo.uploadFailed'));
    }
  };

  const handleDeleteMessage = async (msg) => {
    if (!window.confirm(t('chat.page.message.confirmDelete'))) return;
    setActionMsg(null);
    try {
      await messages.delete(msg.id);
      // The socket event removes it for everyone else; do it locally too so
      // the sender does not wait on a round trip they triggered.
      setMessageList(prev => prev.filter(m => m.id !== msg.id));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('chat.page.message.deleteError'));
    }
  };

  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useContext(SocketContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-DE');
  const messagesEndRef = useRef(null);
  const chatPageRef = useRef(null);
  // active only once the real chat surface (which carries the ref) is mounted —
  // during loading/not-found the ref is null and the hook must wait.
  useChatViewport(chatPageRef, !loading && !!group);
  // Back / swipe-right → the chat list on the RIGHT tab (WhatsApp-style). Was
  // navigate(-1), which landed on whatever was in history (usually the Gruppen
  // tab) even when leaving a club chat. Navigate explicitly by type instead.
  const goBackToList = () => navigate(group?.type === 'club' ? '/chats?filter=clubs' : '/chats');
  useSwipeBack(chatPageRef, goBackToList, !loading && !!group);

  // Composer auto-grow moved into components/ChatComposer.jsx along with the
  // input itself, so the group chat and DMs cannot drift apart again.
  // Banner only appears after 3s of sustained disconnection — avoids
  // scary flashes during routine network blips that socket.io recovers from.
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);
  useEffect(() => {
    if (isConnected) { setShowReconnectBanner(false); return; }
    const t = setTimeout(() => setShowReconnectBanner(true), 3000);
    return () => clearTimeout(t);
  }, [isConnected]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Set before a "load earlier" prepend so the [messageList] auto-scroll effect
  // skips once — otherwise loading older messages instantly yanks the user back
  // to the newest message and the history can never be read.
  const skipAutoScrollRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const fetchGroup = async () => {
      try {
        const response = await groups.getById(groupId);
        if (cancelled) return;
        setGroup(response.data);
        setMuted(!!response.data.is_muted);
        if (response.data.type === 'club' && response.data.chat_only_owner && Number(response.data.owner_id) !== Number(user?.id)) {
          setCanSendMessages(false);
          setPermissionMessage(t('chat.page.permissionOwnerOnly'));
        }
      } catch (error) {
        if (cancelled) return;
        toast.error(t('chat.page.toast.loadGroupError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const fetchMessages = async () => {
      try {
        const response = await messages.get(groupId);
        if (cancelled) return;
        const data = response.data;
        const msgs = Array.isArray(data) ? data : (data?.messages ?? []);
        safeSetMessageList(msgs);
        setHasMore(Array.isArray(data) ? false : (data?.has_more ?? false));
      } catch (error) {
        if (cancelled) return;
        toast.error(t('chat.page.toast.loadMessagesError'));
      }
    };

    fetchGroup();
    fetchMessages();

    return () => {
      cancelled = true;
      // Stamp read on the way out: messages that arrived WHILE the chat was
      // open came after the GET's read marker and would otherwise linger as
      // phantom unreads on the nav badge / chat list. The resync event fires
      // AFTER the request settles so the nav badge refetch reads the new
      // marker (success or not — on failure the refetch is still the truth).
      messages.markRead(groupId)
        .catch(() => {})
        .finally(() => window.dispatchEvent(new Event('jamie:unread-resync')));
    };
  }, [groupId]);

  // Catch-up fetch: pull the latest page and merge anything we don't have yet.
  // Runs after a socket reconnect and when the app returns to the foreground —
  // messages sent while the phone was in the pocket otherwise never appear
  // (receive_message only delivers live events; Lea, 2026-07-30). The GET also
  // re-stamps the read marker, keeping the unread badge honest.
  const catchUpMessages = useCallback(async () => {
    try {
      const response = await messages.get(groupId);
      const data = response.data;
      const msgs = Array.isArray(data) ? data : (data?.messages ?? []);
      if (!msgs.length) return;
      setMessageList(prev => {
        if (!prev.length) return msgs;
        const known = new Set(prev.map(m => m.id));
        const fresh = msgs.filter(m => !known.has(m.id));
        if (!fresh.length) return prev;
        // No overlap → the gap exceeds the fetched window; the fetched page IS
        // the current tail. Replace (keeping any still-pending own bubble)
        // instead of appending across a hole in the history.
        const overlap = msgs.some(m => known.has(m.id));
        return overlap ? [...prev, ...fresh] : [...msgs, ...prev.filter(m => m._pending)];
      });
    } catch { /* next reconnect/visibility tick retries */ }
  }, [groupId]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('join_room', groupId);

    const handleReceiveMessage = (data) => {
      // Dedup by id: the server broadcast is authoritative, but a catch-up
      // refetch may already hold this row (and our own messages arrive via the
      // 201, never here — the server excludes the sender).
      setMessageList((prev) =>
        (data?.id != null && prev.some(m => m.id === data.id)) ? prev : [...prev, data]
      );
    };

    // Every reconnect is a NEW server-side connection whose room memberships
    // are gone — without re-joining, the chat looks connected but silently
    // receives nothing ever again (the root of Lea's "aktualisiert sich
    // nicht"). Re-join first, then back-fill what was missed while offline.
    const handleReconnect = () => {
      socket.emit('join_room', groupId);
      catchUpMessages();
    };

    // Owner removed us from this group/club → server already evicted our socket
    // from the room; leave the chat UI so we don't sit on a dead screen.
    const handleRemoved = (data) => {
      if (String(data?.groupId) !== String(groupId)) return;
      toast.info(t('chat.page.removed'));
      navigate('/chats');
    };

    // A moderator (or the author) removed a message — drop it live instead of
    // leaving it on screen until the next reload.
    const handleMessageDeleted = ({ id }) => {
      setMessageList(prev => prev
        .filter(m => m.id !== id)
        // Dropping the bubble is not enough: every reply that quoted it still
        // carries up to 160 characters of the removed text in its own
        // `reply_to`, and renders them in the quote bar. An admin takedown
        // otherwise left the harassing message on screen, inside each reply,
        // for everyone with the chat open. catchUpMessages cannot heal it
        // either — it only APPENDS rows it does not already know, never
        // rewrites one, so a reconnect or foreground return changes nothing.
        // getMessages already nulls these server-side (the reply LEFT JOIN is
        // gated on is_deleted = FALSE); this is the live path catching up.
        .map(m => (m.reply_to && String(m.reply_to.id) === String(id)
          ? { ...m, reply_to: null }
          : m)));
    };
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('receive_message', handleReceiveMessage);
    socket.on('connect', handleReconnect);
    socket.on('removed_from_group', handleRemoved);

    return () => {
      socket.emit('leave_room', groupId);
      socket.off('message_deleted', handleMessageDeleted);
    socket.off('receive_message', handleReceiveMessage);
      socket.off('connect', handleReconnect);
      socket.off('removed_from_group', handleRemoved);
    };
  }, [socket, groupId, catchUpMessages]);

  // Foreground return with the socket still (apparently) alive: the WebView
  // may have been frozen with events dropped before the client notices the
  // dead connection — refetch immediately instead of waiting for ping timeout.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') catchUpMessages();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [catchUpMessages]);

  useEffect(() => {
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return; }
    scrollToBottom();
  }, [messageList]);

  const loadEarlier = async () => {
    if (!hasMore || loadingMore || messageList.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestId = messageList[0].id;
      const response = await messages.get(groupId, { before: oldestId });
      const data = response.data;
      const older = Array.isArray(data) ? data : (data?.messages ?? []);
      skipAutoScrollRef.current = true; // prepend shouldn't trigger scroll-to-bottom
      setMessageList(prev => [...older, ...prev]);
      setHasMore(Array.isArray(data) ? false : (data?.has_more ?? false));
    } catch (error) {
      toast.error(t('chat.page.toast.loadEarlierError'));
    } finally {
      setLoadingMore(false);
    }
  };

  const isSendingRef = useRef(false);

  // One send path for text and voice. `voice` is { url, durationMs } when the
  // composer finished a recording; the row then carries the URL as its content
  // and message_type='voice', which is what the bubble switches on.
  const handleSendMessage = async (e, voice = null, photo = null) => {
    e?.preventDefault?.();
    const media = voice || photo;
    const sentContent = media ? media.url : content.trim();
    if (!sentContent || !canSendMessages || isSendingRef.current) return;

    // Optimistic send (mirrors DirectMessagePage): render the SENDER's own
    // bubble immediately, but broadcast to the rest of the room only AFTER the
    // HTTP persist succeeds. The `send_message` socket handler re-checks
    // membership + chat_only_owner but runs NO text moderation (that lives on
    // the HTTP path — messageController.checkTextSafety), so emitting in
    // parallel broadcast banned/unmoderated content to everyone in the room
    // live even when the message was about to be rejected. Sender keeps the
    // instant bubble; other members see it ~1 DB round-trip later, moderated.
    isSendingRef.current = true;
    if (!media) setContent('');
    // The quote is consumed by this send; clearing it up front means a slow
    // network cannot leave it attached to the NEXT message too.
    const quoted = replyTo;
    setReplyTo(null);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
      id: tempId,
      user_id: user.id,
      user_name: user.name,
      avatar_url: user.avatar_url,
      content: sentContent,
      // Match the server row shape: the payload lives in media_url, so the
      // bubble reads the same field before and after the 201 swaps it in.
      media_url: media ? sentContent : null,
      message_type: voice ? 'voice' : photo ? 'image' : 'text',
      duration_ms: voice ? voice.durationMs : null,
      reply_to: quoted
        ? { id: quoted.id, content: quoted.content, message_type: quoted.message_type, user_name: quoted.user_name }
        : null,
      created_at: new Date().toISOString(),
      _pending: true,
    };

    setMessageList(prev => [...prev, optimistic]);

    try {
      const response = await messages.send(groupId, sentContent, {
        replyToId: quoted?.id,
        ...(voice ? { messageType: 'voice', durationMs: voice.durationMs } : {}),
        ...(photo ? { messageType: 'image' } : {}),
      });
      const real = {
        ...response.data,
        user_name: user.name,
        avatar_url: user.avatar_url,
        user_id: user.id,
      };
      // If a concurrent catch-up fetch already delivered the persisted row,
      // drop the temp bubble instead of swapping (avoids a duplicate id).
      setMessageList(prev => prev.some(m => m.id === real.id)
        ? prev.filter(m => m.id !== tempId)
        : prev.map(m => (m.id === tempId ? real : m)));
      // Delivery to other members happens SERVER-SIDE now: the HTTP persist
      // path (messageController) broadcasts the moderated, server-authoritative
      // row to the room. The old client `send_message` emit re-broadcast
      // unmoderated, name-spoofable content and has been removed.
    } catch (error) {
      if (error.response?.data?.isOwnerOnly) {
        // Permission revoked between page-load and send — pull the bubble.
        setMessageList(prev => prev.filter(m => m.id !== tempId));
        setCanSendMessages(false);
        setPermissionMessage(t('chat.page.permissionOwnerOnly'));
        if (!media) setContent(sentContent);
      } else {
        // Persist failed (rate limit, server error, moderation 422). Keep the
        // bubble visible but mark it failed. Other members never saw it (the
        // socket broadcast now fires only after a successful persist).
        setMessageList(prev =>
          prev.map(m => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
        );
        toast.error(t('chat.page.toast.sendError'));
      }
    } finally {
      isSendingRef.current = false;
    }
  };

  // Bell in the header: mute/unmute this group's push notifications. Optimistic
  // flip with rollback on failure.
  const handleToggleMute = async () => {
    if (muteBusy) return;
    const next = !muted;
    setMuted(next);
    setMuteBusy(true);
    try {
      await groups.setNotifications(groupId, next);
      toast.info(next ? t('chat.page.mute.muted') : t('chat.page.mute.unmuted'));
    } catch {
      setMuted(!next);
      toast.error(t('chat.page.mute.error'));
    } finally {
      setMuteBusy(false);
    }
  };

  if (loading) return <div className="chat-page"><div className="loading">{t('chat.page.loading')}</div></div>;
  if (!group) return <div className="chat-page"><div className="loading">{t('chat.page.notFound')}</div></div>;

  return (
    <div className="chat-page" ref={chatPageRef}>
      {/* Header */}
      <div className="chat-page-header">
        <button className="back-button" onClick={goBackToList}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="chat-page-info" onClick={() => navigate(`/group/${groupId}`)} style={{ cursor: 'pointer', flex: 1 }}>
          <div className="chat-page-name">{group.name || group.title}</div>
          <div className="chat-page-status">
            {group.member_count || group.members_count || 0} {t('chat.page.members')}
            {group.type === 'club' && t('chat.page.clubSuffix')}
          </div>
          {/* Event info (date · place) so you can tell WHICH activity's chat you're
              in when you're in several groups (Tina 2026-07-27). Clubs have no
              single date, so this only shows for events. */}
          {group.type !== 'club' && (group.date || group.location) && (
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {group.date && new Date(group.date).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
              {group.date && group.location && ' · '}
              {group.location}
            </div>
          )}
        </div>
        {/* Per-group notification bell — mute/unmute push for this chat */}
        <button
          type="button"
          className={`chat-page-bell${muted ? ' muted' : ''}`}
          onClick={handleToggleMute}
          disabled={muteBusy}
          aria-pressed={muted}
          aria-label={muted ? t('chat.page.mute.unmuteAria') : t('chat.page.mute.muteAria')}
          title={muted ? t('chat.page.mute.unmuteAria') : t('chat.page.mute.muteAria')}
        >
          {muted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
              <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
              <path d="M18 8a6 6 0 0 0-9.33-5"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          )}
        </button>
        {group.image_url && (
          <img src={group.image_url} alt={group.name || group.title} className="chat-page-avatar" onClick={() => navigate(`/group/${groupId}`)} style={{ cursor: 'pointer' }} decoding="async" fetchPriority="high" />
        )}
      </div>

      {/* Reconnection Banner — only after 3s sustained disconnect */}
      {showReconnectBanner && (
        <div className="reconnect-banner">
          {t('chat.shared.reconnectBanner')}
        </div>
      )}

      {/* Permission Banner */}
      {!canSendMessages && (
        <div className="permission-banner">
          ⚠️ {permissionMessage}
        </div>
      )}

      {/* Messages */}
      <div className="messages-container">
        {hasMore && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <button
              className="load-earlier-btn"
              onClick={loadEarlier}
              disabled={loadingMore}
            >
              {loadingMore ? t('chat.page.loadingShort') : t('chat.page.loadEarlier')}
            </button>
          </div>
        )}
        {(() => {
          const list = Array.isArray(messageList) ? messageList : [];
          return list.map((msg, index) => {
            // Insert a WhatsApp-style day separator whenever the calendar day
            // changes, so it's clear whether a message is from today, yesterday
            // or longer ago.
            const prev = list[index - 1];
            const showDay = msg.created_at && (!prev || dayKey(prev.created_at) !== dayKey(msg.created_at));
            const daySep = showDay ? (
              <div className="message-day-sep"><span>{daySeparatorLabel(msg.created_at, dateLocale, t)}</span></div>
            ) : null;

            // System messages (welcome, join announcements) render as a centered
            // pill instead of a sender bubble. Backend marks them with
            // message_type='system' and a null user_id.
            if (msg.message_type === 'system') {
              return (
                <Fragment key={msg.id || index}>
                  {daySep}
                  <div className="message-system">{msg.content}</div>
                </Fragment>
              );
            }
            return (
              <Fragment key={msg.id || index}>
                {daySep}
                <div
                  id={`msg-${msg.id}`}
                  className={`message ${msg.user_id === user?.id ? 'sent' : 'received'}${msg._pending ? ' message--pending' : ''}${msg._failed ? ' message--failed' : ''}`}
                  {...(msg.id && !msg._pending ? pressHandlers(msg) : {})}
                >
                  {msg.user_id !== user?.id && (
                    <div className="message-sender">{msg.user_name}</div>
                  )}
                  {msg.reply_to && (
                    <MessageQuote
                      quote={msg.reply_to}
                      onJump={() => jumpToMessage(msg.reply_to.id)}
                    />
                  )}
                  {msg.message_type === 'voice' ? (
                    <VoiceMessage
                      url={mediaUrl(msg)}
                      durationMs={msg.duration_ms}
                      mine={msg.user_id === user?.id}
                    />
                  ) : msg.message_type === 'image' ? (
                    <ImageMessage
                      url={mediaUrl(msg)}
                      mine={msg.user_id === user?.id}
                      onOpen={setLightbox}
                    />
                  ) : (
                    <div className="message-content">{msg.content}</div>
                  )}
                  <div className="message-time">
                    {msg._failed
                      ? t('chat.dm.notSent')
                      : new Date(msg.created_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </Fragment>
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input — shared with DirectMessagePage (voice + reply quote). */}
      <ChatComposer
        value={content}
        onChange={setContent}
        onSend={handleSendMessage}
        onSendVoice={handleSendVoice}
        onSendPhoto={handleSendPhoto}
        disabled={!canSendMessages}
        placeholder={canSendMessages ? t('chat.page.input.placeholder') : t('chat.page.input.placeholderOwnerOnly')}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />

      {/* Message action sheet (long-press). Deliberately a plain sheet rather
          than an inline hover menu: the chat is used on phones, where there is
          no hover, and an always-visible icon on every bubble is noise. */}
      {actionMsg && (
        <div
          className="msg-sheet-backdrop"
          onClick={() => setActionMsg(null)}
          role="presentation"
        >
          <div className="msg-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="msg-sheet-preview">
              {actionMsg.message_type === 'voice' ? t('chat.voice.label')
                : actionMsg.message_type === 'image' ? t('chat.photo.label')
                : actionMsg.content}
            </div>
            {/* A message that never persisted has a client-side `temp-…` id, so
                every server action on it is broken: replying posts
                reply_to_id="temp-…", which parseInt turns into NaN and the
                backend silently drops — the composer shows a quote bar and the
                message sends with no quote — and deleting raises Postgres
                22P02 and comes back as a 500. The only honest action on a
                failed bubble is to clear it locally. */}
            {actionMsg._failed ? (
              <button
                className="msg-sheet-btn msg-sheet-btn--danger"
                onClick={() => {
                  setMessageList(prev => prev.filter(m => m.id !== actionMsg.id));
                  setActionMsg(null);
                }}
              >
                {t('chat.page.message.discardFailed')}
              </button>
            ) : (
              <>
                <button
                  className="msg-sheet-btn"
                  onClick={() => { setReplyTo(actionMsg); setActionMsg(null); }}
                >
                  {t('chat.reply.action')}
                </button>
                {actionMsg.user_id !== user?.id && (
                  <button
                    className="msg-sheet-btn msg-sheet-btn--danger"
                    onClick={() => { setReportMsg(actionMsg); setActionMsg(null); }}
                  >
                    {t('chat.page.message.report')}
                  </button>
                )}
                {(actionMsg.user_id === user?.id || group?.owner_id === user?.id || user?.is_admin) && (
                  <button
                    className="msg-sheet-btn msg-sheet-btn--danger"
                    onClick={() => handleDeleteMessage(actionMsg)}
                  >
                    {t('chat.page.message.delete')}
                  </button>
                )}
              </>
            )}
            <button className="msg-sheet-btn" onClick={() => setActionMsg(null)}>
              {t('chat.page.message.cancel')}
            </button>
          </div>
        </div>
      )}

      {lightbox && (
        <PhotoLightbox photos={[lightbox]} index={0} onIndex={() => {}} onClose={() => setLightbox(null)} />
      )}

      {reportMsg && (
        <ReportModal
          type="message"
          id={reportMsg.id}
          name={reportMsg.user_name}
          onClose={() => setReportMsg(null)}
        />
      )}
    </div>
  );
};
export default ChatPage;
