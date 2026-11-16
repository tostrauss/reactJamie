import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';

// Where the chat's back button leads (Tina 16.11.2026): a chat opened with
// „Zum Chat" in the profile's „Demnächst dabei" goes back to the profile;
// everything else — push taps, the chat list — keeps going to the chat list,
// a club chat to its „Clubs" filter.
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

// data-nav: how the router got there — POP for a step back.
const Where = () => {
  const loc = useLocation();
  const how = useNavigationType();
  return <div data-testid="where" data-nav={how}>{loc.pathname}{loc.search}</div>;
};

// `entry` is the chat's own entry; `before` the ones under it in the history.
const renderChat = async (entry, type = 'group', before = []) => {
  vi.mocked(groups.getById).mockResolvedValueOnce({ data: { id: 5, name: 'Spieleabend', type, owner_id: 2, members_count: 4, my_role: 'member' } });
  vi.mocked(messages.get).mockResolvedValueOnce({ data: { messages: [], has_more: false } });
  const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Ann' } }}>
      <SocketContext.Provider value={{ socket, isConnected: true }}>
        <MemoryRouter initialEntries={[...before, entry]} initialIndex={before.length}>
          <Routes>
            <Route path="/chat/:groupId" element={<ChatPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </SocketContext.Provider>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};
const back = () => fireEvent.click(document.querySelector('.chat-page-header .back-button'));
const where = () => screen.getByTestId('where').textContent;
const how = () => screen.getByTestId('where').dataset.nav;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(groups.getById).mockReset();
  vi.mocked(messages.get).mockReset();
  window.history.replaceState(null, '');
});
afterEach(() => { window.history.replaceState(null, ''); });

describe('ChatPage — where back leads', () => {
  it('opened by „Zum Chat" in the profile → back to the profile', async () => {
    await renderChat({ pathname: '/chat/5', state: { from: '/profile' } });
    back();
    expect(where()).toBe('/profile');
  });

  it('without a „from" (push tap, chat list) → the chat list, as before', async () => {
    await renderChat('/chat/5');
    back();
    expect(where()).toBe('/chats');
  });

  it('a club chat without a „from" → the list on its Clubs filter', async () => {
    await renderChat('/chat/5', 'club');
    back();
    expect(where()).toBe('/chats?filter=clubs');
  });

  it('only an in-app path counts as „from"', async () => {
    await renderChat({ pathname: '/chat/5', state: { from: 'https://example.com/profile' } });
    back();
    expect(where()).toBe('/chats');
  });

  // Review 16.11.2026: „//host“ and „/\host“ start with a slash but name
  // another site — pushState refuses them and the app would be left.
  for (const from of ['//example.com/profile', '/\\example.com/profile']) {
    it(`…not „${from}“ either`, async () => {
      await renderChat({ pathname: '/chat/5', state: { from } });
      back();
      expect(where()).toBe('/chats');
    });
  }
});

// Review 16.11.2026: going back to „from“ pushed it anew — profile → chat →
// profile on the stack, and the hardware back button opened the chat again.
describe('ChatPage — back to „from“ is a step back', () => {
  it('with the origin under it in the history: a step back (POP) to the very tab it came from', async () => {
    window.history.replaceState({ idx: 1 }, '');   // BrowserRouter's index of this entry
    await renderChat({ pathname: '/chat/5', state: { from: '/profile?tab=halloffame' } }, 'group', ['/profile?tab=halloffame']);
    back();
    expect(where()).toBe('/profile?tab=halloffame');
    expect(how()).toBe('POP');
  });

  it('without in-app history (a reload, a fresh tab): it takes this entry\'s place instead of adding one', async () => {
    await renderChat({ pathname: '/chat/5', state: { from: '/profile' } });
    back();
    expect(where()).toBe('/profile');
    expect(how()).toBe('REPLACE');
  });

  it('the chat list stays a plain navigation, as before', async () => {
    window.history.replaceState({ idx: 3 }, '');
    await renderChat('/chat/5', 'group', ['/chats']);
    back();
    expect(where()).toBe('/chats');
    expect(how()).toBe('PUSH');
  });
});
