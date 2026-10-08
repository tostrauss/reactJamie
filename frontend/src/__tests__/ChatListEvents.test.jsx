import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SocketContext } from '../context/SocketContext';

// Club-event chats in the chat list (Tina 08.10.2026): messages flew in the
// event "JAMIE x Mon Ami Halloween", but the list dropped every type='event'
// row on the assumption that the club row covered it. It never did — the club
// row only shows the club's own chat — so the event chat was invisible, under
// "Alle" and under "Gruppen". Real German i18n.
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../hooks/useOnPullRefresh', () => ({ default: () => {} }));
vi.mock('../utils/api', () => ({
  groups: { getJoined: vi.fn(), getAllRequests: vi.fn(async () => ({ data: [] })) },
  clubs: {},
  directMessages: { getConversations: vi.fn(async () => ({ data: [] })) },
}));
const { groups } = await import('../utils/api');
const { ChatList } = await import('../pages/ChatList');

const club = {
  id: 420, name: 'JAMIE Groups Official', type: 'club', role: 'owner',
  last_message: 'Willkommen bei JAMIE Groups Official', last_message_type: 'system',
  last_message_time: '2026-09-30T10:00:00Z', unread_count: 0,
};
const event = {
  id: 451, name: 'JAMIE x Mon Ami Halloween', type: 'event', parent_club_id: 420, role: 'owner',
  last_message: 'Grad richtig guter Point', last_message_type: 'text', last_message_sender: 'Robert',
  last_message_time: new Date().toISOString(), unread_count: 2,
};
const group = {
  id: 7, name: 'Laufen (easy)', type: 'group', role: 'member',
  last_message: 'Alexander hat die Gruppe verlassen', last_message_type: 'system',
  last_message_time: '2026-08-25T10:00:00Z', unread_count: 0,
};

const renderList = async (url) => {
  vi.mocked(groups.getJoined).mockResolvedValueOnce({ data: [club, event, group] });
  render(
    <SocketContext.Provider value={{ socket: null, isConnected: false }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/chats" element={<ChatList />} /></Routes>
      </MemoryRouter>
    </SocketContext.Provider>,
  );
  await act(async () => {});
};
const rowNames = () => [...document.querySelectorAll('.chat-item:not(.chat-item--skeleton) .chat-name')].map(n => n.textContent);

describe('ChatList — club-event chats', () => {
  it('"Alle": the event chat has its own row, on top by its last message, with preview and unread count', async () => {
    await renderList('/chats');
    expect(rowNames()).toEqual(['JAMIE x Mon Ami Halloween', 'JAMIE Groups Official', 'Laufen (easy)']);
    expect(screen.getByText('Grad richtig guter Point')).toBeTruthy();
    const eventRow = screen.getByText('JAMIE x Mon Ami Halloween').closest('.chat-item');
    expect(eventRow.querySelector('.unread-badge')?.textContent).toBe('2');
  });

  it('"Gruppen" lists events with the groups — where Tina looked for it — and "Clubs" only the club', async () => {
    await renderList('/chats?filter=gruppen');
    expect(rowNames()).toEqual(['JAMIE x Mon Ami Halloween', 'Laufen (easy)']);
  });

  it('"Clubs" keeps showing only clubs', async () => {
    await renderList('/chats?filter=clubs');
    expect(rowNames()).toEqual(['JAMIE Groups Official']);
  });

  it('"Verwalten" stays for groups and clubs — an owned event is managed on its own page', async () => {
    await renderList('/chats?tab=verwalten');
    expect(screen.getByText('JAMIE Groups Official')).toBeTruthy();
    expect(screen.queryByText('JAMIE x Mon Ami Halloween')).toBeNull();
  });
});
