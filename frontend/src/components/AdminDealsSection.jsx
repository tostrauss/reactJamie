import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deals as dealsApi, upload } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { loadGoogleMaps, onGoogleMapsReady } from '../utils/googleMaps';
import { ALLOWED_COUNTRIES_LOWER } from '../utils/regions';

/**
 * Admin CRUD for Kooperationen (sponsored deals). Embedded inside
 * AdminDashboard. Lists every active deal with edit/delete actions and a
 * collapsible "Neue Kooperation" form covering Robert's required fields:
 *   - company name
 *   - 2-word headline
 *   - longer description (shown on the deal detail page)
 *   - company photo (uploaded via /api/upload, stored as photos[0])
 *   - visible-until date
 */

const emptyForm = () => ({
  id: null,
  name: '',
  deal_label: '',
  description: '',
  address: '', // free-form address; backend geocodes it to lat/lng for the map
  booking_url: '', // optional external link → "Jetzt buchen" CTA (e.g. ticket shop)
  visible_until: '', // YYYY-MM-DD in the input
  photo_url: '',
  max_redemptions: '100', // global cap; empty = unlimited (auto-offline at cap)
  redeem_interval: 'once', // once | daily | weekly — how often a user may redeem
  redeem_days: [], // ISO weekdays (1=Mon … 7=Sun); empty = any day
});

const todayIso = () => new Date().toISOString().slice(0, 10);

// ISO weekday chips for the "nur an bestimmten Tagen einlösbar" picker.
const WEEKDAYS = [
  { n: 1, label: 'Mo' }, { n: 2, label: 'Di' }, { n: 3, label: 'Mi' },
  { n: 4, label: 'Do' }, { n: 5, label: 'Fr' }, { n: 6, label: 'Sa' }, { n: 7, label: 'So' },
];

