import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// The own profile after Tina's rework (22.10.2026, built 26.10.): the stats
// row „Meet-ups | Friends | Memories", the „Meine Gruppen & Clubs" hub, the
// Memories edit mode (remove with undo, swap the cover photo, a loud
// „Fertig") and the „Warst du dabei?" banner — and no Pro card any more.
// Real German i18n.
const api = vi.hoisted(() => ({
  auth: { updateProfile: vi.fn() },
  subscription: { getStatus: vi.fn() },
  groups: {
    getFavorites: vi.fn(), getJoined: vi.fn(), getMemoryPrompts: vi.fn(),
    deletePhoto: vi.fn(), addPhoto: vi.fn(),
  },
  clubs: { getFavorites: vi.fn() },
  friends: { getPending: vi.fn() },
  reviews: { getMyAttendance: vi.fn() },
  users: {
    getHallOfFame: vi.fn(), getProfileStats: vi.fn(), hideMemory: vi.fn(), unhideMemory: vi.fn(),
  },
  upload: { image: vi.fn() },
}));
vi.mock('../utils/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showUndo: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../components/SpotifySongPicker', () => ({ default: () => null }));

const { Profile } = await import('../pages/Profile');

const USER = { id: 9, name: 'Lea', location: 'Wien', interests: [], photos: [], pinnwand: [], profile_completion: 100 };

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
};

const renderProfile = async (entry = '/profile') => {
  render(
    <AuthContext.Provider value={{ user: USER, setUser: vi.fn() }}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};
const where = () => screen.getByTestId('where').textContent;

const MEMORIES = [
  { id: 10, name: 'Bar-Abend', date: '2026-10-01T19:00:00', cover_url: '/media/a.jpg', own_photo_id: 77, is_deleted: false },
  { id: 11, name: 'Wandern', date: '2026-09-20T10:00:00', cover_url: null, own_photo_id: null, is_deleted: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.subscription.getStatus.mockResolvedValue({ data: { is_pro: false } });
  api.groups.getFavorites.mockResolvedValue({ data: [] });
  api.groups.getJoined.mockResolvedValue({ data: [] });
  api.groups.getMemoryPrompts.mockResolvedValue({ data: [] });
  api.clubs.getFavorites.mockResolvedValue({ data: [] });
  api.friends.getPending.mockResolvedValue({ data: [] });
  api.reviews.getMyAttendance.mockResolvedValue({ data: { available: false } });
  api.users.getProfileStats.mockResolvedValue({ data: { available: true, meetups: 2, friends: 5, memories: 7 } });
  api.users.getHallOfFame.mockResolvedValue({ data: MEMORIES.map((m) => ({ ...m })) });
  api.users.hideMemory.mockResolvedValue({ data: { hidden: true } });
  api.users.unhideMemory.mockResolvedValue({ data: { hidden: false } });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Profile — stats row', () => {
  it('shows Meet-ups | Friends | Memories with their numbers — the labels in English', async () => {
    await renderProfile();
    const row = document.querySelector('.profile-stats-row');
    expect(row).toBeTruthy();
    const tiles = within(row).getAllByRole('button');
    expect(tiles.map((b) => b.textContent)).toEqual(['2Meet-ups', '5Friends', '7Memories']);
  });

  it('Friends opens the friends list', async () => {
    await renderProfile();
    fireEvent.click(screen.getByText('Friends').closest('button'));
    expect(where()).toBe('/friends');
  });

  it('Memories opens the Memories tab', async () => {
    await renderProfile();
    await act(async () => { fireEvent.click(screen.getByText('Memories', { selector: '.profile-stat-label' }).closest('button')); });
    expect(api.users.getHallOfFame).toHaveBeenCalledWith('me');
    expect(await screen.findByText('Bar-Abend')).toBeTruthy();
  });

  it('no row at all when the numbers are unavailable', async () => {
    api.users.getProfileStats.mockResolvedValue({ data: { available: false } });
    await renderProfile();
    expect(document.querySelector('.profile-stats-row')).toBeNull();
    expect(screen.queryByText('Meet-ups')).toBeNull();
  });

  it('no Pro card any more — the crown next to the name stays for Pro', async () => {
    await renderProfile();
    expect(document.querySelector('.pro-cta-card')).toBeNull();
    expect(screen.queryByText('Exklusive Deals & Empfehlungen in Wien')).toBeNull();
    expect(screen.queryByText('👑')).toBeNull();
  });

  it('a Pro user still sees the crown', async () => {
    api.subscription.getStatus.mockResolvedValue({ data: { is_pro: true } });
    await renderProfile();
    expect(screen.getByText('👑')).toBeTruthy();
  });
});

describe('Profile — Meine Gruppen & Clubs', () => {
  const JOINED = [
    { id: 1, name: 'Laufgruppe', type: 'group', role: 'owner', pending_request_count: 0 },
    { id: 2, name: 'Tennisclub', type: 'club', role: 'owner', pending_request_count: 3 },
    { id: 3, name: 'Fremde Gruppe', type: 'group', role: 'member', pending_request_count: 0 },
    { id: 4, name: 'Club-Abend', type: 'event', role: 'owner', pending_request_count: 0 },
  ];

  it('shows what the user owns — no memberships, no club events — open requests first', async () => {
    api.groups.getJoined.mockResolvedValue({ data: JOINED });
    await renderProfile();
    const hub = screen.getByRole('region', { name: 'Meine Gruppen & Clubs' });
    const names = [...hub.querySelectorAll('.profile-manage-name')].map((n) => n.textContent);
    expect(names).toEqual(['Tennisclub', 'Laufgruppe']);
    expect(within(hub).getByText('Club')).toBeTruthy();
    expect(within(hub).getByText('Gruppe')).toBeTruthy();
  });

  it('the requests badge leads to the requests tab', async () => {
    api.groups.getJoined.mockResolvedValue({ data: JOINED });
    await renderProfile();
    fireEvent.click(screen.getByRole('button', { name: '3 Anfragen' }));
    expect(where()).toBe('/chats?tab=anfragen');
  });

  it('„Verwalten" opens the edit page of that group', async () => {
    api.groups.getJoined.mockResolvedValue({ data: JOINED });
    await renderProfile();
    const card = screen.getByText('Laufgruppe').closest('.profile-manage-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Verwalten' }));
    expect(where()).toBe('/group/1/edit');
  });

  it('no section when the user owns nothing', async () => {
    api.groups.getJoined.mockResolvedValue({ data: [JOINED[2]] });
    await renderProfile();
    expect(screen.queryByText('Meine Gruppen & Clubs')).toBeNull();
  });
});

