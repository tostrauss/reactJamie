import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postEventApi } from '../utils/api';

// „Event-Bewertungen“ in the admin dashboard — the stars and feedback people
// give through „Wie war’s bei X?“ (Tina 17.11.2026; read by the JAMIE team
// only). GET /reviews/ratings/admin, newest first, grouped here by event:
// „Name · Datum · Club“ with the average and the number of ratings, the
// written feedbacks under it.
//
// Self-loading like AdminFeedbackSection, and just as tolerant: an older
// server, a failed request, an empty answer marked `unavailable` — or an api
// module without postEventApi (the dashboard's older tests) — and the section
// simply does not render.
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 16 };

const LOCALES = { en: 'en-US', it: 'it-IT', fr: 'fr-FR', es: 'es-ES' };

/** Ratings (newest first) → one entry per event, in the order of its newest rating. */
function groupRatingsByEvent(rows) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!groups.has(r.group_id)) {
      groups.set(r.group_id, {
        group_id: r.group_id, group_name: r.group_name, event_date: r.event_date,
        club_name: r.club_name || null, ratings: [],
      });
    }
    groups.get(r.group_id).ratings.push(r);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    count: g.ratings.length,
    average: g.ratings.reduce((sum, r) => sum + (Number(r.stars) || 0), 0) / g.ratings.length,
  }));
}

export const AdminEventRatingsSection = () => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);   // null = loading / unavailable

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await postEventApi.getRatingsAdmin({ limit: 100 });
        const body = res?.data;
        if (cancelled || !body || body.unavailable || !Array.isArray(body.ratings)) return;
        setData({ ratings: body.ratings, total: Number(body.total) || body.ratings.length });
      } catch { /* route missing / error / no such api → the section stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;

  const lang = (i18n.resolvedLanguage || i18n.language || 'de').split('-')[0];
  const locale = LOCALES[lang] || 'de-DE';
  // The event's date is Vienna wall-clock tagged UTC; a rating's is a real instant.
  const fmtDay = (d) => new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
  const fmtWhen = (d) => new Date(d).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtAverage = (n) => n.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const groups = groupRatingsByEvent(data.ratings);

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={H2}>{t('eventRating.admin.title')} ({data.total})</h2>
      {groups.length === 0 ? (
        <div style={{ ...CARD, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          {t('eventRating.admin.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map((g) => (
            <div key={g.group_id} style={CARD} data-testid="rating-event">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', wordBreak: 'break-word' }}>
                  {[g.group_name, g.event_date ? fmtDay(g.event_date) : null, g.club_name].filter(Boolean).join(' · ')}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  <span aria-hidden="true">⭐</span> {fmtAverage(g.average)}
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
                  {t('eventRating.admin.countFmt', { count: g.count })}
                </span>
              </div>
              {g.ratings.filter((r) => r.feedback).map((r) => (
                <div
                  key={`${r.group_id}-${r.user_id ?? r.created_at}`}
                  style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                      <span aria-hidden="true">⭐</span> {r.stars}
                    </span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{r.user_name || '–'}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>{fmtWhen(r.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {r.feedback}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminEventRatingsSection;
