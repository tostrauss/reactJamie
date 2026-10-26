import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// The list behind the bell (18.10.2026). Rendered by type: JAMIE news as the
// admins wrote it, Hall-of-Fame likes rebuilt in the reader's language, every
// other type exactly as stored. A row is a button only when it leads somewhere.
// Real German i18n (vitest.setup.js).
vi.mock('../utils/api', () => ({
  notifications: { getAll: vi.fn(), markRead: vi.fn() },
}));
const toastError = vi.fn();
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }) }));

const { notifications } = await import('../utils/api');
const { Notifications } = await import('../pages/Notifications');

const AT = '2026-10-18T10:00:00Z';
const NEWS = {
  id: 6, type: 'news', title: 'Neue Deals in Wien', message: 'Drei neue Kooperationen.\nSchau rein!',
  link: '/deal/12', sender: null, is_read: false, created_at: AT,
};
const LIKE = {
  id: 5, type: 'hof_like', title: 'Anna gefällt „Laufen im Prater“ (Fallback)', message: 'Fallback-Text',
  sender: { id: 12, name: 'Anna', avatar: null }, reference_type: 'group', reference_id: 40,
  reference_name: 'Laufen im Prater', reference_gone: false, is_read: false, created_at: AT,
};
const UNKNOWN = {
  id: 4, type: 'mystery_type', title: 'Gespeicherter Titel', message: 'Gespeicherte Nachricht',
  sender: null, reference_type: null, reference_id: null, is_read: true, created_at: AT,
};
const CANCELLED = {
  id: 3, type: 'group_cancelled', title: 'Abgesagt: Yoga', message: 'Das Event findet nicht statt.',
  reference_type: 'group', reference_id: 7, reference_name: 'Yoga', reference_gone: false, is_read: true, created_at: AT,
};
const CLUB_GONE = {
  id: 2, type: 'club_deleted', title: 'Club gelöscht', message: 'Der Club „Weg“ wurde gelöscht.',
  reference_type: 'club', reference_id: 9, reference_name: 'Weg', reference_gone: true, is_read: true, created_at: AT,
};
const FRIEND = {
  id: 1, type: 'friend_accepted', title: 'Neue Freundschaft', message: 'Bea hat angenommen.',
  reference_type: 'user', reference_id: 33, is_read: true, created_at: AT,
};

const renderList = async (rows, initialEntries = ['/notifications']) => {
  vi.mocked(notifications.getAll).mockResolvedValue({ data: rows });
  const where = (name) => <div data-testid="landed">{name}</div>;
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/home" element={where('HOME')} />
        <Route path="/explore" element={where('EXPLORE')} />
        <Route path="/deal/:id" element={where('DEAL')} />
        <Route path="/group/:id" element={where('GROUP')} />
        <Route path="/club/:id" element={where('CLUB')} />
        <Route path="/user/:id" element={where('USER')} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
};
const rowOf = (text) => screen.getByText(text).closest('li');
const landed = () => screen.getByTestId('landed').textContent;

beforeEach(() => {
  vi.mocked(notifications.getAll).mockReset();
  vi.mocked(notifications.markRead).mockReset().mockResolvedValue({ data: { success: true } });
  toastError.mockReset();
});