describe('Profile — Memories edit mode', () => {
  const openEdit = async () => {
    await renderProfile('/profile?tab=halloffame');
    await screen.findByText('Bar-Abend');
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  };

  it('„Bearbeiten" gives every tile the X, „Bild ändern" and „Entfernen"; „Fertig" ends it loudly', async () => {
    await openEdit();
    expect(screen.getAllByRole('button', { name: 'Bild ändern' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Entfernen' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '„Bar-Abend“ aus deinen Memories entfernen' })).toBeTruthy();
    expect(document.querySelectorAll('.hof-card--editing')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(toast.success).toHaveBeenCalledWith('Fertig! Deine Memories sind aktuell ✓');
    expect(screen.queryByRole('button', { name: 'Bild ändern' })).toBeNull();
    expect(document.querySelector('.profile-memories-edit.is-done')).toBeTruthy();
  });

  it('„Entfernen" asks first and does nothing on „Abbrechen"', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openEdit();
    const card = screen.getByText('Wandern').closest('.hof-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Entfernen' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('bleiben unter Entdecken sichtbar'));
    expect(api.users.hideMemory).not.toHaveBeenCalled();
    expect(screen.getByText('Wandern')).toBeTruthy();
  });

  it('after yes the tile leaves the grid, the numbers are re-read, and undo brings it back', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openEdit();
    const card = screen.getByText('Wandern').closest('.hof-card');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Entfernen' })); });
    expect(api.users.hideMemory).toHaveBeenCalledWith(11);
    expect(screen.queryByText('Wandern')).toBeNull();
    expect(api.users.getProfileStats).toHaveBeenCalledTimes(2);
    expect(toast.showUndo).toHaveBeenCalledWith('Aus deinem Profil entfernt', expect.any(Function), 'Rückgängig');

    const undo = toast.showUndo.mock.calls[0][1];
    await act(async () => { await undo(); });
    expect(api.users.unhideMemory).toHaveBeenCalledWith(11);
    expect(screen.getByText('Wandern')).toBeTruthy();
  });

  it('the coral X does the same as „Entfernen"', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openEdit();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '„Bar-Abend“ aus deinen Memories entfernen' }));
    });
    expect(api.users.hideMemory).toHaveBeenCalledWith(10);
  });

  it('„Bild ändern" swaps the photo behind the cover: upload, delete the old one, add the new one', async () => {
    api.upload.image.mockResolvedValue({ data: { url: '/media/new.jpg' } });
    api.groups.deletePhoto.mockResolvedValue({ data: { deleted: true } });
    api.groups.addPhoto.mockResolvedValue({ data: { id: 88, url: '/media/new.jpg' } });
    await openEdit();
    const card = screen.getByText('Bar-Abend').closest('.hof-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Bild ändern' }));
    const file = new File(['x'], 'neu.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('memory-image-input'), { target: { files: [file] } });
    });
    expect(api.upload.image).toHaveBeenCalledWith(file);
    expect(api.groups.deletePhoto).toHaveBeenCalledWith(10, 77);
    expect(api.groups.addPhoto).toHaveBeenCalledWith(10, '/media/new.jpg');
    expect(api.groups.deletePhoto.mock.invocationCallOrder[0])
      .toBeLessThan(api.groups.addPhoto.mock.invocationCallOrder[0]);
    expect(within(card).getByRole('img').getAttribute('src')).toBe('/media/new.jpg');
    expect(toast.success).toHaveBeenCalledWith('Neues Bild gespeichert ✓');
  });

  it('a tile without an own photo only adds one — nothing to delete', async () => {
    api.upload.image.mockResolvedValue({ data: { url: '/media/w.jpg' } });
    api.groups.addPhoto.mockResolvedValue({ data: { id: 90, url: '/media/w.jpg' } });
    await openEdit();
    const card = screen.getByText('Wandern').closest('.hof-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Bild ändern' }));
    await act(async () => {
      fireEvent.change(screen.getByTestId('memory-image-input'),
        { target: { files: [new File(['x'], 'w.jpg', { type: 'image/jpeg' })] } });
    });
    expect(api.groups.deletePhoto).not.toHaveBeenCalled();
    expect(api.groups.addPhoto).toHaveBeenCalledWith(11, '/media/w.jpg');
    expect(within(card).getByRole('img').getAttribute('src')).toBe('/media/w.jpg');
  });

  it('a file over 10 MB never uploads', async () => {
    await openEdit();
    const card = screen.getByText('Wandern').closest('.hof-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Bild ändern' }));
    const big = new File(['x'], 'riesig.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await act(async () => { fireEvent.change(screen.getByTestId('memory-image-input'), { target: { files: [big] } }); });
    expect(api.upload.image).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/zu groß|10 MB/i));
  });

  it('when the new photo is refused after the old one was deleted, the list is read again', async () => {
    api.upload.image.mockResolvedValue({ data: { url: '/media/new.jpg' } });
    api.groups.deletePhoto.mockResolvedValue({ data: { deleted: true } });
    api.groups.addPhoto.mockRejectedValue({ response: { status: 409, data: { code: 'EVENT_LIMIT' } } });
    await openEdit();
    const card = screen.getByText('Bar-Abend').closest('.hof-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Bild ändern' }));
    await act(async () => {
      fireEvent.change(screen.getByTestId('memory-image-input'),
        { target: { files: [new File(['x'], 'n.jpg', { type: 'image/jpeg' })] } });
    });
    expect(toast.error).toHaveBeenCalledWith('Für dieses Event sind keine weiteren Fotos möglich.');
    expect(api.users.getHallOfFame).toHaveBeenCalledTimes(2);
  });
});

describe('Profile — „Warst du dabei?"', () => {
  it('names the one waiting meetup and leads to the share page', async () => {
    api.groups.getMemoryPrompts.mockResolvedValue({ data: [{ id: 20, name: 'Lauftreff' }] });
    await renderProfile('/profile?tab=halloffame');
    const banner = await screen.findByRole('button', { name: /Warst du dabei\?/ });
    expect(banner.textContent).toContain('„Lauftreff“ – teile dein Foto');
    fireEvent.click(banner);
    expect(where()).toBe('/explore/share');
  });

  it('counts several, and steps aside while editing', async () => {
    api.groups.getMemoryPrompts.mockResolvedValue({ data: [{ id: 20, name: 'A' }, { id: 21, name: 'B' }] });
    await renderProfile('/profile?tab=halloffame');
    await waitFor(() => expect(screen.getByText('2 Treffen warten auf dein Foto')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.queryByText('2 Treffen warten auf dein Foto')).toBeNull();
  });

  it('no banner without a waiting meetup', async () => {
    await renderProfile('/profile?tab=halloffame');
    await screen.findByText('Bar-Abend');
    expect(screen.queryByRole('button', { name: /Warst du dabei\?/ })).toBeNull();
  });
});
