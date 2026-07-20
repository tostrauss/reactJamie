import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { admin } from '../utils/api';
import { UserName } from './UserName';

const MUTED = 'rgba(255,255,255,0.5)';

const StatPill = ({ label, value }) => (
  <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 10px', flex: '1 1 60px', minWidth: 60, textAlign: 'center' }}>
    <div style={{ color: '#FD7666', fontSize: 18, fontWeight: 800 }}>{value ?? '—'}</div>
    <div style={{ color: MUTED, fontSize: 10, marginTop: 1 }}>{label}</div>
  </div>
);

// Tappable chips of the user's groups/clubs — each routes to that entity and
// closes the modal. Routes by item.type so it works for memberships + owned.
const ChipRow = ({ title, items, onGo }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{ color: MUTED, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map(it => (
        <button
          key={`${it.type}-${it.id}`}
          onClick={() => onGo(it)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 999, padding: '5px 10px', fontSize: 12, color: '#fff', cursor: 'pointer',
            maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {it.type === 'club' ? '🏛️' : '👥'} {it.name}
        </button>
      ))}
    </div>
  </div>
);

/**
 * AdminUserModal — manage a single user from the admin dashboard.
 * Lets an admin toggle roles (admin / trusted) and delete the account, with an
 * inline two-step delete confirm (no native window.confirm).
 *
 * @param {object}   user          - The user row (id, name, email, avatar_url, is_admin, is_trusted_user, age…)
 * @param {number}   currentUserId - The signed-in admin's id (to block self-admin removal in the UI)
 * @param {function} onClose       - Close the modal
 * @param {function} onUpdated     - Called with the updated user after a role change
 * @param {function} onDeleted     - Called with the user's id after deletion
 */
const Toggle = ({ checked, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    style={{
      width: 46, height: 28, borderRadius: 14, border: 'none', flexShrink: 0,
      background: checked ? '#4ade80' : 'rgba(255,255,255,0.18)',
      position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1, transition: 'background 0.15s', padding: 0,
    }}
  >
    <span style={{
      position: 'absolute', top: 3, left: checked ? 21 : 3,
      width: 22, height: 22, borderRadius: '50%', background: '#fff',
      transition: 'left 0.15s',
    }} />
  </button>
);

export const AdminUserModal = ({ user, currentUserId, onClose, onUpdated, onDeleted }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [isAdmin, setIsAdmin] = useState(!!user.is_admin);
  const [isTrusted, setIsTrusted] = useState(!!user.is_trusted_user);
  const [savingField, setSavingField] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detail, setDetail] = useState(null);

  const isSelf = user.id === currentUserId;

  // Load this user's memberships + activity for the stats section. Tolerant of a
  // missing route on an older backend (section just stays empty).
  useEffect(() => {
    let cancelled = false;
    admin.getUserDetail(user.id)
      .then(res => { if (!cancelled) setDetail(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user.id]);

  const goEntity = (it) => { onClose?.(); navigate(it.type === 'club' ? `/club/${it.id}` : `/group/${it.id}`); };

  const updateRole = async (field, value, setLocal, prev) => {
    setSavingField(field);
    setLocal(value);
    try {
      const res = await admin.setUserRole(user.id, { [field]: value });
      const updated = { ...user, ...res.data.user };
      onUpdated?.(updated);
      toast.success(t('admin.userModal.roleSaved'));
    } catch (err) {
      setLocal(prev); // revert on failure
      toast.error(err.response?.data?.error || t('admin.userModal.roleError'));
    } finally {
      setSavingField('');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await admin.deleteUser(user.id);
      onDeleted?.(user.id);
      toast.success(t('admin.userModal.deleted'));
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.users.deleteError'));
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-overlay modal-overlay-center"
      style={{ zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-container create-action-modal" style={{ maxWidth: 400 }}>
        <div className="modal-top-bar">
          <h3 style={{ margin: 0, fontSize: 18 }}>{t('admin.userModal.title')}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t('admin.backToApp')}>✕</button>
        </div>

        {/* Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 20px' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', background: '#FD7666',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden',
          }}>
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : user.name?.[0]?.toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text-white, #fff)', fontSize: 16, fontWeight: 700 }}>
              <UserName name={user.name} age={user.age} />
            </div>
            <div style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </div>
          </div>
        </div>

        {/* Individual stats — memberships + activity, shown above the role
            toggles so an admin sees who they're acting on. */}
        <div style={{ margin: '14px 0', paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <StatPill label={t('admin.userModal.stats.groups')} value={detail?.groups?.length} />
            <StatPill label={t('admin.userModal.stats.clubs')} value={detail?.clubs?.length} />
            <StatPill label={t('admin.userModal.stats.friends')} value={detail?.counts?.friends} />
            <StatPill label={t('admin.userModal.stats.messages')} value={detail?.counts?.messages} />
            <StatPill label={t('admin.userModal.stats.photos')} value={detail?.counts?.photos} />
          </div>
          {detail?.groups?.length > 0 && <ChipRow title={t('admin.userModal.stats.inGroups')} items={detail.groups} onGo={goEntity} />}
          {detail?.clubs?.length > 0 && <ChipRow title={t('admin.userModal.stats.inClubs')} items={detail.clubs} onGo={goEntity} />}
          {detail?.owned?.length > 0 && <ChipRow title={t('admin.userModal.stats.created')} items={detail.owned} onGo={goEntity} />}
        </div>

        {/* Role toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text-white, #fff)', fontSize: 15, fontWeight: 600 }}>
                {t('admin.userModal.adminLabel')}
              </div>
              <div style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', fontSize: 12, marginTop: 2 }}>
                {isSelf ? t('admin.userModal.adminSelfHint') : t('admin.userModal.adminHint')}
              </div>
            </div>
            <Toggle
              checked={isAdmin}
              disabled={savingField === 'is_admin' || (isSelf && isAdmin)}
              onChange={(v) => updateRole('is_admin', v, setIsAdmin, isAdmin)}
            />
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text-white, #fff)', fontSize: 15, fontWeight: 600 }}>
                {t('admin.userModal.trustedLabel')} <span style={{ color: '#4ade80' }}>✓</span>
              </div>
              <div style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', fontSize: 12, marginTop: 2 }}>
                {t('admin.userModal.trustedHint')}
              </div>
            </div>
            <Toggle
              checked={isTrusted}
              disabled={savingField === 'is_trusted_user'}
              onChange={(v) => updateRole('is_trusted_user', v, setIsTrusted, isTrusted)}
            />
          </div>
        </div>

        {/* Direct message — admins can DM any user without a friend request
            (backend dmAllowed() lets an admin-involved thread through). */}
        {!isSelf && (
          <button
            onClick={() => { onClose?.(); navigate(`/dm/${user.id}`); }}
            style={{
              width: '100%', marginTop: 16, padding: '12px', borderRadius: 12,
              border: 'none', background: '#FD7666', color: '#fff',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {t('admin.userModal.messageBtn')}
          </button>
        )}

        {/* Danger zone — hidden for admins (server forbids deleting them) */}
        {!user.is_admin && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12,
                  border: '1px solid rgba(248,113,113,0.4)', background: 'transparent',
                  color: '#f87171', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {t('admin.userModal.deleteBtn')}
              </button>
            ) : (
              <div>
                <p style={{ color: 'var(--text-muted, rgba(255,255,255,0.6))', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5 }}>
                  {t('admin.userModal.deleteConfirm', { name: user.name || user.email })}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
                      background: 'transparent', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {t('admin.userModal.cancel')}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{
                      flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                      background: '#f87171', color: '#0a0a0a', fontSize: 14, fontWeight: 700,
                      cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.6 : 1,
                    }}
                  >
                    {deleting ? t('admin.userModal.deleting') : t('admin.userModal.deleteConfirmBtn')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUserModal;
