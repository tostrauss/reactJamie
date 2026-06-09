import { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { directMessages, users } from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/chat.css';

export const DirectMessagePage = () => {
  const { userId: otherUserId } = useParams();
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useContext(SocketContext);
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';

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

  useEffect(() => {
    if (!user || !otherUserId) return;

    loadOtherUser();
    loadMessages();
    markAsRead();

    if (!socket) return;

    // Join DM room
    socket.emit('join_dm_room', { userId: user.id, otherUserId: parseInt(otherUserId) });

    // Listen for incoming messages
    socket.on('receive_dm', handleReceiveDM);
    socket.on('dm_user_typing', () => setIsTyping(true));
    socket.on('dm_user_stop_typing', () => setIsTyping(false));

    return () => {
      socket.emit('leave_dm_room', { userId: user.id, otherUserId: parseInt(otherUserId) });
      socket.off('receive_dm', handleReceiveDM);
      socket.off('dm_user_typing');
      socket.off('dm_user_stop_typing');
    };
  }, [user, socket, otherUserId]);

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
    if (!newMessage.trim()) return;

    try {
      const res = await directMessages.send(parseInt(otherUserId), newMessage);

      // Add to local messages immediately
      const sentMessage = {
        ...res.data,
        sender_name: user.name,
        sender_avatar: user.avatar_url
      };
      setMessagesList(prev => [...prev, sentMessage]);

      // Emit socket event for real-time delivery
      if (socket) {
        socket.emit('send_dm', {
          senderId: user.id,
          receiverId: parseInt(otherUserId),
          message: sentMessage
        });
      }

      setNewMessage('');
      stopTyping();
    } catch (err) {
      if (err.response?.data?.requiresFriendship) {
        setError(t('chat.dm.errorNotFriends'));
        setErrorIsFriendship(true);
      } else {
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
    <div className="chat-page">
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
        {messagesList.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.sender_id === user.id ? 'sent' : 'received'}`}
          >
            <div className="message-content">{msg.content}</div>
            <div className="message-time">
              {new Date(msg.created_at).toLocaleTimeString(dateLocale, {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="typing-indicator">
            <span>{t('chat.dm.typingFmt', { name: otherUser?.name || '' })}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="message-input-container">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            handleTyping();
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
