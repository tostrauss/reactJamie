import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { AuthContext } from '../context/AuthContext';

// „Deals“ in a club's edit page (P4 v2, Tina/Tobi 16.11.2026): the club's
// live deals with „Bearbeiten“/„Löschen“ and „Deal anlegen“. Putting one up
// or changing it is JAMIE Pro (or an app admin): without it the tap leads to
// Pro — the ProModal with feature 'clubDeals' wherever Pro may be advertised,
// a toast on iOS without a purchase path (Apple 3.1.1) — never into the form.
// Deleting is free. Real German i18n.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
const upsell = vi.hoisted(() => ({ allowed: true }));
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => upsell.allowed }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
vi.mock('../utils/api', () => ({
  deals: {
    getForClub: vi.fn(), createForClub: vi.fn(), updateForClub: vi.fn(), removeForClub: vi.fn(),
  },
  upload: { image: vi.fn() },
}));
const { deals } = await import('../utils/api');
const { default: ClubDealsSection } = await import('../components/ClubDealsSection');

const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const deal = (o = {}) => ({
  id: 11, name: 'Bar Neun', deal_label: '2 für 1', description: null, address: 'Gumpendorfer Straße 1, 1060 Wien',
  photos: [], booking_url: null, visible_until: `${inDays(30)}T00:00:00.000Z`, max_redemptions: 100,
  redeem_interval: 'once', redeem_days: null, redemption_count: 3, round_redemption_count: 3, events: [], ...o,
});

let proModal;
const onProModal = (e) => proModal.push(e.detail);
beforeEach(() => {
  vi.clearAllMocks();
  upsell.allowed = true;
  proModal = [];
  window.addEventListener('jamie:open-pro-modal', onProModal);
  deals.getForClub.mockResolvedValue({ data: [deal()] });
  deals.createForClub.mockResolvedValue({ data: { id: 12 } });
  deals.updateForClub.mockResolvedValue({ data: { id: 11 } });
  deals.removeForClub.mockResolvedValue({ data: {} });
});
afterEach(() => window.removeEventListener('jamie:open-pro-modal', onProModal));

const renderSection = async ({ isPro = false, isAdmin = false, rows } = {}) => {
  if (rows) deals.getForClub.mockResolvedValue({ data: rows });
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Olli', is_admin: isAdmin }, isPro }}>
      <ClubDealsSection clubId={70} clubName="Bar Neun" />
    </AuthContext.Provider>,
  );
  await waitFor(() => expect(deals.getForClub).toHaveBeenCalledWith(70));
  await waitFor(() => expect(screen.queryByText('Lade Deals…')).not.toBeInTheDocument());
};
const newBtn = () => screen.getByRole('button', { name: '+ Deal anlegen' });
const form = () => screen.queryByRole('form', { name: /Neuer Deal|Deal bearbeiten/ });

