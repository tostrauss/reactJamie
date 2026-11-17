import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { upload } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { loadGoogleMaps, onGoogleMapsReady, createPlacesAutocomplete } from '../utils/googleMaps';
import { ALLOWED_COUNTRIES } from '../utils/regions';
import { viennaTodayUTC } from '../utils/recurrence';

/**
 * The deal form — company, 2-word headline, description, address, booking
 * link, how often and on which days redeemable, visible until, cap, photo
 * (Robert's fields). Out of AdminDealsSection since P4 v2 (Tina/Tobi
 * 16.11.2026), when clubs with JAMIE Pro started putting up their own deals:
 *   - variant 'admin' — the Kooperationen form in /admin, as before: the
 *     dashboard's inline dark styles, texts under admin.deals.*, "Sichtbar
 *     bis" optional (empty = no expiry).
 *   - variant 'club' — in the club's edit page, in its look (ge-*), texts
 *     under groupEdit.deals.* in all five languages; "Sichtbar bis" required,
 *     from tomorrow (an edit: from today) to CLUB_DEAL_MAX_DAYS ahead in
 *     Vienna days (the server checks the upper limit too; the deal shows
 *     through the day picked); an empty address is the club's own, filled in
 *     by the server.
 * The form checks the required fields and builds the payload; the parent
 * saves it — onSubmit(payload, id) → Promise, id null for a new deal —,
 * shows the toasts and closes the form.
 *
 * `embedded` (Tina 17.11.2026: the bar „Deal anlegen“ in a club's event form
 * — „dann öffnet sich nochmal ein Feld, wo man die Deal Infos reingibt inkl.
 * wann der Deal angezeigt werden soll, eh wie wir es hatten“): the same
 * fields as a PANEL inside someone else's form — a <div role="group">, no
 * title, no Speichern/Abbrechen, no native `required` (the host form decides
 * when to save). On every change it reports
 * onChange({ payload, missing, uploading }) — the payload the server takes,
 * which required fields are still empty (their form keys), and whether a
 * photo is still on its way. „Sichtbar bis“ starts today there: an event
 * today may carry a deal through today.
 * `look` picks the class names of the club variant: 'ge' (the edit page,
 * default) or 'event' (the event form on the club page, cd-event-*).
 */

// Mirrors backend dealController CLUB_DEAL_MAX_DAYS.
export const CLUB_DEAL_MAX_DAYS = 180;

// A Vienna calendar day, N days from today there, as the date input wants it.
// The date picked means through that day in Vienna (the server stores its
// end, dealController visibleUntilFrom) — so „today“ must be Vienna's too:
// toISOString() alone gave the UTC day, a day behind from midnight to 01:00
// (02:00 in summer).
const isoDay = (offsetDays = 0) => new Date(viennaTodayUTC() + offsetDays * 864e5).toISOString().slice(0, 10);

