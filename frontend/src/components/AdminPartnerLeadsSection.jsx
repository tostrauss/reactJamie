import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { partnerApi } from '../utils/api';

/**
 * Admin → „Partner-Anfragen“ (Tina's document of 17.11.2026, decided by Tobi).
 *
 * Who runs an official club and answers Tina's partner letter with „Ja,
 * meldet euch!“ fills in the form „JAMIE Anfrage“. That request lands here
 * (and in the office mailbox, and as a push to the admins that links to
 * /admin#partner-leads) — a person is waiting for a call or a mail.
 *
 * Self-loading and tolerant like AdminClassifySection, one step further:
 * ANY failure renders nothing — a server older than this bundle (404), an
 * answer that is not a list, and a test that mocks utils/api without
 * partnerApi (the access itself throws there, so it sits inside the try).
 */
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16 };
const MUTED = 'rgba(255,255,255,0.5)';
const DIVIDER = '1px solid rgba(255,255,255,0.06)';
const LINK = { color: 'var(--accent-coral, #FD7666)', textDecoration: 'none', fontWeight: 600 };
// Every line may break anywhere: a company name or a mail address has no
// spaces to break at, and /admin is used from phones.
const LINE = { minWidth: 0, overflowWrap: 'anywhere' };

// Vienna time, like everything an admin reads here. A date that cannot be
// read shows nothing rather than „Invalid Date“.
const when = (iso, lang) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(lang, { timeZone: 'Europe/Vienna', dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
};

export const AdminPartnerLeadsSection = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n?.resolvedLanguage || i18n?.language || 'de';
  // undefined: still loading · null: not available → nothing · array: the list
  const [leads, setLeads] = useState(undefined);
  const rootRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let next = null;
      try {
        const res = await partnerApi.getPartnerLeads();
        if (Array.isArray(res?.data)) next = res.data;
      } catch {
        next = null;
      }
      if (alive) setLeads(next);
    })();
    return () => { alive = false; };
  }, []);

  // The admin push links to /admin#partner-leads. The list arrives after the
  // page, so the browser's own jump to the anchor finds nothing yet.
  useEffect(() => {
    if (!Array.isArray(leads)) return;
    if (typeof window === 'undefined' || window.location.hash !== '#partner-leads') return;
    rootRef.current?.scrollIntoView?.({ block: 'start' });
  }, [leads]);

  if (!Array.isArray(leads)) return null;

  return (
    <section ref={rootRef} style={{ marginBottom: 32, scrollMarginTop: 16 }}>
      <h2 style={H2}>{t('admin.partnerLeads.title')}</h2>
      <div style={CARD}>
        {leads.length === 0 ? (
          <p style={{ color: MUTED, fontSize: 14, padding: 16, margin: 0 }}>{t('admin.partnerLeads.empty')}</p>
        ) : leads.map((l, i) => {
          const date = when(l.created_at, lang);
          const how = l.contact === 'call' ? t('admin.partnerLeads.contactCall')
            : l.contact === 'mail' ? t('admin.partnerLeads.contactMail') : '';
          const source = l.source ? t(`admin.partnerLeads.source.${l.source}`, { defaultValue: String(l.source) }) : '';
          return (
            <div key={l.id ?? i} data-lead style={{ padding: 14, borderTop: i === 0 ? 'none' : DIVIDER }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', marginBottom: 6 }}>
                <strong style={{ ...LINE, color: '#fff', fontSize: 15, flex: '1 1 auto' }}>
                  {l.club?.id
                    ? <Link to={`/club/${l.club.id}`} style={{ color: '#fff', textDecoration: 'underline' }}>{l.club.name || `#${l.club.id}`}</Link>
                    : '–'}
                </strong>
                {date && <span style={{ color: MUTED, fontSize: 12, whiteSpace: 'nowrap' }}>{date}</span>}
              </div>
              <div style={{ ...LINE, color: '#fff', fontSize: 14, marginBottom: 4 }}>
                {[l.name, l.company].filter(Boolean).join(' · ')}
              </div>
              <div style={{ ...LINE, color: MUTED, fontSize: 12, marginBottom: 8 }}>
                {[source, how].filter(Boolean).join(' · ')}
              </div>
              {(l.email || l.phone) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 14 }}>
                  {l.email && <a href={`mailto:${l.email}`} style={{ ...LINK, ...LINE }}>{l.email}</a>}
                  {l.phone && <a href={`tel:${String(l.phone).replace(/[^\d+]/g, '')}`} style={{ ...LINK, ...LINE }}>{l.phone}</a>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default AdminPartnerLeadsSection;