export const AdminDealsSection = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const fileRef = useRef(null);
  const addressRef = useRef(null);
  const dealAcRef = useRef(null);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  // Google Maps script for the address autocomplete — same picker as group/club
  // creation. Load once.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);

  // Attach Places Autocomplete to the address field whenever the form is open.
  // The deal address was a plain text input → no location suggestions/map hint
  // like group/club creation had (Tobi 2026-08-05). Re-attaches on each open.
  useEffect(() => {
    if (!showForm) { dealAcRef.current = null; return; }
    const attach = () => {
      if (!window.google?.maps?.places || dealAcRef.current || !addressRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(addressRef.current, {
        componentRestrictions: { country: ALLOWED_COUNTRIES_LOWER },
        fields: ['formatted_address', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || addressRef.current?.value || '';
        if (val) setForm(p => ({ ...p, address: val }));
      });
      dealAcRef.current = ac;
    };
    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    return () => clearTimeout(timer);
  }, [showForm]);

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

  const onPhotoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await upload.image(file);
      const url = res.data?.url;
      if (!url) throw new Error('no url');
      setForm(prev => ({ ...prev, photo_url: url }));
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.toast.uploadError'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const startNew = () => {
    setForm(emptyForm());
    setShowForm(true);
  };

  const startEdit = (deal) => {
    setForm({
      id: deal.id,
      name: deal.name || '',
      deal_label: deal.deal_label || '',
      description: deal.description || '',
      address: deal.address || '',
      booking_url: deal.booking_url || '',
      visible_until: deal.visible_until ? deal.visible_until.slice(0, 10) : '',
      photo_url: Array.isArray(deal.photos) && deal.photos.length > 0 ? deal.photos[0] : '',
      max_redemptions: deal.max_redemptions == null ? '' : String(deal.max_redemptions),
      redeem_interval: deal.redeem_interval || 'once',
      redeem_days: Array.isArray(deal.redeem_days) ? deal.redeem_days : [],
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setForm(emptyForm());
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.deal_label.trim()) {
      toast.error(t('admin.deals.toast.requiredFields'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        deal_label: form.deal_label.trim(),
        description: form.description.trim() || null,
        // Backend geocodes a non-empty address to lat/lng (Austria-first) so the
        // deal-detail map renders. Empty = no address.
        address: form.address.trim() || null,
        // Optional external link. Set → a "Jetzt buchen" button on the deal page
        // opens it (ticket shop / booking). Per-deal, so it never shows on deals
        // that don't set it (Tina 2026-07-31: "nicht bei jedem Deal").
        booking_url: form.booking_url.trim() || null,
        photos: form.photo_url ? [form.photo_url] : [],
        visible_until: form.visible_until || null,
        // Empty input = unlimited (null); otherwise the global redemption cap.
        max_redemptions: form.max_redemptions.trim() === '' ? null : form.max_redemptions.trim(),
        redeem_interval: form.redeem_interval || 'once',
        redeem_days: form.redeem_days,
      };
      if (form.id) {
        await dealsApi.update(form.id, payload);
      } else {
        await dealsApi.create(payload);
      }
      toast.success(t('admin.deals.toast.saved'));
      setShowForm(false);
      setForm(emptyForm());
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('admin.deals.toast.saveError'));
    } finally {
      setSaving(false);
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
        {!showForm && (
          <button onClick={startNew} style={btnPrimary}>+ {t('admin.deals.newBtn')}</button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ background: '#252544', borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <h3 style={{ color: '#FD7666', fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
            {form.id ? t('admin.deals.editTitle') : t('admin.deals.newTitle')}
          </h3>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.company')} *</label>
            <input
              type="text"
              maxLength={255}
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder={t('admin.deals.fields.companyPlaceholder')}
              style={inputStyle}
              required
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.headline')} *</label>
            <input
              type="text"
              maxLength={100}
              value={form.deal_label}
              onChange={e => setForm(p => ({ ...p, deal_label: e.target.value }))}
              placeholder={t('admin.deals.fields.headlinePlaceholder')}
              style={inputStyle}
              required
            />
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.headlineHint')}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.description')}</label>
            <textarea
              maxLength={2000}
              rows={4}
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder={t('admin.deals.fields.descriptionPlaceholder')}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
            />
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.descriptionHint')}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.address', { defaultValue: 'Adresse' })}</label>
            <input
              ref={addressRef}
              type="text"
              maxLength={500}
              value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
              placeholder={t('admin.deals.fields.addressPlaceholder', { defaultValue: 'z.B. Hauptstraße 1, 1010 Wien' })}
              style={inputStyle}
              autoComplete="off"
            />
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.addressHint', { defaultValue: 'Österreich-Adresse — wird automatisch in eine Karte auf der Deal-Seite umgewandelt.' })}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.bookingUrl', { defaultValue: 'Externer Link / Ticketshop (optional)' })}</label>
            <input
              type="url"
              inputMode="url"
              maxLength={2000}
              value={form.booking_url}
              onChange={e => setForm(p => ({ ...p, booking_url: e.target.value }))}
              placeholder="https://…"
              style={inputStyle}
            />
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.bookingUrlHint', { defaultValue: 'Wenn gesetzt, erscheint auf der Deal-Seite ein „Jetzt buchen"-Button, der diesen Link öffnet (z.B. euer Ticketshop). Leer lassen = kein Button.' })}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.redeemInterval', { defaultValue: 'Wie oft einlösbar?' })}</label>
            <select
              value={form.redeem_interval}
              onChange={e => setForm(p => ({ ...p, redeem_interval: e.target.value }))}
              style={inputStyle}
            >
              <option value="once">{t('admin.deals.intervals.once', { defaultValue: 'Einmalig pro Nutzer' })}</option>
              <option value="weekly">{t('admin.deals.intervals.weekly', { defaultValue: '1× pro Woche' })}</option>
              <option value="daily">{t('admin.deals.intervals.daily', { defaultValue: '1× pro Tag' })}</option>
            </select>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.redeemIntervalHint', { defaultValue: 'Wiederkehrend (z.B. wöchentlich) für Stamm-Angebote wie „Welcome Shot jeden Donnerstag". Das globale Limit unten gilt dann nicht.' })}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.redeemDays', { defaultValue: 'Nur an bestimmten Tagen einlösbar?' })}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WEEKDAYS.map(({ n, label }) => {
                const active = form.redeem_days.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm(p => ({
                      ...p,
                      redeem_days: active ? p.redeem_days.filter(d => d !== n) : [...p.redeem_days, n].sort((a, b) => a - b),
                    }))}
                    style={{
                      minWidth: 40, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${active ? '#FD7666' : 'rgba(255,255,255,0.15)'}`,
                      background: active ? 'rgba(253,118,102,0.18)' : 'transparent',
                      color: active ? '#FD7666' : 'rgba(255,255,255,0.7)',
                      fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.redeemDaysHint', { defaultValue: 'Leer = jeden Tag einlösbar. Sonst nur an den gewählten Tagen (z.B. nur Do).' })}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.visibleUntil')}</label>
            <input
              type="date"
              min={todayIso()}
              value={form.visible_until}
              onChange={e => setForm(p => ({ ...p, visible_until: e.target.value }))}
              style={inputStyle}
            />
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.visibleUntilHint')}
            </p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t('admin.deals.fields.maxRedemptions')}</label>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="100"
              value={form.max_redemptions}
              onChange={e => setForm(p => ({ ...p, max_redemptions: e.target.value }))}
              style={inputStyle}
            />
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 }}>
              {t('admin.deals.fields.maxRedemptionsHint')}
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('admin.deals.fields.photo')}</label>
            {form.photo_url ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={form.photo_url}
                  alt=""
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10 }}
                />
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, photo_url: '' }))}
                  style={btnGhost}
                >
                  {t('admin.deals.fields.photoRemove')}
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPhotoPick}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  style={{ ...btnGhost, width: '100%', padding: '14px 16px' }}
                >
                  {uploading ? t('admin.deals.fields.photoUploading') : t('admin.deals.fields.photoPick')}
                </button>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving || uploading} style={{ ...btnPrimary, flex: 1 }}>
              {saving ? t('admin.deals.savingBtn') : t('admin.deals.saveBtn')}
            </button>
            <button type="button" onClick={cancelForm} style={btnGhost}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
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
          const redemptions = deal.redemption_count ?? 0;
          const cap = deal.max_redemptions ?? null; // null = unlimited
          const capReached = cap != null && redemptions >= cap;
          const dimmed = isExpired || isInactive || capReached;
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
                    🎟 {cap != null ? `${redemptions} / ${cap}` : t('admin.deals.redemptionsCount', { count: redemptions })}
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
                  {capReached && (
                    <div style={{ color: '#ff7a7a', fontSize: 11, fontWeight: 600 }}>
                      {t('admin.deals.capReachedLabel')}
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
                <button onClick={() => remove(deal)} style={{ ...btnGhost, padding: '8px 12px', fontSize: 12, color: '#ff7a7a' }}>
                  {t('admin.deals.deleteBtn')}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default AdminDealsSection;
