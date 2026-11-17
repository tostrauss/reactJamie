import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// „Aus Fremden können Freundschaften werden!“ — the friends list after an
// event (Tina 17.11.2026, her Bild 8): everybody who was in the group, each
// with „Freundschaftsanfrage senden“ or „✓ Befreundet“. Real German i18n; the
// api is mocked.
const api = vi.hoisted(() => ({
  friends: { sendRequest: vi.fn(), respondRequest: vi.fn() },
  postEventApi: { dismissConnect: vi.fn() },
  users: {},
}));
vi.mock('../utils/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => false }));

const { default: ConnectSheet } = await import('../components/ConnectSheet');

const person = (id, name, friend_status = 'none', over = {}) => ({
  id, name, avatar_url: null, age: 27, is_owner: false, friend_status, friendship_id: null, ...over,
});
const EVENT = {
  group_id: 12, group_name: 'Spieleabend', event_date: '2026-11-15T23:30:00.000Z', image_url: null,
  members: [
    person(5, 'Otto', 'none', { is_owner: true, avatar_url: 'https://app.jamie-app.com/media/uploads/otto.webp' }),
    person(8, 'Niklas', 'accepted', { friendship_id: 31 }),
    person(9, 'Mia', 'pending_out', { friendship_id: 32 }),
    person(10, 'Lena', 'pending_in', { friendship_id: 33 }),
  ],
};
const SECOND = {
  group_id: 13, group_name: 'Lauftreff', event_date: '2026-11-14T00:00:00.000Z', image_url: null,
  members: [person(5, 'Otto', 'none', { is_owner: true }), person(20, 'Paul')],
};

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const onDone = vi.fn();
const renderSheet = (items = [EVENT]) => render(
  <MemoryRouter initialEntries={['/home']}>
    <Routes><Route path="*" element={<Where />} /></Routes>
    <ConnectSheet items={items} onDone={onDone} />
  </MemoryRouter>,
);
const row = (name) => [...document.querySelectorAll('.pe-person')]
  .find((li) => li.querySelector('.pe-person-name').textContent.startsWith(name));
const action = (name) => row(name).querySelector('.pe-friend-btn');
const tap = async (el) => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  vi.clearAllMocks();
  api.friends.sendRequest.mockResolvedValue({ data: { message: 'Friend request sent' } });
  api.friends.respondRequest.mockResolvedValue({ data: { message: 'ok' } });
  api.postEventApi.dismissConnect.mockResolvedValue({ data: { success: true } });
});

describe('ConnectSheet — what it says', () => {
  it('Tina\'s two sentences, character for character, over the event and its day', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The dialog is named by her headline.
    expect(screen.getByRole('dialog', { name: 'Aus Fremden können Freundschaften werden!' })).toBe(dialog);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Aus Fremden können Freundschaften werden!');
    // The space before the „!“ is hers.
    expect(dialog.querySelector('.pe-text').textContent).toBe('Mach den ersten Schritt und schicke eine Freundschaftsanfrage !');
    expect(dialog.querySelector('.pe-head-name').textContent).toBe('Spieleabend');
    // Vienna wall-clock tagged UTC: a 23:30 event stays on the 15th.
    expect(dialog.querySelector('.pe-head-date').textContent).toBe('15. November');
  });

  it('everybody who was there, in the server\'s order (the creator first), with name and age', () => {
    renderSheet();
    const list = screen.getByRole('list', { name: 'Wer bei „Spieleabend“ dabei war' });
    const names = [...list.querySelectorAll('.pe-person-name')].map((n) => n.firstChild.textContent);
    expect(names).toEqual(['Otto', 'Niklas', 'Mia', 'Lena']);
    expect(within(row('Otto')).getByLabelText('Alter 27')).toBeTruthy();
    // A photo where there is one, else the outline of a person (Bild 8).
    expect(row('Otto').querySelector('.pe-person-av img').getAttribute('src')).toContain('otto.webp');
    expect(row('Niklas').querySelector('.pe-person-av img')).toBeNull();
    expect(row('Niklas').querySelector('.pe-person-av svg')).toBeTruthy();
  });

  it('one state per person: send / „✓ Befreundet“ / „Angefragt“ / „Annehmen“', () => {
    renderSheet();
    expect(action('Otto').tagName).toBe('BUTTON');
    expect(action('Otto').textContent).toBe('Freundschaftsanfrage senden');
    expect(action('Otto').classList.contains('pe-friend-btn--primary')).toBe(true);
    // Bild 8: an outlined pill, „✓ Befreundet“ — not a button.
    expect(action('Niklas').tagName).toBe('SPAN');
    expect(action('Niklas').textContent).toBe('✓ Befreundet');
    expect(action('Niklas').classList.contains('pe-friend-btn--friends')).toBe(true);
    expect(action('Niklas').querySelector('[aria-hidden="true"]').textContent).toBe('✓');
    expect(action('Mia').tagName).toBe('SPAN');
    expect(action('Mia').textContent).toBe('Angefragt');
    expect(action('Mia').classList.contains('pe-friend-btn--done')).toBe(true);
    expect(action('Lena').tagName).toBe('BUTTON');
    expect(action('Lena').textContent).toBe('Annehmen');
  });

  it('nothing to show: renders nothing', () => {
    const { container } = renderSheet([]);
    expect(container.querySelector('.pe-backdrop')).toBeNull();
  });
});

