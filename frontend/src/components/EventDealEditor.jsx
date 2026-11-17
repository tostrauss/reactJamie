import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clubs, partnerApi } from '../utils/api';
import { useToast } from '../context/ToastContext';
import DealForm from './DealForm';

/**
 * „Deal am Event“ on the edit page of a club event (Tina's document of
 * 17.11.2026, decided by Tobi): ONE deal per event, put up in the event form
 * or here — and the switch „Automatisierte Nachrichten“ under it. Replaces
 * the club's deal library (ClubDealsSection) and the picker (EventDealPicker)
 * of 16.11.2026: a club's deal only ever shows at its event, and JAMIE Pro
 * has nothing to do with it any more.
 *
 * For the people who run an OFFICIAL club (its owner, a co-manager, an app
 * admin) — the server decides (GET …/extras: 403 for everybody else) and
 * says what may be done:
 *   jamie_deal    a deal the JAMIE team hung on the event: named, not editable
 *   deal          the club's own deal on the event: „Bearbeiten“, „Entfernen“
 *   deal_allowed  none yet and one may be put up: „Deal anlegen“
 *   otherwise     the free tier is used up: one sentence
 *
 * Tolerant like every new surface: ANY failure of the first read renders
 * nothing — a member, a community, an older server, and a test that mocks
 * utils/api without partnerApi (the access itself throws there, so it sits
 * inside the try).
 */
