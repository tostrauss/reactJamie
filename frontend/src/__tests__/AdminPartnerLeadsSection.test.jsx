import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Admin → „Partner-Anfragen“ (Tina's document of 17.11.2026, decided by
// Tobi): what a club sends with „Ja, meldet euch!“ → „JAMIE Anfrage“ shows up
// here, with a mail and a phone link — someone is waiting for an answer.
// Real German i18n.
const world = {};
const api = { getPartnerLeads: vi.fn() };
vi.mock('../utils/api', () => ({
  // A test that mocks utils/api WITHOUT partnerApi (AdminDashboardPro and
  // friends) throws on the access itself — this getter does the same on demand.
  get partnerApi() {
    if (world.noApi) throw new Error('[vitest] No "partnerApi" export is defined on the "../utils/api" mock');
    return api;
  },
}));
const { AdminPartnerLeadsSection } = await import('../components/AdminPartnerLeadsSection');

const lead = (over = {}) => ({
  id: 5, created_at: '2026-11-17T08:05:00.000Z', source: 'third',
  name: 'Tina Muster', company: 'Café Soleá GmbH', email: 'tina@solea.at', phone: '+43 660 1234567', contact: 'mail',
  club: { id: 7, name: 'Café Soleá' }, user: { id: 3, name: 'Tina' }, ...over,
});
const renderSection = async () => {
  const view = render(<MemoryRouter><AdminPartnerLeadsSection /></MemoryRouter>);
  await act(async () => {});
  return view;
};
const cards = () => [...document.querySelectorAll('[data-lead]')];

beforeEach(() => {
  vi.clearAllMocks();
  world.noApi = false;
  api.getPartnerLeads.mockResolvedValue({ data: [] });
});

describe('AdminPartnerLeadsSection', () => {
  it('lists the requests: club link, Vienna time, who, how — and a mail and a phone link', async () => {
    api.getPartnerLeads.mockResolvedValue({ data: [
      lead(),
      lead({ id: 4, source: 'concurrent', contact: 'call', email: null, company: null, name: 'Jonas Weber', club: { id: 9, name: 'Laufclub Prater' } }),
    ] });
    await renderSection();
    screen.getByRole('heading', { name: 'Partner-Anfragen' });
    const [first, second] = cards();

    const club = within(first).getByRole('link', { name: 'Café Soleá' });
    expect(club.getAttribute('href')).toBe('/club/7');
    // 08:05 UTC in November is 09:05 in Vienna.
    within(first).getByText('17.11.2026, 09:05');
    within(first).getByText('Tina Muster · Café Soleá GmbH');
    within(first).getByText('Nachricht 2 · 3. Event · per Mail');
    expect(within(first).getByRole('link', { name: 'tina@solea.at' }).getAttribute('href')).toBe('mailto:tina@solea.at');
    expect(within(first).getByRole('link', { name: '+43 660 1234567' }).getAttribute('href')).toBe('tel:+436601234567');

    within(second).getByText('Jonas Weber');
    within(second).getByText('Nachricht 1 · 2. Event gleichzeitig · per Anruf');
    expect(within(second).queryByRole('link', { name: /@/ })).toBeNull();
    expect(within(second).getByRole('link', { name: '+43 660 1234567' })).toBeTruthy();
  });

  it('names every source in words; an unknown one shows as it came', async () => {
    api.getPartnerLeads.mockResolvedValue({ data: [
      lead({ id: 1, source: 'ticket' }), lead({ id: 2, source: 'deal' }), lead({ id: 3, source: 'later-idea' }),
    ] });
    await renderSection();
    const [ticket, deal, unknown] = cards();
    within(ticket).getByText('Ticket-Event · per Mail');
    within(deal).getByText('Deal · per Mail');
    within(unknown).getByText('later-idea · per Mail');
  });

  it('a request whose club is gone keeps its place: „–“ instead of a link, no phone link without a number', async () => {
    api.getPartnerLeads.mockResolvedValue({ data: [lead({ club: null, phone: null, created_at: 'kaputt' })] });
    await renderSection();
    const [card] = cards();
    within(card).getByText('–');
    expect(within(card).getAllByRole('link')).toHaveLength(1);
    expect(card.textContent).not.toMatch(/Invalid Date/);
  });

  it('long names wrap instead of widening the page', async () => {
    api.getPartnerLeads.mockResolvedValue({ data: [lead({
      company: 'Donaukanal-Gastronomiebetriebsgesellschaft-mbH-und-Co-KG',
      email: 'veranstaltungen.und.partnerschaften@donaukanal-gastronomiebetriebsgesellschaft.at',
    })] });
    await renderSection();
    const [card] = cards();
    expect(within(card).getByText(/Donaukanal-Gastronomiebetriebsgesellschaft/).style.overflowWrap).toBe('anywhere');
    expect(within(card).getByRole('link', { name: /veranstaltungen/ }).style.overflowWrap).toBe('anywhere');
  });

  it('no request yet: the heading and one sentence', async () => {
    await renderSection();
    screen.getByRole('heading', { name: 'Partner-Anfragen' });
    screen.getByText('Noch keine Partner-Anfragen.');
    expect(cards()).toHaveLength(0);
  });

  it.each([
    ['a server older than this bundle (404)', () => api.getPartnerLeads.mockRejectedValue({ response: { status: 404 } })],
    ['a server error', () => api.getPartnerLeads.mockRejectedValue({ response: { status: 500 } })],
    ['an answer that is not a list', () => api.getPartnerLeads.mockResolvedValue({ data: { unavailable: true } })],
    ['no answer at all', () => api.getPartnerLeads.mockResolvedValue(undefined)],
    ['a mocked api without partnerApi', () => { world.noApi = true; }],
  ])('%s: nothing is rendered, nothing throws', async (_name, arrange) => {
    arrange();
    const { container } = await renderSection();
    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('opened from the admin push (/admin#partner-leads): the list scrolls into view once it has arrived', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    window.history.replaceState(null, '', '/admin#partner-leads');
    try {
      api.getPartnerLeads.mockResolvedValue({ data: [lead()] });
      await renderSection();
      expect(scrolled).toHaveBeenCalledTimes(1);
    } finally {
      window.history.replaceState(null, '', '/');
      delete Element.prototype.scrollIntoView;
    }
  });

  it('opened without the anchor: no scrolling', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      api.getPartnerLeads.mockResolvedValue({ data: [lead()] });
      await renderSection();
      expect(scrolled).not.toHaveBeenCalled();
    } finally {
      delete Element.prototype.scrollIntoView;
    }
  });
});
