import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { friends } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { UserName } from '../components/UserName';

export default function BlockedUsers() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState(null);

  const load = async () => {
    try {
      const res = await friends.getBlocked();
      setList(res.data || []);
    } catch {
      toast.error(t('blockedUsers.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleUnblock = async (userId) => {
    setUnblockingId(userId);
    try {
      await friends.unblock(userId);
      setList(prev => prev.filter(u => u.id !== userId));
      toast.success(t('blockedUsers.unblocked'));
    } catch {
      toast.error(t('blockedUsers.unblockError'));
    } finally {
      setUnblockingId(null);
    }
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate('/settings')}
          style={{ background: 'none', border: 'none', color: 'var(--coral)', fontSize: 14, cursor: 'pointer', padding: 0 }}
        >
          ← {t('common.back')}
        </button>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{t('blockedUsers.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24, lineHeight: 1.5 }}>
        {t('blockedUsers.subtitle')}
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          {t('common.loading')}
        </div>
      ) : list.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--text-secondary)',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 16,
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🤝</div>
          <p style={{ fontSize: 14 }}>{t('blockedUsers.empty')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(u => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
              }}
            >
              {u.avatar_url ? (
                <img
                  src={u.avatar_url}
                  alt=""
                  style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
                  loading="lazy"
                />
              ) : (
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700,
                }}>
                  {u.name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <Link
                to={`/user/${u.id}`}
                style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'inherit', textDecoration: 'none' }}
              >
                <UserName name={u.name} age={u.age} />
              </Link>
              <button
                onClick={() => handleUnblock(u.id)}
                disabled={unblockingId === u.id}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: 'inherit',
                  padding: '8px 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: 36,
                }}
              >
                {unblockingId === u.id ? t('common.loadingShort') : t('blockedUsers.unblock')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
