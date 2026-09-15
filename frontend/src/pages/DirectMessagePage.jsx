import { useState, useEffect, useContext, useRef, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { directMessages, users, upload } from '../utils/api';
import { ChatComposer } from '../components/ChatComposer';
import { VoiceMessage } from '../components/VoiceMessage';
import { ImageMessage } from '../components/ImageMessage';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { MessageQuote } from '../components/MessageQuote';
import { mediaUrl } from '../utils/chatMedia';
import { MessageTicks, tickState } from '../components/MessageTicks';
import { ReportModal } from '../components/ReportModal';
import { serverErrorMessage } from '../utils/apiError';
import { downscaleImageFile } from '../utils/images';
import { useToast } from '../context/ToastContext';
import { dayKey, daySeparatorLabel } from '../utils/chatDate';
import { useChatViewport } from '../hooks/useChatViewport';
import useSwipeBack from '../hooks/useSwipeBack';
import '../styles/chat.css';

export const DirectMessagePage = () => {
  const { userId: otherUserId } = useParams();
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useContext(SocketContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-DE');

  const [messagesList, setMessagesList] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Track the *type* of error separately so the UI can branch without
  // string-matching the localized message (which would break in English).
  const [errorIsFriendship, setErrorIsFriendship] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  // Long-press → reply / report, same as the group chat. DMs had no message
  // actions at all before 2026-09-15.
  const [actionMsg, setActionMsg] = useState(null);
  const [reportMsg, setReportMsg] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  // Read watermark from the live `dm_read` event. Per-message `is_read` already
  // arrives with the rows; this heals bubbles the append-only catch-up merge
  // can never rewrite, and makes the tick flip instantly instead of on the next
  // refetch.
  const [readThrough, setReadThrough] = useState(null);
  const longPressTimer = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const chatPageRef = useRef(null);
  // active only once the real chat surface (which carries the ref) is mounted —
  // during loading/error the ref is null and the hook must wait.
  useChatViewport(chatPageRef, !loading && !error);
  // Swipe right / back arrow → the chat list on the FREUNDE tab (a DM is always
  // a friend chat). Was '/chats', which opened the default Gruppen tab.
  useSwipeBack(chatPageRef, () => navigate('/chats?filter=freunde'), !loading && !error);

  // Composer auto-grow moved into components/ChatComposer.jsx along with the
  // input itself, so the group chat and DMs cannot drift apart again.
  // Catch-up: pull the conversation again and merge anything missing — after a
  // socket reconnect and on returning to the foreground, messages sent while
  // the WebView was frozen never arrive via receive_dm (same gap ChatPage had).
  const catchUpDm = async () => {
    try {
      const res = await directMessages.getConversation(otherUserId);
      const msgs = res.data || [];
      if (!msgs.length) return;
      setMessagesList(prev => {
        if (!prev.length) return msgs;
        const known = new Set(prev.map(m => m.id));
        const fresh = msgs.filter(m => !known.has(m.id));
        const overlap = msgs.some(m => known.has(m.id));
        if (!overlap && fresh.length) return [...msgs, ...prev.filter(m => m._pending)];
        // Patch the receipt fields of rows we ALREADY hold before appending.
        // The merge used to append unknown ids and return early when there were
        // none — so a refetch whose only news was "this has now been delivered"
        // threw that news away, and the zugestellt tick could never appear while
        // the thread stayed open.
        const byId = new Map(msgs.map(m => [m.id, m]));
        const patched = prev.map(m => {
          const s = byId.get(m.id);
          if (!s) return m;
          if (s.is_read === m.is_read && s.delivered_at === m.delivered_at) return m;
          return { ...m, is_read: s.is_read, delivered_at: s.delivered_at };
        });
        return fresh.length ? [...patched, ...fresh] : patched;
      });
      markAsRead();
    } catch { /* next tick retries */ }
  };

  useEffect(() => {
    if (!user || !otherUserId) return;

    loadOtherUser();
    loadMessages();
    markAsRead();

    if (!socket) return;

    // Join DM room
    socket.emit('join_dm_room', { userId: user.id, otherUserId: parseInt(otherUserId) });

    // Reconnects create a NEW server-side connection with no room memberships —
    // re-join and back-fill, or the conversation silently stops updating.
    const handleReconnect = () => {
      socket.emit('join_dm_room', { userId: user.id, otherUserId: parseInt(otherUserId) });
      catchUpDm();
    };

    // An admin took this message down (DELETE /api/dm/message/:id) — drop it
    // live, and null out any quote of it, or the removed text stays on screen
    // inside every reply's quote bar until the page unmounts.
    const handleDmDeleted = ({ id }) => {
      setMessagesList(prev => prev
        .filter(m => String(m.id) !== String(id))
        .map(m => (m.reply_to && String(m.reply_to.id) === String(id)
          ? { ...m, reply_to: null }
          : m)));
    };

    // The other side opened the thread — flip our ticks to blue now.
    const handleDmRead = (data) => {
      if (Number(data?.senderId) !== Number(user.id)) return;   // not our messages
      setReadThrough(prev => {
        const next = data?.readThrough || null;
        if (!next) return prev;
        return !prev || new Date(next) > new Date(prev) ? next : prev;
      });
    };

    // Listen for incoming messages
    socket.on('receive_dm', handleReceiveDM);
    socket.on('dm_read', handleDmRead);
    socket.on('dm_deleted', handleDmDeleted);
    socket.on('dm_user_typing', () => setIsTyping(true));
    socket.on('dm_user_stop_typing', () => setIsTyping(false));
    socket.on('connect', handleReconnect);

    return () => {
      socket.emit('leave_dm_room', { userId: user.id, otherUserId: parseInt(otherUserId) });
      socket.off('receive_dm', handleReceiveDM);
      socket.off('dm_read', handleDmRead);
      socket.off('dm_deleted', handleDmDeleted);
      socket.off('dm_user_typing');
      socket.off('dm_user_stop_typing');
      socket.off('connect', handleReconnect);
    };
    // Key on user?.id, NOT the whole `user` object: AuthContext replaces the
    // user object identity on every background profile refresh, which otherwise
    // re-ran this effect — leaving/rejoining the DM room and reloading the whole
    // message list, silently dropping an in-flight optimistic bubble.
  }, [user?.id, socket, otherUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foreground return: refetch immediately — the socket may not have noticed
  // the dead connection yet (ping timeout), but the user is looking NOW.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') catchUpDm();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [otherUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollToBottom();
  }, [messagesList]);

  const loadOtherUser = async () => {
    try {
      const res = await users.getById(otherUserId);
      setOtherUser(res.data);
    } catch (err) {
    }
  };

  const loadMessages = async () => {
    try {
      const res = await directMessages.getConversation(otherUserId);
      setMessagesList(res.data || []);
      setLoading(false);
    } catch (err) {
      // Log the full backend payload to the console so we can read the actual
      // server-side cause (Postgres error code, missing table, etc.) instead
      // of staring at a generic "could not load conversation" toast.
      console.error('[dm] getConversation failed:', {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
      });
      if (err.response?.data?.requiresFriendship) {
        setError(t('chat.dm.errorNotFriends'));
        setErrorIsFriendship(true);
      } else {
        // Prefer the backend's specific error string when present — the user
        // (and we) can then tell whether it's a network blip, missing table,
        // moderation rejection, etc.
        const backendMsg = err.response?.data?.error;
        setError(backendMsg || t('chat.dm.errorLoad'));
        setErrorIsFriendship(false);
      }
      setLoading(false);
    }
  };

  const markAsRead = async () => {
    try {
      await directMessages.markRead(otherUserId);
    } catch (err) {
      // silent
    }
  };

  const handleReceiveDM = (data) => {
    // Skip messages sent by the current user — they're already added optimistically
    if (data.message && data.senderId !== user.id) {
      // Dedup by id in case a catch-up refetch already appended this row.
      setMessagesList(prev =>
        (data.message.id != null && prev.some(m => m.id === data.message.id))
          ? prev
          : [...prev, data.message]
      );
      markAsRead();
    }
  };

  const handleSendMessage = async (e, voice = null, photo = null) => {
    e?.preventDefault?.();
    const media = voice || photo;
    const content = media ? media.url : newMessage.trim();
    if (!content) return;

    // Optimistic send: render the SENDER's own bubble immediately, but deliver
    // to the recipient over the socket only AFTER the HTTP persist succeeds.
    // The `send_dm` socket handler runs NO text moderation (that lives on the
    // HTTP path — dmController.checkTextSafety), so emitting in parallel
    // delivered banned/unmoderated content to the recipient live even when the
    // message was about to be rejected. The sender still gets an instant
    // bubble; the recipient sees it ~1 DB round-trip later, and only if it
    // passed moderation.
    const receiverIdInt = parseInt(otherUserId, 10);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
      id: tempId,
      sender_id: user.id,
      receiver_id: receiverIdInt,
      content,
      // Match the server row shape — see ChatPage.
      media_url: media ? content : null,
      message_type: voice ? 'voice' : photo ? 'image' : 'text',
      duration_ms: voice ? voice.durationMs : null,
      reply_to: replyTo
        ? { id: replyTo.id, content: replyTo.content, message_type: replyTo.message_type, user_name: replyTo.sender_name }
        : null,
      created_at: new Date().toISOString(),
      sender_name: user.name,
      sender_avatar: user.avatar_url,
      _pending: true,
    };

    // Consumed by THIS send — a slow network must not leave the quote attached
    // to the next message too.
    const quoted = replyTo;
    setReplyTo(null);
    setMessagesList(prev => [...prev, optimistic]);
    if (!media) setNewMessage('');
    stopTyping();

    // Persist FIRST, then deliver. Reconcile the sender's optimistic bubble
    // with the persisted row, and only THEN emit to the recipient — so the
    // recipient never receives a message that moderation rejected.
    try {
      const res = await directMessages.send(receiverIdInt, content, {
        replyToId: quoted?.id,
        ...(voice ? { messageType: 'voice', durationMs: voice.durationMs } : {}),
        ...(photo ? { messageType: 'image' } : {}),
      });
      const real = {
        ...res.data,
        sender_name: user.name,
        sender_avatar: user.avatar_url,
      };
      // If a concurrent catch-up fetch already delivered the persisted row,
      // drop the temp bubble instead of swapping (avoids a duplicate id).
      setMessagesList(prev => prev.some(m => m.id === real.id)
        ? prev.filter(m => m.id !== tempId)
        : prev.map(m => (m.id === tempId ? real : m)));
      // Delivery to the recipient happens SERVER-SIDE now: the HTTP persist path
      // (dmController.sendDM) broadcasts the moderated row to the DM room. The
      // old client `send_dm` emit re-broadcast unmoderated content and is gone.
    } catch (err) {
      if (err.response?.data?.requiresFriendship) {
        // Friendship dropped between page-load and send. Pull the
        // optimistic bubble back so the chat doesn't appear to have sent
        // a message that never persisted.
        setMessagesList(prev => prev.filter(m => m.id !== tempId));
        setError(t('chat.dm.errorNotFriends'));
        setErrorIsFriendship(true);
      } else {
        // Persist failed (rate limit, server error, moderation 422, etc.) —
        // keep the bubble visible but mark it failed so the sender knows it
        // didn't go through. The recipient never received it (socket emit now
        // happens only after a successful persist), so nothing to retract.
        setMessagesList(prev =>
          prev.map(m => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
        );
        toast.error(t('chat.dm.errorSend'));
      }
    }
  };

  const handleSendVoice = async ({ blob, mimeType, durationMs }) => {
    try {
      const res = await upload.voice(blob, durationMs, mimeType);
      await handleSendMessage(null, { url: res.data.url, durationMs: res.data.duration_ms ?? durationMs });
    } catch (err) {
      toast.error(serverErrorMessage(err, t, 'chat.voice.uploadFailed'));
    }
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

  // Long-press opens the action sheet; cancelled on move/end so scrolling the
  // thread never triggers it.
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

  const jumpToMessage = (id) => {
    const el = document.getElementById(`dm-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('message--flash');
    setTimeout(() => el.classList.remove('message--flash'), 1200);
  };

  const handleTyping = () => {
    if (!socket) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Throttled to one emit per 2 s. This fires from the textarea's onChange,
    // i.e. once per KEYSTROKE — a fast typist produced ~35 socket events per
    // 10 s, which is pure waste on a mobile connection and was enough to trip
    // the server's per-socket event budget. The 3 s idle timer below is what
    // actually ends the indicator, so a lower emit rate changes nothing the
    // other person sees.
    const now = Date.now();
    if (now - lastTypingEmitRef.current > 2000) {
      lastTypingEmitRef.current = now;
      socket.emit('dm_typing', { senderId: user.id, receiverId: parseInt(otherUserId) });
    }

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  };

  const stopTyping = () => {
    lastTypingEmitRef.current = 0;   // the next keystroke starts a fresh indicator
    if (!socket) return;
    socket.emit('dm_stop_typing', { senderId: user.id, receiverId: parseInt(otherUserId) });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="chat-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div className="loading">{t('chat.dm.loading')}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-page">
        <header className="chat-page-header">
          <button className="back-button" onClick={() => navigate('/chats?filter=freunde')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="chat-page-info">
            <h2 className="chat-page-name">{otherUser?.name || t('chat.dm.chatFallback')}</h2>
          </div>
        </header>
        <div className="error-state">
          <p>{error}</p>
          {errorIsFriendship ? (
            <button className="btn btn-primary" onClick={() => navigate(`/user/${otherUserId}`)} style={{ marginTop: '12px' }}>
              {t('chat.dm.addFriend')}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate('/chats?filter=freunde')} style={{ marginTop: '12px' }}>
              {t('chat.dm.backToChats')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page" ref={chatPageRef}>
      <header className="chat-page-header">
        <button className="back-button" onClick={() => navigate('/chats?filter=freunde')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="chat-page-info" onClick={() => navigate(`/user/${otherUserId}`)}>
          <h2 className="chat-page-name">{otherUser?.name || t('chat.dm.chatFallback')}</h2>
          <span className="chat-page-status">{t('chat.dm.profileHint')}</span>
        </div>
        {otherUser?.avatar_url ? (
          <img
            src={otherUser.avatar_url}
            alt={otherUser.name}
            className="chat-page-avatar"
            onClick={() => navigate(`/user/${otherUserId}`)}
          />
        ) : (
          <div
            className="chat-avatar-placeholder"
            style={{ width: '44px', height: '44px', fontSize: '18px', cursor: 'pointer' }}
            onClick={() => navigate(`/user/${otherUserId}`)}
          >
            {(otherUser?.name || '?')[0].toUpperCase()}
          </div>
        )}
      </header>

      {/* Reconnection Banner */}
      {!isConnected && (
        <div className="reconnect-banner">
          {t('chat.shared.reconnectBanner')}
        </div>
      )}

      <div className="messages-container">
        {messagesList.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <p>{t('chat.dm.empty')}</p>
            <p style={{ fontSize: '13px', marginTop: '8px' }}>{t('chat.dm.emptyHint')}</p>
          </div>
        )}
        {messagesList.map((msg, index) => {
          const prev = messagesList[index - 1];
          const showDay = msg.created_at && (!prev || dayKey(prev.created_at) !== dayKey(msg.created_at));
          return (
            <Fragment key={msg.id}>
              {showDay && <div className="message-day-sep"><span>{daySeparatorLabel(msg.created_at, dateLocale, t)}</span></div>}
              <div
                id={`dm-${msg.id}`}
                className={`message ${msg.sender_id === user.id ? 'sent' : 'received'}${msg._pending ? ' message--pending' : ''}${msg._failed ? ' message--failed' : ''}`}
                {...(msg.id && !msg._pending ? pressHandlers(msg) : {})}
              >
                {msg.reply_to && (
                  <MessageQuote quote={msg.reply_to} onJump={() => jumpToMessage(msg.reply_to.id)} />
                )}
                {msg.message_type === 'voice' ? (
                  <VoiceMessage url={mediaUrl(msg)} durationMs={msg.duration_ms} mine={msg.sender_id === user.id} />
                ) : msg.message_type === 'image' ? (
                  <ImageMessage url={mediaUrl(msg)} mine={msg.sender_id === user.id} onOpen={setLightbox} />
                ) : (
                  <div className="message-content">{msg.content}</div>
                )}
                <div className="message-time">
                  {msg._failed
                    ? t('chat.dm.notSent')
                    : new Date(msg.created_at).toLocaleTimeString(dateLocale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                  <MessageTicks state={tickState(msg, {
                    mine: msg.sender_id === user.id,
                    readThrough,
                  })} />
                </div>
              </div>
            </Fragment>
          );
        })}
        {isTyping && (
          <div className="typing-indicator">
            <span>{t('chat.dm.typingFmt', { name: otherUser?.name || '' })}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatComposer
        value={newMessage}
        onChange={(v) => { setNewMessage(v); handleTyping(); }}
        onSend={handleSendMessage}
        onSendVoice={handleSendVoice}
        onSendPhoto={handleSendPhoto}
        placeholder={t('chat.dm.inputPlaceholder')}
        replyTo={replyTo && { ...replyTo, user_name: replyTo.sender_name }}
        onCancelReply={() => setReplyTo(null)}
      />

      {actionMsg && (
        <div className="msg-sheet-backdrop" onClick={() => setActionMsg(null)} role="presentation">
          <div className="msg-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="msg-sheet-preview">
              {actionMsg.message_type === 'voice' ? t('chat.voice.label')
                : actionMsg.message_type === 'image' ? t('chat.photo.label')
                : actionMsg.content}
            </div>
            {/* A failed send carries a client-side `temp-…` id — see ChatPage.
                Replying to it would post a reply_to_id the backend drops, so
                clearing it locally is the only action that does what it says. */}
            {actionMsg._failed ? (
              <button
                className="msg-sheet-btn msg-sheet-btn--danger"
                onClick={() => {
                  setMessagesList(prev => prev.filter(m => m.id !== actionMsg.id));
                  setActionMsg(null);
                }}
              >
                {t('chat.page.message.discardFailed')}
              </button>
            ) : (
              <>
                <button className="msg-sheet-btn" onClick={() => { setReplyTo(actionMsg); setActionMsg(null); }}>
                  {t('chat.reply.action')}
                </button>
                {actionMsg.sender_id !== user?.id && (
                  <button
                    className="msg-sheet-btn msg-sheet-btn--danger"
                    onClick={() => { setReportMsg(actionMsg); setActionMsg(null); }}
                  >
                    {t('chat.page.message.report')}
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
          // "dm", NOT "message": this id comes from `direct_messages`, whose
          // ids collide with `messages` ids one-for-one.
          type="dm"
          id={reportMsg.id}
          name={reportMsg.sender_name}
          onClose={() => setReportMsg(null)}
        />
      )}
    </div>
  );
};

export default DirectMessagePage;
