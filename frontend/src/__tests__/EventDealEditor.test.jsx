import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// „Deal am Event“ on the edit page of a club event (Tina's document of
// 17.11.2026, decided by Tobi): ONE deal per event — put up, edited and taken
// off right here, without JAMIE Pro — and the switch „Automatisierte
// Nachrichten“ under it. The server says who sees it and what may be done
// (GET …/extras); this only draws it. Real German i18n.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
const world = {};
const partner = { getEventExtras: vi.fn(), saveEventDeal: vi.fn(), removeEventDeal: vi.fn() };
vi.mock('../utils/api', () => ({
  // A test that mocks utils/api WITHOUT partnerApi (GroupEditSize) throws on
  // the access itself — this getter does the same on demand.
  get partnerApi() {
    if (world.noApi) throw new Error('[vitest] No "partnerApi" export is defined on the "../utils/api" mock');
    return partner;
  },
  clubs: { updateEvent: vi.fn() },
  upload: { image: vi.fn() },
}));
const { clubs } = await import('../utils/api');
const { default: EventDealEditor } = await import('../components/EventDealEditor');

const DEAL = {
  id: 42, name: 'Café Soleá', deal_label: '1 Punsch gratis', description: null, address: 'Wien', booking_url: null,
  photos: [], visible_until: '2026-12-31T22:59:59.000Z', max_redemptions: 100, redeem_interval: 'once', redeem_days: null,
};
const extras = (over = {}) => ({
  is_official: true, club_name: 'Café Soleá', auto_messages: false,
  deal: null, deal_shown: null, jamie_deal: null, deal_allowed: true, ...over,
});
const renderEditor = async (data) => {
  if (data !== undefined) partner.getEventExtras.mockResolvedValue({ data });
  const view = render(<EventDealEditor clubId={7} eventId={90} eventDate="2026-12-05" />);
  await act(async () => {});
  return view;
};
const autoSwitch = () => screen.getByLabelText('Automatisierte Nachrichten');
const NOT_ALLOWED = 'Deals gibt es für die ersten 2 Events eures Clubs – danach als JAMIE Partner.';

