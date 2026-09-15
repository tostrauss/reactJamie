import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { reports as reportsApi, admin, messages as messagesApi, groups as groupsApi, clubs as clubsApi, directMessages as dmApi } from '../utils/api';

/**
 * Moderation queue (reports → GET /api/reports).
 *
 * Before 2026-09-15 there was NO admin UI for reports at all: the endpoint
 * existed and nothing in the frontend called it, so the only signal a report
 * ever produced was an e-mail reading "Typ: user · ID: 984". Whoever got that
 * mail had to open the database to find out who #984 was.
 *
 * Every report here therefore renders the RESOLVED target the server sends —
 * the reported person's name and e-mail, the reported group, or the reported
 * message's actual text — plus one tap to open it and one tap to close the
 * report out. Same self-loading, 404-tolerant convention as
 * AdminFeedbackSection: an old backend without the route simply hides this.
 */
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 16 };
const MUTED = 'rgba(255,255,255,0.5)';

// Reason → colour. `inappropriate` and `harassment` are the two that usually
// need same-day attention, so they get the alarm colour and the rest do not —
// a queue where everything is red is a queue nobody triages.
const REASON_STYLE = {
  harassment:    { color: '#ff6b6b', bg: 'rgba(255,107,107,0.14)' },
  inappropriate: { color: '#ff8a80', bg: 'rgba(255,138,128,0.12)' },
  fake:          { color: '#FFD54F', bg: 'rgba(255,213,79,0.12)' },
  spam:          { color: '#90CAF9', bg: 'rgba(144,202,249,0.12)' },
  other:         { color: '#B0BEC5', bg: 'rgba(176,190,197,0.12)' },
};

const STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'];
const PAGE = 50;

// 44px minimum touch target — /admin is opened from a phone as often as a
// desktop, and these are the buttons that act on a moderation decision.
const BTN = {
  minHeight: 44, padding: '0 16px', borderRadius: 12, border: 'none',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: '1 1 auto',
};

