import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deals as dealsApi } from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { thumbUrl } from '../utils/images';
import { canPutUpClubDeals, askForClubDealsPro, CLUB_DEAL_MAX_LIVE } from '../utils/clubDeals';
import DealForm from './DealForm';

// The shop icon of the deal row on an event (EventDealRow), for a deal
// without a photo.
const ShopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M3 9h18v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
    <path d="M5 13v7h14v-7" />
    <path d="M10 20v-4h4v4" />
  </svg>
);

/**
 * „Deals“ in a club's edit page (P4 v2, Tina/Tobi 16.11.2026: „Wenn man als
 * Club einen Deal anlegen will selbst, kann man das nur mit Pro Abo“). Only
 * for a live official club, shown to its owner and co-managers — GroupEdit
 * lets nobody else in, and the server checks every call again.
 *
 * Lists the club's live deals (offer in the partner yellow, until when, how
 * often redeemed, at which events) with „Bearbeiten“ and „Löschen“, plus
 * „Deal anlegen“. The deals show in the app exactly like JAMIE's own. Putting
 * one up and changing one need Pro (or an app admin): without, the tap leads
 * to Pro instead of into the form — utils/clubDeals.js. Deleting is free:
 * what a club published it can always take down.
 */
export default function ClubDealsSection({ clubId, clubName }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { user, isPro } = useContext(AuthContext);
  const lang = i18n.resolvedLanguage || i18n.language || 'de';

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // The open form: null = closed, { deal: null } = a new one, { deal } = editing.
  const [formFor, setFormFor] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await dealsApi.getForClub(clubId);
      setList(Array.isArray(res.data) ? res.data : []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  // The paid part: into the form only with Pro (or as an app admin).
  // A new deal also only below CLUB_DEAL_MAX_LIVE live ones (the server's
  // rule, review 16.11.2026) — no form that could only end in that refusal.
  const openForm = (deal) => {
    if (!canPutUpClubDeals({ isPro, user })) {
      askForClubDealsPro(t, toast);
      return;
    }
    const live = list.filter((d) => !d.visible_until || new Date(d.visible_until) > new Date()).length;
    if (!deal && live >= CLUB_DEAL_MAX_LIVE) {
      toast.error(t('groupEdit.deals.toast.limit', { max: CLUB_DEAL_MAX_LIVE }));
      return;
    }
    setFormFor({ deal });
  };

  const saveDeal = async (payload, id) => {
    try {
      if (id) {
        await dealsApi.updateForClub(clubId, id, payload);
      } else {
        await dealsApi.createForClub(clubId, payload);
      }
      toast.success(t('groupEdit.deals.toast.saved'));
      setFormFor(null);
      load();
    } catch (err) {
      // The subscription ran out since the page was opened.
      if (err.response?.data?.code === 'PRO_REQUIRED') {
        setFormFor(null);
        askForClubDealsPro(t, toast);
        return;
      }
      // Already CLUB_DEAL_MAX_LIVE live deals (another manager meanwhile, or
      // an expired one brought back): say so and show the list as it is now.
      if (err.response?.data?.code === 'CLUB_DEAL_LIMIT') {
        toast.error(t('groupEdit.deals.toast.limit', { max: CLUB_DEAL_MAX_LIVE }));
        setFormFor(null);
        load();
        return;
      }
      toast.error(err.response?.data?.error || t('groupEdit.deals.toast.saveError'));
    }
  };

  const remove = async (deal) => {
    // Named by its offer: a club's deals all carry the club's name.
    if (deletingId || !window.confirm(t('groupEdit.deals.confirmDelete', { name: deal.deal_label }))) return;
    setDeletingId(deal.id);
    try {
      await dealsApi.removeForClub(clubId, deal.id);
      setList((prev) => prev.filter((d) => d.id !== deal.id));
      toast.success(t('groupEdit.deals.toast.deleted'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('groupEdit.deals.toast.deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  // The day the club picked, read in Vienna: stored as the end of that day
  // there (dealController visibleUntilFrom) — an older deal's midnight UTC
  // falls on the same Vienna day.
  const day = (iso) => new Date(iso).toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' });

  const row = (deal, idx) => {
    const photo = Array.isArray(deal.photos) ? deal.photos[0] : null;
    const until = deal.visible_until ? new Date(deal.visible_until) : null;
    const expired = !!until && until < new Date();
    // The cap of the current round takes a one-time deal offline (redeemDeal).
    const capReached = (deal.redeem_interval || 'once') === 'once' && deal.max_redemptions != null
      && (deal.round_redemption_count ?? 0) >= deal.max_redemptions;
    const events = Array.isArray(deal.events) ? deal.events : [];
    const meta = [
      until && (expired ? t('groupEdit.deals.expiredFmt', { date: day(deal.visible_until) })
        : t('groupEdit.deals.untilFmt', { date: day(deal.visible_until) })),
      capReached && t('groupEdit.deals.capReached'),
      t('groupEdit.deals.redemptions', { count: deal.redemption_count ?? 0 }),
    ].filter(Boolean).join(' · ');
    return (
      <div
        key={deal.id}
        className={`ge-deal-row${idx < list.length - 1 ? ' ge-row-divider' : ''}${expired || capReached ? ' is-dimmed' : ''}`}
      >
        <span className="ge-deal-thumb" aria-hidden="true">
          {photo ? <img src={thumbUrl(photo)} alt="" loading="lazy" decoding="async" /> : <ShopIcon />}
        </span>
        <div className="ge-deal-info">
          <p className="ge-deal-name">{deal.name}</p>
          <p className="ge-deal-label">{deal.deal_label}</p>
          <p className="ge-deal-meta">{meta}</p>
          {events.length > 0 && (
            <p className="ge-deal-meta">
              {t('groupEdit.deals.atEvents', { names: events.map((e) => e.name).join(', ') })}
            </p>
          )}
        </div>
        <div className="ge-member-actions">
          <button
            type="button"
            className="ge-role-btn"
            onClick={() => openForm(deal)}
            aria-label={t('groupEdit.deals.editAria', { name: deal.deal_label })}
          >
            {t('groupEdit.deals.editBtn')}
          </button>
          <button
            type="button"
            className="ge-remove-btn"
            onClick={() => remove(deal)}
            disabled={deletingId === deal.id}
            aria-label={t('groupEdit.deals.deleteAria', { name: deal.deal_label })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            <span>{t('groupEdit.deals.deleteBtn')}</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="ge-section" aria-labelledby="ge-deals-title">
      <div className="ge-section-head">
        <span className="ge-section-title" id="ge-deals-title">{t('groupEdit.deals.title')}</span>
        {list.length > 0 && <span className="ge-section-count">{list.length}</span>}
      </div>
      <p className="ge-hint ge-deals-intro">{t('groupEdit.deals.intro')}</p>

      {formFor ? (
        <DealForm
          key={formFor.deal?.id ?? 'new'}
          variant="club"
          deal={formFor.deal}
          defaults={{ name: clubName || '' }}
          title={formFor.deal ? t('groupEdit.deals.editTitle') : t('groupEdit.deals.newTitle')}
          onSubmit={saveDeal}
          onCancel={() => setFormFor(null)}
        />
      ) : (
        <>
          {loading ? (
            <p className="ge-empty">{t('groupEdit.deals.loading')}</p>
          ) : failed ? (
            <p className="ge-empty">{t('groupEdit.deals.toast.loadError')}</p>
          ) : list.length === 0 ? (
            <p className="ge-empty">{t('groupEdit.deals.empty')}</p>
          ) : (
            <div className="ge-card">{list.map(row)}</div>
          )}
          {!failed && (
            <button type="button" className="ge-share-btn ge-deals-new" onClick={() => openForm(null)}>
              + {t('groupEdit.deals.newBtn')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