let confirmSpy;
beforeEach(() => {
  vi.clearAllMocks();
  world.noApi = false;
  partner.getEventExtras.mockResolvedValue({ data: extras() });
  partner.saveEventDeal.mockResolvedValue({ data: { deal: DEAL, deal_shown: null } });
  partner.removeEventDeal.mockResolvedValue({ data: { ok: true } });
  clubs.updateEvent.mockImplementation(async (_c, _e, body) => ({ data: { id: 90, ...body } }));
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => confirmSpy.mockRestore());

describe('EventDealEditor — who sees it', () => {
  it('asks the server for this event of this club', async () => {
    await renderEditor();
    expect(partner.getEventExtras).toHaveBeenCalledWith(7, 90);
    expect(screen.getByText('Deal am Event')).toBeInTheDocument();
  });

  it.each([
    ['a plain member (403)', () => partner.getEventExtras.mockRejectedValue({ response: { status: 403, data: { code: 'NOT_CLUB_MANAGER' } } })],
    ['an older server (404)', () => partner.getEventExtras.mockRejectedValue({ response: { status: 404 } })],
    ['a server error', () => partner.getEventExtras.mockRejectedValue({ response: { status: 500 } })],
    ['an event of a community', () => partner.getEventExtras.mockResolvedValue({ data: extras({ is_official: false, deal_allowed: false }) })],
    ['no answer at all', () => partner.getEventExtras.mockResolvedValue(undefined)],
    ['a mocked api without partnerApi', () => { world.noApi = true; }],
  ])('%s: nothing is rendered, nothing throws', async (_name, arrange) => {
    arrange();
    const { container } = await renderEditor(undefined);
    expect(container.textContent).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('the deal tables are not there yet (unavailable): only the sentence — no button, no switch', async () => {
    await renderEditor(extras({ unavailable: true, deal_allowed: false }));
    expect(screen.getByText(NOT_ALLOWED)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Automatisierte Nachrichten')).not.toBeInTheDocument();
  });
});

describe('EventDealEditor — the deal', () => {
  it('none yet and one may be put up: „Deal anlegen“ opens the form with the club\'s name and the event\'s date', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Deal anlegen' }));
    expect(screen.getByRole('form', { name: 'Neuer Deal' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name auf der Karte/)).toHaveValue('Café Soleá');
    expect(screen.getByLabelText(/^Sichtbar bis/)).toHaveValue('2026-12-05');

    fireEvent.change(screen.getByLabelText(/^Angebot \(2 Wörter\)/), { target: { value: '1 Punsch gratis' } });
    partner.getEventExtras.mockResolvedValue({ data: extras({ deal: DEAL }) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' })); });

    expect(partner.saveEventDeal).toHaveBeenCalledTimes(1);
    const [clubId, eventId, payload] = partner.saveEventDeal.mock.calls[0];
    expect([clubId, eventId]).toEqual([7, 90]);
    expect(payload).toMatchObject({ name: 'Café Soleá', deal_label: '1 Punsch gratis', visible_until: '2026-12-05' });
    expect(toast.success).toHaveBeenCalledWith('Deal gespeichert');
    // the form is closed and the page shows what the server has now
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(await screen.findByText('1 Punsch gratis')).toBeInTheDocument();
    expect(partner.getEventExtras).toHaveBeenCalledTimes(2);
  });

  it('the club\'s own deal: name, offer and „Sichtbar bis“ (the Vienna day) — „Bearbeiten“ saves through the event', async () => {
    await renderEditor(extras({ deal: DEAL }));
    expect(screen.getByText('Café Soleá')).toBeInTheDocument();
    expect(screen.getByText('1 Punsch gratis')).toBeInTheDocument();
    expect(screen.getByText('Sichtbar bis 31.12.2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Deal anlegen' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deal „1 Punsch gratis“ bearbeiten' }));
    expect(screen.getByRole('form', { name: 'Deal bearbeiten' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Angebot \(2 Wörter\)/)).toHaveValue('1 Punsch gratis');
    fireEvent.change(screen.getByLabelText(/^Angebot \(2 Wörter\)/), { target: { value: '2 für 1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' })); });
    expect(partner.saveEventDeal.mock.calls[0][2]).toMatchObject({ deal_label: '2 für 1' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('„Entfernen“ asks first, then takes the deal off the event', async () => {
    await renderEditor(extras({ deal: DEAL }));
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(confirmSpy).toHaveBeenCalledWith('Deal „1 Punsch gratis“ vom Event nehmen und löschen?');
    expect(partner.removeEventDeal).not.toHaveBeenCalled();

    partner.getEventExtras.mockResolvedValue({ data: extras() });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entfernen' })); });
    expect(partner.removeEventDeal).toHaveBeenCalledWith(7, 90);
    expect(toast.success).toHaveBeenCalledWith('Deal entfernt');
    expect(await screen.findByRole('button', { name: '+ Deal anlegen' })).toBeInTheDocument();
    expect(screen.queryByText('1 Punsch gratis')).not.toBeInTheDocument();
  });

  it('a failed removal says so and leaves the deal where it is', async () => {
    await renderEditor(extras({ deal: DEAL }));
    partner.removeEventDeal.mockRejectedValue({ response: { status: 500, data: {} } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entfernen' })); });
    expect(toast.error).toHaveBeenCalledWith('Das hat nicht geklappt');
    expect(screen.getByText('1 Punsch gratis')).toBeInTheDocument();
  });

  it('no deal and none allowed (the free tier is used up): the sentence, no button', async () => {
    await renderEditor(extras({ deal_allowed: false }));
    expect(screen.getByText(NOT_ALLOWED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Deal anlegen' })).not.toBeInTheDocument();
  });

  it('a deal of the JAMIE team on the event: named, no buttons', async () => {
    await renderEditor(extras({ jamie_deal: { name: 'JAMIE Punsch' }, deal_allowed: true }));
    expect(screen.getByText('An diesem Event hängt ein Deal von JAMIE: JAMIE Punsch. Den kann nur das JAMIE-Team ändern.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Deal anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
  });

  it('the server says PARTNER_REQUIRED on saving: the form closes, the sentence takes its place — no toast', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Deal anlegen' }));
    fireEvent.change(screen.getByLabelText(/^Angebot \(2 Wörter\)/), { target: { value: '1 Punsch gratis' } });
    partner.saveEventDeal.mockRejectedValue({ response: { status: 403, data: { code: 'PARTNER_REQUIRED', reason: 'deal', error: 'x' } } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' })); });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText(NOT_ALLOWED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Deal anlegen' })).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an own deal on an event that may no longer carry one: „Bearbeiten“ shows the sentence instead of a form that would be refused', async () => {
    await renderEditor(extras({ deal: DEAL, deal_allowed: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Deal „1 Punsch gratis“ bearbeiten' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText(NOT_ALLOWED)).toBeInTheDocument();
    // taking it off is always possible
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeEnabled();
  });

  it('any other failed save keeps the form and says what the server said', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Deal anlegen' }));
    fireEvent.change(screen.getByLabelText(/^Angebot \(2 Wörter\)/), { target: { value: 'Hurensohn' } });
    partner.saveEventDeal.mockRejectedValue({ response: { status: 422, data: { error: 'Dein Text enthält unangemessene Inhalte.' } } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' })); });
    expect(toast.error).toHaveBeenCalledWith('Dein Text enthält unangemessene Inhalte.');
    expect(screen.getByRole('form', { name: 'Neuer Deal' })).toBeInTheDocument();
  });
});

describe('EventDealEditor — „Automatisierte Nachrichten“', () => {
  it('shows the switch as it is stored, with Tina\'s sentence under it', async () => {
    await renderEditor(extras({ auto_messages: true }));
    expect(autoSwitch()).toBeChecked();
    expect(screen.getByText('Erinnerungen und Infos zum Event gehen automatisch in euren Namen an die Gruppe')).toBeInTheDocument();
  });

  it('a tap saves at once through the event and says so', async () => {
    await renderEditor();
    expect(autoSwitch()).not.toBeChecked();
    await act(async () => { fireEvent.click(autoSwitch()); });
    expect(clubs.updateEvent).toHaveBeenCalledWith(7, 90, { auto_messages: true });
    expect(autoSwitch()).toBeChecked();
    expect(toast.success).toHaveBeenCalledWith('Automatisierte Nachrichten an');

    await act(async () => { fireEvent.click(autoSwitch()); });
    expect(clubs.updateEvent).toHaveBeenLastCalledWith(7, 90, { auto_messages: false });
    expect(autoSwitch()).not.toBeChecked();
    expect(toast.success).toHaveBeenLastCalledWith('Automatisierte Nachrichten aus');
  });

  it('a failed save turns the switch back and says so', async () => {
    await renderEditor();
    clubs.updateEvent.mockRejectedValue({ response: { status: 500, data: {} } });
    await act(async () => { fireEvent.click(autoSwitch()); });
    expect(autoSwitch()).not.toBeChecked();
    expect(toast.error).toHaveBeenCalledWith('Das hat nicht geklappt');
    await waitFor(() => expect(autoSwitch()).toBeEnabled());
  });

  it('the server stored something else than asked (its table is not ready): the switch shows what is stored', async () => {
    await renderEditor();
    clubs.updateEvent.mockResolvedValue({ data: { id: 90, auto_messages: false } });
    await act(async () => { fireEvent.click(autoSwitch()); });
    expect(autoSwitch()).not.toBeChecked();
    expect(toast.error).toHaveBeenCalledWith('Das hat nicht geklappt');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