export const AdminReportsSection = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);     // null = loading / route unavailable
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async (nextStatus) => {
    setRows(null);
    try {
      const res = await reportsApi.list({ status: nextStatus, limit: PAGE });
      setRows(res.data.reports || []);
      setCounts(res.data.counts || {});
      setTotal(res.data.total || 0);
    } catch {
      setUnavailable(true);   // route missing on an old backend → hide section
    }
  }, []);

  useEffect(() => { load(status); }, [status, load]);

  const loadMore = async () => {
    if (loadingMore || !rows) return;
    setLoadingMore(true);
    try {
      const res = await reportsApi.list({ status, limit: PAGE, offset: rows.length });
      setRows(prev => [...prev, ...(res.data.reports || [])]);
      setTotal(res.data.total || 0);
    } catch { /* keep what we have */ }
    setLoadingMore(false);
  };

  // ── Enforcement, next to the decision ────────────────────────────────────
  // Until 2026-09-15 this queue could only label a report. Removing the
  // reported content or stopping the account was impossible from here — the
  // only lever in the whole product was an irreversible account hard-delete
  // that did not even remove the message (audit finding 11). Both actions
  // below are reversible-ish: the message soft-deletes (the row survives as
  // evidence) and the freeze is a plain is_active flip.
  const enforce = async (report, kind) => {
    const tg = report.target;
    const confirmMsg = (kind === 'deleteMessage' || kind === 'deleteDm')
      ? t('admin.reports.confirmDeleteMessage')
      : kind === 'deleteGroup'
        ? t('admin.reports.confirmDeleteGroup', { name: tg?.name || `#${tg?.id}` })
        : t('admin.reports.confirmFreeze', { name: tg?.name || `#${tg?.id}` });
    if (!window.confirm(confirmMsg)) return;
    setBusyId(report.id);
    try {
      if (kind === 'deleteDm') {
        // NEVER messagesApi.delete here: a dm id addresses `direct_messages`,
        // and messages.delete would soft-delete whichever unrelated GROUP
        // message happens to carry the same SERIAL.
        await dmApi.deleteMessage(tg.id);
        setRows(prev => prev.map(r => (r.id === report.id
          ? { ...r, target: { ...r.target, deleted: true } } : r)));
      } else if (kind === 'deleteMessage') {
        await messagesApi.delete(tg.id);
        // Reflect it on the card immediately: the evidence row is kept, so the
        // admin should see "gelöscht" rather than the message vanishing.
        setRows(prev => prev.map(r => (r.id === report.id
          ? { ...r, target: { ...r.target, deleted: true } } : r)));
      } else if (kind === 'deleteGroup') {
        // Clubs and club events have their own endpoints (the club one also
        // busts the discover/map caches and lets a club manager act).
        if (tg.entity_type === 'club') await clubsApi.delete(tg.id);
        else await groupsApi.delete(tg.id);
        setRows(prev => prev.map(r => (r.id === report.id
          ? { ...r, target: { ...r.target, deleted: true } } : r)));
      } else {
        const freeze = kind === 'freeze';
        await admin.setUserActive(tg.id, !freeze);
        setRows(prev => prev.map(r => (r.id === report.id
          ? { ...r, target: { ...r.target, frozen: freeze } } : r)));
      }
      // No toast: the card itself changes (the button flips, the message is
      // marked deleted), which is the clearer confirmation.
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err?.response?.data?.error || t('admin.reports.actionFailed'));
    }
    setBusyId(null);
  };

  const act = async (id, next) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await reportsApi.setStatus(id, next);
      // The row no longer belongs in the list we are looking at — drop it and
      // move the badge, rather than re-fetching the whole page under the
      // admin's finger.
      setRows(prev => prev.filter(r => r.id !== id));
      setTotal(n => Math.max(0, n - 1));
      setCounts(c => ({
        ...c,
        [status]: Math.max(0, (c[status] || 0) - 1),
        [next]: (c[next] || 0) + 1,
      }));
    } catch {
      // Leave the row in place: a failed action must not look like it worked.
      alert(t('admin.reports.actionFailed'));
    }
    setBusyId(null);
  };

  if (unavailable) return null;

  const locale = (i18n.resolvedLanguage || 'de').startsWith('en') ? 'en-US'
    : (i18n.resolvedLanguage || 'de').startsWith('it') ? 'it-IT'
    : (i18n.resolvedLanguage || 'de').startsWith('fr') ? 'fr-FR'
    : (i18n.resolvedLanguage || 'de').startsWith('es') ? 'es-ES' : 'de-DE';
  const fmtDate = (d) => (d ? new Date(d).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  // ── The reported thing, rendered per kind ────────────────────────────────
  const renderTarget = (r) => {
    const tg = r.target;
    if (!tg || tg.missing) {
      return <div style={{ fontSize: 13, color: '#e0a86a' }}>{t('admin.reports.targetGone', { type: t(`admin.reports.type.${r.reported_type}`), id: r.reported_id })}</div>;
    }

    if (tg.kind === 'user') {
      return (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {tg.name} <span style={{ fontWeight: 400, color: MUTED, fontSize: 13 }}>#{tg.id}</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2, wordBreak: 'break-word' }}>
            {[tg.email, tg.location, tg.joined_at && t('admin.reports.memberSince', { date: new Date(tg.joined_at).toLocaleDateString(locale) })]
              .filter(Boolean).join(' · ')}
          </div>
          {tg.bio && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{tg.bio}</div>}
        </div>
      );
    }

    if (tg.kind === 'group') {
      return (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {tg.name} <span style={{ fontWeight: 400, color: MUTED, fontSize: 13 }}>#{tg.id}</span>
            {tg.deleted && <span style={{ color: '#e0a86a', fontSize: 12, marginLeft: 6 }}>{t('admin.reports.deleted')}</span>}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2, wordBreak: 'break-word' }}>
            {[t(`admin.reports.entity.${tg.entity_type}`, { defaultValue: tg.entity_type }), tg.category, tg.location,
              tg.owner && t('admin.reports.createdBy', { name: tg.owner.name })].filter(Boolean).join(' · ')}
          </div>
          {tg.description && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{tg.description}</div>}
        </div>
      );
    }

    // message / dm — the content IS the evidence, so it is the most prominent
    // thing on the card. It comes snapshotted from the server precisely so a
    // report stays judgeable after the message is deleted.
    //
    // The two differ only in the byline: a group message names its author and
    // chat, a DM names sender → receiver (there is no chat to open — it is a
    // private two-party thread, and admins have no route into one).
    const isDm = tg.kind === 'dm';
    return (
      <div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 6, wordBreak: 'break-word' }}>
          {(isDm
            ? [tg.sender ? t('admin.reports.byAuthor', { name: tg.sender.name, id: tg.sender.id }) : t('admin.reports.authorGone'),
               tg.receiver && t('admin.reports.toReceiver', { name: tg.receiver.name }),
               fmtDate(tg.created_at)]
            : [tg.author ? t('admin.reports.byAuthor', { name: tg.author.name, id: tg.author.id }) : t('admin.reports.authorGone'),
               tg.group && t('admin.reports.inChat', { name: tg.group.name }),
               fmtDate(tg.created_at)]
          ).filter(Boolean).join(' · ')}
        </div>
        <div style={{
          fontSize: 14, color: '#fff', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: 'rgba(0,0,0,0.25)', borderLeft: '3px solid var(--accent-coral, #FD7666)',
          borderRadius: 8, padding: '10px 12px',
        }}>
          {tg.content}
          {/* For a voice note or a photo, `content` is only the label — the
              thing being judged is the media itself, so play/show it here.
              Without this a reported photo is unreviewable: the card would
              read "📷 Foto" and offer nothing to look at. */}
          {tg.media_url && tg.message_type === 'image' && (
            <img
              src={tg.media_url}
              alt=""
              style={{ display: 'block', marginTop: 8, maxWidth: '100%', maxHeight: 320, borderRadius: 6 }}
            />
          )}
          {tg.media_url && tg.message_type === 'voice' && (
            <audio src={tg.media_url} controls preload="none" style={{ display: 'block', marginTop: 8, width: '100%' }} />
          )}
        </div>
        {tg.deleted && <div style={{ fontSize: 12, color: '#e0a86a', marginTop: 6 }}>{t('admin.reports.messageDeleted')}</div>}
      </div>
    );
  };

  return (
    <div id="reports" style={{ marginBottom: 32, scrollMarginTop: 16 }}>
      <h2 style={H2}>{t('admin.sections.reportsFmt', { count: counts.pending || 0 })}</h2>

      {/* Status filter — the queue is only useful if handled reports can leave
          it AND still be found again. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              minHeight: 44, padding: '0 14px', borderRadius: 12, cursor: 'pointer',
              border: `1.5px solid ${status === s ? 'var(--accent-coral, #FD7666)' : 'rgba(255,255,255,0.15)'}`,
              background: status === s ? 'rgba(253,118,102,0.15)' : 'transparent',
              color: status === s ? 'var(--accent-coral, #FD7666)' : 'rgba(255,255,255,0.65)',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {t(`admin.reports.status.${s}`)}{counts[s] ? ` (${counts[s]})` : ''}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div style={{ ...CARD, fontSize: 13, color: MUTED }}>{t('admin.reports.loading')}</div>
      ) : rows.length === 0 ? (
        <div style={{ ...CARD, fontSize: 13, color: MUTED }}>{t('admin.reports.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => {
            const rs = REASON_STYLE[r.reason] || REASON_STYLE.other;
            const tg = r.target;
            const busy = busyId === r.id;
            return (
              <div key={r.id} style={CARD}>
                {/* header: reason, type, repeat count, age */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: rs.color, background: rs.bg, borderRadius: 8, padding: '3px 8px' }}>
                    {t(`admin.reports.reason.${r.reason}`, { defaultValue: r.reason })}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
                    {t(`admin.reports.type.${r.reported_type}`)}
                  </span>
                  {tg?.report_count > 1 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#ffb74d', background: 'rgba(255,183,77,0.14)', borderRadius: 8, padding: '3px 8px' }}>
                      {t('admin.reports.repeatFmt', { count: tg.report_count })}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>
                    #{r.id} · {fmtDate(r.created_at)}
                  </span>
                </div>

                {/* the reported thing */}
                {renderTarget(r)}

                {/* who reported it, and what they wrote */}
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: 12, color: MUTED, wordBreak: 'break-word' }}>
                    {t('admin.reports.reportedBy', { name: r.reporter_name, id: r.reporter_id })}
                    {r.reporter_email ? ` · ${r.reporter_email}` : ''}
                  </div>
                  {r.details
                    ? <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.5, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.details}</div>
                    : <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', marginTop: 6, fontStyle: 'italic' }}>{t('admin.reports.noDetails')}</div>}
                  {r.reviewed_by_name && (
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>
                      {t('admin.reports.reviewedBy', { name: r.reviewed_by_name, date: fmtDate(r.reviewed_at) })}
                    </div>
                  )}
                </div>

                {/* actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {tg?.path && (
                    <button
                      onClick={() => navigate(tg.path)}
                      style={{ ...BTN, background: 'rgba(255,255,255,0.08)', color: '#fff' }}
                    >
                      {t(tg.kind === 'message' ? 'admin.reports.openChat' : 'admin.reports.openTarget')}
                    </button>
                  )}
                  {status !== 'resolved' && (
                    <button
                      onClick={() => act(r.id, 'resolved')}
                      disabled={busy}
                      style={{ ...BTN, background: 'var(--accent-coral, #FD7666)', color: '#fff', opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? '…' : t('admin.reports.markResolved')}
                    </button>
                  )}
                  {status !== 'dismissed' && (
                    <button
                      onClick={() => act(r.id, 'dismissed')}
                      disabled={busy}
                      style={{ ...BTN, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)', opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? '…' : t('admin.reports.dismiss')}
                    </button>
                  )}
                  {status !== 'pending' && (
                    <button
                      onClick={() => act(r.id, 'pending')}
                      disabled={busy}
                      style={{ ...BTN, background: 'transparent', color: MUTED, border: '1.5px solid rgba(255,255,255,0.15)' }}
                    >
                      {busy ? '…' : t('admin.reports.reopen')}
                    </button>
                  )}
                </div>

                {/* Enforcement — visually separated from the triage buttons
                    above, because these change the world rather than the
                    queue. Only shown where there is something to act on. */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {tg?.kind === 'dm' && !tg.missing && !tg.deleted && (
                    <button
                      onClick={() => enforce(r, 'deleteDm')}
                      disabled={busy}
                      style={{ ...BTN, background: 'rgba(255,107,107,0.14)', color: '#ff6b6b', opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? '…' : t('admin.reports.deleteMessage')}
                    </button>
                  )}
                  {tg?.kind === 'message' && !tg.missing && !tg.deleted && (
                    <button
                      onClick={() => enforce(r, 'deleteMessage')}
                      disabled={busy}
                      style={{ ...BTN, background: 'rgba(255,107,107,0.14)', color: '#ff6b6b', opacity: busy ? 0.5 : 1 }}
                    >
                      {t('admin.reports.deleteMessage')}
                    </button>
                  )}
                  {/* A reported group/club can now be taken down from here —
                      the decision and the enforcement in one place. Until
                      2026-09-15 deleteGroup was owner-only, so an admin
                      looking at this card had no way to remove the thing at
                      all. */}
                  {tg?.kind === 'group' && !tg.missing && !tg.deleted && (
                    <button
                      onClick={() => enforce(r, 'deleteGroup')}
                      disabled={busy}
                      style={{ ...BTN, background: 'rgba(255,107,107,0.14)', color: '#ff6b6b', opacity: busy ? 0.5 : 1 }}
                    >
                      {t(tg.entity_type === 'club' ? 'admin.reports.deleteClub' : 'admin.reports.deleteGroup')}
                    </button>
                  )}
                  {tg?.kind === 'user' && !tg.missing && !tg.is_admin && (
                    <button
                      onClick={() => enforce(r, tg.frozen ? 'unfreeze' : 'freeze')}
                      disabled={busy}
                      style={{ ...BTN, background: 'rgba(255,107,107,0.14)', color: '#ff6b6b', opacity: busy ? 0.5 : 1 }}
                    >
                      {t(tg.frozen ? 'admin.reports.unfreezeUser' : 'admin.reports.freezeUser')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {rows.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{ ...BTN, background: 'rgba(255,255,255,0.08)', color: '#fff', flex: 'none' }}
            >
              {loadingMore ? '…' : t('admin.reports.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
