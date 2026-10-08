import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';

// Profile pictures in group chats, WhatsApp-style (Tina 08.10.2026): the
// sender's picture and name only on the FIRST message of a run; a new day or
// a system line starts a new run; own messages carry neither; a tap opens a
// small profile sheet OVER the chat (leaving the chat would drop the loaded
// history). Real German i18n.
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

const row = (id, userId, name, over = {}) => ({
  id, group_id: 5, user_id: userId, user_name: name,
  avatar_url: userId === 2 ? '/media/uploads/bea.jpg' : null,
  message_type: 'text', content: `Nachricht ${id}`,
  created_at: `2026-10-08T10:0${id}:00Z`, reactions: [], ...over,
});
const ROWS = [
  row(1, 2, 'Bea'),
  row(2, 2, 'Bea'),                       // same run → no picture, no visible name
  row(3, 3, 'Cid'),                       // no avatar_url → initial
  row(4, 1, 'Ann'),                       // own message → nothing
  { id: 5, group_id: 5, user_id: null, user_name: null, message_type: 'system',
    content: 'Dan ist der Gruppe beigetreten', created_at: '2026-10-08T10:05:00Z', reactions: [] },
  row(6, 2, 'Bea'),                       // after a system line → new run
  row(7, 2, 'Bea', { created_at: '2026-10-09T09:00:00Z' }),   // new day → new run
];

function ProfileStub() {
  const { id } = useParams();
  return <div>PROFIL {id}</div>;
}
const renderChat = async (rows = ROWS) => {
  vi.mocked(groups.getById).mockResolvedValueOnce({ data: { id: 5, name: 'Wandern', type: 'group', owner_id: 2, members_count: 4, my_role: 'member' } });
  vi.mocked(messages.get).mockResolvedValueOnce({ data: { messages: rows, has_more: false } });
  const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Ann' } }}>
      <SocketContext.Provider value={{ socket, isConnected: true }}>
        <MemoryRouter initialEntries={['/chat/5']}>
          <Routes>
            <Route path="/chat/:groupId" element={<ChatPage />} />
            <Route path="/user/:id" element={<ProfileStub />} />
          </Routes>
        </MemoryRouter>
      </SocketContext.Provider>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(groups.getById).mockReset();
  vi.mocked(messages.get).mockReset();
});

describe('ChatPage — sender pictures in group chats', () => {
  it('picture and name only on the first message of each run; own messages carry neither', async () => {
    await renderChat();
    expect([...document.querySelectorAll('button[aria-label="Profil von Bea"]')]).toHaveLength(3);   // msgs 1, 6, 7
    expect([...document.querySelectorAll('button[aria-label="Profil von Cid"]')]).toHaveLength(1);
    expect(document.querySelector('button[aria-label="Profil von Ann"]')).toBeNull();
    const senders = [...document.querySelectorAll('.message-sender')].map(n => n.textContent);
    expect(senders).toEqual(['Bea', 'Cid', 'Bea', 'Bea']);
    expect(document.querySelector('.messages-container--avatars')).toBeTruthy();
  });

  it('a follow-up bubble still names its sender for screen readers', async () => {
    await renderChat();
    const followUp = document.getElementById('msg-2');
    expect(followUp.querySelector('.message-sender')).toBeNull();
    expect(followUp.querySelector('.sr-only')?.textContent).toBe('Bea: ');
    expect(document.getElementById('msg-1').querySelector('.sr-only')).toBeNull();   // visible name instead
    expect(document.getElementById('msg-4').querySelector('.sr-only')).toBeNull();   // own message
  });

  it('shows the thumbnail of the picture, or the initial when there is none', async () => {
    await renderChat();
    const bea = [...document.querySelectorAll('button[aria-label="Profil von Bea"]')][0];
    expect(bea.querySelector('img').getAttribute('src')).toBe('/media/uploads/bea.jpg?size=thumb');
    const cid = document.querySelector('button[aria-label="Profil von Cid"]');
    expect(cid.querySelector('img')).toBeNull();
    expect(cid.textContent).toBe('C');
  });

  it('a tap opens a profile sheet over the chat; "Profil ansehen" leaves, "Abbrechen" stays', async () => {
    await renderChat();
    fireEvent.click(document.querySelector('button[aria-label="Profil von Cid"]'));
    const sheet = screen.getByRole('dialog', { name: 'Cid' });
    expect(within(sheet).getByText('Cid')).toBeTruthy();
    expect(screen.getByText('Nachricht 1')).toBeTruthy();              // the chat is still there
    fireEvent.click(within(sheet).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/PROFIL/)).toBeNull();
    fireEvent.click(document.querySelector('button[aria-label="Profil von Cid"]'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cid' })).getByRole('button', { name: 'Profil ansehen' }));
    expect(screen.getByText('PROFIL 3')).toBeTruthy();
  });

  it('messages of deleted accounts (user_id NULL) never merge into one run', async () => {
    await renderChat([
      row(1, null, null, { content: 'alt 1' }),
      row(2, null, null, { content: 'alt 2' }),
    ]);
    expect(document.querySelectorAll('.message-avatar--static')).toHaveLength(2);
    expect(document.querySelector('button[aria-label^="Profil von"]')).toBeNull();
  });
});