describe('ConnectSheet — the friendship buttons', () => {
  it('„Freundschaftsanfrage senden“ sends the request and says „Angefragt“ at once', async () => {
    let finish;
    api.friends.sendRequest.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderSheet();
    fireEvent.click(action('Otto'));
    expect(api.friends.sendRequest).toHaveBeenCalledWith(5);
    expect(action('Otto').textContent).toBe('Angefragt');       // before the answer is in
    await act(async () => { finish({ data: {} }); });
    expect(action('Otto').textContent).toBe('Angefragt');
    expect(action('Otto').tagName).toBe('SPAN');
  });

  it('„Befreundet“ does nothing when tapped', async () => {
    renderSheet();
    await tap(action('Niklas'));
    expect(api.friends.sendRequest).not.toHaveBeenCalled();
    expect(api.friends.respondRequest).not.toHaveBeenCalled();
  });

  it('„Annehmen“ accepts the open request and turns into „✓ Befreundet“', async () => {
    renderSheet();
    await tap(action('Lena'));
    expect(api.friends.respondRequest).toHaveBeenCalledWith(33, 'accept');
    expect(action('Lena').textContent).toBe('✓ Befreundet');
    expect(toast.success).toHaveBeenCalledWith('Ihr seid jetzt befreundet 🎉');
  });

  it('the daily limit of five: the row falls back and the „Tageslimit erreicht“ sheet opens above', async () => {
    api.friends.sendRequest.mockRejectedValue({ response: { status: 403, data: { code: 'DAILY_FRIEND_LIMIT', error: 'Tageslimit erreicht' } } });
    renderSheet();
    await tap(action('Otto'));
    expect(action('Otto').textContent).toBe('Freundschaftsanfrage senden');
    expect(screen.getByRole('dialog', { name: 'Tageslimit erreicht' })).toBeTruthy();
    expect(screen.getByText(/Du hast heute schon 5 Leute angefragt/)).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('any other failure: the row falls back and one error toast says so', async () => {
    api.friends.sendRequest.mockRejectedValue({ response: { status: 500, data: { error: 'Interner Serverfehler' } } });
    renderSheet();
    await tap(action('Otto'));
    expect(action('Otto').textContent).toBe('Freundschaftsanfrage senden');
    expect(toast.error).toHaveBeenCalledWith('Anfrage konnte nicht gesendet werden.');
  });

  it('a state belongs to the person: asked in one event, „Angefragt“ in the next one too', async () => {
    renderSheet([EVENT, SECOND]);
    await tap(action('Otto'));
    await tap(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen.getByRole('dialog').querySelector('.pe-head-name').textContent).toBe('Lauftreff');
    expect(action('Otto').textContent).toBe('Angefragt');
    expect(action('Paul').textContent).toBe('Freundschaftsanfrage senden');
  });

  it('a person is no link: a tap on the name stays where it is', async () => {
    renderSheet();
    await tap(row('Niklas').querySelector('.pe-person-name'));
    await tap(row('Niklas').querySelector('.pe-person-av'));
    expect(screen.getByTestId('where').textContent).toBe('/home');
    expect(row('Niklas').querySelector('a, button')).toBeNull();
  });
});

describe('ConnectSheet — closing', () => {
  it('„Fertig“ closes this event for good and moves to the next; after the last one onDone', async () => {
    renderSheet([EVENT, SECOND]);
    await tap(screen.getByRole('button', { name: 'Fertig' }));
    expect(api.postEventApi.dismissConnect).toHaveBeenCalledWith(12);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').querySelector('.pe-head-name').textContent).toBe('Lauftreff');
    // The 14th is a date-only meetup, stored at 00:00.
    expect(screen.getByRole('dialog').querySelector('.pe-head-date').textContent).toBe('14. November');
    await tap(screen.getByRole('button', { name: 'Fertig' }));
    expect(api.postEventApi.dismissConnect).toHaveBeenLastCalledWith(13);
    expect(api.postEventApi.dismissConnect).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the X does the same', async () => {
    renderSheet();
    await tap(screen.getByRole('button', { name: 'Schließen' }));
    expect(api.postEventApi.dismissConnect).toHaveBeenCalledWith(12);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Escape does the same', async () => {
    renderSheet();
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(api.postEventApi.dismissConnect).toHaveBeenCalledWith(12);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a tap on the dimmed background does nothing', async () => {
    renderSheet();
    await tap(document.querySelector('.pe-backdrop'));
    expect(api.postEventApi.dismissConnect).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closing never waits for the network: a failing dismiss still moves on', async () => {
    api.postEventApi.dismissConnect.mockRejectedValue(new Error('Network Error'));
    renderSheet();
    await tap(screen.getByRole('button', { name: 'Fertig' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the list re-sorted under it (a Connect push for another event): the closed one never comes back', async () => {
    const { rerender } = renderSheet([EVENT, SECOND]);
    await tap(screen.getByRole('button', { name: 'Fertig' }));          // closes 12
    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <ConnectSheet items={[SECOND, EVENT]} onDone={onDone} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog').querySelector('.pe-head-name').textContent).toBe('Lauftreff');
    await tap(screen.getByRole('button', { name: 'Fertig' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
