import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clubs, friends as friendsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import '../styles/home.css';

export const ClubEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const { t } = useTranslation();

  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    category: ''
  });

  useEffect(() => {
    loadClubData();
  }, [id]);

  const loadClubData = async () => {
    setLoading(true);
    try {
      const [clubRes, membersRes, friendsRes] = await Promise.all([
        clubs.getById(id),
        clubs.getMembers(id),
        friendsApi.getAll().catch(() => ({ data: [] }))
      ]);
      const clubData = clubRes.data;
      setClub(clubData);
      setMembers(membersRes.data || []);
      // Filter out friends who are already members
      const memberIds = new Set((membersRes.data || []).map(m => m.id || m.user_id));
      setFriends((friendsRes.data || []).filter(f => !memberIds.has(f.friend_id)));
      setFormData({
        name: clubData.name || clubData.title || '',
        description: clubData.description || '',
        location: clubData.location || '',
        category: clubData.category || '',
        chat_only_owner: clubData.chat_only_owner || false,
        events_owner_only: clubData.events_owner_only || false,
      });
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await clubs.update(id, formData);
      navigate(`/group/${id}`);
    } catch (error) {
      toast.error(error.response?.data?.error || t('clubEdit.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm(t('clubEdit.removeConfirm'))) return;
    try {
      await clubs.kickMember(id, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId && m.user_id !== memberId));
    } catch (error) {
      toast.error(t('clubEdit.removeError'));
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleInviteFriend = async (friendId, friendName) => {
    try {
      // Join the club on behalf of the friend — this adds them as a member
      await clubs.join(id);
      setFriends(prev => prev.filter(f => f.friend_id !== friendId));
      toast.success(t('clubEdit.inviteToast', { name: friendName }));
    } catch (err) {
      // If joining fails (e.g. friend must accept themselves), just notify
      toast.info(t('clubEdit.inviteFallback', { name: friendName }));
    }
  };

  if (loading) {
    return (
      <div className="club-edit-page">
        <div className="loading">{t('clubEdit.loading')}</div>
      </div>
    );
  }

  return (
    <div className="club-edit-page">
      {/* Header */}
      <div className="edit-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1>{t('clubEdit.title')}</h1>
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? t('clubEdit.saving') : t('clubEdit.save')}
        </button>
      </div>

      <div className="edit-content">
        {/* Club Info Form */}
        <div className="edit-section">
          <div className="form-section">
            <label className="form-label">{t('clubEdit.fields.name')}</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="form-input"
              placeholder={t('clubEdit.fields.namePlaceholder')}
            />
          </div>

          <div className="form-section">
            <label className="form-label">{t('clubEdit.fields.desc')}</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              className="form-input"
              placeholder={t('clubEdit.fields.descPlaceholder')}
              rows={3}
            />
          </div>

          <div className="form-section">
            <label className="form-label">{t('clubEdit.fields.location')}</label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              className="form-input"
              placeholder={t('clubEdit.fields.locationPlaceholder')}
            />
          </div>

          <div className="form-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-white)', marginBottom: 2 }}>
                {t('clubEdit.chat.title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formData.chat_only_owner ? t('clubEdit.chat.ownerOnly') : t('clubEdit.chat.all')}
              </div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={formData.chat_only_owner}
                onChange={(e) => setFormData(prev => ({ ...prev, chat_only_owner: e.target.checked }))}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>

          <div className="form-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-white)', marginBottom: 2 }}>
                {t('clubEdit.events.title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formData.events_owner_only ? t('clubEdit.events.ownerOnly') : t('clubEdit.events.all')}
              </div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={formData.events_owner_only}
                onChange={(e) => setFormData(prev => ({ ...prev, events_owner_only: e.target.checked }))}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>
        </div>

        {/* Members Section */}
        <div className="edit-section">
          <h2 className="edit-section-title">
            {t('clubEdit.membersTitle')}
            <span className="member-count-badge">{members.length}</span>
          </h2>
          <div className="members-list">
            {members.map(member => (
              <div key={member.id || member.user_id} className="member-row">
                <div className="member-avatar">
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt={member.name} loading="lazy" decoding="async" />
                  ) : (
                    <div className="avatar-initial">
                      {(member.name || '?')[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="member-info">
                  <UserName className="member-name" name={member.name} age={member.age} />
                  {member.role === 'owner' && (
                    <span className="member-role">{t('clubEdit.memberRole')}</span>
                  )}
                </div>
                {member.role !== 'owner' && (member.user_id || member.id) !== user?.id && (
                  <button
                    className="remove-member-btn"
                    onClick={() => handleRemoveMember(member.user_id || member.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Invite Friends Section */}
        <div className="edit-section">
          <h2 className="edit-section-title">{t('clubEdit.inviteTitle')}</h2>
          <div className="invite-list">
            {friends.length === 0 ? (
              <p className="invite-empty">{t('clubEdit.noFriends')}</p>
            ) : (
              friends.map(friend => (
                <div key={friend.id} className="member-row">
                  <div className="member-avatar">
                    {friend.avatar_url ? (
                      <img src={friend.avatar_url} alt={friend.name} loading="lazy" decoding="async" />
                    ) : (
                      <div className="avatar-initial">
                        {(friend.name || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <UserName className="member-name" name={friend.name} age={friend.age} />
                  <button
                    className="invite-btn"
                    onClick={() => handleInviteFriend(friend.friend_id, friend.name)}
                  >
                    {t('clubEdit.inviteBtn')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClubEdit;
