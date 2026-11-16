import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthContext } from '../context/AuthContext';

// „Deal am Event“ in the edit page of a club's own event (P4 v2, Tina/Tobi
// 16.11.2026): the club's managers hang one of the club's deals on it or take
// it off — at once, PUT /api/deals/event/:id. Hanging one on needs Pro (or an
// app admin): the ProModal with 'clubDeals', on iOS without a purchase path
// a toast; taking it off is free. A deal JAMIE hung there is only named.
// Real German i18n.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
const upsell = vi.hoisted(() => ({ allowed: true }));
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => upsell.allowed }));
vi.mock('../utils/api', () => ({ deals: { getForClub: vi.fn(), setEventDeal: vi.fn() } }));
const { deals } = await import('../utils/api');
const { default: EventDealPicker } = await import('../components/EventDealPicker');

const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();
const deal = (id, label, o = {}) => ({ id, name: 'Bar Neun', deal_label: label, visible_until: inDays(30), events: [], ...o });
const EVENT = 90;

let proModal;
const onProModal = (e) => proModal.push(e.detail);
beforeEach(() => {
  vi.clearAllMocks();
  upsell.allowed = true;
  proModal = [];
  window.addEventListener('jamie:open-pro-modal', onProModal);
  deals.setEventDeal.mockResolvedValue({ data: { group_id: EVENT, deal_id: 11, deal: { id: 11 } } });
});
afterEach(() => window.removeEventListener('jamie:open-pro-modal', onProModal));

const renderPicker = async ({ rows = [deal(11, '2 für 1'), deal(12, 'Gratis Shot')], isPro = true, isAdmin = false, shownDeal = null } = {}) => {
  deals.getForClub.mockResolvedValue({ data: rows });
  render(
    <AuthContext.Provider value={{ user: { id: 1, is_admin: isAdmin }, isPro }}>
      <EventDealPicker clubId={70} eventId={EVENT} shownDeal={shownDeal} />
    </AuthContext.Provider>,
  );
  await waitFor(() => expect(deals.getForClub).toHaveBeenCalledWith(70));
};
const chip = (name) => screen.getByRole('button', { name });

describe('EventDealPicker', () => {
  it('„Kein Deal“ plus the club\'s deals by their offer; the one on the event is pressed (also when hidden there)', async () => {
    await renderPicker({ rows: [
      deal(11, '2 für 1'),
      deal(12, 'Gratis Shot', { max_redemptions: 1, round_redemption_count: 1, events: [{ id: EVENT, name: 'Neun Night' }] }),
    ] });
    expect(await screen.findByText('Deal am Event')).toBeInTheDocument();
    expect(chip('Kein Deal')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('2 für 1')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Gratis Shot')).toHaveAttribute('aria-pressed', 'true');
  });

  it('past their end date they are not offered — unless one is the current deal', async () => {
    await renderPicker({ rows: [
      deal(11, 'Alt', { visible_until: inDays(-2) }),
      deal(12, 'Auch alt', { visible_until: inDays(-2), events: [{ id: EVENT }] }),
      deal(13, 'Neu'),
    ] });
    await screen.findByText('Deal am Event');
    expect(screen.queryByRole('button', { name: 'Alt' })).not.toBeInTheDocument();
    expect(chip('Auch alt')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Neu')).toBeInTheDocument();
  });

  it('with Pro: a tap hangs it on at once, the toast says whether the event shows it', async () => {
    await renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: '2 für 1' }));
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(EVENT, 11));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deal hängt jetzt am Event'));
    expect(chip('2 für 1')).toHaveAttribute('aria-pressed', 'true');
    deals.setEventDeal.mockResolvedValue({ data: { group_id: EVENT, deal_id: 12, deal: null } });
    fireEvent.click(chip('Gratis Shot'));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Angehängt – am Event aber gerade nicht sichtbar (abgelaufen oder Limit erreicht)'));
  });

  it('without Pro: hanging one on leads to Pro (web: the modal, iOS without a purchase path: a toast) — nothing sent', async () => {
    await renderPicker({ isPro: false });
    fireEvent.click(await screen.findByRole('button', { name: '2 für 1' }));
    expect(proModal).toEqual([{ feature: 'clubDeals' }]);
    upsell.allowed = false;
    fireEvent.click(chip('2 für 1'));
    expect(toast.error).toHaveBeenCalledWith('Deals für deinen Club sind ein JAMIE Pro Feature.');
    expect(proModal).toHaveLength(1);
    expect(deals.setEventDeal).not.toHaveBeenCalled();
    expect(chip('2 für 1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('…but taking it off is free', async () => {
    deals.setEventDeal.mockResolvedValue({ data: { group_id: EVENT, deal_id: null, deal: null } });
    await renderPicker({ isPro: false, rows: [deal(11, '2 für 1', { events: [{ id: EVENT }] })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kein Deal' }));
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(EVENT, null));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deal vom Event gelöst'));
    expect(proModal).toEqual([]);
  });

  it('an app admin without a subscription may hang one on', async () => {
    await renderPicker({ isPro: false, isAdmin: true });
    fireEvent.click(await screen.findByRole('button', { name: '2 für 1' }));
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(EVENT, 11));
    expect(proModal).toEqual([]);
  });

  it('a deal JAMIE hung there is named, nothing to choose', async () => {
    await renderPicker({ shownDeal: { id: 5, name: 'Café Soleá', deal_label: '1+1' } });
    expect(await screen.findByText('An diesem Event hängt ein Deal von JAMIE: Café Soleá. Den kann nur das JAMIE-Team ändern.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kein Deal' })).not.toBeInTheDocument();
  });

  it('no deals yet: where to put them up', async () => {
    await renderPicker({ rows: [] });
    expect(await screen.findByText('Dein Club hat noch keine Deals. Leg sie unter Club bearbeiten → Deals an.')).toBeInTheDocument();
  });

  it('when the server refuses the list (no manager, club in review), nothing shows', async () => {
    deals.getForClub.mockRejectedValue({ response: { status: 403, data: { code: 'NOT_CLUB_MANAGER' } } });
    const { container } = render(
      <AuthContext.Provider value={{ user: { id: 1 }, isPro: true }}>
        <EventDealPicker clubId={70} eventId={EVENT} shownDeal={null} />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(deals.getForClub).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('the server\'s reason when it refuses the change (e.g. JAMIE\'s deal there meanwhile)', async () => {
    deals.setEventDeal.mockRejectedValue({ response: { status: 409, data: { code: 'DEAL_SET_BY_JAMIE',
      error: 'An diesem Event hängt ein Deal von JAMIE. Den kann nur das JAMIE-Team ändern.' } } });
    await renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: '2 für 1' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'An diesem Event hängt ein Deal von JAMIE. Den kann nur das JAMIE-Team ändern.'));
    expect(chip('2 für 1')).toHaveAttribute('aria-pressed', 'false');
  });
});
