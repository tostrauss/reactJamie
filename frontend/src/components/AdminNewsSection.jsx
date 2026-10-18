import { useState, useEffect, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { admin } from '../utils/api';
import { isInternalPath } from '../utils/notifications';

/**
 * Admin → "News an alle" (Lea, 18.10.2026: new features and deals go
 * unnoticed — JAMIE needs a one-way channel inside the app).
 *
 * One send puts a 📣 row into EVERY active account's bell on Home; the device
 * push goes only to people who switched on „Neuigkeiten & Deals" (App Store
 * Review Guideline 4.5.4). Because it reaches everyone at once, the section
 * says how many before anything happens, and sending is two explicit steps —
 * the same inline confirm as AdminUserModal, no window.confirm. The server
 * refuses the same title again within 10 minutes as an accidental double send.
 *
 * Self-loading and tolerant like AdminFeaturedClubsSection: a server without
 * the news routes (404) → the section is not rendered at all.
 */
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16 };
const MUTED = 'rgba(255,255,255,0.5)';
const DIVIDER = '1px solid rgba(255,255,255,0.06)';
// 16px: iOS zooms into any focused field below that, and /admin is used from phones.
const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '12px 14px',
  color: '#fff', fontSize: 16, fontFamily: 'inherit', outline: 'none',
};
const LABEL = { display: 'block', color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 6 };
const BTN = {
  minHeight: 44, padding: '0 18px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
};

// newsController.NEWS_TITLE_MAX / NEWS_MESSAGE_MAX — the server re-checks.
const NEWS_TITLE_MAX = 80;
const NEWS_MESSAGE_MAX = 500;

// Server codes this section words itself (admin.news.errors.*).
const ERROR_KEYS = {
  NEWS_DUPLICATE: 'duplicate',
  NEWS_UNAVAILABLE: 'unavailable',
  NEWS_SEND_FAILED: 'sendFailed',
};

const Counter = ({ value, max }) => (
  <span style={{ fontSize: 12, color: value > max ? '#f87171' : MUTED, fontVariantNumeric: 'tabular-nums' }}>
    {value}/{max}
  </span>
);

