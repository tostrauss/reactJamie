import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// The free tier of official clubs in the event form of the club page (Tina's
// document of 17.11.2026, decided by Tobi): a club at its limit gets her
// partner letter instead of the form, a ticket event is a partner's, and the
// form carries two new bars — „Deal anlegen“ and „Automatisierte
// Nachrichten“. A community's form is untouched. Real German i18n.
const world = {};
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => true }));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
vi.mock('../utils/api', () => ({
  clubs: {
    getById: vi.fn(() => Promise.resolve({ data: { ...world.club } })),
    getMembers: vi.fn(() => Promise.resolve({ data: { members: [], total_count: 12, gated: false } })),
    getFavorites: vi.fn(() => Promise.resolve({ data: [] })),
    getEvents: vi.fn(() => Promise.resolve({ data: world.events })),
    createEvent: vi.fn(),
    deleteEvent: vi.fn(() => Promise.resolve({ data: {} })),
  },
  partnerApi: {
    getEventQuota: vi.fn(() => (world.quota instanceof Error ? Promise.reject(world.quota) : Promise.resolve({ data: world.quota }))),
    requestPartner: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
  upload: { image: vi.fn() },
}));
const { clubs, partnerApi } = await import('../utils/api');
const { ClubDetail } = await import('../pages/ClubDetail');

const CLUB = {
  id: 7, name: 'Laufclub Prater', owner_id: 1, type: 'club', club_type: 'official', approval_status: 'approved',
  is_member: true, is_manager: false, events_owner_only: false, is_private: false,
  members_count: 12, description: 'Wir laufen.', category: 'Sport',
};
const quota = (over = {}) => ({
  club_id: 7, club_name: 'Laufclub Prater', limited: true, free_events: 2, used: 0, upcoming: 0,
  block: null, ticket_allowed: false, is_manager: true, ...over,
});
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const renderClub = async ({ isPro = false, userId = 1 } = {}) => {
  render(
    <AuthContext.Provider value={{ user: { id: userId, name: 'Olga', email: 'olga@x.at', avatar_url: '/a.webp' }, isPro }}>
      <MemoryRouter initialEntries={['/club/7']}>
        <Routes><Route path="/club/:id" element={<ClubDetail />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};
const plus = () => screen.getByRole('button', { name: 'Neues Event erstellen' });
const tap = async (el) => { await act(async () => { fireEvent.click(el); }); };
const form = () => document.querySelector('form.cd-event-form');
const box = (label) => screen.getByText(label).closest('label').querySelector('input[type="checkbox"]');
const fillEvent = () => {
  fireEvent.change(screen.getByPlaceholderText('Name des Events'), { target: { value: 'Punsch Night' } });
  fireEvent.change(form().querySelector('input[type="date"]'), { target: { value: day(5) } });
};
const submit = async () => { await act(async () => { fireEvent.submit(form()); }); };
const proEvents = [];
window.addEventListener('jamie:open-pro-modal', (e) => proEvents.push(e.detail));

beforeEach(() => {
  vi.clearAllMocks();
  proEvents.length = 0;
  world.club = { ...CLUB };
  world.events = [];
  world.quota = quota();
  clubs.createEvent.mockImplementation((id, body) => Promise.resolve({
    data: { id: 90, name: body.name, date: `${body.date}T19:00:00.000Z`, owner_id: 1, members_count: 1, max_members: 20, deal: null },
  }));
});

describe('a club at its limit gets Tina\'s letter instead of the form', () => {
  it('a second event while the first is still ahead: „+“ opens „ihr seid ja schnell“ — no form', async () => {
    world.quota = quota({ used: 1, upcoming: 1, block: 'concurrent' });
    await renderClub();
    expect(partnerApi.getEventQuota).toHaveBeenCalledWith('7');
    await tap(plus());
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent).toBe('Hey Laufclub Prater, ihr seid ja schnell! 🙌');
    within(sheet).getByText(/Noch nicht bereit\?/);
    expect(form()).toBeNull();
    // closing it leaves the page as it was — and the form still closed
    await tap(within(sheet).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(form()).toBeNull();
  });

  it('the third event: „schön, dass ihr wieder ein Event plant“ — without „Noch nicht bereit?“; „Erstes Event erstellen“ goes the same way', async () => {
    world.quota = quota({ used: 2, upcoming: 0, block: 'third' });
    await renderClub();
    await tap(screen.getByRole('button', { name: 'Erstes Event erstellen' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent)
      .toBe('Hey Laufclub Prater, schön, dass ihr wieder ein Event plant! 🙌');
    expect(within(sheet).queryByText(/Noch nicht bereit/)).toBeNull();
    expect(form()).toBeNull();
  });

  it('a plain member who may create events gets one sentence, not the letter', async () => {
    world.club = { ...CLUB, owner_id: 99 };
    world.quota = quota({ used: 1, upcoming: 1, block: 'concurrent', is_manager: false });
    await renderClub();
    await tap(plus());
    expect(toast.error).toHaveBeenCalledWith('Dieser Club kann gerade keine weiteren Events anlegen.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(form()).toBeNull();
  });

  it('a co-manager gets the letter like the owner', async () => {
    world.club = { ...CLUB, owner_id: 99, is_manager: true };
    world.quota = quota({ used: 2, block: 'third' });
    await renderClub();
    await tap(plus());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('not at the limit: the form opens — and „+“ closes it again', async () => {
    await renderClub();
    await tap(plus());
    expect(form()).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await tap(plus());
    expect(form()).toBeNull();
  });

  it('the quota cannot be read (an older server): the form opens as it always did, the server decides', async () => {
    world.quota = Object.assign(new Error('Request failed'), { response: { status: 404 } });
    await renderClub();
    await tap(plus());
    expect(form()).toBeTruthy();
  });
});

describe('„Kostenfreies Event“ unticked', () => {
  it('a limited official club: the ticket letter opens, the tick stays, no ticket field', async () => {
    await renderClub({ isPro: true });
    await tap(plus());
    await tap(box('Kostenfreies Event'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent).toBe('Hey Laufclub Prater, ihr seid ja schnell! 🙌');
    expect(within(sheet).queryByText(/Noch nicht bereit/)).toBeNull();      // not for tickets
    expect(box('Kostenfreies Event').checked).toBe(true);
    expect(screen.queryByText('Kostenpflichtiges Event')).toBeNull();
    expect(screen.queryByLabelText(/Ticket-Link/)).toBeNull();
    expect(proEvents).toEqual([]);
    // the request names the ticket letter as its source
    await tap(within(sheet).getByRole('button', { name: 'Ja, meldet euch!' }));
    await tap(screen.getByRole('checkbox', { name: /Datenschutzerklärung/ }));
    await tap(screen.getByRole('button', { name: 'Anfrage senden' }));
    expect(partnerApi.requestPartner).toHaveBeenCalledWith('7', expect.objectContaining({ reason: 'ticket', contact: 'mail' }));
  });

  it('a limited club, a member without the right to ask: one sentence, the tick stays', async () => {
    world.club = { ...CLUB, owner_id: 99 };
    await renderClub();
    await tap(plus());
    await tap(box('Kostenfreies Event'));
    expect(toast.error).toHaveBeenCalledWith('Dieser Club kann gerade keine weiteren Events anlegen.');
    expect(box('Kostenfreies Event').checked).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an official club that is not limited (a paying partner): the ticket field, and it is sent without Pro and without the Pro modal', async () => {
    world.quota = quota({ limited: false, ticket_allowed: true });
    await renderClub({ isPro: false });
    await tap(plus());
    await tap(box('Kostenfreies Event'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Ticket-Link/), { target: { value: 'shop.example.com/t' } });
    fillEvent();
    await submit();
    expect(proEvents).toEqual([]);
    expect(clubs.createEvent).toHaveBeenCalledWith('7', expect.objectContaining({ name: 'Punsch Night', ticket_url: 'shop.example.com/t' }));
  });

  it('…and should the server still ask for Pro there (the free tier switched off), the Pro modal opens', async () => {
    world.quota = quota({ limited: false, ticket_allowed: true });
    clubs.createEvent.mockRejectedValue({ response: { status: 403, data: { code: 'PRO_REQUIRED', error: 'Kostenpflichtige Events sind ein Pro-Feature.' } } });
    await renderClub({ isPro: false });
    await tap(plus());
    await tap(box('Kostenfreies Event'));
    fireEvent.change(screen.getByLabelText(/Ticket-Link/), { target: { value: 'https://shop.example.com/t' } });
    fillEvent();
    await submit();
    expect(proEvents).toEqual([{ feature: 'paidEvents' }]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a community: the Pro way as before — no quota asked, no letter', async () => {
    world.club = { ...CLUB, club_type: 'community' };
    await renderClub({ isPro: false });
    expect(partnerApi.getEventQuota).not.toHaveBeenCalled();
    await tap(plus());
    await tap(box('Kostenfreies Event'));
    expect(screen.queryByRole('dialog')).toBeNull();
    screen.getByText('Kostenpflichtiges Event');
    fireEvent.change(screen.getByLabelText(/Ticket-Link/), { target: { value: 'https://shop.example.com/t' } });
    fillEvent();
    await submit();
    expect(proEvents).toEqual([{ feature: 'paidEvents' }]);
    expect(clubs.createEvent).not.toHaveBeenCalled();
  });
});

describe('the bars „Deal anlegen“ and „Automatisierte Nachrichten“', () => {
  it('under „Kostenfreies Event“, in this order, both unticked — Tina\'s texts', async () => {
    await renderClub();
    await tap(plus());
    const titles = [...form().querySelectorAll('.cd-event-recurring-title')].map((el) => el.textContent);
    expect(titles).toEqual(['Wöchentlich wiederholen', 'Privates Event', 'Kostenfreies Event', 'Deal anlegen', 'Automatisierte Nachrichten']);
    screen.getByText('Biete Teilnehmer:innen einen Vorteil, z. B. Rabatt oder Gratisgetränk');
    screen.getByText('Erinnerungen und Infos zum Event gehen automatisch in euren Namen an die Gruppe');
    expect(box('Deal anlegen').checked).toBe(false);
    expect(box('Automatisierte Nachrichten').checked).toBe(false);
    expect(form().querySelector('.cd-event-deal-panel')).toBeNull();
  });

  it.each([
    ['a community', { club_type: 'community' }],
    ['an official club still in review', { approval_status: 'pending' }],
    ['a plain member of an official club', { owner_id: 99 }],
  ])('%s has neither bar', async (_who, over) => {
    world.club = { ...CLUB, ...over };
    world.quota = quota({ is_manager: false });
    await renderClub();
    await tap(plus());
    expect(form()).toBeTruthy();
    expect(screen.queryByText('Deal anlegen')).toBeNull();
    expect(screen.queryByText('Automatisierte Nachrichten')).toBeNull();
  });

  it('the tick opens the deal\'s fields between the two bars — the club\'s name and the event\'s date filled in; unticking takes them away', async () => {
    await renderClub();
    await tap(plus());
    fireEvent.change(form().querySelector('input[type="date"]'), { target: { value: day(5) } });
    await tap(box('Deal anlegen'));
    const panel = screen.getByRole('group', { name: 'Deal zum Event' });
    expect(panel).toHaveClass('cd-event-deal-panel');
    expect(within(panel).getByLabelText(/^Name auf der Karte/)).toHaveValue('Laufclub Prater');
    expect(within(panel).getByLabelText(/^Sichtbar bis/)).toHaveValue(day(5));
    // between its bar and the next one
    const dealBar = screen.getByText('Deal anlegen').closest('label');
    const autoBar = screen.getByText('Automatisierte Nachrichten').closest('label');
    expect(dealBar.nextElementSibling).toBe(panel);
    expect(panel.nextElementSibling).toBe(autoBar);
    await tap(box('Deal anlegen'));
    expect(form().querySelector('.cd-event-deal-panel')).toBeNull();
  });

  it('the event is sent with its deal and the automated messages', async () => {
    clubs.createEvent.mockImplementation((id, body) => Promise.resolve({ data: {
      id: 90, name: body.name, date: `${body.date}T19:00:00.000Z`, owner_id: 1, members_count: 1, max_members: 20,
      deal: { id: 3, name: 'Laufclub Prater', deal_label: '1 Punsch gratis', photo: null, verified: false },
    } }));
    await renderClub();
    await tap(plus());
    fillEvent();
    await tap(box('Deal anlegen'));
    fireEvent.change(screen.getByLabelText(/^Angebot/), { target: { value: '1 Punsch gratis' } });
    await tap(box('Automatisierte Nachrichten'));
    await submit();
    expect(clubs.createEvent).toHaveBeenCalledTimes(1);
    const [, body] = clubs.createEvent.mock.calls[0];
    expect(body).toMatchObject({ name: 'Punsch Night', date: day(5), auto_messages: true });
    expect(body.deal).toEqual({
      name: 'Laufclub Prater', deal_label: '1 Punsch gratis', description: null, address: null, booking_url: null,
      photos: [], visible_until: day(5), max_redemptions: '100', redeem_interval: 'once', redeem_days: [],
    });
    expect(toast.success).toHaveBeenCalledWith('Event erstellt');
    // the new event shows with its deal under it, the form is closed and reset
    await waitFor(() => expect(document.querySelector('.cd-event-item .event-deal-row')).toBeTruthy());
    expect(form()).toBeNull();
    // the quota is asked again: this event used one of the free ones
    expect(partnerApi.getEventQuota).toHaveBeenCalledTimes(2);
    await tap(plus());
    expect(box('Deal anlegen').checked).toBe(false);
    expect(box('Automatisierte Nachrichten').checked).toBe(false);
  });

  it('without the ticks neither is sent as set: no deal, automated messages off', async () => {
    await renderClub();
    await tap(plus());
    fillEvent();
    await submit();
    const [, body] = clubs.createEvent.mock.calls[0];
    expect(body.deal).toBeUndefined();
    expect(body.auto_messages).toBe(false);
  });

  it('a community\'s request carries neither field at all', async () => {
    world.club = { ...CLUB, club_type: 'community' };
    await renderClub();
    await tap(plus());
    fillEvent();
    await submit();
    const [, body] = clubs.createEvent.mock.calls[0];
    expect('deal' in body && body.deal !== undefined).toBe(false);
    expect(body.auto_messages).toBeUndefined();
  });

  it('„Deal anlegen“ ticked without an offer: said in the deal\'s words, nothing sent', async () => {
    await renderClub();
    await tap(plus());
    fillEvent();
    await tap(box('Deal anlegen'));
    await submit();
    expect(toast.error).toHaveBeenCalledWith('Name, Angebot und „Sichtbar bis“ sind Pflichtfelder');
    expect(clubs.createEvent).not.toHaveBeenCalled();
    expect(form()).toBeTruthy();
  });
});

describe('the server says no after all', () => {
  const refuse = (reason) => clubs.createEvent.mockRejectedValue({ response: { status: 403, data: {
    code: 'PARTNER_REQUIRED', reason, club_name: 'Laufclub Prater', error: 'Ab dem dritten Event geht es als JAMIE Partner weiter.' } } });

  it('403 PARTNER_REQUIRED / third: the letter for the third event, the form closes, the quota is read again', async () => {
    refuse('third');
    await renderClub();
    await tap(plus());
    fillEvent();
    await submit();
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent)
      .toBe('Hey Laufclub Prater, schön, dass ihr wieder ein Event plant! 🙌');
    expect(form()).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(partnerApi.getEventQuota).toHaveBeenCalledTimes(2);
  });

  it('403 PARTNER_REQUIRED / ticket: the ticket letter, the event is free again in the form', async () => {
    world.quota = quota({ limited: false, ticket_allowed: true });
    refuse('ticket');
    await renderClub({ isPro: true });
    await tap(plus());
    await tap(box('Kostenfreies Event'));
    fireEvent.change(screen.getByLabelText(/Ticket-Link/), { target: { value: 'https://shop.example.com/t' } });
    fillEvent();
    await submit();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(form()).toBeTruthy();
    expect(box('Kostenfreies Event').checked).toBe(true);
  });

  it('a member is told in one sentence', async () => {
    world.club = { ...CLUB, owner_id: 99 };
    world.quota = quota({ is_manager: false });
    refuse('concurrent');
    await renderClub();
    await tap(plus());
    fillEvent();
    await submit();
    expect(toast.error).toHaveBeenCalledWith('Dieser Club kann gerade keine weiteren Events anlegen.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('any other failure: the server\'s sentence as before', async () => {
    clubs.createEvent.mockRejectedValue({ response: { status: 422, data: { error: 'Dein Text enthält unangemessene Inhalte.' } } });
    await renderClub();
    await tap(plus());
    fillEvent();
    await submit();
    expect(toast.error).toHaveBeenCalledWith('Dein Text enthält unangemessene Inhalte.');
    expect(form()).toBeTruthy();
  });
});
