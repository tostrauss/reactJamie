import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups, messages } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import '../styles/chat.css';

export const ChatPage = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [messageList, setMessageList] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  
  const { user } = useContext(AuthContext);
  const socket = useContext(SocketContext);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    loadGroup();
    loadMessages();
  }, [groupId]);

  // Realtime Socket Listeners
  useEffect(() => {
    if (!socket) return;

    socket.emit('join_room', groupId);

    socket.on('receive_message', (data) => {
      setMessageList((prev) => [...prev, data]);
      scrollToBottom();
    });

    return () => {
      socket.emit('leave_room', groupId);
      socket.off('receive_message');
    };
  }, [socket, groupId]);

  useEffect(() => {
    scrollToBottom();
  }, [messageList]);

  const loadGroup = async () => {
    try {
      const response = await groups.getById(groupId);
      setGroup(response.data);
    } catch (error) {
      console.error('Error loading group:', error);
      // Optional: Navigate back if group invalid
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    try {
      const response = await messages.get(groupId);
      setMessageList(response.data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;

    // 1. Optimistic UI Update (optional, but good for speed)
    // 2. Send to Backend to save in DB
    try {
      const response = await messages.send(groupId, content);
      
      // 3. Emit to Socket Room
      if (socket) {
        socket.emit('send_message', {
          ...response.data, // Contains id, content, created_at
          user_name: user.name, // Add sender info for display
          user_id: user.id
        });
      }
      
      setContent('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="error">Group not found</div>;

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button onClick={() => navigate(-1)} className="back-btn">←</button>
        <div className="header-info">
          <h2>{group.title}</h2>
          <p>{group.member_count} members</p>
        </div>
      </div>

      <div className="messages">
        {messageList.map((msg, index) => (
          <div key={msg.id || index} className={`message ${msg.user_id === user?.id ? 'own' : ''}`}>
            <div className="message-header">
              <strong>{msg.user_name}</strong>
              <span className="time">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="message-content">{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-form" onSubmit={handleSendMessage}>
        <input
          type="text"
          placeholder="Type a message..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
};