import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { groups, clubs, upload, friends as friendsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';
import { ImageCropModal } from '../components/ImageCropModal';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import { shareLink } from '../utils/share';
import '../styles/group-edit.css';

// Which main category contains a given subcategory name (for pre-selecting the
// main chip when editing). '' if the stored category isn't in the hierarchy.
const mainCategoryOf = (subName) =>
  CATEGORY_HIERARCHY.find(c => c.subs.some(s => s.name === subName))?.id || '';

export const GroupEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : 'de-DE';

  const [group, setGroup]           = useState(null);
  const [members, setMembers]       = useState([]);
  const [friends, setFriends]       = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [formData, setFormData]     = useState({
    name: '', description: '', max_members: 10, date: '', time: '', image_url: null,
    categories: [], mainCategory: '',
    target_age_min: '', target_age_max: '',
    chat_only_owner: false, events_owner_only: false,
    is_recurring_weekly: false, is_private: false,
  });
  const [uploading, setUploading]   = useState(false);
  const [cropFile, setCropFile]     = useState(null);

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
      // Defense-in-depth: also block non-managers on the frontend so a guest who
      // pastes a /group/:id/edit URL doesn't see a form they can't actually save.
      // Co-managers (clubs, role='admin') ARE allowed — g.is_manager covers both
      // owner and manager. Backend still enforces it on every write either way.
      const mayManage = g.is_manager || (user && g.owner_id && Number(g.owner_id) === Number(user.id));
      if (user && !mayManage) {
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
      // Events carry a real time-of-day; split it into local date + time for
      // the two inputs (local getters match how the event is displayed
      // everywhere else). Groups set their time in chat, so they keep the
      // date-only field and no time input.
      const dt = g.date ? new Date(g.date) : null;
      const validDt = dt && !isNaN(dt.getTime());
      const pad = (n) => String(n).padStart(2, '0');
      const isEventType = g.type === 'event';
      setFormData({
        name: g.name || g.title || '',
        description: g.description || '',
        // Groups are 4-20 since 2026-07-30 — clamp legacy values (3, 100)
        // into range on load so the save passes the backend validation. A group
        // that already grew past 20 members keeps its size (backend allows
        // max(20, member count) for exactly this legacy case).
        max_members: g.type === 'group'
          ? Math.max(4, Math.min(g.max_members || 10, Math.max(20, g.members_count || 0)))
          : (g.max_members || 10),
        date: isEventType && validDt
          ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
          : (g.date ? g.date.slice(0, 10) : ''),
        time: isEventType && validDt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '',
        image_url: g.image_url || null,
        categories: (Array.isArray(g.categories) && g.categories.length) ? g.categories : (g.category ? [g.category] : []),
        mainCategory: mainCategoryOf((Array.isArray(g.categories) && g.categories[0]) || g.category),
        target_age_min: g.target_age_min ?? '',
        target_age_max: g.target_age_max ?? '',
        chat_only_owner: !!g.chat_only_owner,
        events_owner_only: !!g.events_owner_only,
        is_recurring_weekly: !!g.is_recurring_weekly,
        is_private: !!g.is_private,
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

  // Cover photo edit — same flow as CreateClub: pick → crop (16:9) → upload →
  // store the returned URL in formData. Persisted on Save with the rest.
  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (file) setCropFile(file);
  };

  const uploadCover = async (file) => {
    setUploading(true);
    try {
      const res = await upload.image(file);
      setFormData(prev => ({ ...prev, image_url: res.data.url }));
    } catch {
      toast.error(t('groupEdit.imageUploadError', { defaultValue: 'Bild konnte nicht hochgeladen werden' }));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Clubs need the dedicated /api/clubs/:id endpoint so settings like
      // chat_only_owner and events_owner_only actually persist — the generic
      // groups.update ignores those columns.
      const isClubType = group?.type === 'club';
      const isEventType = group?.type === 'event';

      if (isEventType && group?.parent_club_id) {
        // Club events use the dedicated endpoint: correct permissions (club
        // owner/manager OR event creator) + cache busting (club page, discover
        // feed, map). date + time are sent separately and combined server-side.
        await clubs.updateEvent(group.parent_club_id, id, {
          name: formData.name,
          description: formData.description || undefined,
          date: formData.date || undefined,
          time: formData.time || undefined,
          max_members: formData.max_members,
          is_recurring_weekly: formData.is_recurring_weekly,
          image_url: formData.image_url || undefined,
        });
      } else {
        // Strip empty strings for nullable backend fields. Postgres can't cast
        // '' to TIMESTAMP/INT — converting to null lets COALESCE in the SQL
        // update keep the existing column value instead of throwing.
        // Events store a full timestamp — recombine the date + time inputs.
        // Groups stay date-only (their time lives in the chat).
        const dateValue = formData.date === ''
          ? null
          : (isEventType && formData.time ? `${formData.date}T${formData.time}` : formData.date);
        const payload = {
          ...formData,
          date: dateValue,
          target_age_min: formData.target_age_min === '' ? null : formData.target_age_min,
          target_age_max: formData.target_age_max === '' ? null : formData.target_age_max,
        };
        if (isClubType) {
          await clubs.update(id, payload);
        } else {
          await groups.update(id, payload);
        }
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

  // Co-manager promote/demote (clubs only, owner only). Updates the local role
  // optimistically so the badge + buttons flip without a refetch.
  const setMemberRole = (memberId, role) =>
    setMembers(prev => prev.map(m =>
      (m.id === memberId || m.user_id === memberId) ? { ...m, role } : m));

  const handlePromoteManager = async (memberId) => {
    try {
      await clubs.addManager(id, memberId);
      setMemberRole(memberId, 'admin');
      toast.success(t('groupEdit.managerAdded'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupEdit.managerError'));
    }
  };

  const handleDemoteManager = async (memberId) => {
    try {
      await clubs.removeManager(id, memberId);
      setMemberRole(memberId, 'member');
      toast.success(t('groupEdit.managerRemoved'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupEdit.managerError'));
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
    const title = group?.name || group?.title || t('groupEdit.fallbackName');
    const result = await shareLink({ title, url });
    if (result === 'copied') toast.success(t('groupEdit.linkCopied'));
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
  const isEvent = group?.type === 'event';
  // Only the club OWNER may assign/revoke co-managers (a manager viewing this
  // page can edit + invite + remove members, but not mint more managers).
  const viewerIsOwner = !!(group && user && Number(group.owner_id) === Number(user.id));

  const groupName = group?.name || group?.title || t('groupEdit.fallbackName');
  const displayDate = formData.date
    ? new Date(formData.date).toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';
  // Local YYYY-MM-DD today — blocks picking a past date (which would hide the
  // group/event from the map). Events keep their own date if already set.
  const todayStr = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();

  return (
    <div className="ge-page">

      {/* ── Cover + Header ── */}
      <div className="ge-cover">
        {formData.image_url
          ? <img src={formData.image_url} alt="" className="ge-cover-img" decoding="async" fetchPriority="high" />
          : <div className="ge-cover-placeholder" />
        }
        <div className="ge-cover-overlay" />
        {/* Cover photo edit — change the club/event/group image right here. */}
        <label className="ge-cover-edit" title={t('groupEdit.changePhoto', { defaultValue: 'Foto ändern' })}>
          <input type="file" accept="image/*" onChange={handleImagePick} hidden disabled={uploading} />
          {uploading ? (
            <span className="ge-cover-edit-text">{t('groupEdit.uploading', { defaultValue: 'Lädt…' })}</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          )}
        </label>
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
              const isMemberOwner = member.role === 'owner';
              const isMemberManager = member.role === 'admin';
              const isSelf = mid === user?.id;
              // Regular members can be removed; the owner/managers are not kicked
              // (managers are demoted instead — backend also enforces this).
              const canRemove = member.role === 'member' && !isSelf;
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
                    {isMemberOwner && <p className="ge-member-role">{t('groupEdit.memberRole')}</p>}
                    {isMemberManager && <p className="ge-member-role ge-member-role--manager">{t('groupEdit.managerBadge')}</p>}
                  </div>
                  <div className="ge-member-actions">
                    {/* Manager assignment — clubs only, owner only. */}
                    {isClub && viewerIsOwner && isMemberManager && (
                      <button className="ge-role-btn" onClick={() => handleDemoteManager(mid)}>
                        {t('groupEdit.removeManager')}
                      </button>
                    )}
                    {isClub && viewerIsOwner && member.role === 'member' && (
                      <button className="ge-role-btn ge-role-btn--promote" onClick={() => handlePromoteManager(mid)}>
                        {t('groupEdit.makeManager')}
                      </button>
                    )}
                    {canRemove && (
                      <button className="ge-remove-btn" onClick={() => handleRemoveMember(mid)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                        <span>{t('groupEdit.removeBtn')}</span>
                      </button>
                    )}
                  </div>
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
              <label className="ge-label">
                {t('groupEdit.fields.title')}
                {/* Groups cap the title at 15 chars (clubs/events keep their
                    longer names). */}
                {group?.type === 'group' && (
                  <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 400 }}>
                    {(formData.name || '').length}/15
                  </span>
                )}
              </label>
              <input
                className="ge-input"
                placeholder={t('groupEdit.fields.titlePlaceholder')}
                value={formData.name}
                onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                maxLength={group?.type === 'group' ? 15 : undefined}
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

            {/* Kategorie — Haupt- + Unterkategorie ändern. Nicht für Events:
                die erben die Kategorie ihres Clubs. */}
            {group?.type !== 'event' && (
              <>
                <div className="ge-field">
                  <label className="ge-label">
                    {t('groupEdit.fields.category', { defaultValue: 'Kategorie' })}
                    {' '}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({formData.categories.length}/3)</span>
                  </label>

                  {/* Currently-selected categories as removable chips. Without
                      this, a sub picked under one main category stays invisibly
                      in `categories` once you switch to another main — and since
                      the first entry is the PRIMARY (displayed) category, the
                      group's category looked unchangeable. The first chip is the
                      primary; removing it promotes the next one. */}
                  {formData.categories.length > 0 && (
                    <div className="cat-selected-row">
                      {formData.categories.map((cat, i) => (
                        <button
                          key={cat}
                          type="button"
                          className={`cat-selected-chip${i === 0 ? ' is-primary' : ''}`}
                          onClick={() => setFormData(p => ({ ...p, categories: p.categories.filter(c => c !== cat) }))}
                          title={t('groupEdit.fields.categoryRemove', { defaultValue: 'Entfernen' })}
                        >
                          {i === 0 && <span className="cat-selected-chip__dot" aria-hidden="true" />}
                          <span>{cat}</span>
                          <span className="cat-selected-chip__x" aria-hidden="true">✕</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="ge-cat-grid">
                    {CATEGORY_HIERARCHY.map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        className={`ge-cat-chip${formData.mainCategory === cat.id ? ' active' : ''}`}
                        onClick={() => setFormData(p => ({ ...p, mainCategory: cat.id }))}
                      >
                        <span className="ge-cat-icon">{cat.icon}</span>
                        <span>{cat.label}</span>
                      </button>
                    ))}
                  </div>
                  {formData.mainCategory && (
                    <div className="ge-cat-grid ge-cat-grid--subs">
                      {CATEGORY_HIERARCHY.find(c => c.id === formData.mainCategory)?.subs.map(sub => {
                        const selected = formData.categories.includes(sub.name);
                        return (
                          <button
                            key={sub.name}
                            type="button"
                            className={`ge-cat-chip${selected ? ' active' : ''}`}
                            onClick={() => setFormData(p => {
                              // Toggle; cap at 3. Selections persist across main categories.
                              if (selected) return { ...p, categories: p.categories.filter(c => c !== sub.name) };
                              if (p.categories.length >= 3) return p;
                              return { ...p, categories: [...p.categories, sub.name] };
                            })}
                          >
                            <span className="ge-cat-icon">{sub.icon}</span>
                            <span>{sub.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="ge-divider" />
              </>
            )}

            <div className="ge-controls-row">
              <div className="ge-control-block">
                <span className="ge-control-label">{t('groupEdit.fields.size')}</span>
                <div className="ge-stepper">
                  <button
                    className="ge-step-btn"
                    onClick={() => setFormData(p => ({ ...p, max_members: Math.max(isClub ? 2 : 4, p.max_members - 1) }))}
                  >−</button>
                  <span className="ge-step-val">{formData.max_members}</span>
                  <button
                    className="ge-step-btn"
                    onClick={() => setFormData(p => ({ ...p, max_members: Math.min(isClub ? 500 : Math.max(20, members.length), p.max_members + 1) }))}
                  >+</button>
                </div>
              </div>

              {/* Clubs have no event date — show only the size control for them.
                  Date + time share ONE block (time stacked under date) so the
                  3rd field never overflows the row on narrow phones. */}
              {!isClub && (
                <>
                  <div className="ge-control-divider" />
                  <div className="ge-control-block">
                    <span className="ge-control-label">
                      {isEvent
                        ? `${t('groupEdit.fields.date')} & ${t('groupEdit.fields.time', { defaultValue: 'Uhrzeit' })}`
                        : t('groupEdit.fields.date')}
                    </span>
                    <div className="ge-datetime-stack">
                      <div className="ge-date-wrap">
                        <span className="ge-date-display">{displayDate}</span>
                        <input
                          type="date"
                          className="ge-date-overlay"
                          value={formData.date}
                          min={todayStr}
                          onChange={e => setFormData(p => ({ ...p, date: e.target.value }))}
                        />
                      </div>
                      {/* Uhrzeit — only events carry a time-of-day (groups set it in chat). */}
                      {isEvent && (
                        <div className="ge-date-wrap">
                          <span className="ge-date-display">{formData.time || '—'}</span>
                          <input
                            type="time"
                            className="ge-date-overlay"
                            value={formData.time}
                            onChange={e => setFormData(p => ({ ...p, time: e.target.value }))}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Visibility (public ⇄ private) — editable after creation for
                groups and clubs. A one-off event has no join flow, so hide it
                there. Toggle ON = private (join by request only). */}
            {group?.type !== 'event' && (
              <>
                <div className="ge-divider" />
                <div className="ge-field ge-toggle-field">
                  <div>
                    <label className="ge-label">{t('groupEdit.fields.visibility')}</label>
                    <p className="ge-hint">
                      {formData.is_private
                        ? t('groupEdit.fields.visibilityPrivate')
                        : t('groupEdit.fields.visibilityPublic')}
                    </p>
                  </div>
                  <label className="ge-toggle">
                    <input
                      type="checkbox"
                      checked={formData.is_private}
                      onChange={e => setFormData(p => ({ ...p, is_private: e.target.checked }))}
                    />
                    <span className="ge-toggle-slider" />
                  </label>
                </div>
              </>
            )}

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

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          aspect={16 / 9}
          onConfirm={(cropped) => { setCropFile(null); uploadCover(cropped); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
};

export default GroupEdit;
