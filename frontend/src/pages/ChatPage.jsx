import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groups, messages } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
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

  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useContext(SocketContext);
  const toast = useToast();
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    loadGroup();
    loadMessages();
  }, [groupId]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('join_room', groupId);

    const handleReceiveMessage = (data) => {
      setMessageList((prev) => [...prev, data]);
      scrollToBottom();
    };

    socket.on('receive_message', handleReceiveMessage);

    return () => {
      socket.emit('leave_room', groupId);
      socket.off('receive_message', handleReceiveMessage);
    };
  }, [socket, groupId]);

  useEffect(() => {
    scrollToBottom();
  }, [messageList]);

  const loadGroup = async () => {
    try {
      const response = await groups.getById(groupId);
      setGroup(response.data);
      // Check club permissions
      if (response.data.type === 'club' && response.data.owner_id !== user?.id) {
        setCanSendMessages(false);
        setPermissionMessage('Nur der Club-Gründer kann Nachrichten senden');
      }
    } catch (error) {
      toast.error('Gruppe konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    try {
      const response = await messages.get(groupId);
      const data = response.data;
      const msgs = Array.isArray(data) ? data : (data?.messages ?? []);
      safeSetMessageList(msgs);
      setHasMore(Array.isArray(data) ? false : (data?.has_more ?? false));
    } catch (error) {
      toast.error('Nachrichten konnten nicht geladen werden');
    }
  };

  const loadEarlier = async () => {
    if (!hasMore || loadingMore || messageList.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestId = messageList[0].id;
      const response = await messages.get(groupId, { before: oldestId });
      const data = response.data;
      const older = Array.isArray(data) ? data : (data?.messages ?? []);
      setMessageList(prev => [...older, ...prev]);
      setHasMore(Array.isArray(data) ? false : (data?.has_more ?? false));
    } catch (error) {
      toast.error('Ältere Nachrichten konnten nicht geladen werden');
    } finally {
      setLoadingMore(false);
    }
  };

  const isSendingRef = useRef(false);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!content.trim() || !canSendMessages || isSendingRef.current) return;

    const sentContent = content;
    isSendingRef.current = true;
    setContent('');

    try {
      const response = await messages.send(groupId, sentContent);
      const msg = { ...response.data, user_name: user.name, avatar_url: user.avatar_url, user_id: user.id };

      // Add own message immediately — socket only broadcasts to others
      setMessageList(prev => [...prev, msg]);

      if (socket) {
        socket.emit('send_message', { ...msg, group_id: groupId, groupId });
      }
    } catch (error) {
      setContent(sentContent);
      toast.error('Nachricht konnte nicht gesendet werden');
      if (error.response?.data?.isOwnerOnly) {
        setCanSendMessages(false);
        setPermissionMessage('Nur der Club-Gründer kann Nachrichten senden');
      }
    } finally {
      isSendingRef.current = false;
    }
  };

  if (loading) return <div className="chat-page"><div className="loading">Laden...</div></div>;
  if (!group) return <div className="chat-page"><div className="loading">Gruppe nicht gefunden</div></div>;

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-page-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className="chat-page-info" onClick={() => navigate(`/group/${groupId}`)} style={{ cursor: 'pointer', flex: 1 }}>
          <div className="chat-page-name">{group.name || group.title}</div>
          <div className="chat-page-status">
            {group.member_count || group.members_count || 0} Mitglieder
            {group.type === 'club' && ' · Club'}
          </div>
        </div>
        {group.image_url && (
          <img src={group.image_url} alt={group.name || group.title} className="chat-page-avatar" onClick={() => navigate(`/group/${groupId}`)} style={{ cursor: 'pointer' }} />
        )}
      </div>

      {/* Reconnection Banner */}
      {!isConnected && (
        <div className="reconnect-banner">
          Verbindung unterbrochen – Wiederverbindung...
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
              {loadingMore ? 'Laden…' : 'Ältere Nachrichten laden'}
            </button>
          </div>
        )}
        {(Array.isArray(messageList) ? messageList : []).map((msg, index) => (
          <div key={msg.id || index} className={`message ${msg.user_id === user?.id ? 'sent' : 'received'}`}>
            {msg.user_id !== user?.id && (
              <div className="message-sender">{msg.user_name}</div>
            )}
            <div className="message-content">{msg.content}</div>
            <div className="message-time">
              {new Date(msg.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <form className="message-input-container" onSubmit={handleSendMessage}>
        <input
          type="text"
          placeholder={canSendMessages ? "Nachricht schreiben..." : "Nur der Gr\u00fcnder kann schreiben"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="message-input"
          disabled={!canSendMessages}
        />
        <button type="submit" className="send-button" disabled={!content.trim() || !canSendMessages}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </form>
    </div>
  );
};
export default ChatPage;
