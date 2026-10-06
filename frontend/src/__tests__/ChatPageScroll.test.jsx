import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';

// Group chat opening position + catch-up paging (tester 06.10.2026, "einige
// konnten die Fotos nicht sehen": a photo below the fold of a chat that
// opened at the TOP looked like a missing photo). Real German i18n.
vi.mock('../hooks/useChatViewport', () => ({ useChatViewport: () => {} }));
vi.mock('../hooks/useSwipeBack', () => ({ default: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  groups: { getById: vi.fn() },
  messages: { get: vi.fn(), markRead: vi.fn(() => Promise.resolve()) },
  upload: {},
}));
const { groups, messages } = await import('../utils/api');
const { ChatPage } = await import('../pages/ChatPage');

const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const row = (id) => ({ id, user_id: 2, user_name: 'Bea', content: `m${id}`, message_type: 'text', created_at: '2026-10-05T10:00:00Z' });
const page = (ids, has_more = false) => ({ data: { messages: ids.map(row), has_more } });
const group = { data: { id: 5, name: 'Wandern', type: 'group', owner_id: 2 } };

const mkSocket = () => {
  const handlers = {};
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
    off: vi.fn(),
  };
};

const renderChat = (socket) => render(
  <AuthContext.Provider value={{ user: { id: 1, name: 'Ann' } }}>
    <SocketContext.Provider value={{ socket, isConnected: true }}>
      <MemoryRouter initialEntries={['/chat/5']}>
        <Routes><Route path="/chat/:groupId" element={<ChatPage />} /></Routes>
      </MemoryRouter>
    </SocketContext.Provider>
  </AuthContext.Provider>,
);

let scrollCalls;
beforeEach(() => {
  scrollCalls = [];
  Element.prototype.scrollIntoView = vi.fn(function (opts) { scrollCalls.push(opts); });
  vi.mocked(groups.getById).mockReset();
  vi.mocked(messages.get).mockReset();
});

describe('ChatPage — opens at the newest message', () => {
  it('messages BEFORE the group: still jumps to the end once the chat surface exists', async () => {
    const g = deferred();
    vi.mocked(groups.getById).mockReturnValueOnce(g.p);
    vi.mocked(messages.get).mockResolvedValueOnce(page([1, 2, 3]));
    renderChat(mkSocket());
    await act(async () => {});            // messages are in, loading screen still up
    expect(scrollCalls).toEqual([]);
    await act(async () => { g.resolve(group); });
    expect(scrollCalls).toEqual([{ behavior: 'auto' }]);
  });

  it('group first: exactly one instant jump; a live message afterwards scrolls smoothly', async () => {
    vi.mocked(groups.getById).mockResolvedValueOnce(group);
    const m = deferred();
    vi.mocked(messages.get).mockReturnValueOnce(m.p);
    const socket = mkSocket();
    renderChat(socket);
    await act(async () => {});
    expect(scrollCalls).toEqual([]);      // nothing to scroll to yet
    await act(async () => { m.resolve(page([1, 2, 3])); });
    expect(scrollCalls).toEqual([{ behavior: 'auto' }]);
    await act(async () => { socket.handlers.receive_message(row(4)); });
    expect(scrollCalls).toEqual([{ behavior: 'auto' }, { behavior: 'smooth' }]);
  });
});

// B1: the chat scrolls only when the LAST message changes. A reaction or a
// poll vote on a message further up must not yank a reader who scrolled up.
describe('ChatPage — scrolls only when the newest message changes', () => {
  it('reactions and poll updates on older rows: no scroll; a new message: one smooth scroll', async () => {
    vi.mocked(groups.getById).mockResolvedValueOnce(group);
    const pollRow = { ...row(1), message_type: 'poll', content: '📊 q — A · B', poll: {
      kind: 'choice', question: 'q', multi: false, closed: false, version: 1, voter_count: 0,
      options: [{ pos: 0, label: 'A', votes: 0 }, { pos: 1, label: 'B', votes: 0 }], my_votes: [] } };
    vi.mocked(messages.get).mockResolvedValueOnce({ data: { messages: [pollRow, row(2), row(3)], has_more: false } });
    const socket = mkSocket();
    renderChat(socket);
    await act(async () => {});
    expect(scrollCalls).toEqual([{ behavior: 'auto' }]);
    scrollCalls.length = 0;
    await act(async () => { socket.handlers.message_reaction({ messageId: 2, reactions: [{ emoji: '👍', count: 1, user_ids: [2] }] }); });
    await act(async () => { socket.handlers.poll_update({ messageId: 1, groupId: 5, poll: { ...pollRow.poll, version: 2, voter_count: 1,
      options: [{ pos: 0, label: 'A', votes: 1 }, { pos: 1, label: 'B', votes: 0 }] } }); });
    expect(scrollCalls).toEqual([]);
    await act(async () => { socket.handlers.receive_message(row(4)); });
    expect(scrollCalls).toEqual([{ behavior: 'smooth' }]);
  });
});

describe('ChatPage — catch-up after a long absence', () => {
  it('offers "Ältere laden" again when more than a page arrived meanwhile', async () => {
    vi.mocked(groups.getById).mockResolvedValueOnce(group);
    vi.mocked(messages.get).mockResolvedValueOnce(page([1, 2, 3], false));
    const socket = mkSocket();
    renderChat(socket);
    await act(async () => {});
    expect(screen.queryByText('Ältere Nachrichten laden')).toBeNull();
    vi.mocked(messages.get).mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => 70 + i), true));
    await act(async () => { socket.handlers.connect(); });
    expect(screen.getByText('Ältere Nachrichten laden')).toBeTruthy();
  });
});
