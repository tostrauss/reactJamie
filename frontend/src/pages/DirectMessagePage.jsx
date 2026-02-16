import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { directMessages } from '../utils/api';
import '../styles/chat.css';

export const DirectMessagePage = () => {
  const { userId: otherUserId } = useParams();
  const { user } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (!user || !socket || !otherUserId) return;

    loadMessages();
    markAsRead();

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
  }, [messages]);

  const loadMessages = async () => {
    try {
      const res = await directMessages.getConversation(otherUserId);
      setMessages(res.data);
      if (res.data.length > 0) {
        const firstMessage = res.data[0];
        const otherUserInfo = firstMessage.sender_id === user.id
          ? { name: firstMessage.receiver_name, avatar_url: firstMessage.receiver_avatar }
          : { name: firstMessage.sender_name, avatar_url: firstMessage.sender_avatar };
        setOtherUser(otherUserInfo);
      }
      setLoading(false);
    } catch (err) {
      console.error('Error loading messages:', err);
      if (err.response?.data?.requiresFriendship) {
        setError('You must be friends to send messages');
      } else {
        setError('Failed to load conversation');
      }
      setLoading(false);
    }
  };

  const markAsRead = async () => {
    try {
      await directMessages.markRead(otherUserId);
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const handleReceiveDM = (data) => {
    if (data.message) {
      setMessages(prev => [...prev, data.message]);
      markAsRead();
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      const res = await directMessages.send(otherUserId, newMessage);

      // Emit socket event for real-time delivery
      socket.emit('send_dm', {
        senderId: user.id,
        receiverId: parseInt(otherUserId),
        message: {
          ...res.data,
          sender_name: user.name,
          sender_avatar: user.avatar_url
        }
      });

      setNewMessage('');
      stopTyping();
    } catch (err) {
      console.error('Error sending message:', err);
      if (err.response?.data?.requiresFriendship) {
        alert('You must be friends to send messages');
      } else {
        alert('Failed to send message');
      }
    }
  };

  const handleTyping = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    socket.emit('dm_typing', { senderId: user.id, receiverId: parseInt(otherUserId) });

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  };

  const stopTyping = () => {
    socket.emit('dm_stop_typing', { senderId: user.id, receiverId: parseInt(otherUserId) });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (loading) return <div className="chat-page"><div className="loading">Loading...</div></div>;
  if (error) {
    return (
      <div className="chat-page">
        <div className="error-state">
          <p>{error}</p>
          <button onClick={() => navigate('/chats')}>Back to Chats</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button className="back-btn" onClick={() => navigate('/chats')}>←</button>
        <div className="chat-info">
          {otherUser?.avatar_url && (
            <img src={otherUser.avatar_url} alt={otherUser.name} className="chat-avatar" />
          )}
          <h2>{otherUser?.name || 'Chat'}</h2>
        </div>
      </header>

      <div className="messages-container">
        {messages.map((msg) => (
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

      <form className="message-form" onSubmit={handleSendMessage}>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            handleTyping();
          }}
          placeholder="Nachricht schreiben..."
          className="message-input"
        />
        <button type="submit" className="send-btn" disabled={!newMessage.trim()}>
          Senden
        </button>
      </form>
    </div>
  );
};

export default DirectMessagePage;
