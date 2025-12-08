import React, { useState, useEffect, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { groups, messages } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import '../styles/chat.css';

export const ChatPage = () => {
  const { groupId } = useParams();
  const [group, setGroup] = useState(null);
  const [messageList, setMessageList] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const { user } = useContext(AuthContext);

  useEffect(() => {
    loadGroup();
    loadMessages();
    const interval = setInterval(loadMessages, 2000);
    return () => clearInterval(interval);
  }, [groupId]);

  const loadGroup = async () => {
    try {
      const response = await groups.getById(groupId);
      setGroup(response.data);
    } catch (error) {
      console.error('Error loading group:', error);
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

    try {
      await messages.send(groupId, content);
      setContent('');
      loadMessages();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="error">Group not found</div>;

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h2>{group.title}</h2>
        <p>{group.member_count} members</p>
      </div>

      <div className="messages">
        {messageList.map(msg => (
          <div key={msg.id} className={`message ${msg.user_id === user?.id ? 'own' : ''}`}>
            <div className="message-header">
              <strong>{msg.user_name}</strong>
              <span className="time">{new Date(msg.created_at).toLocaleTimeString()}</span>
            </div>
            <p className="message-content">{msg.content}</p>
          </div>
        ))}
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
