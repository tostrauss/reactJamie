import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deals as dealsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { canPutUpClubDeals, askForClubDealsPro } from '../utils/clubDeals';

/**
 * „Deal am Event“ in the edit page of a club's own event (P4 v2, Tina/Tobi
 * 16.11.2026): the club's managers hang one of its deals on the event — it
 * then shows on the event page like JAMIE's — or take it off. Applied at
 * once, like the admin's „An Event hängen“, not with „Speichern“.
 *
 * GroupEdit shows it for partner events only (is_partner: an official club's
 * event its owner or a co-manager put up), so everyone who edits one manages
 * the club. The deals come from /deals/club/:id; when that is refused (no
 * manager after all, the club in review, …) nothing shows. A deal JAMIE hung
 * on the event is named and stays — only the JAMIE team moves it (the server
 * answers 409 DEAL_SET_BY_JAMIE). Hanging one on needs Pro (or an app
 * admin), taking it off does not.
 */
export default function EventDealPicker({ clubId, eventId, shownDeal }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, isPro } = useContext(AuthContext);

  const [deals, setDeals] = useState(null);     // null: loading, or not for this viewer
  const [current, setCurrent] = useState(null); // id of the club's deal on this event
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    dealsApi.getForClub(clubId)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setDeals(list);
        // Also one that is attached but not shown right now (expired, sold out).
        setCurrent(list.find((d) => (d.events || []).some((e) => Number(e.id) === Number(eventId)))?.id ?? null);
      })
      .catch(() => { if (!cancelled) setDeals(null); });
    return () => { cancelled = true; };
  }, [clubId, eventId]);

  if (!deals) return null;

  // On the event, but not one of the club's: JAMIE's.
  const jamieDeal = current == null && shownDeal?.id && !deals.some((d) => d.id === shownDeal.id) ? shownDeal : null;
  // Choosable: the club's deals that are not past their end date — and the
  // current one in any case.
  const now = new Date();
  const choices = deals.filter((d) => d.id === current || !d.visible_until || new Date(d.visible_until) > now);

  const choose = async (dealId) => {
    if (busy || dealId === current) return;
    if (dealId !== null && !canPutUpClubDeals({ isPro, user })) {
      askForClubDealsPro(t, toast);
      return;
    }
    setBusy(true);
    try {
      const res = await dealsApi.setEventDeal(eventId, dealId);
      setCurrent(dealId);
      if (dealId === null) toast.success(t('groupEdit.deals.event.toast.detached'));
      else if (res.data?.deal) toast.success(t('groupEdit.deals.event.toast.attached'));
      else toast.warning(t('groupEdit.deals.event.toast.attachedHidden'));
    } catch (err) {
      if (err.response?.data?.code === 'PRO_REQUIRED') askForClubDealsPro(t, toast);
      else toast.error(err.response?.data?.error || t('groupEdit.deals.event.toast.error'));
    } finally {
      setBusy(false);
    }
  };

  // An offer may run to 100 characters: it ends in „…“ instead of widening
  // the page (S3).
  const chip = (dealId, label, title) => (
    <button
      key={dealId ?? 'none'}
      type="button"
      className={`ge-cat-chip ge-event-deal-chip${current === dealId ? ' active' : ''}`}
      aria-pressed={current === dealId}
      disabled={busy}
      title={title}
      onClick={() => choose(dealId)}
    >
      <span className="ge-event-deal-chip-text">{label}</span>
    </button>
  );

  return (
    <section className="ge-section" aria-labelledby="ge-event-deal-title">
      <div className="ge-section-head">
        <span className="ge-section-title" id="ge-event-deal-title">{t('groupEdit.deals.event.title')}</span>
      </div>
      <div className="ge-card ge-form-card">
        <div className="ge-field">
          {jamieDeal ? (
            <p className="ge-hint ge-event-deal-note">{t('groupEdit.deals.event.jamieNote', { name: jamieDeal.name })}</p>
          ) : choices.length === 0 ? (
            <p className="ge-hint ge-event-deal-note">{t('groupEdit.deals.event.none')}</p>
          ) : (
            <>
              <p className="ge-hint">{t('groupEdit.deals.event.hint')}</p>
              <div className="ge-cat-grid" role="group" aria-labelledby="ge-event-deal-title">
                {chip(null, t('groupEdit.deals.event.noDeal'))}
                {choices.map((d) => chip(d.id, d.deal_label, d.name))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