describe('Notifications — rendering by type', () => {
  it('news: 📣, the admin title in bold, the message as written, opens its link', async () => {
    await renderList([NEWS]);
    const row = rowOf('Neue Deals in Wien');
    expect(row.textContent).toContain('📣');
    expect(screen.getByText('Neue Deals in Wien').className).toContain('notif-item-title--news');
    const msg = row.querySelector('.notif-item-msg');
    expect(msg.textContent).toBe('Drei neue Kooperationen.\nSchau rein!');
    expect(msg.className).toContain('notif-item-msg--news');   // white-space: pre-line keeps the break
    await act(async () => { fireEvent.click(row.querySelector('button')); });
    expect(landed()).toBe('DEAL');
  });

  it('hof_like: ❤️ and the sentence in the reader’s language — not the stored German fallback', async () => {
    await renderList([LIKE]);
    const text = 'Anna gefällt „Laufen im Prater“ in den Memories';
    const row = rowOf(text);
    expect(row.textContent).toContain('❤️');
    expect(screen.queryByText(/Fallback/)).toBeNull();
    await act(async () => { fireEvent.click(row.querySelector('button')); });
    expect(landed()).toBe('EXPLORE');
  });

  it('hof_like from an account that no longer exists reads „Jemandem gefällt …“', async () => {
    await renderList([{ ...LIKE, sender: null }]);
    expect(screen.getByText('Jemandem gefällt „Laufen im Prater“ in den Memories')).toBeTruthy();
  });

  it('hof_like whose event is gone falls back to the stored text', async () => {
    await renderList([{ ...LIKE, reference_name: null }]);
    expect(screen.getByText(LIKE.title)).toBeTruthy();
    expect(screen.getByText(LIKE.message)).toBeTruthy();
  });

  it('an unknown type shows its stored title and message, 📢, and is not tappable', async () => {
    await renderList([UNKNOWN]);
    const row = rowOf('Gespeicherter Titel');
    expect(screen.getByText('Gespeicherte Nachricht')).toBeTruthy();
    expect(row.textContent).toContain('📢');
    expect(row.querySelector('button')).toBeNull();
    expect(row.querySelector('.notif-chevron')).toBeNull();
  });
});

describe('Notifications — tap targets', () => {
  it('a group reference opens the group', async () => {
    await renderList([CANCELLED, FRIEND]);
    await act(async () => { fireEvent.click(rowOf('Abgesagt: Yoga').querySelector('button')); });
    expect(landed()).toBe('GROUP');
  });

  it('a user reference opens the profile', async () => {
    await renderList([FRIEND]);
    await act(async () => { fireEvent.click(rowOf('Neue Freundschaft').querySelector('button')); });
    expect(landed()).toBe('USER');
  });

  it('a deleted club is not tappable any more', async () => {
    await renderList([CLUB_GONE]);
    expect(rowOf('Club gelöscht').querySelector('button')).toBeNull();
  });

  it('a link that is not an internal path is ignored; the reference still works', async () => {
    await renderList([{ ...CANCELLED, link: 'https://evil.example' }]);
    await act(async () => { fireEvent.click(rowOf('Abgesagt: Yoga').querySelector('button')); });
    expect(landed()).toBe('GROUP');
  });
});

describe('Notifications — page', () => {
  it('marks read up to the newest row shown, then tells the bell', async () => {
    const onRead = vi.fn();
    window.addEventListener('jamie:notifications-read', onRead);
    await renderList([UNKNOWN, NEWS, LIKE]);
    await waitFor(() => expect(notifications.markRead).toHaveBeenCalledWith(6));
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    window.removeEventListener('jamie:notifications-read', onRead);
  });

  it('unread rows are highlighted, read ones are not', async () => {
    await renderList([NEWS, UNKNOWN]);
    expect(rowOf('Neue Deals in Wien').querySelector('.notif-item').className).toContain('notif-item--unread');
    expect(rowOf('Gespeicherter Titel').querySelector('.notif-item').className).not.toContain('notif-item--unread');
  });

  it('empty state', async () => {
    await renderList([]);
    expect(screen.getByText('Keine Benachrichtigungen')).toBeTruthy();
    expect(screen.getByText('Du bist auf dem neuesten Stand!')).toBeTruthy();
  });

  it('a failed load toasts and never marks anything read', async () => {
    vi.mocked(notifications.getAll).mockRejectedValueOnce(new Error('offline'));
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes><Route path="/notifications" element={<Notifications />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => {});
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Benachrichtigungen konnten nicht geladen werden'));
    expect(notifications.markRead).not.toHaveBeenCalled();
  });

  it('back goes Home when the list was the first screen (opened from a push)', async () => {
    await renderList([NEWS]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zurück' })); });
    expect(landed()).toBe('HOME');
  });
});
