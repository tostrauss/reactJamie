import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SocketContext } from '../context/SocketContext';

// The bell top right on Home (Robert / Lea, 18.10.2026). Pinned: the badge
// shows the server's unread count ("9+" at most), counts `new_notification`
// socket events itself (a news blast must not make every open app re-fetch),
// re-reads on foreground, and is back at 0 after the list was opened.
// Real German i18n (vitest.setup.js).
vi.mock('../utils/api', () => ({
  notifications: { getUnreadCount: vi.fn(), getAll: vi.fn(), markRead: vi.fn() },
}));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { notifications } = await import('../utils/api');
const { NotificationBell } = await import('../components/NotificationBell');
const { Notifications } = await import('../pages/Notifications');

// Minimal socket.io stand-in: handler registry + a way to fire server events.
const makeSocket = () => {
  const handlers = {};
  return {
    on: vi.fn((ev, fn) => { (handlers[ev] ||= new Set()).add(fn); }),
    off: vi.fn((ev, fn) => { handlers[ev]?.delete(fn); }),
    fire: (ev, payload) => { for (const fn of [...(handlers[ev] || [])]) fn(payload); },
    listeners: (ev) => handlers[ev]?.size || 0,
  };
};

const renderApp = async (socket = null) => {
  render(
    <SocketContext.Provider value={{ socket, isConnected: !!socket }}>
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<div><NotificationBell /></div>} />
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </MemoryRouter>
    </SocketContext.Provider>,
  );
  await act(async () => {});
};
const bell = () => document.querySelector('.home-bell');
const badge = () => document.querySelector('.home-bell-badge');
const count = (n) => Promise.resolve({ data: { count: n } });

beforeEach(() => {
  vi.mocked(notifications.getUnreadCount).mockReset();
  vi.mocked(notifications.getAll).mockReset();
  vi.mocked(notifications.markRead).mockReset().mockResolvedValue({ data: { success: true } });
});

describe('NotificationBell', () => {
  it('shows the unread count from the server, labelled for screen readers', async () => {
    vi.mocked(notifications.getUnreadCount).mockReturnValue(count(3));
    await renderApp();
    expect(badge().textContent).toBe('3');
    expect(bell().getAttribute('aria-label')).toBe('Benachrichtigungen, 3 neu');
    expect(notifications.getUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('caps the badge at "9+"', async () => {
    vi.mocked(notifications.getUnreadCount).mockReturnValue(count(12));
    await renderApp();
    expect(badge().textContent).toBe('9+');
    expect(bell().getAttribute('aria-label')).toBe('Benachrichtigungen, 9+ neu');
  });

  it('no badge at 0 — just the bell', async () => {
    vi.mocked(notifications.getUnreadCount).mockReturnValue(count(0));
    await renderApp();
    expect(badge()).toBeNull();
    expect(screen.getByRole('button', { name: 'Benachrichtigungen' })).toBeTruthy();
  });

  it('counts new_notification socket events live — without asking the server again', async () => {
    vi.mocked(notifications.getUnreadCount).mockReturnValue(count(2));
    const socket = makeSocket();
    await renderApp(socket);
    expect(badge().textContent).toBe('2');

    await act(async () => { socket.fire('new_notification', { id: 9, user_id: 7, type: 'news' }); });
    expect(badge().textContent).toBe('3');
    await act(async () => { for (let i = 0; i < 7; i += 1) socket.fire('new_notification', { id: 10 + i }); });
    expect(badge().textContent).toBe('9+');
    expect(notifications.getUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('starts at 0 and lights up on the first event when the count failed to load', async () => {
    vi.mocked(notifications.getUnreadCount).mockRejectedValue(new Error('offline'));
    const socket = makeSocket();
    await renderApp(socket);
    expect(badge()).toBeNull();
    await act(async () => { socket.fire('new_notification', undefined); });
    expect(badge().textContent).toBe('1');
  });

  it('re-reads the count when the app comes back to the foreground; a failed re-read keeps the badge', async () => {
    vi.mocked(notifications.getUnreadCount)
      .mockReturnValueOnce(count(1))
      .mockReturnValueOnce(count(4))
      .mockRejectedValueOnce(new Error('blip'));
    await renderApp();
    expect(badge().textContent).toBe('1');

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(badge().textContent).toBe('4');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(badge().textContent).toBe('4');
  });

  it('tap → the list (which marks read), back → the badge is gone; the socket listener is cleaned up', async () => {
    vi.mocked(notifications.getUnreadCount)
      .mockReturnValueOnce(count(2))     // Home, before
      .mockReturnValue(count(0));        // Home, after the list marked everything read
    vi.mocked(notifications.getAll).mockResolvedValue({ data: [
      { id: 8, type: 'news', title: 'Neue Deals in Wien', message: 'Schau rein', is_read: false, created_at: '2026-10-18T10:00:00Z' },
      { id: 5, type: 'mystery', title: 'Etwas', message: null, is_read: false, created_at: '2026-10-17T10:00:00Z' },
    ] });
    const socket = makeSocket();
    await renderApp(socket);
    expect(badge().textContent).toBe('2');
    expect(socket.listeners('new_notification')).toBe(1);

    await act(async () => { fireEvent.click(bell()); });
    expect(await screen.findByText('Neue Deals in Wien')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Benachrichtigungen' })).toBeTruthy();
    // Marks up to the newest row it showed.
    await waitFor(() => expect(notifications.markRead).toHaveBeenCalledWith(8));
    // Home is gone → its listener too.
    expect(socket.listeners('new_notification')).toBe(0);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zurück' })); });
    await waitFor(() => expect(bell()).toBeTruthy());
    await waitFor(() => expect(notifications.getUnreadCount).toHaveBeenCalledTimes(2));
    expect(badge()).toBeNull();
    expect(bell().getAttribute('aria-label')).toBe('Benachrichtigungen');
  });

  it('re-reads the count when the list reports that mark-read landed', async () => {
    vi.mocked(notifications.getUnreadCount)
      .mockReturnValueOnce(count(3))
      .mockReturnValueOnce(count(0));
    await renderApp();
    expect(badge().textContent).toBe('3');
    await act(async () => { window.dispatchEvent(new CustomEvent('jamie:notifications-read')); });
    expect(badge()).toBeNull();
  });

  it('works without a socket provider value (no crash, no listener)', async () => {
    vi.mocked(notifications.getUnreadCount).mockReturnValue(count(1));
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes><Route path="/home" element={<NotificationBell />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(badge().textContent).toBe('1');
  });
});
