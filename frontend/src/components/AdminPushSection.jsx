import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';

/**
 * Admin → Nutzer verwalten → "Push-Benachrichtigungen" (support tool,
 * 06.10.2026).
 *
 * "Die Push-Benachrichtigungen klappen bei mir nicht" has come in again and
 * again (Tina 07-19, Lea 07-30, the iOS incident 09-04, a tester 10-06), and
 * every time the first question — is ANY device of this person registered? —
 * needed a SQL console, and the second — does a push to it actually leave? —
 * needed a log search that found nothing for web push. This answers both:
 * the registered devices (platform + push service, never the endpoint/token),
 * and a test push with the push service's verdict per device.
 */

// Push service host → which kind of device/browser it is.
const platformKey = (d) => {
  if (d.platform === 'apns') return 'iphone';
  const h = d.host || '';
  if (h.endsWith('googleapis.com')) return 'android';
  if (h.endsWith('push.apple.com')) return 'apple';
  if (h.includes('mozilla')) return 'firefox';
  if (h.endsWith('notify.windows.com')) return 'edge';
  return 'web';
};

export const AdminPushSection = ({ userId, devices }) => {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(false);

  // Older backend without the field: render nothing rather than "no devices".
  if (!Array.isArray(devices)) return null;

  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleDateString(i18n.resolvedLanguage || 'de', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch { return ''; }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await admin.sendTestPush(userId);
      setResults(Array.isArray(res.data?.results) ? res.data.results : []);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const outcome = (r) => {
    if (r.ok) return `✓ ${t('admin.userModal.push.accepted')}${r.status ? ` (${r.status})` : ''}`;
    if (r.pruned) return `✗ ${t('admin.userModal.push.pruned')}`;
    return `✗ ${t('admin.userModal.push.failed')}${r.status ? ` (${r.status})` : r.reason ? ` (${r.reason})` : ''}`;
  };

  return (
    <div style={{ margin: '14px 0', paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ color: 'var(--text-white, #fff)', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        {t('admin.userModal.push.title')}
      </div>

      {devices.length === 0 ? (
        <div style={{ color: '#fbbf24', fontSize: 13 }}>{t('admin.userModal.push.none')}</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {devices.map((d) => {
            const r = results?.find((x) => x.id === d.id);
            return (
              <li key={d.id} style={{ fontSize: 13, color: 'var(--text-muted, rgba(255,255,255,0.7))' }}>
                <strong style={{ color: 'var(--text-white, #fff)' }}>{t(`admin.userModal.push.platform.${platformKey(d)}`)}</strong>
                {d.platform === 'web' && d.host ? ` · ${d.host}` : ''}
                {d.registered_at ? ` · ${t('admin.userModal.push.registered', { date: fmt(d.registered_at) })}` : ''}
                {r && (
                  <div style={{ color: r.ok ? '#4ade80' : '#f87171', marginTop: 1 }}>{outcome(r)}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {devices.length > 0 && (
        <>
          <button
            type="button"
            onClick={sendTest}
            disabled={busy}
            style={{
              width: '100%', minHeight: 44, marginTop: 10, borderRadius: 12,
              border: '1px solid rgba(253,118,102,0.5)', background: 'transparent',
              color: '#FD7666', fontSize: 14, fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? t('admin.userModal.push.testing') : t('admin.userModal.push.test')}
          </button>
          {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 6 }}>{t('admin.userModal.push.error')}</div>}
          {results && (
            <p style={{ color: 'var(--text-muted, rgba(255,255,255,0.55))', fontSize: 12, lineHeight: 1.45, margin: '8px 0 0' }}>
              {t('admin.userModal.push.hint')}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default AdminPushSection;
