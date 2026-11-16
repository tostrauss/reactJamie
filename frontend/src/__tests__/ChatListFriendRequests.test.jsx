import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SocketContext } from '../context/SocketContext';

// Friend requests in Chat → Anfragen (Lea, 18.10.2026: „Man bemerkt die
// Freundschaftsanfragen nicht, nur wenn man aufs eigene Profil schaut.“). Same
// swipe deck as the join requests, marked „Freundschaftsanfrage“ instead of a
// group — since 16.11.2026 in the card's own band (Ziel 4) —, answered
// through the friendship endpoints. Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), showUndo: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../hooks/useOnPullRefresh', () => ({ default: () => {} }));
vi.mock('../utils/api', () => ({
  groups: {
    getJoined: vi.fn(async () => ({ data: [] })),
    getAllRequests: vi.fn(async () => ({ data: [] })),
    handleRequest: vi.fn(async () => ({ data: {} })),
  },
  clubs: { handleRequest: vi.fn(async () => ({ data: {} })) },
  directMessages: { getConversations: vi.fn(async () => ({ data: [] })) },
  friends: {
    getPending: vi.fn(async () => ({ data: [] })),
    respondRequest: vi.fn(async () => ({ data: {} })),
  },
}));
const { groups, clubs, friends } = await import('../utils/api');
const { ChatList } = await import('../pages/ChatList');

// GET /friends/requests/pending row (requester_*), with the Abzeichen-Stufe
// both ways: _step is the five-step level the deck shows, _tier the old
// bundles' scale it must ignore.
const friendReq = (o = {}) => ({
  id: 31, requester_id: 77, addressee_id: 1, status: 'pending',
  requester_name: 'Lea', requester_avatar: null, requester_age: 27,
  requester_interests: ['Wandern', 'Kaffee'], requester_trusted: true,
  requester_attendance_tier: 2, requester_attendance_step: 3,
  created_at: '2026-10-17T10:00:00Z', updated_at: '2026-10-17T10:00:00Z', ...o,
});
// Join request with the SAME id and updated_at — two tables, two sequences:
// handling one must never hide the other.
const joinReq = (o = {}) => ({
  id: 31, group_id: 7, user_id: 55, user_name: 'Max', user_avatar: null, user_age: 30,
  user_interests: '[]', user_trusted: false, message: 'Darf ich mit?',
  group_name: 'Laufen (easy)', group_type: 'group',
  created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-17T10:00:00Z', ...o,
});

const makeSocket = () => {
  const handlers = {};
  return {
    handlers,
    on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
    off: vi.fn((ev) => { delete handlers[ev]; }),
  };
};

// Where the page put the URL (tab, segment).
const LocationProbe = () => {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
};

