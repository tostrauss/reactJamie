import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// „An Event hängen“ in the web admin (P4 v1, Tina 16.11.2026): an admin hangs
// a deal on an event by its ID or simply its link, sees the events a deal
// hangs on and takes it off again („Lösen“) — PUT /api/deals/event/:groupId.
// deal=null in the answer means attached, but not visible on the event right
// now, and the toast says so. Real German i18n.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
vi.mock('../utils/api', () => ({
  deals: {
    getAllForAdmin: vi.fn(),
    setEventDeal: vi.fn(),
    getRedemptions: vi.fn(),
    newRound: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  upload: { image: vi.fn() },
}));
const { deals } = await import('../utils/api');
const { AdminDealsSection } = await import('../components/AdminDealsSection');

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const deal = (o = {}) => ({
  id: 5, name: 'Café Soleá', deal_label: '1 Getränk gratis', photos: [], is_active: true,
  visible_until: FUTURE, max_redemptions: 100, redeem_interval: 'once', redeem_round: 0,
  redemption_count: 3, round_redemption_count: 3, events: [], ...o,
});
// A Vienna wall-clock evening, tagged UTC like every groups.date.
const PUNSCH = { id: 527, name: 'Punsch Night', date: '2026-11-20T23:30:00.000Z' };

const renderSection = async (rows) => {
  deals.getAllForAdmin.mockResolvedValue({ data: rows });
  render(<AdminDealsSection />);
  await screen.findByText(rows[0].name);
};
const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /An Event hängen/ }));
const typeEvent = (value) => fireEvent.change(screen.getByLabelText('Event-ID oder Link zum Event'), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  deals.setEventDeal.mockResolvedValue({ data: { group_id: 527, deal_id: 5, deal: { id: 5 } } });
});

