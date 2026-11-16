import { proUpsellAllowed } from './platform';

// A club's own deals (P4 v2, Tina/Tobi 16.11.2026): putting one up, changing
// one and hanging one on an event is the paid part — JAMIE Pro or an app
// admin, the server's rule (dealController clubDealAccess). AuthContext.isPro
// only knows the subscription, so the admin flag is checked on its own here;
// without it an admin would be sent to the ProModal for nothing.
export const canPutUpClubDeals = ({ isPro, user }) => !!(isPro || user?.is_admin);

// At most this many of a club's deals show at a time — the feed has no place
// filter. Mirrors backend dealController CLUB_DEAL_MAX_LIVE (review 16.11.2026).
export const CLUB_DEAL_MAX_LIVE = 3;

// The way to Pro, as for paid events on the club page (ClubDetail): where Pro
// may not be advertised — iOS without a purchase path, Apple 3.1.1 — only a
// toast, else the ProModal leading with „Deals für deinen Club“.
export const askForClubDealsPro = (t, toast) => {
  if (!proUpsellAllowed()) {
    toast.error(t('groupEdit.deals.toast.proRequired'));
    return;
  }
  window.dispatchEvent(new CustomEvent('jamie:open-pro-modal', { detail: { feature: 'clubDeals' } }));
};