const renderList = async ({ friendRows = [], joinRows = [], socket = null, url = '/chats?tab=anfragen' } = {}) => {
  friends.getPending.mockResolvedValue({ data: friendRows });
  groups.getAllRequests.mockResolvedValue({ data: joinRows });
  render(
    <SocketContext.Provider value={{ socket, isConnected: !!socket }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/chats" element={<ChatList />} /></Routes>
        <LocationProbe />
      </MemoryRouter>
    </SocketContext.Provider>,
  );
  await act(async () => {});
};
const tabDot = () => screen.getByText('Anfragen').closest('button').querySelector('.tab-dot');
// The decision buttons are icons — their names say whom and what for.
const ACCEPT_LEA = 'Freundschaftsanfrage von Lea annehmen';
const DECLINE_LEA = 'Freundschaftsanfrage von Lea ablehnen';
const ACCEPT_MAX = 'Max in „Laufen (easy)“ aufnehmen';
const DECLINE_MAX = 'Anfrage von Max für „Laufen (easy)“ ablehnen';
const band = () => document.querySelector('.request-type-band');

beforeEach(() => {
  vi.clearAllMocks();
  friends.respondRequest.mockResolvedValue({ data: {} });
});

describe('ChatList — friend requests in the Anfragen deck', () => {
  it('shows the friend request, labelled „Freundschaftsanfrage“ instead of a group, with the card facts', async () => {
    await renderList({ friendRows: [friendReq()] });
    expect(document.querySelector('.request-card')).toHaveClass('request-card--friend');
    expect(band().textContent).toContain('Freundschaftsanfrage');
    expect(band().querySelector('.group-badge, .club-badge')).toBeNull();
    expect(document.querySelector('.request-type-band-name')).toBeNull();
    // The old line above the card — it stood still while the card moved.
    expect(document.querySelector('.requests-deck-group')).toBeNull();
    expect(screen.getByText('Lea, 27')).toBeTruthy();
    expect(screen.getByText('Wandern')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Verifiziert' })).toBeTruthy();
    // 🌟 from requester_attendance_step — never the old three-step field.
    expect(screen.getByRole('img', { name: /mindestens 25-mal bestätigt/ })).toBeTruthy();
  });

  it('friend requests come first; accepting one uses the friendship API, then the join request follows', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq()] });
    expect(screen.getByText('Lea, 27')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ACCEPT_LEA }));
    await waitFor(() => expect(friends.respondRequest).toHaveBeenCalledWith(31, 'accept'));
    expect(groups.handleRequest).not.toHaveBeenCalled();
    expect(clubs.handleRequest).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Du und Lea seid jetzt befreundet!');

    // Same id + updated_at in the other table — still there, with its group.
    await waitFor(() => expect(screen.getByText('Max, 30')).toBeTruthy());
    expect(document.querySelector('.request-type-band-name').textContent).toBe('Laufen (easy)');
    expect(band().querySelector('.group-badge').textContent).toBe('Gruppe');
    expect(document.querySelector('.request-card')).toHaveClass('request-card--group');

    fireEvent.click(screen.getByRole('button', { name: ACCEPT_MAX }));
    await waitFor(() => expect(groups.handleRequest).toHaveBeenCalledWith(7, 31, 'accept'));
    expect(friends.respondRequest).toHaveBeenCalledTimes(1);
  });

  it('within the friend requests the one waiting longest comes first', async () => {
    await renderList({ friendRows: [
      friendReq({ id: 40, requester_name: 'Neu', created_at: '2026-10-18T08:00:00Z', updated_at: '2026-10-18T08:00:00Z' }),
      friendReq({ id: 41, requester_name: 'Alt', created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z' }),
    ] });
    expect(screen.getByText('Alt, 27')).toBeTruthy();
    expect(screen.queryByText('Neu, 27')).toBeNull();
  });

  it('declining is undoable — reject and undo both go to the friendship API', async () => {
    await renderList({ friendRows: [friendReq()] });
    fireEvent.click(screen.getByRole('button', { name: DECLINE_LEA }));
    await waitFor(() => expect(friends.respondRequest).toHaveBeenCalledWith(31, 'reject'));
    expect(toast.showUndo).toHaveBeenCalledWith('Freundschaftsanfrage von Lea abgelehnt', expect.any(Function), 'Rückgängig');
    await waitFor(() => expect(screen.queryByText('Lea, 27')).toBeNull());

    // The server restores the row with a fresh updated_at.
    friends.getPending.mockResolvedValue({ data: [friendReq({ updated_at: '2026-10-18T09:00:00Z' })] });
    const undo = toast.showUndo.mock.calls[0][1];
    await act(async () => { await undo(); });
    expect(friends.respondRequest).toHaveBeenCalledWith(31, 'undo');
    await waitFor(() => expect(screen.getByText('Lea, 27')).toBeTruthy());
    expect(groups.handleRequest).not.toHaveBeenCalled();
  });

  it('a request that is no longer open leaves the deck with a clear message — never the English server text', async () => {
    await renderList({ friendRows: [friendReq()] });
    friends.respondRequest.mockRejectedValueOnce({ response: { status: 404, data: { error: 'Friend request not found' } } });
    friends.getPending.mockResolvedValue({ data: [] });
    fireEvent.click(screen.getByRole('button', { name: ACCEPT_LEA }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Diese Anfrage ist nicht mehr offen.'));
    expect(toast.error).not.toHaveBeenCalledWith('Friend request not found');
    await waitFor(() => expect(screen.queryByText('Lea, 27')).toBeNull());
    expect(screen.getByText('Keine offenen Anfragen')).toBeTruthy();
  });

  it('any other failure keeps the card and says what failed', async () => {
    await renderList({ friendRows: [friendReq()] });
    friends.respondRequest.mockRejectedValueOnce({ response: { status: 500, data: { error: 'Internal' } } });
    fireEvent.click(screen.getByRole('button', { name: DECLINE_LEA }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Fehler beim Ablehnen'));
    expect(screen.getByText('Lea, 27')).toBeTruthy();
    expect(toast.showUndo).not.toHaveBeenCalled();
  });

  it('the Anfragen tab dot counts friend requests — one alone lights it', async () => {
    await renderList({ friendRows: [friendReq()], url: '/chats' });
    expect(tabDot()).toBeTruthy();
  });

  it('no dot when neither kind is waiting', async () => {
    await renderList({ url: '/chats' });
    expect(tabDot()).toBeNull();
  });

  it('the empty state names both kinds', async () => {
    await renderList();
    expect(screen.getByText('Keine offenen Anfragen')).toBeTruthy();
    expect(screen.getByText('Neue Freundschaftsanfragen und Beitrittsanfragen für deine Gruppen und Clubs landen hier.')).toBeTruthy();
  });

  it('a friend_request_update ping refetches the friend requests live — not the join requests', async () => {
    const socket = makeSocket();
    await renderList({ socket });
    expect(screen.getByText('Keine offenen Anfragen')).toBeTruthy();
    expect(socket.on).toHaveBeenCalledWith('friend_request_update', expect.any(Function));

    friends.getPending.mockResolvedValue({ data: [friendReq()] });
    const joinFetches = groups.getAllRequests.mock.calls.length;
    await act(async () => { socket.handlers.friend_request_update({ action: 'received' }); });
    await waitFor(() => expect(screen.getByText('Lea, 27')).toBeTruthy());
    expect(groups.getAllRequests.mock.calls.length).toBe(joinFetches);
  });
});

// „Überspringen“ (Tina, 07.11.2026): a third way out of the deck — ablehnen nur
// zum Weiterblättern kostet den Anfragenden eines seiner zwei Anfrage-Budgets.
describe('ChatList — Überspringen im Anfragen-Deck', () => {
  it('stellt die Karte ans Deck-Ende, ruft keine API und rotiert beim zweiten Skip zurück', async () => {
    await renderList({ joinRows: [
      joinReq(),
      joinReq({ id: 32, user_id: 56, user_name: 'Mia', created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-18T10:00:00Z' }),
    ] });
    expect(screen.getByText('Max, 30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.getByText('Mia, 30')).toBeTruthy();
    expect(groups.handleRequest).not.toHaveBeenCalled();
    expect(friends.respondRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.getByText('Max, 30')).toBeTruthy();
  });

  it('zeigt den Knopf nicht, wenn es keine zweite Karte gibt', async () => {
    await renderList({ joinRows: [joinReq()] });
    expect(screen.queryByRole('button', { name: 'Überspringen' })).toBeNull();
  });
});

// Ziel 4 (Tina 16.11.2026): while swiping it must be clear what a card is —
// segments over the deck, the swipe's words per type, toasts that name the
// group or event and say when an asker's last attempt is gone.
describe('ChatList — Typ klar erkennbar (Ziel 4)', () => {
  // A partner's club event next to the group request, created a day later.
  const punsch = (o = {}) => joinReq({
    id: 32, user_id: 56, user_name: 'Mia', group_id: 9, group_name: 'Punsch Night', group_type: 'event',
    group_date: '2026-12-05T19:00:00.000Z', parent_club_id: 3, parent_club_type: 'official', is_partner: true,
    created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-18T10:00:00Z', ...o,
  });
  const segments = () => screen.getByRole('tablist', { name: 'Anfragen filtern' });
  const where = () => screen.getByTestId('location').textContent;

  it('segments „Alle · Beitritte (n) · Freunde (n)“ — the open cards of each kind', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq(), punsch()] });
    expect(within(segments()).getByRole('tab', { name: 'Alle' })).toHaveAttribute('aria-selected', 'true');
    expect(within(segments()).getByRole('tab', { name: /Beitritte/ }).querySelector('.chat-filter-bubble-count').textContent).toBe('2');
    expect(within(segments()).getByRole('tab', { name: /Freunde/ }).querySelector('.chat-filter-bubble-count').textContent).toBe('1');
  });

  it('„Beitritte“ and „Freunde“ each show only their kind — and live in the URL', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq(), punsch()] });
    expect(screen.getByText('Lea, 27')).toBeTruthy();
    fireEvent.click(within(segments()).getByRole('tab', { name: /Beitritte/ }));
    expect(screen.getByText('Max, 30')).toBeTruthy();
    expect(screen.queryByText('Lea, 27')).toBeNull();
    expect(where()).toBe('/chats?tab=anfragen&kind=beitritte');
    fireEvent.click(within(segments()).getByRole('tab', { name: /Freunde/ }));
    expect(screen.getByText('Lea, 27')).toBeTruthy();
    expect(where()).toBe('/chats?tab=anfragen&kind=freunde');
    fireEvent.click(within(segments()).getByRole('tab', { name: 'Alle' }));
    expect(where()).toBe('/chats?tab=anfragen');
  });

  it('a deep link opens a segment, and skipping rotates inside it', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq(), punsch()], url: '/chats?tab=anfragen&kind=beitritte' });
    expect(screen.getByText('Max, 30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.getByText('Mia, 30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.getByText('Max, 30')).toBeTruthy();
    expect(screen.queryByText('Lea, 27')).toBeNull();
  });

  it('a finished segment says so and leads back to the rest — the tab dot still counts it', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq()], url: '/chats?tab=anfragen&kind=freunde' });
    fireEvent.click(screen.getByRole('button', { name: ACCEPT_LEA }));
    expect(await screen.findByText('Keine offenen Freundschaftsanfragen')).toBeTruthy();
    expect(tabDot()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alle Anfragen zeigen (1)' }));
    expect(screen.getByText('Max, 30')).toBeTruthy();
  });

  it('no segments while nothing waits', async () => {
    await renderList();
    expect(screen.queryByRole('tablist', { name: 'Anfragen filtern' })).toBeNull();
  });

  it('the swipe says what it does: „Befreunden“ a person, „Aufnehmen“ into a group, „Ablehnen“ both', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq()] });
    const acceptLabel = () => document.querySelector('.swipe-accept .swipe-indicator-label').textContent;
    expect(acceptLabel()).toBe('Befreunden');
    expect(document.querySelector('.swipe-decline .swipe-indicator-label').textContent).toBe('Ablehnen');
    fireEvent.click(screen.getByRole('button', { name: ACCEPT_LEA }));
    await waitFor(() => expect(screen.getByText('Max, 30')).toBeTruthy());
    expect(acceptLabel()).toBe('Aufnehmen');
  });

  it('a partner\'s event: „☆ Partner“ in the band, the partner frame, its name', async () => {
    await renderList({ joinRows: [punsch()] });
    expect(document.querySelector('.request-card')).toHaveClass('request-card--partner');
    expect(document.querySelector('.request-type-band-name').textContent).toBe('Punsch Night');
    expect(screen.getByText('Event eines JAMIE-Partners')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mia in „Punsch Night“ aufnehmen' })).toBeTruthy();
  });

  it('the toasts name the group or event', async () => {
    await renderList({ joinRows: [joinReq(), joinReq({ id: 32, user_id: 56, user_name: 'Mia', updated_at: '2026-10-18T10:00:00Z' })] });
    fireEvent.click(screen.getByRole('button', { name: ACCEPT_MAX }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Max ist jetzt bei „Laufen (easy)“ dabei 🎉'));
    groups.handleRequest.mockResolvedValueOnce({ data: { status: 'rejected', attempts_left: 1 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Anfrage von Mia für „Laufen (easy)“ ablehnen' }));
    await waitFor(() => expect(toast.showUndo).toHaveBeenCalledWith(
      'Anfrage von Mia für „Laufen (easy)“ abgelehnt', expect.any(Function), 'Rückgängig'));
  });

  it('declining an asker\'s last attempt (attempts_left 0) says it was the last request', async () => {
    groups.handleRequest.mockResolvedValueOnce({ data: { status: 'rejected', attempts_left: 0 } });
    await renderList({ joinRows: [joinReq()] });
    fireEvent.click(screen.getByRole('button', { name: DECLINE_MAX }));
    await waitFor(() => expect(toast.showUndo).toHaveBeenCalledWith(
      'Anfrage von Max für „Laufen (easy)“ abgelehnt – das war die letzte Anfrage', expect.any(Function), 'Rückgängig'));
  });

  it('a club request goes to the club endpoint and the toast names the club', async () => {
    await renderList({ joinRows: [joinReq({ group_type: 'club', group_name: 'Lauftreff', group_club_type: 'official' })] });
    expect(screen.getByText('Club')).toHaveClass('club-badge');
    fireEvent.click(screen.getByRole('button', { name: 'Max in „Lauftreff“ aufnehmen' }));
    await waitFor(() => expect(clubs.handleRequest).toHaveBeenCalledWith(7, 31, 'accept'));
    expect(groups.handleRequest).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Max ist jetzt bei „Lauftreff“ dabei 🎉');
  });
});