describe('ClubDealsSection — the list', () => {
  it('each deal: name, offer, until when, how often redeemed, the events it hangs on', async () => {
    await renderSection({ rows: [deal({ events: [{ id: 90, name: 'Neun Night', date: null }, { id: 91, name: 'Quiz', date: null }] })] });
    expect(screen.getByText('Deals')).toBeInTheDocument();
    expect(screen.getByText('Bar Neun')).toBeInTheDocument();
    expect(screen.getByText('2 für 1')).toHaveClass('ge-deal-label');
    const until = new Date(`${inDays(30)}T00:00:00.000Z`).toLocaleDateString('de', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    expect(screen.getByText(`Sichtbar bis ${until} · 3× eingelöst`)).toBeInTheDocument();
    expect(screen.getByText('📍 Neun Night, Quiz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deal „2 für 1“ bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deal „2 für 1“ löschen' })).toBeInTheDocument();
  });

  it('an expired one and a one-time deal at its cap are dimmed and say so', async () => {
    await renderSection({ rows: [
      deal({ id: 1, deal_label: 'Alt', visible_until: '2026-01-02T00:00:00.000Z', redemption_count: 1 }),
      deal({ id: 2, deal_label: 'Voll', max_redemptions: 3 }),
      deal({ id: 3, deal_label: 'Wöchentlich', redeem_interval: 'weekly', max_redemptions: 3 }),
    ] });
    const rowOf = (label) => screen.getByText(label).closest('.ge-deal-row');
    expect(rowOf('Alt')).toHaveClass('is-dimmed');
    expect(within(rowOf('Alt')).getByText(/^Abgelaufen am 02\.01\.2026 · 1× eingelöst$/)).toBeInTheDocument();
    expect(rowOf('Voll')).toHaveClass('is-dimmed');
    expect(within(rowOf('Voll')).getByText(/Limit erreicht – offline/)).toBeInTheDocument();
    expect(rowOf('Wöchentlich')).not.toHaveClass('is-dimmed');   // weekly deals are never capped
  });

  // Review 16.11.2026: the server keeps a deal through the day picked in
  // Vienna (the end of that day) — the list says so until then.
  it('a deal through the 17th in Vienna still shows as such late that evening', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-12-17T22:30:00Z'));   // 23:30 in Vienna
      await renderSection({ rows: [deal({ visible_until: '2026-12-17T22:59:59.000Z' })] });
      const row = screen.getByText('2 für 1').closest('.ge-deal-row');
      expect(row).not.toHaveClass('is-dimmed');
      expect(within(row).getByText('Sichtbar bis 17.12.2026 · 3× eingelöst')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no deals yet: a line saying so and „Deal anlegen“', async () => {
    await renderSection({ rows: [] });
    expect(screen.getByText('Noch keine Deals.')).toBeInTheDocument();
    expect(newBtn()).toBeInTheDocument();
  });

  it('a list the server refuses says so, without „Deal anlegen“', async () => {
    deals.getForClub.mockRejectedValue({ response: { status: 403 } });
    render(
      <AuthContext.Provider value={{ user: { id: 1 }, isPro: true }}>
        <ClubDealsSection clubId={70} clubName="Bar Neun" />
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Deals konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Deal anlegen' })).not.toBeInTheDocument();
  });
});

describe('ClubDealsSection — the Pro gate per platform', () => {
  it('web / Android without Pro: „Deal anlegen“ opens the ProModal with clubDeals — no form, no toast', async () => {
    await renderSection();
    fireEvent.click(newBtn());
    expect(proModal).toEqual([{ feature: 'clubDeals' }]);
    expect(form()).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('iOS without a purchase path: only the toast (Apple 3.1.1) — no modal, no form', async () => {
    upsell.allowed = false;
    await renderSection();
    fireEvent.click(newBtn());
    expect(toast.error).toHaveBeenCalledWith('Deals für deinen Club sind ein JAMIE Pro Feature.');
    expect(proModal).toEqual([]);
    expect(form()).toBeNull();
  });

  it('„Bearbeiten“ without Pro leads to Pro the same way', async () => {
    await renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Deal „2 für 1“ bearbeiten' }));
    expect(proModal).toEqual([{ feature: 'clubDeals' }]);
    expect(form()).toBeNull();
  });

  it('an app admin without a subscription goes straight into the form (isPro || is_admin)', async () => {
    await renderSection({ isAdmin: true });
    fireEvent.click(newBtn());
    expect(form()).toBeInTheDocument();
    expect(proModal).toEqual([]);
  });
});

describe('ClubDealsSection — with Pro', () => {
  it('a new deal: the club form, the club\'s name prefilled; saved → toast, list reloaded, form closed', async () => {
    await renderSection({ isPro: true });
    fireEvent.click(newBtn());
    expect(form()).toHaveClass('ge-deal-form');
    expect(screen.getByLabelText(/^Name auf der Karte/)).toHaveValue('Bar Neun');
    expect(screen.getByLabelText(/^Sichtbar bis/)).toBeRequired();
    fireEvent.change(screen.getByLabelText(/^Angebot/), { target: { value: 'Gratis Shot' } });
    fireEvent.change(screen.getByLabelText(/^Sichtbar bis/), { target: { value: inDays(14) } });
    fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' }));
    await waitFor(() => expect(deals.createForClub).toHaveBeenCalledTimes(1));
    expect(deals.createForClub).toHaveBeenCalledWith(70, expect.objectContaining({
      name: 'Bar Neun', deal_label: 'Gratis Shot', visible_until: inDays(14), address: null,
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deal gespeichert'));
    expect(deals.getForClub).toHaveBeenCalledTimes(2);
    expect(form()).toBeNull();
  });

  it('editing: prefilled, saved with the deal\'s id', async () => {
    await renderSection({ isPro: true });
    fireEvent.click(screen.getByRole('button', { name: 'Deal „2 für 1“ bearbeiten' }));
    expect(screen.getByLabelText(/^Angebot/)).toHaveValue('2 für 1');
    fireEvent.change(screen.getByLabelText(/^Angebot/), { target: { value: '3 für 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' }));
    await waitFor(() => expect(deals.updateForClub).toHaveBeenCalledTimes(1));
    const [clubId, dealId, payload] = deals.updateForClub.mock.calls[0];
    expect([clubId, dealId]).toEqual([70, 11]);
    expect(payload.deal_label).toBe('3 für 2');
    expect(payload.address).toBeUndefined();   // untouched → not sent, not geocoded again
  });

  it('the server\'s reason on a failed save; the form stays open', async () => {
    deals.createForClub.mockRejectedValue({ response: { status: 422, data: { error: 'Dein Text enthält unangemessene Inhalte.' } } });
    await renderSection({ isPro: true });
    fireEvent.click(newBtn());
    fireEvent.change(screen.getByLabelText(/^Angebot/), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^Sichtbar bis/), { target: { value: inDays(3) } });
    fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Dein Text enthält unangemessene Inhalte.'));
    expect(form()).toBeInTheDocument();
  });

  // Review 16.11.2026: at most 3 of a club's deals show at a time (the server's
  // CLUB_DEAL_LIMIT) — the feed has no place filter.
  it('three live deals: „Deal anlegen“ says so instead of opening a form; an expired one does not count', async () => {
    const LIMIT = 'Höchstens 3 aktive Deals gleichzeitig – lösche zuerst einen.';
    await renderSection({ isPro: true, rows: [deal({ id: 1 }), deal({ id: 2 }), deal({ id: 3 })] });
    fireEvent.click(newBtn());
    expect(toast.error).toHaveBeenCalledWith(LIMIT);
    expect(form()).toBeNull();
    // editing one of them stays possible
    fireEvent.click(screen.getAllByRole('button', { name: 'Deal „2 für 1“ bearbeiten' })[0]);
    expect(form()).toBeInTheDocument();
    cleanup();
    toast.error.mockClear();
    await renderSection({ isPro: true, rows: [deal({ id: 1 }), deal({ id: 2 }), deal({ id: 3, visible_until: '2026-01-02T00:00:00.000Z' })] });
    fireEvent.click(newBtn());
    expect(toast.error).not.toHaveBeenCalled();
    expect(form()).toBeInTheDocument();
  });

  it('the server\'s CLUB_DEAL_LIMIT (another manager was quicker): toast, form closed, list reloaded', async () => {
    deals.createForClub.mockRejectedValue({ response: { status: 409, data: { code: 'CLUB_DEAL_LIMIT', error: 'x' } } });
    await renderSection({ isPro: true });
    fireEvent.click(newBtn());
    fireEvent.change(screen.getByLabelText(/^Angebot/), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^Sichtbar bis/), { target: { value: inDays(3) } });
    fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Höchstens 3 aktive Deals gleichzeitig – lösche zuerst einen.'));
    expect(form()).toBeNull();
    await waitFor(() => expect(deals.getForClub).toHaveBeenCalledTimes(2));
  });

  it('the subscription ran out meanwhile (PRO_REQUIRED): the form closes, the way to Pro opens', async () => {
    deals.createForClub.mockRejectedValue({ response: { status: 403, data: { code: 'PRO_REQUIRED', error: 'x' } } });
    await renderSection({ isPro: true });
    fireEvent.click(newBtn());
    fireEvent.change(screen.getByLabelText(/^Angebot/), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^Sichtbar bis/), { target: { value: inDays(3) } });
    fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' }));
    await waitFor(() => expect(proModal).toEqual([{ feature: 'clubDeals' }]));
    expect(form()).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('ClubDealsSection — deleting is free', () => {
  it('without Pro: confirm, delete, gone from the list', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Deal „2 für 1“ löschen' }));
    expect(confirm).toHaveBeenCalledWith('Deal „2 für 1“ löschen? Er verschwindet sofort aus der App.');
    await waitFor(() => expect(deals.removeForClub).toHaveBeenCalledWith(70, 11));
    await waitFor(() => expect(screen.queryByText('2 für 1')).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('Deal gelöscht');
    expect(proModal).toEqual([]);
    confirm.mockRestore();
  });

  it('cancelled: nothing happens', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Deal „2 für 1“ löschen' }));
    expect(deals.removeForClub).not.toHaveBeenCalled();
    expect(screen.getByText('2 für 1')).toBeInTheDocument();
    confirm.mockRestore();
  });
});