// ISO weekdays (1=Mon … 7=Sun) for "nur an bestimmten Tagen einlösbar", named
// in the UI language — 5 Jan 2026 was a Monday. German without the dot, as
// the admin chips always read ("Mo", "Di", …).
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const weekdayLabel = (n, lang) => {
  let s;
  try {
    s = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + n)));
  } catch {
    s = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][n - 1];
  }
  s = s.replace(/\.$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const formFromDeal = (deal, defaults = {}) => ({
  id: deal?.id ?? null,
  name: deal?.name ?? defaults.name ?? '',
  deal_label: deal?.deal_label || '',
  description: deal?.description || '',
  address: deal?.address || '', // free-form address; backend geocodes it to lat/lng for the map
  booking_url: deal?.booking_url || '', // optional external link → "Jetzt buchen" CTA (e.g. ticket shop)
  // YYYY-MM-DD in the input; a new deal at an event starts out with the
  // event's date (defaults.visible_until)
  visible_until: deal?.visible_until ? deal.visible_until.slice(0, 10) : (defaults.visible_until || ''),
  photo_url: Array.isArray(deal?.photos) && deal.photos.length > 0 ? deal.photos[0] : '',
  // global cap; empty = unlimited (auto-offline at cap)
  max_redemptions: deal ? (deal.max_redemptions == null ? '' : String(deal.max_redemptions)) : '100',
  redeem_interval: deal?.redeem_interval || 'once', // once | daily | weekly — how often a user may redeem
  redeem_days: Array.isArray(deal?.redeem_days) ? deal.redeem_days : [], // ISO weekdays; empty = any day
});

// Which required fields are still empty → their form keys. A club's deal
// needs its end date, JAMIE's does not.
const missingFields = (form, { club }) => [
  !form.name.trim() && 'name',
  !form.deal_label.trim() && 'deal_label',
  club && !form.visible_until && 'visible_until',
].filter(Boolean);

// What the server takes, from the form as it stands.
const buildPayload = (form, { club, deal }) => {
  const address = form.address.trim();
  return {
    name: form.name.trim(),
    deal_label: form.deal_label.trim(),
    description: form.description.trim() || null,
    // Backend geocodes a non-empty address to lat/lng (Austria-first) so the
    // deal-detail map renders. Empty = no address (a club's: the club's).
    // A club's edit leaves an untouched address out, so the server does not
    // geocode it again on every save.
    address: club && form.id && address === (deal?.address || '') ? undefined : (address || null),
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
};

// The class names of the club variant, per look.
const LOOKS = {
  ge: {
    field: 'ge-field', label: 'ge-label', hint: 'ge-hint', divider: true,
    input: 'ge-input', textarea: 'ge-input ge-textarea', chips: 'ge-cat-grid', chip: 'ge-cat-chip',
    photoPick: 'ge-share-btn', photoRemove: 'ge-role-btn',
  },
  event: {
    field: 'cd-event-deal-field', label: 'cd-event-deal-label', hint: 'cd-event-recurring-hint', divider: false,
    input: 'cd-event-input', textarea: 'cd-event-input cd-event-textarea', chips: 'cd-event-deal-chips', chip: 'cd-event-deal-chip',
    photoPick: 'cd-event-deal-photo-btn', photoRemove: 'cd-event-deal-photo-btn',
  },
};

// The admin dashboard's inline look, exactly as the form had it in
// AdminDealsSection.
const ADMIN = {
  form: { background: '#252544', borderRadius: 14, padding: 16, marginBottom: 16 },
  title: { color: '#FD7666', fontSize: 16, fontWeight: 700, marginBottom: 14 },
  input: {
    width: '100%', padding: '10px 12px', background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
    color: '#fff', fontSize: 14, fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  label: { display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 6, fontWeight: 600 },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 },
  btnPrimary: {
    padding: '10px 18px', borderRadius: 8, background: '#FD7666', color: '#fff',
    border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 14,
  },
  btnGhost: {
    padding: '10px 18px', borderRadius: 8, background: 'transparent',
    color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer', fontSize: 14,
  },
};

export default function DealForm({
  variant = 'admin', deal = null, defaults, title, onSubmit, onCancel,
  embedded = false, look = 'ge', onChange,
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const club = variant === 'club';
  const cls = LOOKS[look] || LOOKS.ge;
  const ns = club ? 'groupEdit.deals' : 'admin.deals';
  const k = (key, opts) => t(`${ns}.${key}`, opts);
  const lang = i18n.resolvedLanguage || i18n.language || 'de';
  const idp = `deal-${variant}${embedded ? '-event' : ''}`; // ids for label ↔ input

  const fileRef = useRef(null);
  const addressRef = useRef(null);
  const dealAcRef = useRef(null);
  const [form, setForm] = useState(() => formFromDeal(deal, defaults));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Embedded: the host form saves, so it hears of every change — and of the
  // first state, before anything was typed. The latest onChange is used
  // without making it a dependency (the host passes a new function each
  // render).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!embedded) return;
    onChangeRef.current?.({
      payload: buildPayload(form, { club, deal }),
      missing: missingFields(form, { club }),
      uploading,
    });
  }, [embedded, form, uploading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Google Maps script for the address autocomplete — same picker as group/club
  // creation. Load once.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);

  // Places Autocomplete on the address field while the form is open. The deal
  // address was a plain text input → no location suggestions/map hint like
  // group/club creation had (Tobi 2026-08-05).
  useEffect(() => {
    const attach = () => {
      if (!window.google?.maps?.places || dealAcRef.current || !addressRef.current) return;
      const handle = createPlacesAutocomplete(addressRef.current, {
        // No componentRestrictions: Places accepts at most 5 countries and we sell
        // in 6 (utils/regions.js), so the 6-country list could break the whole
        // dropdown. The country is checked when a place is PICKED instead.
        fields: ['formatted_address', 'name', 'address_components'],
      });
      const ac = handle.autocomplete;
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place.formatted_address || place.name || addressRef.current?.value || '';
        const country = (place.address_components || []).find(c => c.types?.includes('country'))?.short_name || '';
        if (val && ALLOWED_COUNTRIES.includes(country)) {
          setForm(p => ({ ...p, address: val }));
        } else if (val) {
          toast.error(t('createGroup.step2.locationNotATError'));
          setForm(p => ({ ...p, address: '' }));
          if (addressRef.current) addressRef.current.value = '';
        }
      });
      dealAcRef.current = handle;
    };
    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    // Form closes → the input unmounts: drop the binding and Google's dropdown.
    return () => {
      clearTimeout(timer);
      dealAcRef.current?.dispose();
      dealAcRef.current = null;
    };
  }, []);

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
      toast.error(err.response?.data?.error || k('toast.uploadError'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (missingFields(form, { club }).length) {
      toast.error(k('toast.requiredFields'));
      return;
    }
    const payload = buildPayload(form, { club, deal });
    setSaving(true);
    try {
      await onSubmit(payload, form.id);
    } finally {
      setSaving(false);
    }
  };

  // One field: label, control, hint — in the variant's look. A function, not
  // a component, so the inputs keep their focus while typing. The label
  // points at the input `${idp}-${key}`; a group of chips is named by it
  // instead (aria-labelledby `${idp}-${key}-label`), the photo by nothing.
  const field = (key, { label, required, hint, last, labels = 'input' }, control) => {
    const labelProps = labels === 'input' ? { htmlFor: `${idp}-${key}` }
      : labels === 'group' ? { id: `${idp}-${key}-label` } : {};
    return club ? (
      <div key={key}>
        <div className={cls.field}>
          <label className={cls.label} {...labelProps}>{label}{required && ' *'}</label>
          {control}
          {hint && <p className={cls.hint}>{hint}</p>}
        </div>
        {cls.divider && !last && <div className="ge-divider" />}
      </div>
    ) : (
      <div key={key} style={{ marginBottom: last ? 16 : 12 }}>
        <label style={ADMIN.label} {...labelProps}>{label}{required && ' *'}</label>
        {control}
        {hint && <p style={ADMIN.hint}>{hint}</p>}
      </div>
    );
  };
  const inputProps = (key) => (club ? { id: `${idp}-${key}`, className: cls.input } : { id: `${idp}-${key}`, style: ADMIN.input });
  const set = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));
  // Embedded, the fields sit in the host's <form>: a native `required` would
  // stop that form's submit with the browser's own bubble — the host checks
  // `missing` and says it in its own words instead.
  const need = (on = true) => (embedded ? undefined : on);

  const chip = (active, onClick, label, key) => (club ? (
    <button key={key} type="button" className={`${cls.chip}${active ? ' active' : ''}`} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  ) : (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={onClick}
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
  ));

  // „Sichtbar bis“ from: a new club deal starts tomorrow at the earliest; an
  // edit may keep today — a deal „sichtbar bis“ today is live until 23:59:59
  // in Vienna, and min = tomorrow made the browser refuse to save it
  // unchanged (review 16.11.2026). The server takes today, too.
  // Embedded in an event's form, today is fine for a new deal as well: an
  // event today may carry a deal through today.
  const untilMin = club && !form.id && !embedded ? isoDay(1) : isoDay(0);

  const intervals = [
    ['once', k('intervals.once', { defaultValue: 'Einmalig pro Nutzer' })],
    ['weekly', k('intervals.weekly', { defaultValue: '1× pro Woche' })],
    ['daily', k('intervals.daily', { defaultValue: '1× pro Tag' })],
  ];

  const fields = (
    <>
      {field('name', { label: k('fields.company'), required: true },
        <input
          {...inputProps('name')}
          type="text"
          maxLength={255}
          value={form.name}
          onChange={set('name')}
          placeholder={k('fields.companyPlaceholder')}
          required={need()}
        />)}

      {field('label', { label: k('fields.headline'), required: true, hint: k('fields.headlineHint') },
        <input
          {...inputProps('label')}
          type="text"
          maxLength={100}
          value={form.deal_label}
          onChange={set('deal_label')}
          placeholder={k('fields.headlinePlaceholder')}
          required={need()}
        />)}

      {field('description', { label: k('fields.description'), hint: k('fields.descriptionHint') },
        <textarea
          {...(club
            ? { id: `${idp}-description`, className: cls.textarea }
            : { id: `${idp}-description`, style: { ...ADMIN.input, resize: 'vertical', minHeight: 80 } })}
          maxLength={2000}
          rows={4}
          value={form.description}
          onChange={set('description')}
          placeholder={k('fields.descriptionPlaceholder')}
        />)}

      {field('address', {
        label: k('fields.address', { defaultValue: 'Adresse' }),
        hint: k('fields.addressHint', { defaultValue: 'Österreich-Adresse — wird automatisch in eine Karte auf der Deal-Seite umgewandelt.' }),
      },
        <input
          {...inputProps('address')}
          ref={addressRef}
          type="text"
          maxLength={255}
          value={form.address}
          onChange={set('address')}
          placeholder={k('fields.addressPlaceholder', { defaultValue: 'z.B. Hauptstraße 1, 1010 Wien' })}
          autoComplete="off"
        />)}

      {field('booking', {
        label: k('fields.bookingUrl', { defaultValue: 'Externer Link / Ticketshop (optional)' }),
        hint: k('fields.bookingUrlHint', { defaultValue: 'Wenn gesetzt, erscheint auf der Deal-Seite ein „Jetzt buchen"-Button, der diesen Link öffnet (z.B. euer Ticketshop). Leer lassen = kein Button.' }),
      },
        <input
          {...inputProps('booking')}
          type="url"
          inputMode="url"
          maxLength={2000}
          value={form.booking_url}
          onChange={set('booking_url')}
          placeholder="https://…"
        />)}

      {field('interval', {
        label: k('fields.redeemInterval', { defaultValue: 'Wie oft einlösbar?' }),
        hint: k('fields.redeemIntervalHint', { defaultValue: 'Wiederkehrend (z.B. wöchentlich) für Stamm-Angebote wie „Welcome Shot jeden Donnerstag". Das globale Limit unten gilt dann nicht.' }),
        labels: club ? 'group' : 'input',
      }, club ? (
        <div className={cls.chips} role="group" aria-labelledby={`${idp}-interval-label`}>
          {intervals.map(([value, label]) => chip(form.redeem_interval === value,
            () => setForm(p => ({ ...p, redeem_interval: value })), label, value))}
        </div>
      ) : (
        <select {...inputProps('interval')} value={form.redeem_interval} onChange={set('redeem_interval')}>
          {intervals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      ))}

      {field('days', {
        label: k('fields.redeemDays', { defaultValue: 'Nur an bestimmten Tagen einlösbar?' }),
        hint: k('fields.redeemDaysHint', { defaultValue: 'Leer = jeden Tag einlösbar. Sonst nur an den gewählten Tagen (z.B. nur Do).' }),
        labels: 'group',
      },
        <div
          className={club ? cls.chips : undefined}
          style={club ? undefined : { display: 'flex', flexWrap: 'wrap', gap: 6 }}
          role="group"
          aria-labelledby={`${idp}-days-label`}
        >
          {WEEKDAYS.map((n) => {
            const active = form.redeem_days.includes(n);
            return chip(active, () => setForm(p => ({
              ...p,
              redeem_days: active ? p.redeem_days.filter(d => d !== n) : [...p.redeem_days, n].sort((a, b) => a - b),
            })), weekdayLabel(n, lang), n);
          })}
        </div>)}

      {field('until', { label: k('fields.visibleUntil'), required: club, hint: k('fields.visibleUntilHint') },
        <input
          {...inputProps('until')}
          type="date"
          min={untilMin}
          max={club ? isoDay(CLUB_DEAL_MAX_DAYS) : undefined}
          value={form.visible_until}
          onChange={set('visible_until')}
          required={need(club)}
        />)}

      {field('max', { label: k('fields.maxRedemptions'), hint: k('fields.maxRedemptionsHint') },
        <input
          {...inputProps('max')}
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="100"
          value={form.max_redemptions}
          onChange={set('max_redemptions')}
        />)}

      {field('photo', { label: k('fields.photo'), last: true, labels: 'none' }, form.photo_url ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={form.photo_url}
            alt=""
            style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10 }}
          />
          <button
            type="button"
            onClick={() => setForm(p => ({ ...p, photo_url: '' }))}
            className={club ? cls.photoRemove : undefined}
            style={club ? undefined : ADMIN.btnGhost}
          >
            {k('fields.photoRemove')}
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
            className={club ? cls.photoPick : undefined}
            style={club ? undefined : { ...ADMIN.btnGhost, width: '100%', padding: '14px 16px' }}
          >
            {uploading ? k('fields.photoUploading') : k('fields.photoPick')}
          </button>
        </>
      ))}
    </>
  );

  // A panel inside the host's form: the fields only.
  if (embedded) {
    return (
      <div className="cd-event-deal-panel" role="group" aria-label={title}>
        {fields}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={club ? 'ge-card ge-form-card ge-deal-form' : undefined}
      style={club ? undefined : ADMIN.form}
      aria-label={title}
    >
      <h3 className={club ? 'ge-deal-form-title' : undefined} style={club ? undefined : ADMIN.title}>{title}</h3>

      {fields}

      <div className={club ? 'ge-deal-form-actions' : undefined} style={club ? undefined : { display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={saving || uploading}
          className={club ? 'ge-deal-btn ge-deal-btn--primary' : undefined}
          style={club ? undefined : { ...ADMIN.btnPrimary, flex: 1 }}
        >
          {saving ? k('savingBtn') : k('saveBtn')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={club ? 'ge-deal-btn' : undefined}
          style={club ? undefined : ADMIN.btnGhost}
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
