import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';
  const messagesEndRef = useRef(null);
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

  useEffect(() => {
    let cancelled = false;

    const fetchGroup = async () => {
      try {
        const response = await groups.getById(groupId);
        if (cancelled) return;
        setGroup(response.data);
        if (response.data.type === 'club' && response.data.chat_only_owner && response.data.owner_id !== user?.id) {
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

    return () => { cancelled = true; };
  }, [groupId]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('join_room', groupId);

    const handleReceiveMessage = (data) => {
      setMessageList((prev) => [...prev, data]);
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
      toast.error(t('chat.page.toast.loadEarlierError'));
    } finally {
      setLoadingMore(false);
    }
  };

  const isSendingRef = useRef(false);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const sentContent = content.trim();
    if (!sentContent || !canSendMessages || isSendingRef.current) return;

    // Optimistic send (mirrors DirectMessagePage): render the bubble + fire
    // the socket emit in parallel to the HTTP persist. Without this, the
    // sender's own bubble waits on the full HTTP roundtrip, and so does the
    // recipient's. Backend's `send_message` socket handler only broadcasts
    // (does NOT persist) and re-checks chat_only_owner, so emitting before
    // the HTTP completes is safe.
    isSendingRef.current = true;
    setContent('');

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = {
      id: tempId,
      user_id: user.id,
      user_name: user.name,
      avatar_url: user.avatar_url,
      content: sentContent,
      created_at: new Date().toISOString(),
      _pending: true,
    };

    setMessageList(prev => [...prev, optimistic]);

    if (socket) {
      socket.emit('send_message', { ...optimistic, group_id: groupId, groupId });
    }

    try {
      const response = await messages.send(groupId, sentContent);
      const real = {
        ...response.data,
        user_name: user.name,
        avatar_url: user.avatar_url,
        user_id: user.id,
      };
      setMessageList(prev => prev.map(m => (m.id === tempId ? real : m)));
    } catch (error) {
      if (error.response?.data?.isOwnerOnly) {
        // Permission revoked between page-load and send — pull the bubble.
        setMessageList(prev => prev.filter(m => m.id !== tempId));
        setCanSendMessages(false);
        setPermissionMessage('Nur der Club-Gründer kann Nachrichten senden');
        setContent(sentContent);
      } else {
        // Persist failed (rate limit, server error). Keep the bubble visible
        // but mark it failed — recipients may have already seen it via
        // socket; this is the same trade-off as DMs.
        setMessageList(prev =>
          prev.map(m => (m.id === tempId ? { ...m, _pending: false, _failed: true } : m))
        );
        toast.error(t('chat.page.toast.sendError'));
      }
    } finally {
      isSendingRef.current = false;
    }
  };

  if (loading) return <div className="chat-page"><div className="loading">{t('chat.page.loading')}</div></div>;
  if (!group) return <div className="chat-page"><div className="loading">{t('chat.page.notFound')}</div></div>;

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
            {group.member_count || group.members_count || 0} {t('chat.page.members')}
            {group.type === 'club' && t('chat.page.clubSuffix')}
          </div>
        </div>
        {group.image_url && (
          <img src={group.image_url} alt={group.name || group.title} className="chat-page-avatar" onClick={() => navigate(`/group/${groupId}`)} style={{ cursor: 'pointer' }} decoding="async" fetchpriority="high" />
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
        {(Array.isArray(messageList) ? messageList : []).map((msg, index) => {
          // System messages (welcome, join announcements) render as a centered
          // pill instead of a sender bubble. Backend marks them with
          // message_type='system' and a null user_id.
          if (msg.message_type === 'system') {
            return (
              <div key={msg.id || index} className="message-system">
                {msg.content}
              </div>
            );
          }
          return (
            <div
              key={msg.id || index}
              className={`message ${msg.user_id === user?.id ? 'sent' : 'received'}${msg._pending ? ' message--pending' : ''}${msg._failed ? ' message--failed' : ''}`}
            >
              {msg.user_id !== user?.id && (
                <div className="message-sender">{msg.user_name}</div>
              )}
              <div className="message-content">{msg.content}</div>
              <div className="message-time">
                {msg._failed
                  ? t('chat.dm.notSent')
                  : new Date(msg.created_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <form className="message-input-container" onSubmit={handleSendMessage}>
        <input
          type="text"
          placeholder={canSendMessages ? t('chat.page.input.placeholder') : t('chat.page.input.placeholderOwnerOnly')}
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
