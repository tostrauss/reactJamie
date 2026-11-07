import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Explore (Tina, 22.10.2026): tabs Memories | Friends instead of Hall of Fame |
// Deals, the „Warst du dabei?" banner, the meetup title on the card, and the
// Friends tab — since 07.11.2026 (Tina) the FRIENDS themselves, an orange ⊕
// opening „Friends hinzufügen" with suggestions „Von deinen letzten Events",
// and the people search with the friendship button in the row. Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../hooks/useOnPullRefresh', () => ({ default: () => {} }));
vi.mock('../utils/api', () => ({
  groups: {
    getHallOfFame: vi.fn(),
    getHallOfFameFriends: vi.fn(),
    getMyLikes: vi.fn(async () => ({ data: [] })),
    toggleLike: vi.fn(),
    addPhoto: vi.fn(),
    getPhotos: vi.fn(),
    deletePhoto: vi.fn(),
  },
  users: { search: vi.fn() },
  friends: { getAll: vi.fn(), getSuggestions: vi.fn(), sendRequest: vi.fn(), respondRequest: vi.fn() },
  upload: { image: vi.fn() },
}));
const { groups, users, friends } = await import('../utils/api');
const { Explore } = await import('../pages/Explore');

const card = (over = {}) => ({
  id: 5, name: 'Wandern am Kahlenberg', category: 'Wandern', date: '2026-10-11T10:00:00',
  image_url: '/media/cover.jpg', moment_photo_url: null, owner_id: 2, owner_name: 'Tina',
  like_count: 0, photos: [], photo_count: 0, my_photo_count: 0, is_participant: false, can_add_photo: false,
  ...over,
});

const Where = () => {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
};

