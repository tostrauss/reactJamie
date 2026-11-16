import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deals as dealsApi } from '../utils/api';
import { useToast } from '../context/ToastContext';
import DealForm from './DealForm';

/**
 * Admin CRUD for Kooperationen (sponsored deals). Embedded inside
 * AdminDashboard. Lists every active deal with edit/delete actions and a
 * collapsible "Neue Kooperation" form covering Robert's required fields:
 *   - company name
 *   - 2-word headline
 *   - longer description (shown on the deal detail page)
 *   - company photo (uploaded via /api/upload, stored as photos[0])
 *   - visible-until date
 * The form itself is DealForm (variant 'admin') since 16.11.2026 — clubs
 * with JAMIE Pro fill in the same one for their own deals (P4 v2).
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

// The event a deal is hung on, as an admin pastes it: the bare ID or the
// event page's link (…/group/527, also with a slash, query or hash behind).
// → the id, or null for anything else.
const parseEventId = (input) => {
  const s = String(input || '').trim();
  const m = s.match(/^#?(\d+)$/) || s.match(/\/group\/(\d+)(?:[/?#]|$)/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

// An event's day as its creator typed it: the stored Vienna wall-clock comes
// back tagged UTC, so it is read in UTC (utils/eventDate.js).
const eventDay = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : null;
};

export const AdminDealsSection = () => {
  const { t } = useTranslation();
  const toast = useToast();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  // The open form: null = closed, { deal: null } = a new one, { deal } = editing.
  const [formFor, setFormFor] = useState(null);

  // Admin endpoint returns inactive + expired deals too, plus a
  // redemption_count per row joined in from deal_redemptions.
  const load = async () => {
    setLoading(true);
    try {
      const res = await dealsApi.getAllForAdmin();
      setList(res.data || []);
    } catch {
      toast.error(t('admin.deals.toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const [exportingId, setExportingId] = useState(null);

  const exportRedemptions = async (deal) => {
    setExportingId(deal.id);
    try {
      const res = await dealsApi.getRedemptions(deal.id);
      const rows = res.data || [];
      if (!rows.length) {
        toast.error(t('admin.deals.toast.noRedemptions'));
        return;
      }
      // RFC 4180 CSV escaper: wrap every field in quotes, double any internal
      // quotes, and strip the carriage returns / newlines that Excel + Google
      // Sheets interpret as a new row mid-field. JSON.stringify was previously
      // used here but it doesn't escape embedded CR/LF inside a field — a
      // user_name containing "\n" would break the row count.
      const csvEscape = (v) => {
        const s = (v == null ? '' : String(v)).replace(/\r?\n|\r/g, ' ');
        return `"${s.replace(/"/g, '""')}"`;
      };
      const headers = ['user_id', 'user_name', 'user_email', 'redeemed_at'];
      const csvLines = [
        headers.join(','),
        ...rows.map(r => headers.map(h => csvEscape(r[h])).join(',')),
      ];
      // CRLF line endings so Excel on Windows opens the file without warnings.
      // BOM prefix forces UTF-8 detection (umlauts in user_name don't get
      // mangled when an admin opens the file in Excel-DE).
      const blob = new Blob(['﻿' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deal-${deal.id}-redemptions.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('admin.deals.toast.exportError'));
    } finally {
      setExportingId(null);
    }
  };

  const startNew = () => setFormFor({ deal: null });
  const startEdit = (deal) => setFormFor({ deal });
  const cancelForm = () => setFormFor(null);

  // DealForm checked the required fields and built the payload.
  const saveDeal = async (payload, id) => {
    try {
      if (id) {
        await dealsApi.update(id, payload);
      } else {
        await dealsApi.create(payload);
      }
      toast.success(t('admin.deals.toast.saved'));
      setFormFor(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.toast.saveError'));
    }
  };

  // "Neue Runde starten" (Tina 24.09.2026): reopen a 'once' deal for everyone
  // without losing the old redemptions — they keep counting in the stats/CSV,
  // only the per-user lock and the cap restart. Server refuses for daily/weekly.
  // Tina 26.09.2026: a deal is a library entry — reopening it usually means a
  // new end date, so the button opens a one-field panel (date, prefilled with
  // the current date if still valid, else +30 days) and sends both at once.
  const [roundFor, setRoundFor] = useState(null);   // deal.id with the panel open
  const [roundDate, setRoundDate] = useState('');   // YYYY-MM-DD, '' = no expiry
  const [roundSaving, setRoundSaving] = useState(false);
  const openNewRound = (deal) => {
    const stillValid = deal.visible_until && new Date(deal.visible_until) > new Date();
    const plus30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    setRoundDate(stillValid ? deal.visible_until.slice(0, 10) : plus30);
    setRoundFor(deal.id);
  };
  const submitNewRound = async (deal) => {
    setRoundSaving(true);
    try {
      await dealsApi.newRound(deal.id, { visible_until: roundDate || null });
      toast.success(t('admin.deals.toast.newRound'));
      setRoundFor(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.toast.newRoundError'));
    } finally {
      setRoundSaving(false);
    }
  };

  // „An Event hängen“ (P4 v1, Tina 16.11.2026): a deal shows on an event's
  // head card once an admin hangs it there — by the event's ID or simply its
  // link, pasted from the page. Club events and meetups, also a café's deal
  // that belongs to no club. One deal per event: another one replaces it.
  // The server answers deal=null when the deal is attached but not visible
  // right now (expired, inactive or at its limit) — then the toast says so.
  const [attachFor, setAttachFor] = useState(null);      // deal.id with the panel open
  const [attachInput, setAttachInput] = useState('');
  const [attachBusy, setAttachBusy] = useState(false);
  const [detachingKey, setDetachingKey] = useState(null); // `${dealId}:${eventId}`
  const openAttach = (deal) => {
    setAttachInput('');
    setAttachFor(deal.id);
  };
  const submitAttach = async (deal) => {
    if (attachBusy) return;
    const eventId = parseEventId(attachInput);
    if (!eventId) {
      toast.error(t('admin.deals.events.toast.invalidId'));
      return;
    }
    setAttachBusy(true);
    try {
      const res = await dealsApi.setEventDeal(eventId, deal.id);
      if (res.data?.deal) toast.success(t('admin.deals.events.toast.attached', { id: eventId }));
      else toast.warning(t('admin.deals.events.toast.attachedHidden', { id: eventId }));
      setAttachFor(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.events.toast.attachError'));
    } finally {
      setAttachBusy(false);
    }
  };
  const detach = async (deal, ev) => {
    const key = `${deal.id}:${ev.id}`;
    if (detachingKey) return;
    setDetachingKey(key);
    try {
      await dealsApi.setEventDeal(ev.id, null);
      toast.success(t('admin.deals.events.toast.detached', { name: ev.name }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.events.toast.detachError'));
    } finally {
      setDetachingKey(null);
    }
  };

  const remove = async (deal) => {
    if (!window.confirm(t('admin.deals.confirmDelete', { name: deal.name }))) return;
    try {
      await dealsApi.remove(deal.id);
      toast.success(t('admin.deals.toast.deleted'));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.toast.deleteError'));
    }
  };

  const headingStyle = {
    color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12,
    opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1,
  };
  const cardStyle = {
    display: 'flex', gap: 12, padding: 12, background: '#252544',
    borderRadius: 12, marginBottom: 8, alignItems: 'center',
  };
  const inputStyle = {
    width: '100%', padding: '10px 12px', background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
    color: '#fff', fontSize: 14, fontFamily: 'inherit',
    boxSizing: 'border-box',
  };
  const labelStyle = { display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 6, fontWeight: 600 };
  const btnPrimary = {
    padding: '10px 18px', borderRadius: 8, background: '#FD7666', color: '#fff',
    border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 14,
  };
  const btnGhost = {
    padding: '10px 18px', borderRadius: 8, background: 'transparent',
    color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer', fontSize: 14,
  };

  return (
    <div id="admin-deals" style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={headingStyle}>{t('admin.deals.title')}</h2>
        {!formFor && (
          <button onClick={startNew} style={btnPrimary}>+ {t('admin.deals.newBtn')}</button>
        )}
      </div>

      {formFor && (
        <DealForm
          key={formFor.deal?.id ?? 'new'}
          variant="admin"
          deal={formFor.deal}
          title={formFor.deal ? t('admin.deals.editTitle') : t('admin.deals.newTitle')}
          onSubmit={saveDeal}
          onCancel={cancelForm}
        />
      )}

      {loading ? (
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{t('admin.deals.loading')}</p>
      ) : list.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontStyle: 'italic' }}>
          {t('admin.deals.empty')}
        </p>
      ) : (
        list.map(deal => {
          const photo = Array.isArray(deal.photos) && deal.photos[0];
          const expiry = deal.visible_until ? new Date(deal.visible_until).toLocaleDateString('de-DE') : null;
          const isExpired = deal.visible_until && new Date(deal.visible_until) < new Date();
          const isInactive = deal.is_active === false;
          const redemptions = deal.redemption_count ?? 0;           // all rounds — the stat
          const roundRedemptions = deal.round_redemption_count ?? redemptions; // current round — what the cap sees
          const round = deal.redeem_round ?? 0;
          const isOnce = (deal.redeem_interval || 'once') === 'once';
          const cap = deal.max_redemptions ?? null; // null = unlimited
          const capReached = isOnce && cap != null && roundRedemptions >= cap;
          const dimmed = isExpired || isInactive || capReached;
          // [{ id, name, date }] — a server before 16.11.2026 sends none.
          const events = Array.isArray(deal.events) ? deal.events : [];
          return (
            <div key={deal.id} style={{ ...cardStyle, opacity: dimmed ? 0.55 : 1, flexWrap: 'wrap' }}>
              <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', background: '#1a1a2e', flexShrink: 0 }}>
                {photo && <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {deal.name}
                  </div>
                  {/* Redemption-count badge — coral when >0, ghost when 0,
                      so an admin can spot well-performing deals at a glance. */}
                  <span
                    title={t('admin.deals.redemptionsTooltip')}
                    style={{
                      flexShrink: 0,
                      padding: '3px 9px',
                      borderRadius: 100,
                      fontSize: 11,
                      fontWeight: 700,
                      background: redemptions > 0 ? 'rgba(253,118,102,0.18)' : 'rgba(255,255,255,0.06)',
                      color: redemptions > 0 ? '#FD7666' : 'rgba(255,255,255,0.5)',
                      border: redemptions > 0 ? '1px solid rgba(253,118,102,0.3)' : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {/* Total across all rounds is the stat; for capped 'once'
                        deals the current round vs. cap is what takes it offline. */}
                    🎟 {t('admin.deals.redemptionsCount', { count: redemptions })}
                    {isOnce && cap != null && (round > 0
                      ? ` · ${t('admin.deals.roundCount', { count: roundRedemptions })} / ${cap}`
                      : ` · ${roundRedemptions} / ${cap}`)}
                  </span>
                </div>
                <div style={{ color: '#FD7666', fontSize: 12, fontWeight: 600 }}>
                  {deal.deal_label}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                  {expiry && (
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                      {isExpired ? t('admin.deals.expiredFmt', { date: expiry }) : t('admin.deals.untilFmt', { date: expiry })}
                    </div>
                  )}
                  {isInactive && (
                    <div style={{ color: '#ff7a7a', fontSize: 11, fontWeight: 600 }}>
                      {t('admin.deals.inactiveLabel')}
                    </div>
                  )}
                  {round > 0 && (
                    <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 600 }}>
                      {t('admin.deals.roundLabel', { round: round + 1 })}
                    </div>
                  )}
                  {capReached && (
                    <div style={{ color: '#ff7a7a', fontSize: 11, fontWeight: 600 }}>
                      {t('admin.deals.capReachedLabel')}
                    </div>
                  )}
                  {/* A club's own deal (P4 v2, 16.11.2026) — put up by the
                      club with Pro, not by JAMIE. */}
                  {deal.club && (
                    <div style={{ color: 'var(--partner-text)', fontSize: 11, fontWeight: 600 }}>
                      {t('admin.deals.clubFmt', { name: deal.club.name })}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => exportRedemptions(deal)}
                  disabled={exportingId === deal.id || redemptions === 0}
                  style={{ ...btnGhost, padding: '8px 12px', fontSize: 12, opacity: redemptions === 0 ? 0.4 : 1 }}
                >
                  {exportingId === deal.id ? '…' : t('admin.deals.exportCsvBtn')}
                </button>
                <button onClick={() => startEdit(deal)} style={{ ...btnGhost, padding: '8px 12px', fontSize: 12 }}>
                  {t('admin.deals.editBtn')}
                </button>
                {isOnce && !isInactive && (
                  <button
                    onClick={() => (roundFor === deal.id ? setRoundFor(null) : openNewRound(deal))}
                    disabled={redemptions === 0 && !isExpired}
                    title={t('admin.deals.confirmNewRound', { name: deal.name })}
                    style={{ ...btnGhost, padding: '8px 12px', fontSize: 12, opacity: redemptions === 0 && !isExpired ? 0.4 : 1 }}
                  >
                    ↻ {t('admin.deals.newRoundBtn')}
                  </button>
                )}
                <button onClick={() => remove(deal)} style={{ ...btnGhost, padding: '8px 12px', fontSize: 12, color: '#ff7a7a' }}>
                  {t('admin.deals.deleteBtn')}
                </button>
              </div>
              {roundFor === deal.id && (
                <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label style={labelStyle}>{t('admin.deals.newRoundDateLabel')}</label>
                    <input
                      type="date"
                      min={todayIso()}
                      value={roundDate}
                      onChange={e => setRoundDate(e.target.value)}
                      style={inputStyle}
                    />
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
                      {t('admin.deals.newRoundDateHint')} · {t('admin.deals.newRoundHint', { count: redemptions })}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => setRoundFor(null)} style={{ ...btnGhost, padding: '8px 12px', fontSize: 12 }}>
                      {t('common.cancel')}
                    </button>
                    <button type="button" onClick={() => submitNewRound(deal)} disabled={roundSaving} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12 }}>
                      {roundSaving ? '…' : `↻ ${t('admin.deals.newRoundStartBtn')}`}
                    </button>
                  </div>
                </div>
              )}
              {/* The events this deal hangs on, each with „Lösen“, and „An
                  Event hängen“ (P4 v1, 16.11.2026). A dimmed deal still hangs
                  there — the event page just does not show it. */}
              {(events.length > 0 || !isInactive) && (
                <div style={{ flexBasis: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {events.map(ev => {
                    const day = eventDay(ev.date);
                    const busy = detachingKey === `${deal.id}:${ev.id}`;
                    return (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <a
                          href={`/group/${ev.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          📍 {ev.name}{day ? ` · ${day}` : ''} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>#{ev.id}</span>
                        </a>
                        <button type="button" onClick={() => detach(deal, ev)} disabled={busy} style={{ ...btnGhost, padding: '6px 10px', fontSize: 12, flexShrink: 0 }}>
                          {busy ? '…' : t('admin.deals.events.detachBtn')}
                        </button>
                      </div>
                    );
                  })}
                  {dimmed && events.length > 0 && (
                    <p style={{ color: '#ff7a7a', fontSize: 11, fontWeight: 600, margin: 0 }}>
                      {t('admin.deals.events.hiddenNote')}
                    </p>
                  )}
                  {isInactive ? null : attachFor === deal.id ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
                      <div style={{ flex: '1 1 200px' }}>
                        <label style={labelStyle} htmlFor={`deal-${deal.id}-event`}>{t('admin.deals.events.inputLabel')}</label>
                        <input
                          id={`deal-${deal.id}-event`}
                          type="text"
                          autoComplete="off"
                          value={attachInput}
                          onChange={e => setAttachInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAttach(deal); } }}
                          placeholder={t('admin.deals.events.inputPlaceholder')}
                          style={inputStyle}
                        />
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
                          {t('admin.deals.events.inputHint')}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => setAttachFor(null)} style={{ ...btnGhost, padding: '8px 12px', fontSize: 12 }}>
                          {t('common.cancel')}
                        </button>
                        <button type="button" onClick={() => submitAttach(deal)} disabled={attachBusy} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12 }}>
                          {attachBusy ? '…' : t('admin.deals.events.attachSubmit')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => openAttach(deal)} style={{ ...btnGhost, padding: '6px 10px', fontSize: 12, alignSelf: 'flex-start' }}>
                      + {t('admin.deals.events.attachBtn')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default AdminDealsSection;