export const AdminNewsSection = () => {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const locale = i18n.resolvedLanguage || i18n.language || 'de';
  const num = (n) => Number(n || 0).toLocaleString(locale);

  const [hidden, setHidden] = useState(false);
  const [audience, setAudience] = useState(null);   // { total, pushOptIn } once counted
  const [recent, setRecent] = useState([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [withPush, setWithPush] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);       // the last send's counts
  const [error, setError] = useState('');

  const loadAudience = useCallback(async () => {
    try {
      const res = await admin.getNewsAudience();
      const d = res?.data || {};
      setAudience({ total: Number(d.total) || 0, pushOptIn: Number(d.pushOptIn) || 0 });
    } catch (err) {
      // 404 = a server without this feature → no section. Anything else keeps
      // the form usable; only the count is missing.
      if (err?.response?.status === 404) setHidden(true);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await admin.getNews();
      setRecent(Array.isArray(res?.data?.news) ? res.data.news : []);
    } catch { /* the list is a convenience; the form works without it */ }
  }, []);

  useEffect(() => { loadAudience(); loadRecent(); }, [loadAudience, loadRecent]);

  if (hidden) return null;

  const cleanTitle = title.trim();
  const cleanMessage = message.trim();
  const cleanLink = link.trim();
  const linkInvalid = cleanLink !== '' && !isInternalPath(cleanLink);
  const valid = cleanTitle !== '' && cleanMessage !== ''
    && cleanTitle.length <= NEWS_TITLE_MAX && cleanMessage.length <= NEWS_MESSAGE_MAX && !linkInvalid;

  // Any edit retires the last verdict.
  const edited = () => { setResult(null); setError(''); };

  const errorText = (err) => {
    const data = err?.response?.data;
    const key = ERROR_KEYS[data?.code];
    if (key) return t(`admin.news.errors.${key}`, { minutes: data.minutes ?? 10, recipients: num(data.recipients) });
    if (data?.code === 'NEWS_LINK_INVALID') return t('admin.news.linkInvalid');
    // No answer at all (offline, or the 60 s client timeout): the request may
    // well have arrived and still be fanning out — say so instead of inviting
    // a blind retry, and refresh the list that shows what actually went out.
    if (!err?.response) return t('admin.news.errors.noResponse');
    return t('admin.news.errors.generic');
  };

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await admin.sendNews({
        title: cleanTitle, message: cleanMessage, link: cleanLink || undefined, push: withPush,
      });
      setResult(res?.data || {});
      setTitle('');
      setMessage('');
      setLink('');
      setWithPush(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
      setConfirming(false);
      loadRecent();
      loadAudience();
    }
  };

  const titleId = `${uid}-title`;
  const messageId = `${uid}-message`;
  const linkId = `${uid}-link`;
  const linkHintId = `${uid}-link-hint`;
  const pushId = `${uid}-push`;
  const confirmId = `${uid}-confirm`;

  return (
    <div id="news" style={{ marginBottom: 32 }}>
      <h2 style={H2}>{t('admin.news.title')}</h2>
      <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.45, margin: '-4px 0 12px' }}>{t('admin.news.hint')}</p>

      <div style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <label htmlFor={titleId} style={LABEL}>{t('admin.news.titleLabel')}</label>
            <Counter value={title.trim().length} max={NEWS_TITLE_MAX} />
          </div>
          <input
            id={titleId}
            type="text"
            value={title}
            maxLength={NEWS_TITLE_MAX}
            onChange={(e) => { setTitle(e.target.value); edited(); }}
            placeholder={t('admin.news.titlePlaceholder')}
            disabled={sending || confirming}
            style={FIELD}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <label htmlFor={messageId} style={LABEL}>{t('admin.news.messageLabel')}</label>
            <Counter value={message.trim().length} max={NEWS_MESSAGE_MAX} />
          </div>
          <textarea
            id={messageId}
            value={message}
            maxLength={NEWS_MESSAGE_MAX}
            rows={4}
            onChange={(e) => { setMessage(e.target.value); edited(); }}
            placeholder={t('admin.news.messagePlaceholder')}
            disabled={sending || confirming}
            style={{ ...FIELD, resize: 'vertical', minHeight: 96, lineHeight: 1.45 }}
          />
        </div>

        <div>
          <label htmlFor={linkId} style={LABEL}>{t('admin.news.linkLabel')}</label>
          <input
            id={linkId}
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
            value={link}
            onChange={(e) => { setLink(e.target.value); edited(); }}
            placeholder="/deal/12"
            disabled={sending || confirming}
            aria-invalid={linkInvalid || undefined}
            aria-describedby={linkHintId}
            style={linkInvalid ? { ...FIELD, border: '1px solid rgba(248,113,113,0.7)' } : FIELD}
          />
          <div id={linkHintId} style={{ fontSize: 12, marginTop: 6, color: linkInvalid ? '#f87171' : MUTED, lineHeight: 1.4 }}>
            {linkInvalid ? t('admin.news.linkInvalid') : t('admin.news.linkHint')}
          </div>
        </div>

        {/* A real checkbox in a 44px row: the whole line is the hit area. */}
        <label htmlFor={pushId} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: 'pointer' }}>
          <input
            id={pushId}
            type="checkbox"
            checked={withPush}
            onChange={(e) => { setWithPush(e.target.checked); edited(); }}
            disabled={sending || confirming}
            style={{ width: 20, height: 20, accentColor: '#FD7666', flexShrink: 0 }}
          />
          <span style={{ color: '#fff', fontSize: 14, lineHeight: 1.35 }}>{t('admin.news.pushLabel')}</span>
        </label>

        <div role="status" style={{ fontSize: 13, color: MUTED }}>
          {audience
            ? t('admin.news.audience', { total: num(audience.total), pushOptIn: num(audience.pushOptIn) })
            : t('admin.news.audienceLoading')}
        </div>

        {!confirming ? (
          <button
            type="button"
            onClick={() => { setConfirming(true); setResult(null); setError(''); }}
            disabled={!valid || sending}
            style={{
              ...BTN, alignSelf: 'flex-start',
              border: valid ? 'none' : '1px solid rgba(255,255,255,0.15)',
              background: valid ? '#FD7666' : 'transparent',
              color: valid ? '#fff' : 'rgba(255,255,255,0.4)',
              cursor: valid ? 'pointer' : 'default',
            }}
          >
            {t('admin.news.review')}
          </button>
        ) : (
          <div
            role="alertdialog"
            aria-labelledby={confirmId}
            style={{ borderTop: DIVIDER, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div id={confirmId} style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{t('admin.news.confirmTitle')}</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 1.5 }}>
              {audience ? t('admin.news.confirmBody', { total: num(audience.total) }) : t('admin.news.confirmBodyUnknown')}
              {' '}
              {withPush
                ? (audience ? t('admin.news.confirmPush', { pushOptIn: num(audience.pushOptIn) }) : '')
                : t('admin.news.confirmNoPush')}
            </div>

            {/* Exactly what lands in the bell — the last chance to spot a typo. */}
            <div aria-label={t('admin.news.preview')} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(253,118,102,0.08)', borderLeft: '3px solid #FD7666', borderRadius: 12, padding: 12 }}>
              <span aria-hidden="true" style={{ fontSize: 20, lineHeight: '24px' }}>📣</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, overflowWrap: 'anywhere' }}>{cleanTitle}</div>
                <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 1.4, marginTop: 4, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{cleanMessage}</div>
                {cleanLink && (
                  <div style={{ color: MUTED, fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>→ {cleanLink}</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* Focus lands on the harmless choice: Enter right after opening
                  the confirm must not send to everyone. */}
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                disabled={sending}
                style={{ ...BTN, flex: '1 1 120px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#fff' }}
              >
                {t('admin.news.cancel')}
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                style={{
                  ...BTN, flex: '1 1 120px', border: 'none', background: '#FD7666', color: '#fff',
                  cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? t('admin.news.sending') : t('admin.news.confirmSend')}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div role="status" style={{ color: '#4ade80', fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>
            {t('admin.news.sent', { recipients: num(result.recipients) })}
            {result.push ? ` ${t('admin.news.sentPush', { pushRecipients: num(result.pushRecipients) })}` : ''}
          </div>
        )}
        {error && (
          <div role="alert" style={{ color: '#f87171', fontSize: 13, lineHeight: 1.45 }}>{error}</div>
        )}
      </div>

      <h3 style={{ ...H2, fontSize: 12, marginTop: 20 }}>{t('admin.news.recentTitle')}</h3>
      {recent.length === 0 ? (
        <div style={{ ...CARD, padding: 16, fontSize: 13, color: MUTED }}>{t('admin.news.recentEmpty')}</div>
      ) : (
        <ul style={{ ...CARD, listStyle: 'none', margin: 0, padding: 0, overflow: 'hidden' }}>
          {recent.map((p, i) => (
            <li key={p.id} style={{ padding: '12px 16px', borderBottom: i < recent.length - 1 ? DIVIDER : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>{p.title}</span>
                {p.status && p.status !== 'sent' && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: p.status === 'failed' ? '#f87171' : '#fbbf24' }}>
                    {t(`admin.news.status.${p.status === 'failed' ? 'failed' : 'sending'}`)}
                  </span>
                )}
              </div>
              <div style={{ color: MUTED, fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' }}>
                {new Date(p.created_at).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {t('admin.news.recentMeta', { recipients: num(p.recipients), push: num(p.push_recipients) })}
                {p.created_by_name ? ` · ${t('admin.news.recentBy', { name: p.created_by_name })}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminNewsSection;