const renderAt = async (path, { user = { id: 9 }, hall = [card()], friendList = [], suggestions = [] } = {}) => {
  vi.mocked(groups.getHallOfFame).mockResolvedValue({ data: hall });
  vi.mocked(friends.getAll).mockResolvedValue({ data: friendList });
  vi.mocked(friends.getSuggestions).mockResolvedValue({ data: suggestions });
  render(
    <AuthContext.Provider value={{ user }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/explore" element={<><Explore /><Where /></>} />
          <Route path="/explore/share" element={<p>SHARE PAGE</p>} />
          <Route path="/user/:id" element={<p>PROFILE</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

const tab = (name) => screen.getByRole('tab', { name });
const typeSearch = async (value) => {
  fireEvent.change(screen.getByPlaceholderText('Nach Namen suchen…'), { target: { value } });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(groups.getMyLikes).mockResolvedValue({ data: [] });
});

describe('Explore — Memories | Friends', () => {
  it('shows the two tabs, asks for pictures only, and puts the meetup on the card', async () => {
    await renderAt('/explore');
    expect(tab('Memories').getAttribute('aria-selected')).toBe('true');
    expect(tab('Friends')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Deals|Hall of Fame/ })).toBeNull();
    expect(groups.getHallOfFame).toHaveBeenCalledWith({ limit: 30, photosOnly: true });
    expect(screen.getByText('Wandern am Kahlenberg').className).toBe('ef-event-title');
    // Lazy: nobody pays for the friends lists until they open the tab.
    expect(friends.getAll).not.toHaveBeenCalled();
  });

  it('an old ?tab=deals link falls back to Memories', async () => {
    await renderAt('/explore?tab=deals');
    expect(tab('Memories').getAttribute('aria-selected')).toBe('true');
  });

  it('the banner leads to „Warst du dabei..“', async () => {
    await renderAt('/explore');
    fireEvent.click(screen.getByRole('button', { name: /Warst du dabei\?.*Teile deine schönsten Momente mit der Community\./ }));
    expect(screen.getByText('SHARE PAGE')).toBeTruthy();
  });

  it('the moment push (?share=1) goes straight to the share page', async () => {
    await renderAt('/explore?share=1');
    expect(screen.getByText('SHARE PAGE')).toBeTruthy();
    expect(groups.getHallOfFame).not.toHaveBeenCalled();
  });

  it('a guest sees no banner, and the Friends tab asks to log in without loading', async () => {
    await renderAt('/explore', { user: { id: 0, isGuest: true } });
    expect(screen.queryByText('Warst du dabei?')).toBeNull();
    fireEvent.click(tab('Friends'));
    expect(screen.getByText('Melde dich an, um Freunde zu finden.')).toBeTruthy();
    expect(friends.getAll).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Nach Namen suchen…')).toBeNull();
  });
});

describe('Explore — Friends tab (Tina 07.11.2026)', () => {
  const friendRow = (o = {}) => ({ friendship_id: 1, friend_id: 21, name: 'Niklas', age: 26, location: 'Wien', avatar_url: null, ...o });
  const sugg = (o = {}) => ({ id: 31, name: 'Sophie', age: 24, event_name: 'Spieleabend', friend_status: 'none', ...o });

  it('shows the FRIENDS (not event memories) under the heading with the orange ⊕', async () => {
    await renderAt('/explore?tab=friends', { friendList: [friendRow(), friendRow({ friend_id: 22, name: 'Laura', location: 'Graz' })] });
    expect(screen.getByRole('heading', { name: 'Friends' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Friends hinzufügen' })).toBeTruthy();
    expect(screen.getByText('Niklas')).toBeTruthy();
    expect(screen.getByText('Laura')).toBeTruthy();
    expect(groups.getHallOfFameFriends).not.toHaveBeenCalled();
    expect(screen.queryByText('Hier fehlen noch deine Friends!')).toBeNull();
    fireEvent.click(screen.getByText('Niklas'));
    expect(screen.getByText('PROFILE')).toBeTruthy();
  });

  it('without friends: the empty state with suggestions from recent events and „Weitere Personen entdecken"', async () => {
    await renderAt('/explore?tab=friends', { suggestions: [sugg(), sugg({ id: 32, name: 'Laura', event_name: 'Coffee Meetup', friend_status: 'pending_out' })] });
    expect(screen.getByText('Hier fehlen noch deine Friends!')).toBeTruthy();
    expect(screen.getByText('Ihr wart schon gemeinsam unterwegs. Zeit, euch zu vernetzen!')).toBeTruthy();
    expect(screen.getByText('Von deinen letzten Events')).toBeTruthy();
    const row = (name) => screen.getByText(name).closest('.ef-friends-row');
    expect(within(row('Sophie')).getByText('Spieleabend')).toBeTruthy();
    expect(within(row('Sophie')).getByRole('button', { name: '+ Anfragen' })).toBeTruthy();
    expect(within(row('Laura')).getByText('Angefragt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Weitere Personen entdecken/ }));
    expect(screen.getByRole('dialog', { name: 'Friends hinzufügen' })).toBeTruthy();
  });

  it('the ⊕ sheet: hint, suggestions, and asking a suggestion is optimistic', async () => {
    vi.mocked(friends.sendRequest).mockResolvedValueOnce({ data: { message: 'Friend request sent' } });
    await renderAt('/explore?tab=friends', { friendList: [friendRow()], suggestions: [sugg()] });
    fireEvent.click(screen.getByRole('button', { name: 'Friends hinzufügen' }));
    const sheet = screen.getByRole('dialog', { name: 'Friends hinzufügen' });
    expect(within(sheet).getByText('Personen suchen und Freundschaftsanfragen senden.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: '+ Anfragen' })); });
    expect(friends.sendRequest).toHaveBeenCalledWith(31);
    expect(within(sheet).getByText('Angefragt')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog', { name: 'Friends hinzufügen' })).toBeNull();
  });

  it('the 6th request of the day opens „Tageslimit erreicht" and rolls the row back', async () => {
    vi.mocked(friends.sendRequest).mockRejectedValueOnce({ response: { status: 403, data: {
      code: 'DAILY_FRIEND_LIMIT', limit: 5, error: 'Du hast heute schon 5 Freundschaftsanfragen geschickt.' } } });
    await renderAt('/explore?tab=friends', { suggestions: [sugg()] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Anfragen' })); });
    expect(screen.getByRole('dialog', { name: 'Tageslimit erreicht' })).toBeTruthy();
    expect(screen.getByText(/Du hast heute schon 5 Leute angefragt/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Anfragen' })).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('search rows: avatar, name, bio line and the button for every friendship state', async () => {
    vi.mocked(users.search).mockResolvedValue({ data: [
      { id: 4, name: 'Lena', age: 27, bio: 'Laufen & Kaffee', friend_status: 'none' },
      { id: 5, name: 'Leo', location: 'Graz', friend_status: 'pending_in', friendship_id: 12 },
      { id: 6, name: 'Lea', friend_status: 'accepted' },
      { id: 7, name: 'Len', friend_status: 'pending_out' },
    ] });
    await renderAt('/explore?tab=friends', { friendList: [friendRow()] });
    await typeSearch('Le');
    await waitFor(() => expect(screen.getByText('Lena')).toBeTruthy());
    expect(users.search).toHaveBeenCalledWith('Le', expect.objectContaining({ signal: expect.anything() }));
    expect(screen.getByText('Laufen & Kaffee')).toBeTruthy();
    expect(screen.getByText('Graz')).toBeTruthy(); // no bio → location
    const row = (name) => screen.getByText(name).closest('.ef-friends-row');
    expect(within(row('Lena')).getByRole('button', { name: '+ Anfragen' })).toBeTruthy();
    expect(within(row('Leo')).getByRole('button', { name: 'Annehmen' })).toBeTruthy();
    expect(within(row('Lea')).getByText('Befreundet')).toBeTruthy();
    expect(within(row('Len')).getByText('Angefragt')).toBeTruthy();
    // The search replaces the friends list while it is open.
    expect(screen.queryByText('Niklas')).toBeNull();
  });

  it('„Anfragen" is optimistic, a failure rolls it back', async () => {
    vi.mocked(users.search).mockResolvedValue({ data: [{ id: 4, name: 'Lena', friend_status: 'none' }] });
    vi.mocked(friends.sendRequest)
      .mockResolvedValueOnce({ data: { message: 'Friend request sent' } })
      .mockRejectedValueOnce({ response: { status: 429, data: { error: 'Zu viele Freundschaftsanfragen.' } } });
    await renderAt('/explore?tab=friends');
    await typeSearch('Len');
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Anfragen' })).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Anfragen' })); });
    expect(friends.sendRequest).toHaveBeenCalledWith(4);
    expect(screen.getByText('Angefragt')).toBeTruthy();

    await typeSearch('Lena');
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Anfragen' })).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+ Anfragen' })); });
    expect(screen.getByRole('button', { name: '+ Anfragen' })).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith('Anfrage konnte nicht gesendet werden.');
  });

  it('„Annehmen" accepts the request and reloads the friends list', async () => {
    vi.mocked(users.search).mockResolvedValue({ data: [{ id: 5, name: 'Leo', friend_status: 'pending_in', friendship_id: 12 }] });
    vi.mocked(friends.respondRequest).mockResolvedValueOnce({ data: { status: 'accepted' } });
    await renderAt('/explore?tab=friends');
    expect(friends.getAll).toHaveBeenCalledTimes(1);
    await typeSearch('Leo');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annehmen' })).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Annehmen' })); });
    expect(friends.respondRequest).toHaveBeenCalledWith(12, 'accept');
    expect(screen.getByText('Befreundet')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Ihr seid jetzt befreundet 🎉');
    expect(friends.getAll).toHaveBeenCalledTimes(2);
  });

  it('says so when the search is rate-limited', async () => {
    vi.mocked(users.search).mockRejectedValue({ name: 'AxiosError', response: { status: 429 } });
    await renderAt('/explore?tab=friends');
    await typeSearch('Lena');
    await waitFor(() => expect(screen.getByText('Zu viele Suchanfragen – bitte warte kurz.')).toBeTruthy());
  });
});