describe('AdminDealsSection — deals at events', () => {
  it('lists the events a deal hangs on — name, the day as typed (UTC), #id, a link to the event — each with „Lösen“', async () => {
    await renderSection([deal({ events: [PUNSCH] })]);
    const link = screen.getByRole('link', { name: /Punsch Night/ });
    expect(link).toHaveAttribute('href', '/group/527');
    // 23:30 wall-clock on the 20th — read in local time it would slide to the 21st.
    expect(link.textContent).toContain('20.11.2026');
    expect(link.textContent).toContain('#527');
    expect(screen.getByRole('button', { name: 'Lösen' })).toBeInTheDocument();
  });

  it('„Lösen“ takes it off (deal_id null) and reloads the list', async () => {
    await renderSection([deal({ events: [PUNSCH] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Lösen' }));
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(527, null));
    expect(toast.success).toHaveBeenCalledWith('Deal von „Punsch Night“ gelöst');
    await waitFor(() => expect(deals.getAllForAdmin).toHaveBeenCalledTimes(2));
  });

  it('„An Event hängen“ by the event ID', async () => {
    await renderSection([deal()]);
    openPanel();
    typeEvent('527');
    fireEvent.click(screen.getByRole('button', { name: 'Anhängen' }));
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(527, 5));
    expect(toast.success).toHaveBeenCalledWith('Deal hängt jetzt am Event #527');
    await waitFor(() => expect(deals.getAllForAdmin).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Event-ID oder Link zum Event')).not.toBeInTheDocument();
  });

  it('…or by the link pasted from the event page (Enter submits)', async () => {
    await renderSection([deal()]);
    openPanel();
    typeEvent('https://jamie-app.com/group/527?from=share');
    fireEvent.keyDown(screen.getByLabelText('Event-ID oder Link zum Event'), { key: 'Enter' });
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(527, 5));
  });

  it('deal=null in the answer: attached, but the toast says it is not visible there right now', async () => {
    deals.setEventDeal.mockResolvedValue({ data: { group_id: 527, deal_id: 5, deal: null } });
    await renderSection([deal()]);
    openPanel();
    typeEvent('527');
    fireEvent.click(screen.getByRole('button', { name: 'Anhängen' }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Am Event #527 angehängt – dort aber gerade nicht sichtbar (abgelaufen, inaktiv oder Limit erreicht)',
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('anything but an ID or an event link is refused before any call', async () => {
    await renderSection([deal()]);
    openPanel();
    typeEvent('Punsch Night');
    fireEvent.click(screen.getByRole('button', { name: 'Anhängen' }));
    expect(toast.error).toHaveBeenCalledWith('Bitte eine Event-ID oder den Link zum Event eingeben');
    expect(deals.setEventDeal).not.toHaveBeenCalled();
  });

  it('the server\'s reason when it refuses (a club, an unknown event)', async () => {
    deals.setEventDeal.mockRejectedValue({ response: { status: 404, data: { error: 'Event nicht gefunden' } } });
    await renderSection([deal()]);
    openPanel();
    typeEvent('99999');
    fireEvent.click(screen.getByRole('button', { name: 'Anhängen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Event nicht gefunden'));
    // The panel stays open to correct the ID.
    expect(screen.getByLabelText('Event-ID oder Link zum Event')).toBeInTheDocument();
  });

  it('an expired deal still lists its events, with the note that the event does not show it now', async () => {
    await renderSection([deal({ visible_until: '2026-01-01T00:00:00.000Z', events: [PUNSCH] })]);
    expect(screen.getByText('Am Event gerade nicht sichtbar (abgelaufen, inaktiv oder Limit erreicht)')).toBeInTheDocument();
  });

  it('a deleted (inactive) deal can be taken off events, but not hung on new ones', async () => {
    await renderSection([deal({ is_active: false, events: [PUNSCH] })]);
    expect(screen.getByRole('button', { name: 'Lösen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /An Event hängen/ })).not.toBeInTheDocument();
  });

  it('a live deal without events shows no note, only the way to hang it', async () => {
    await renderSection([deal(), deal({ id: 6, name: 'Bar Neun', events: [] })]);
    expect(screen.queryByText(/Am Event gerade nicht sichtbar/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /An Event hängen/ })).toHaveLength(2);
    // Each deal its own panel.
    fireEvent.click(screen.getAllByRole('button', { name: /An Event hängen/ })[1]);
    typeEvent('12');
    fireEvent.click(screen.getByRole('button', { name: 'Anhängen' }));
    await waitFor(() => expect(deals.setEventDeal).toHaveBeenCalledWith(12, 6));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deal hängt jetzt am Event #12'));
    expect(screen.queryAllByLabelText('Event-ID oder Link zum Event')).toHaveLength(0);
  });
});

// D-1 (Tina 17.11.2026: „Das können nur wir als Admins einstellen!“): a CLUB's
// deal shows in the Gruppen feed on its event's day once an admin switches
// „Im Gruppen-Feed zeigen“ on — PUT /api/deals/event/:groupId/feed.
describe('AdminDealsSection — „Im Gruppen-Feed zeigen“', () => {
  const CLUB = { id: 70, name: 'Bar Neun Club' };
  beforeEach(() => {
    deals.setEventDealFeed = vi.fn().mockResolvedValue({ data: { group_id: 527, deal_id: 5, in_feed: true } });
  });

  it('only on a club\'s deal — JAMIE\'s own deals are in the feed anyway', async () => {
    await renderSection([deal({ events: [PUNSCH] })]);
    expect(screen.queryByRole('button', { name: /Gruppen-Feed/ })).not.toBeInTheDocument();
  });

  it('off (also for a server that sends no in_feed): switching on calls the endpoint, says so and reloads', async () => {
    await renderSection([deal({ club: CLUB, events: [PUNSCH] })]);
    const btn = screen.getByRole('button', { name: 'Im Gruppen-Feed zeigen' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    await waitFor(() => expect(deals.setEventDealFeed).toHaveBeenCalledWith(527, true));
    expect(toast.success).toHaveBeenCalledWith('„Punsch Night“: Der Deal erscheint am Tag des Events im Gruppen-Feed');
    await waitFor(() => expect(deals.getAllForAdmin).toHaveBeenCalledTimes(2));
    expect(deals.setEventDeal).not.toHaveBeenCalled();
  });

  it('on: the button says so and a tap takes it back', async () => {
    await renderSection([deal({ club: CLUB, events: [{ ...PUNSCH, in_feed: true }, { id: 600, name: 'Quiz', date: null, in_feed: false }] })]);
    const on = screen.getByRole('button', { name: 'Im Gruppen-Feed ✓' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    // each event its own switch
    expect(screen.getByRole('button', { name: 'Im Gruppen-Feed zeigen' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(on);
    await waitFor(() => expect(deals.setEventDealFeed).toHaveBeenCalledWith(527, false));
    expect(toast.success).toHaveBeenCalledWith('„Punsch Night“: Der Deal ist nicht mehr im Gruppen-Feed');
  });

  it('the server\'s reason when it refuses, else the fallback text', async () => {
    deals.setEventDealFeed.mockRejectedValueOnce({ response: { status: 503, data: { error: 'Der Feed-Schalter ist gleich wieder verfügbar.' } } });
    await renderSection([deal({ club: CLUB, events: [PUNSCH] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Im Gruppen-Feed zeigen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Der Feed-Schalter ist gleich wieder verfügbar.'));
    deals.setEventDealFeed.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Im Gruppen-Feed zeigen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Feed-Schalter konnte nicht geändert werden'));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
