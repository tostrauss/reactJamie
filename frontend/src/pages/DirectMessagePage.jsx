import { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { directMessages, users, subscription as subscriptionApi } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { ProModal } from '../components/ProModal';
import '../styles/chat.css';

export const DirectMessagePage = () => {
  const { userId: otherUserId } = useParams();
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useContext(SocketContext);
  const navigate = useNavigate();
  const toast = useToast();

  const [messagesList, setMessagesList] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isPro, setIsPro] = useState(null);
  const [showProModal, setShowProModal] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    subscriptionApi.getStatus().then(r => setIsPro(r.data.is_pro)).catch(() => setIsPro(false));
  }, []);

  useEffect(() => {
    if (!user || !otherUserId || isPro === null) return;

    if (!isPro) {
      setLoading(false);
      return;
    }

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
  }, [user, socket, otherUserId, isPro]);

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
      if (err.response?.data?.requiresFriendship) {
        setError('Ihr müsst befreundet sein, um Nachrichten zu senden');
      } else {
        setError('Konversation konnte nicht geladen werden');
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
        setError('Ihr müsst befreundet sein, um Nachrichten zu senden');
      } else {
        toast.error('Nachricht konnte nicht gesendet werden');
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

  if (loading || isPro === null) {
    return (
      <div className="chat-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div className="loading">Laden...</div>
        </div>
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="chat-page">
        <header className="chat-page-header">
          <button className="back-button" onClick={() => navigate('/chats')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="chat-page-info">
            <h2 className="chat-page-name">Direktnachrichten</h2>
          </div>
        </header>
        <div className="error-state">
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>👑</p>
          <p style={{ fontWeight: 700, marginBottom: '8px' }}>Pro erforderlich</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
            Direktnachrichten sind exklusiv für Pro-Mitglieder.
          </p>
          <button className="btn btn-primary" onClick={() => setShowProModal(true)}>
            Pro aktivieren
          </button>
        </div>
        {showProModal && (
          <ProModal
            onClose={() => setShowProModal(false)}
            onSuccess={() => setIsPro(true)}
          />
        )}
      </div>
    );
  }

  if (error) {
    const isFriendshipError = error.includes('befreundet');
    return (
      <div className="chat-page">
        <header className="chat-page-header">
          <button className="back-button" onClick={() => navigate('/chats')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="chat-page-info">
            <h2 className="chat-page-name">{otherUser?.name || 'Chat'}</h2>
          </div>
        </header>
        <div className="error-state">
          <p>{error}</p>
          {isFriendshipError ? (
            <button className="btn btn-primary" onClick={() => navigate(`/user/${otherUserId}`)} style={{ marginTop: '12px' }}>
              Freund hinzufügen
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate('/chats')} style={{ marginTop: '12px' }}>
              Zurück zu Chats
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
          <h2 className="chat-page-name">{otherUser?.name || 'Chat'}</h2>
          <span className="chat-page-status">Tippe für Profil</span>
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
          Verbindung unterbrochen – Wiederverbindung...
        </div>
      )}

      <div className="messages-container">
        {messagesList.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <p>Noch keine Nachrichten</p>
            <p style={{ fontSize: '13px', marginTop: '8px' }}>Sag Hallo!</p>
          </div>
        )}
        {messagesList.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.sender_id === user.id ? 'sent' : 'received'}`}
          >
            <div className="message-content">{msg.content}</div>
            <div className="message-time">
              {new Date(msg.created_at).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="typing-indicator">
            <span>{otherUser?.name} schreibt...</span>
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
          placeholder="Nachricht schreiben..."
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
