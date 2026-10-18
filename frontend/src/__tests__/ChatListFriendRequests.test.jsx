import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SocketContext } from '../context/SocketContext';

// Friend requests in Chat → Anfragen (Lea, 18.10.2026: „Man bemerkt die
// Freundschaftsanfragen nicht, nur wenn man aufs eigene Profil schaut.“). Same
// swipe deck as the join requests, marked „Freundschaftsanfrage“ instead of a
// group badge, answered through the friendship endpoints. Real German i18n.
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

const renderList = async ({ friendRows = [], joinRows = [], socket = null, url = '/chats?tab=anfragen' } = {}) => {
  friends.getPending.mockResolvedValue({ data: friendRows });
  groups.getAllRequests.mockResolvedValue({ data: joinRows });
  render(
    <SocketContext.Provider value={{ socket, isConnected: !!socket }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/chats" element={<ChatList />} /></Routes>
      </MemoryRouter>
    </SocketContext.Provider>,
  );
  await act(async () => {});
};
const tabDot = () => screen.getByText('Anfragen').closest('button').querySelector('.tab-dot');

beforeEach(() => {
  vi.clearAllMocks();
  friends.respondRequest.mockResolvedValue({ data: {} });
});

describe('ChatList — friend requests in the Anfragen deck', () => {
  it('shows the friend request, labelled „Freundschaftsanfrage“ instead of a group badge, with the card facts', async () => {
    await renderList({ friendRows: [friendReq()] });
    expect(document.querySelector('.requests-deck-group .friend-badge')?.textContent).toBe('Freundschaftsanfrage');
    expect(document.querySelector('.requests-deck-group .group-badge, .requests-deck-group .club-badge')).toBeNull();
    expect(document.querySelector('.requests-deck-group-name')).toBeNull();
    expect(screen.getByText('Lea, 27')).toBeTruthy();
    expect(screen.getByText('Wandern')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Verifiziert' })).toBeTruthy();
    // 🌟 from requester_attendance_step — never the old three-step field.
    expect(screen.getByRole('img', { name: /mindestens 25-mal bestätigt/ })).toBeTruthy();
  });

  it('friend requests come first; accepting one uses the friendship API, then the join request follows', async () => {
    await renderList({ friendRows: [friendReq()], joinRows: [joinReq()] });
    expect(screen.getByText('Lea, 27')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(friends.respondRequest).toHaveBeenCalledWith(31, 'accept'));
    expect(groups.handleRequest).not.toHaveBeenCalled();
    expect(clubs.handleRequest).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Du und Lea seid jetzt befreundet!');

    // Same id + updated_at in the other table — still there, with its group.
    await waitFor(() => expect(screen.getByText('Max, 30')).toBeTruthy());
    expect(screen.getByText('Laufen (easy)')).toBeTruthy();
    expect(document.querySelector('.requests-deck-group .group-badge')).toBeTruthy();
    expect(document.querySelector('.friend-badge')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Diese Anfrage ist nicht mehr offen.'));
    expect(toast.error).not.toHaveBeenCalledWith('Friend request not found');
    await waitFor(() => expect(screen.queryByText('Lea, 27')).toBeNull());
    expect(screen.getByText('Keine offenen Anfragen')).toBeTruthy();
  });

  it('any other failure keeps the card and says what failed', async () => {
    await renderList({ friendRows: [friendReq()] });
    friends.respondRequest.mockRejectedValueOnce({ response: { status: 500, data: { error: 'Internal' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
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
