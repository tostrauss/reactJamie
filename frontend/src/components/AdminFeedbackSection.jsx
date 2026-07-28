import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';

// In-app feedback list (app_feedback → GET /admin/feedback). Self-loading and
// tolerant of a missing route on old backends: 404 → the section simply
// doesn't render, same convention as AdminGrowthSection.
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 16 };

const CAT_STYLE = {
  bug:   { label: '🐞', color: '#ff8a80', bg: 'rgba(255,138,128,0.12)' },
  idea:  { label: '💡', color: '#FFD54F', bg: 'rgba(255,213,79,0.12)' },
  other: { label: '💬', color: '#90CAF9', bg: 'rgba(144,202,249,0.12)' },
};

const PAGE = 50;

export const AdminFeedbackSection = () => {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState(null); // null = loading/unavailable
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    admin.getFeedback({ limit: PAGE })
      .then(res => { setRows(res.data.feedback || []); setTotal(res.data.total || 0); })
      .catch(() => setRows(null)); // route missing / error → hide section
  }, []);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await admin.getFeedback({ limit: PAGE, offset: rows.length });
      setRows(prev => [...prev, ...(res.data.feedback || [])]);
      setTotal(res.data.total || 0);
    } catch { /* keep what we have */ }
    setLoadingMore(false);
  };

  if (rows === null) return null;

  const locale = (i18n.resolvedLanguage || 'de').startsWith('en') ? 'en-US'
    : (i18n.resolvedLanguage || 'de').startsWith('it') ? 'it-IT' : 'de-DE';
  const fmtDate = (d) => new Date(d).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={H2}>{t('admin.sections.feedbackFmt', { count: total })}</h2>
      {rows.length === 0 ? (
        <div style={{ ...CARD, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          {t('admin.feedback.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(f => {
            const cat = CAT_STYLE[f.category] || CAT_STYLE.other;
            return (
              <div key={f.id} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cat.color, background: cat.bg, borderRadius: 8, padding: '3px 8px' }}>
                    {cat.label} {t(`admin.feedback.cat.${f.category}`, { defaultValue: f.category })}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>{f.platform}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginLeft: 'auto' }}>
                    {f.user_name || t('admin.feedback.anonymous')}{f.user_email ? ` · ${f.user_email}` : ''}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{fmtDate(f.created_at)}</span>
                </div>
                <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {f.message}
                </div>
              </div>
            );
          })}
          {rows.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{ ...CARD, border: 'none', cursor: 'pointer', color: 'var(--coral, #FD7666)', fontSize: 13, fontWeight: 600 }}
            >
              {loadingMore ? t('common.loadingShort') : t('admin.feedback.loadMoreFmt', { count: total - rows.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminFeedbackSection;
