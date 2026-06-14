import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, clubs, friends as friendsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import '../styles/group-edit.css';

export const GroupEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : 'de-DE';

  const [group, setGroup]           = useState(null);
  const [members, setMembers]       = useState([]);
  const [friends, setFriends]       = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [formData, setFormData]     = useState({
    name: '', description: '', max_members: 10, date: '',
    target_age_min: '', target_age_max: '',
    chat_only_owner: false, events_owner_only: false,
    is_recurring_weekly: false,
  });

  useEffect(() => { loadData(); }, [id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [groupRes, membersRes, friendsRes] = await Promise.all([
        groups.getById(id),
        groups.getMembers(id),
        friendsApi.getAll().catch(() => ({ data: [] }))
      ]);
      const g = groupRes.data;
      // Defense-in-depth: also block non-owners on the frontend so a guest who
      // pastes a /group/:id/edit URL doesn't see a form they can't actually
      // save. Backend still rejects the PUT with 403 either way.
      if (user && g.owner_id && Number(g.owner_id) !== Number(user.id)) {
        toast.error(t('groupEdit.notOwner'));
        navigate(-1);
        return;
      }
      setGroup(g);
      // /api/groups/:id/members returns { members, total_count, gated } — unwrap.
      const memberData = membersRes.data;
      const memberList = Array.isArray(memberData) ? memberData : (memberData?.members || []);
      setMembers(memberList);
      const memberIds = new Set(memberList.map(m => m.id || m.user_id));
      setFriends((friendsRes.data || []).filter(f => !memberIds.has(f.friend_id)));
      setFormData({
        name: g.name || g.title || '',
        description: g.description || '',
        max_members: g.max_members || 10,
        date: g.date ? g.date.slice(0, 10) : '',
        target_age_min: g.target_age_min ?? '',
        target_age_max: g.target_age_max ?? '',
        chat_only_owner: !!g.chat_only_owner,
        events_owner_only: !!g.events_owner_only,
        is_recurring_weekly: !!g.is_recurring_weekly,
      });
      // Load favorite status from the API that matches the entity type so
      // the heart in the header reflects the user's current state on mount.
      const isClubType = g.type === 'club';
      const favRes = await (isClubType ? clubs.getFavorites() : groups.getFavorites())
        .catch(() => ({ data: [] }));
      setIsFavorited((favRes.data || []).some(f => f.id === parseInt(id, 10)));
    } catch {
      toast.error(t('groupEdit.loadError'));
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const handleFavoriteToggle = async () => {
    if (favoriteBusy) return;
    const wasFav = isFavorited;
    setIsFavorited(!wasFav);
    setFavoriteBusy(true);
    try {
      const isClubType = group?.type === 'club';
      await (isClubType ? clubs.toggleFavorite(id) : groups.toggleFavorite(id));
    } catch {
      setIsFavorited(wasFav);
      toast.error(t('groupEdit.favError'));
    } finally {
      setFavoriteBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Clubs need the dedicated /api/clubs/:id endpoint so settings like
      // chat_only_owner and events_owner_only actually persist — the generic
      // groups.update ignores those columns.
      const isClubType = group?.type === 'club';
      // Strip empty strings for nullable backend fields. Postgres can't cast
      // '' to TIMESTAMP/INT — converting to null lets COALESCE in the SQL
      // update keep the existing column value instead of throwing.
      const payload = {
        ...formData,
        date: formData.date === '' ? null : formData.date,
        target_age_min: formData.target_age_min === '' ? null : formData.target_age_min,
        target_age_max: formData.target_age_max === '' ? null : formData.target_age_max,
      };
      if (isClubType) {
        await clubs.update(id, payload);
      } else {
        await groups.update(id, payload);
      }
      toast.success(t('groupEdit.saved'));
      navigate(-1);
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupEdit.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    try {
      await groups.kickMember(id, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId && m.user_id !== memberId));
    } catch {
      toast.error(t('groupEdit.removeError'));
    }
  };

  const handleInviteFriend = async (friendId, friendName) => {
    try {
      await groups.invite(id, friendId);
      setFriends(prev => prev.filter(f => f.friend_id !== friendId));
      setMembers(prev => [...prev, { user_id: friendId, name: friendName, role: 'member' }]);
      toast.success(t('groupEdit.inviteToast', { name: friendName }));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupEdit.inviteError'));
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/group/${id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: group?.name || group?.title || t('groupEdit.fallbackName'), url });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t('groupEdit.linkCopied'));
    }
  };

  const filteredFriends = friends.filter(f =>
    f.name?.toLowerCase().includes(friendSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="ge-page ge-loading">
        <div className="ge-spinner" />
      </div>
    );
  }

  // This component edits groups, events AND clubs (the /club/:id/edit route
  // points here too) so the layout is identical across all three. Club-only
  // fields (chat/event permission toggles) and group-only fields (date,
  // target age) are conditionally rendered on group.type below.
  const isClub = group?.type === 'club';

  const groupName = group?.name || group?.title || t('groupEdit.fallbackName');
  const displayDate = formData.date
    ? new Date(formData.date).toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';

  return (
    <div className="ge-page">

      {/* ── Cover + Header ── */}
      <div className="ge-cover">
        {group?.image_url
          ? <img src={group.image_url} alt="" className="ge-cover-img" decoding="async" fetchpriority="high" />
          : <div className="ge-cover-placeholder" />
        }
        <div className="ge-cover-overlay" />
        <div className="ge-header">
          <button className="ge-back-btn" onClick={() => navigate(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <h1 className="ge-page-title">{groupName}</h1>
          {/* Header save button removed by request — the single save action is
              the sticky button at the bottom of the page. The right-side slot
              now holds a favourite-toggle heart so the owner can add their own
              group/club to favourites without leaving the edit view. */}
          <button
            className={`ge-fav-header-btn${isFavorited ? ' active' : ''}`}
            onClick={handleFavoriteToggle}
            disabled={favoriteBusy}
            aria-label={t('groupEdit.favoriteAria')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24"
              fill={isFavorited ? '#FD7666' : 'none'}
              stroke={isFavorited ? '#FD7666' : 'currentColor'}
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="ge-body">

        {/* ── Mitglieder ── */}
        <section className="ge-section">
          <div className="ge-section-head">
            <span className="ge-section-title">{t('groupEdit.sections.members')}</span>
            <span className="ge-section-count">{members.length}</span>
          </div>
          <div className="ge-card">
            {members.map((member, idx) => {
              const mid = member.user_id || member.id;
              const isOwner = member.role === 'owner';
              const canRemove = !isOwner && mid !== user?.id;
              const isSelf = mid === user?.id;
              return (
                <div key={mid} className={`ge-member-row ${idx < members.length - 1 ? 'ge-row-divider' : ''}`}>
                  <div
                    className="ge-avatar ge-avatar-md"
                    style={{ cursor: isSelf ? 'default' : 'pointer' }}
                    onClick={() => !isSelf && navigate(`/user/${mid}`)}
                  >
                    {member.avatar_url
                      ? <img src={member.avatar_url} alt={member.name} loading="lazy" decoding="async" />
                      : <span>{(member.name || '?')[0].toUpperCase()}</span>
                    }
                  </div>
                  <div
                    className="ge-member-info"
                    style={{ cursor: isSelf ? 'default' : 'pointer' }}
                    onClick={() => !isSelf && navigate(`/user/${mid}`)}
                  >
                    <p className="ge-member-name"><UserName name={member.name} age={member.age} /></p>
                    {isOwner && <p className="ge-member-role">{t('groupEdit.memberRole')}</p>}
                  </div>
                  {canRemove && (
                    <button className="ge-remove-btn" onClick={() => handleRemoveMember(mid)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                      <span>{t('groupEdit.removeBtn')}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Freunde hinzufügen ── */}
        <section className="ge-section">
          <div className="ge-section-head">
            <span className="ge-section-title">{t('groupEdit.sections.addFriends')}</span>
          </div>
          <div className="ge-search-wrap">
            <svg className="ge-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              className="ge-search"
              placeholder={t('groupEdit.searchPlaceholder')}
              value={friendSearch}
              onChange={e => setFriendSearch(e.target.value)}
            />
          </div>
          {filteredFriends.length === 0 ? (
            <p className="ge-empty">{t('groupEdit.noFriendsAvailable')}</p>
          ) : (
            <div className="ge-friends-grid">
              {filteredFriends.map(friend => (
                <button
                  key={friend.friend_id}
                  className="ge-friend-card"
                  onClick={() => handleInviteFriend(friend.friend_id, friend.name)}
                >
                  <div className="ge-avatar ge-avatar-lg">
                    {friend.avatar_url
                      ? <img src={friend.avatar_url} alt={friend.name} loading="lazy" decoding="async" />
                      : <span>{(friend.name || '?')[0].toUpperCase()}</span>
                    }
                  </div>
                  <UserName className="ge-friend-name" name={friend.name} age={friend.age} />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Gruppe / Club / Event bearbeiten ── */}
        <section className="ge-section">
          <div className="ge-section-head">
            <span className="ge-section-title">
              {group?.type === 'event'
                ? t('groupEdit.sections.eventInfo')
                : group?.type === 'club'
                ? t('groupEdit.sections.clubInfo')
                : t('groupEdit.sections.groupInfo')}
            </span>
          </div>
          <div className="ge-card ge-form-card">

            <div className="ge-field">
              <label className="ge-label">{t('groupEdit.fields.title')}</label>
              <input
                className="ge-input"
                placeholder={t('groupEdit.fields.titlePlaceholder')}
                value={formData.name}
                onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
              />
            </div>

            <div className="ge-divider" />

            <div className="ge-field">
              <label className="ge-label">{t('groupEdit.fields.desc')}</label>
              <textarea
                className="ge-input ge-textarea"
                placeholder={t('groupEdit.fields.descPlaceholder')}
                rows={3}
                value={formData.description}
                onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="ge-divider" />

            <div className="ge-controls-row">
              <div className="ge-control-block">
                <span className="ge-control-label">{t('groupEdit.fields.size')}</span>
                <div className="ge-stepper">
                  <button
                    className="ge-step-btn"
                    onClick={() => setFormData(p => ({ ...p, max_members: Math.max(2, p.max_members - 1) }))}
                  >−</button>
                  <span className="ge-step-val">{formData.max_members}</span>
                  <button
                    className="ge-step-btn"
                    onClick={() => setFormData(p => ({ ...p, max_members: Math.min(isClub ? 500 : 100, p.max_members + 1) }))}
                  >+</button>
                </div>
              </div>

              {/* Clubs have no event date — show only the size control for them. */}
              {!isClub && (
                <>
                  <div className="ge-control-divider" />
                  <div className="ge-control-block">
                    <span className="ge-control-label">{t('groupEdit.fields.date')}</span>
                    <div className="ge-date-wrap">
                      <span className="ge-date-display">{displayDate}</span>
                      <input
                        type="date"
                        className="ge-date-overlay"
                        value={formData.date}
                        onChange={e => setFormData(p => ({ ...p, date: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Weekly recurrence — only meaningful for type='group' events. */}
            {!isClub && (
              <>
                <div className="ge-divider" />
                <div className="ge-field ge-toggle-field">
                  <div>
                    <label className="ge-label">{t('groupEdit.fields.weeklyLabel')}</label>
                    <p className="ge-hint">
                      {formData.is_recurring_weekly
                        ? t('groupEdit.fields.weeklyOn')
                        : t('groupEdit.fields.weeklyOff')}
                    </p>
                  </div>
                  <label className="ge-toggle">
                    <input
                      type="checkbox"
                      checked={formData.is_recurring_weekly}
                      onChange={e => setFormData(p => ({ ...p, is_recurring_weekly: e.target.checked }))}
                    />
                    <span className="ge-toggle-slider" />
                  </label>
                </div>
              </>
            )}

            <div className="ge-divider" />

            {/* Target age — group/event audience filter, not a club concept. */}
            {!isClub && (
              <div className="ge-field">
                <label className="ge-label">{t('groupEdit.fields.targetAge')}</label>
                <p className="ge-hint">{t('groupEdit.fields.targetAgeHint')}</p>
                <div className="ge-age-range">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={14}
                    max={99}
                    placeholder={t('groupEdit.fields.targetAgeFromPlaceholder')}
                    className="ge-input ge-age-input"
                    value={formData.target_age_min}
                    onChange={e => setFormData(p => ({ ...p, target_age_min: e.target.value }))}
                  />
                  <span className="ge-age-sep">–</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={14}
                    max={99}
                    placeholder={t('groupEdit.fields.targetAgeToPlaceholder')}
                    className="ge-input ge-age-input"
                    value={formData.target_age_max}
                    onChange={e => setFormData(p => ({ ...p, target_age_max: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* ── Club settings (only relevant for type='club') ─────── */}
            {isClub && (
              <>
                <div className="ge-divider" />
                <div className="ge-field ge-toggle-field">
                  <div>
                    <label className="ge-label">{t('groupEdit.fields.chatPermissions')}</label>
                    <p className="ge-hint">
                      {formData.chat_only_owner
                        ? t('groupEdit.fields.chatOwnerOnly')
                        : t('groupEdit.fields.chatAll')}
                    </p>
                  </div>
                  <label className="ge-toggle">
                    <input
                      type="checkbox"
                      checked={formData.chat_only_owner}
                      onChange={e => setFormData(p => ({ ...p, chat_only_owner: e.target.checked }))}
                    />
                    <span className="ge-toggle-slider" />
                  </label>
                </div>

                <div className="ge-divider" />
                <div className="ge-field ge-toggle-field">
                  <div>
                    <label className="ge-label">{t('groupEdit.fields.eventPermissions')}</label>
                    <p className="ge-hint">
                      {formData.events_owner_only
                        ? t('groupEdit.fields.eventsOwnerOnly')
                        : t('groupEdit.fields.eventsAll')}
                    </p>
                  </div>
                  <label className="ge-toggle">
                    <input
                      type="checkbox"
                      checked={formData.events_owner_only}
                      onChange={e => setFormData(p => ({ ...p, events_owner_only: e.target.checked }))}
                    />
                    <span className="ge-toggle-slider" />
                  </label>
                </div>
              </>
            )}

          </div>
        </section>

        {/* ── Gruppe / Event teilen ── */}
        <section className="ge-section">
          <div className="ge-section-head">
            <span className="ge-section-title">
              {group?.type === 'event'
                ? t('groupEdit.sections.shareEvent')
                : isClub
                ? t('groupEdit.sections.shareClub')
                : t('groupEdit.sections.shareGroup')}
            </span>
          </div>
          <button className="ge-share-btn" onClick={handleShare}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>
            </svg>
            {t('groupEdit.shareBtn')}
          </button>
        </section>

        <div className="ge-bottom-space" />
      </div>

      {/* ── Sticky footer ── */}
      <div className="ge-footer">
        <button className="ge-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? t('groupEdit.saving') : t('groupEdit.save')}
        </button>
      </div>
    </div>
  );
};

export default GroupEdit;
