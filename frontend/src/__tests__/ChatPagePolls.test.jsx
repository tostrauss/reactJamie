import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';

// Chat polls inside the real ChatPage (B1) — wiring, not the parts: the poll
// renders from the page payload, a tap votes optimistically, a live
// poll_update lands, and "Umfrage beenden" is offered only to those the
// server lets close. Real German i18n.
vi.mock('../hooks/useChatViewport', () => ({ useChatViewport: () => {} }));
vi.mock('../hooks/useSwipeBack', () => ({ default: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  groups: { getById: vi.fn() },
  messages: { get: vi.fn(), markRead: vi.fn(() => Promise.resolve()), votePoll: vi.fn(), closePoll: vi.fn() },
  upload: {},
}));
const { groups, messages } = await import('../utils/api');
const { ChatPage } = await import('../pages/ChatPage');

const summary = (over = {}) => ({
  kind: 'choice', question: 'Was machen wir?', multi: false, closed: false, version: 1, voter_count: 0,
  options: [{ pos: 0, label: 'Bowling', date: null, time: null, votes: 0 }, { pos: 1, label: 'Kino', date: null, time: null, votes: 0 }],
  my_votes: [], ...over,
});
const pollRow = (authorId, over = {}) => ({
  id: 77, group_id: 5, user_id: authorId, user_name: authorId === 1 ? 'Ann' : 'Bea', message_type: 'poll',
  content: '📊 Was machen wir? — Bowling · Kino', created_at: '2026-10-06T10:00:00Z', reactions: [], poll: summary(), ...over,
});

const mkSocket = () => {
  const handlers = {};
  return { handlers, emit: vi.fn(), on: vi.fn((ev, fn) => { handlers[ev] = fn; }), off: vi.fn() };
};
const renderChat = async ({ rows, group, socket = mkSocket() }) => {
  vi.mocked(groups.getById).mockResolvedValueOnce({ data: group });
  vi.mocked(messages.get).mockResolvedValueOnce({ data: { messages: rows, has_more: false } });
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Ann' } }}>
      <SocketContext.Provider value={{ socket, isConnected: true }}>
        <MemoryRouter initialEntries={['/chat/5']}>
          <Routes><Route path="/chat/:groupId" element={<ChatPage />} /></Routes>
        </MemoryRouter>
      </SocketContext.Provider>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  return socket;
};
const group = (over = {}) => ({ id: 5, name: 'Wandern', type: 'group', owner_id: 2, members_count: 5, my_role: 'member', ...over });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  for (const fn of [groups.getById, messages.get, messages.votePoll, messages.closePoll]) vi.mocked(fn).mockReset();
});

describe('ChatPage — polls', () => {
  it('renders the poll from the page payload with "x von y" and votes optimistically', async () => {
    let resolve;
    vi.mocked(messages.votePoll).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await renderChat({ rows: [pollRow(2)], group: group() });
    expect(screen.getByText('Was machen wir?')).toBeTruthy();
    expect(screen.getByText('Noch keine Stimmen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Kino/ }));
    expect(messages.votePoll).toHaveBeenCalledWith(77, [1]);
    expect(screen.getByRole('button', { name: /Kino/ }).getAttribute('aria-pressed')).toBe('true'); // before the answer
    expect(screen.getByText('1 von 5 hat abgestimmt')).toBeTruthy();
    await act(async () => { resolve({ data: { poll: summary({ version: 2, voter_count: 1, my_votes: [1],
      options: [{ pos: 0, label: 'Bowling', votes: 0 }, { pos: 1, label: 'Kino', votes: 1 }] }) } }); });
    expect(screen.getByRole('button', { name: /Kino/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a live poll_update for this chat lands; one for another chat or an older version does not', async () => {
    const socket = await renderChat({ rows: [pollRow(2)], group: group() });
    const update = (data) => act(async () => { socket.handlers.poll_update(data); });
    await update({ messageId: 77, groupId: 9, poll: summary({ version: 5, voter_count: 3 }) });
    expect(screen.getByText('Noch keine Stimmen')).toBeTruthy();
    await update({ messageId: 77, groupId: 5, poll: summary({ version: 5, voter_count: 3,
      options: [{ pos: 0, label: 'Bowling', votes: 2 }, { pos: 1, label: 'Kino', votes: 1 }] }) });
    expect(screen.getByText('3 von 5 haben abgestimmt')).toBeTruthy();
    await update({ messageId: 77, groupId: 5, poll: summary({ version: 4, voter_count: 0 }) });
    expect(screen.getByText('3 von 5 haben abgestimmt')).toBeTruthy();
    await update(null); // never destructured
  });

  it('without poll data (old server, failed side query) the content line shows — like an old app', async () => {
    await renderChat({ rows: [pollRow(2, { poll: undefined })], group: group() });
    expect(screen.getByText('📊 Was machen wir? — Bowling · Kino')).toBeTruthy();
  });

  it('"Umfrage beenden" in the long-press sheet: for the author, not for another member', async () => {
    await renderChat({ rows: [pollRow(1, { id: 78 }), pollRow(2, { id: 79 })], group: group() });
    const bubbles = document.querySelectorAll('.message--poll');
    fireEvent.contextMenu(bubbles[0]);
    expect(screen.getByRole('button', { name: 'Umfrage beenden' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    fireEvent.contextMenu(bubbles[1]);
    expect(screen.queryByRole('button', { name: 'Umfrage beenden' })).toBeNull();
  });

  it('a co-manager of this group may end someone else\'s poll', async () => {
    await renderChat({ rows: [pollRow(2)], group: group({ my_role: 'admin' }) });
    fireEvent.contextMenu(document.querySelector('.message--poll'));
    expect(screen.getByRole('button', { name: 'Umfrage beenden' })).toBeTruthy();
  });

  it('switching chats in-app (iOS push banner tap) closes an open poll sheet — no draft lands in the other group', async () => {
    vi.mocked(groups.getById).mockResolvedValueOnce({ data: group() });
    vi.mocked(messages.get).mockResolvedValueOnce({ data: { messages: [], has_more: false } });
    let go;
    const Nav = () => { go = useNavigate(); return null; };
    render(
      <AuthContext.Provider value={{ user: { id: 1, name: 'Ann' } }}>
        <SocketContext.Provider value={{ socket: mkSocket(), isConnected: true }}>
          <MemoryRouter initialEntries={['/chat/5']}>
            <Nav />
            <Routes><Route path="/chat/:groupId" element={<ChatPage />} /></Routes>
          </MemoryRouter>
        </SocketContext.Provider>
      </AuthContext.Provider>,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Umfrage erstellen' }));
    expect(screen.getByRole('dialog', { name: 'Neue Umfrage' })).toBeTruthy();
    vi.mocked(groups.getById).mockResolvedValueOnce({ data: group({ id: 9, name: 'Klettern' }) });
    vi.mocked(messages.get).mockResolvedValueOnce({ data: { messages: [], has_more: false } });
    await act(async () => { go('/chat/9'); });
    expect(screen.queryByRole('dialog', { name: 'Neue Umfrage' })).toBeNull();
  });

  it('the composer\'s poll button opens the "Neue Umfrage" sheet', async () => {
    await renderChat({ rows: [], group: group() });
    fireEvent.click(screen.getByRole('button', { name: 'Umfrage erstellen' }));
    expect(screen.getByRole('dialog', { name: 'Neue Umfrage' })).toBeTruthy();
  });
});
