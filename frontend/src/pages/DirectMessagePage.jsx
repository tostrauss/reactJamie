import { useState, useEffect, useContext, useRef, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { directMessages, users } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { dayKey, daySeparatorLabel } from '../utils/chatDate';
import { useChatViewport } from '../hooks/useChatViewport';
import '../styles/chat.css';

export const DirectMessagePage = () => {
  const { userId: otherUserId } = useParams();
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useContext(SocketContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : 'de-DE';

  const [messagesList, setMessagesList] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Track the *type* of error separately so the UI can branch without
  // string-matching the localized message (which would break in English).
  const [errorIsFriendship, setErrorIsFriendship] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const chatPageRef = useRef(null);
  // active only once the real chat surface (which carries the ref) is mounted —
  // during loading/error the ref is null and the hook must wait.
  useChatViewport(chatPageRef, !loading && !error);

  // Grow the composer with its content (up to a cap).
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

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
        if (!fresh.length) return prev;
        const overlap = msgs.some(m => known.has(m.id));
        return overlap ? [...prev, ...fresh] : [...msgs, ...prev.filter(m => m._pending)];
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

    // Listen for incoming messages
    socket.on('receive_dm', handleReceiveDM);
    socket.on('dm_user_typing', () => setIsTyping(true));
    socket.on('dm_user_stop_typing', () => setIsTyping(false));
    socket.on('connect', handleReconnect);

    return () => {
      socket.emit('leave_dm_room', { userId: user.id, otherUserId: parseInt(otherUserId) });
      socket.off('receive_dm', handleReceiveDM);
      socket.off('dm_user_typing');
      socket.off('dm_user_stop_typing');
      socket.off('connect', handleReconnect);
    };
  }, [user, socket, otherUserId]);

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
      setMessagesList(prev => [...prev, data.message]);
      markAsRead();
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const content = newMessage.trim();
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
      created_at: new Date().toISOString(),
      sender_name: user.name,
      sender_avatar: user.avatar_url,
      _pending: true,
    };

    setMessagesList(prev => [...prev, optimistic]);
    setNewMessage('');
    if (inputRef.current) inputRef.current.style.height = 'auto'; // collapse composer
    stopTyping();

    // Persist FIRST, then deliver. Reconcile the sender's optimistic bubble
    // with the persisted row, and only THEN emit to the recipient — so the
    // recipient never receives a message that moderation rejected.
    try {
      const res = await directMessages.send(receiverIdInt, content);
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
      // Deliver to the recipient ONLY after moderation + persistence succeeded.
      if (socket) {
        socket.emit('send_dm', {
          senderId: user.id,
          receiverId: receiverIdInt,
          message: real,
        });
      }
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

  const handleTyping = () => {
    if (!socket) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    socket.emit('dm_typing', { senderId: user.id, receiverId: parseInt(otherUserId) });

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  };

  const stopTyping = () => {
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
          <button className="back-button" onClick={() => navigate('/chats')}>
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
            <button className="btn btn-primary" onClick={() => navigate('/chats')} style={{ marginTop: '12px' }}>
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
        <button className="back-button" onClick={() => navigate('/chats')}>
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
                className={`message ${msg.sender_id === user.id ? 'sent' : 'received'}${msg._pending ? ' message--pending' : ''}${msg._failed ? ' message--failed' : ''}`}
              >
                <div className="message-content">{msg.content}</div>
                <div className="message-time">
                  {msg._failed
                    ? t('chat.dm.notSent')
                    : new Date(msg.created_at).toLocaleTimeString(dateLocale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
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

      <div className="message-input-container">
        <textarea
          ref={inputRef}
          rows={1}
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            handleTyping();
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage(e);
            }
          }}
          placeholder={t('chat.dm.inputPlaceholder')}
          className="message-input"
        />
        <button
          className="send-button"
          onClick={handleSendMessage}
          disabled={!newMessage.trim()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22,2 15,22 11,13 2,9"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default DirectMessagePage;