export default function EventDealEditor({ clubId, eventId, eventDate }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const lang = i18n.resolvedLanguage || i18n.language || 'de';

  // undefined: loading · null: not for this viewer → nothing · object: the extras
  const [extras, setExtras] = useState(undefined);
  // The open form: null = closed, { deal: null } = a new one, { deal } = editing.
  const [formFor, setFormFor] = useState(null);
  const [removing, setRemoving] = useState(false);
  // The server said PARTNER_REQUIRED: the sentence instead of the form.
  const [blocked, setBlocked] = useState(false);
  const [auto, setAuto] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await partnerApi.getEventExtras(clubId, eventId);
      const data = res?.data && typeof res.data === 'object' ? res.data : null;
      setExtras(data);
      setAuto(data?.auto_messages === true);
    } catch {
      setExtras(null);
    }
  }, [clubId, eventId]);

  useEffect(() => { load(); }, [load]);

  if (!extras || extras.is_official === false) return null;

  const saveDeal = async (payload) => {
    try {
      await partnerApi.saveEventDeal(clubId, eventId, payload);
      toast.success(t('groupEdit.deals.toast.saved'));
      setFormFor(null);
      setBlocked(false);
      load();
    } catch (err) {
      // The free tier ran out meanwhile (a third event, the mark taken away).
      if (err?.response?.data?.code === 'PARTNER_REQUIRED') {
        setFormFor(null);
        setBlocked(true);
        return;
      }
      toast.error(err?.response?.data?.error || t('groupEdit.deals.toast.saveError'));
      // JAMIE hung its own deal on meanwhile: show the page as it is now.
      if (err?.response?.status === 409) { setFormFor(null); load(); }
    }
  };

  const removeDeal = async (deal) => {
    // Named by its offer: a club's deals all carry the club's name.
    if (removing || !window.confirm(t('groupEdit.deals.event.confirmRemove', { name: deal.deal_label }))) return;
    setRemoving(true);
    try {
      await partnerApi.removeEventDeal(clubId, eventId);
      toast.success(t('groupEdit.deals.event.toast.removed'));
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('groupEdit.deals.event.toast.error'));
    } finally {
      setRemoving(false);
    }
  };

  // The switch saves at once, like the bell in a chat: shown as tapped, turned
  // back if the server says no — or stores something else than was asked.
  const toggleAuto = async (next) => {
    if (autoBusy) return;
    setAutoBusy(true);
    setAuto(next);
    try {
      const res = await clubs.updateEvent(clubId, eventId, { auto_messages: next });
      const stored = typeof res?.data?.auto_messages === 'boolean' ? res.data.auto_messages : next;
      setAuto(stored);
      if (stored !== next) toast.error(t('groupEdit.deals.event.toast.error'));
      else toast.success(t(next ? 'groupEdit.deals.event.toast.autoOn' : 'groupEdit.deals.event.toast.autoOff'));
    } catch (err) {
      setAuto(!next);
      toast.error(err?.response?.data?.error || t('groupEdit.deals.event.toast.error'));
    } finally {
      setAutoBusy(false);
    }
  };

  // The day the club picked, read in Vienna: stored as the end of that day
  // there (dealController visibleUntilFrom).
  const day = (iso) => new Date(iso).toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' });
  const notAllowed = <p className="ge-hint ge-deals-intro">{t('partner.dealNotAllowed')}</p>;
  const deal = extras.deal;

  const body = () => {
    if (extras.unavailable) return notAllowed;
    if (formFor) {
      return (
        <DealForm
          key={formFor.deal?.id ?? 'new'}
          variant="club"
          deal={formFor.deal}
          defaults={{ name: extras.club_name || '', visible_until: eventDate || '' }}
          title={formFor.deal ? t('groupEdit.deals.editTitle') : t('groupEdit.deals.newTitle')}
          onSubmit={saveDeal}
          onCancel={() => setFormFor(null)}
        />
      );
    }
    if (extras.jamie_deal) {
      return <p className="ge-hint ge-deals-intro">{t('groupEdit.deals.event.jamieNote', { name: extras.jamie_deal.name })}</p>;
    }
    if (deal) {
      return (
        <>
          <div className="ge-card">
            <div className="ge-deal-row">
              <div className="ge-deal-info">
                <p className="ge-deal-name">{deal.name}</p>
                <p className="ge-deal-label">{deal.deal_label}</p>
                {deal.visible_until && (
                  <p className="ge-deal-meta">{t('groupEdit.deals.untilFmt', { date: day(deal.visible_until) })}</p>
                )}
              </div>
              <div className="ge-member-actions">
                <button
                  type="button"
                  className="ge-role-btn"
                  // Editing is putting a deal up again: what the free tier no
                  // longer allows gets the sentence, not a form that ends in it.
                  onClick={() => (extras.deal_allowed ? setFormFor({ deal }) : setBlocked(true))}
                  aria-label={t('groupEdit.deals.editAria', { name: deal.deal_label })}
                >
                  {t('groupEdit.deals.editBtn')}
                </button>
                <button
                  type="button"
                  className="ge-remove-btn"
                  onClick={() => removeDeal(deal)}
                  disabled={removing}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                  <span>{t('groupEdit.deals.event.removeBtn')}</span>
                </button>
              </div>
            </div>
          </div>
          {blocked && notAllowed}
        </>
      );
    }
    if (extras.deal_allowed && !blocked) {
      return (
        <button type="button" className="ge-share-btn ge-deals-new" onClick={() => setFormFor({ deal: null })}>
          + {t('clubDetail.events.dealLabel')}
        </button>
      );
    }
    return notAllowed;
  };

  return (
    <section className="ge-section" aria-labelledby="ge-event-deal-title">
      <div className="ge-section-head">
        <span className="ge-section-title" id="ge-event-deal-title">{t('groupEdit.deals.event.title')}</span>
      </div>
      {body()}
      {!extras.unavailable && (
        <div className="ge-field ge-toggle-field ge-event-auto">
          <div>
            <label className="ge-label" htmlFor="ge-event-auto-switch">{t('clubDetail.events.autoMessagesLabel')}</label>
            <p className="ge-hint">{t('clubDetail.events.autoMessagesHint')}</p>
          </div>
          <label className="ge-toggle">
            <input
              id="ge-event-auto-switch"
              type="checkbox"
              checked={auto}
              disabled={autoBusy}
              onChange={(e) => toggleAuto(e.target.checked)}
            />
            <span className="ge-toggle-slider" />
          </label>
        </div>
      )}
    </section>
  );
}
