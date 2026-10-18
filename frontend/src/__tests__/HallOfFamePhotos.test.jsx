import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { HallOfFameGrid } from '../components/HallOfFameGrid';

// Hall of Fame (Lea, 18.10.2026): participants — not only the owner — add
// photos to an event's card, a chip opens the gallery with who shared what,
// and the profile grid keeps events whose chat is gone. Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../hooks/useOnPullRefresh', () => ({ default: () => {} }));
vi.mock('../utils/api', () => ({
  groups: {
    getHallOfFame: vi.fn(),
    getMyLikes: vi.fn(async () => ({ data: [] })),
    toggleLike: vi.fn(),
    update: vi.fn(),
    addPhoto: vi.fn(),
    getPhotos: vi.fn(),
    deletePhoto: vi.fn(async () => ({ data: { deleted: true } })),
  },
  deals: { getAll: vi.fn(async () => ({ data: [] })) },
  upload: { image: vi.fn(async () => ({ data: { url: '/media/new.jpg' } })) },
}));
const { groups, upload } = await import('../utils/api');
const { Explore } = await import('../pages/Explore');

const card = (over = {}) => ({
  id: 5, name: 'Wandern am Kahlenberg', category: 'Wandern', date: '2026-10-11T10:00:00',
  image_url: '/media/cover.jpg', moment_photo_url: null, owner_id: 2, owner_name: 'Tina',
  like_count: 0, photos: [], photo_count: 0, my_photo_count: 0, is_participant: true, can_add_photo: true,
  ...over,
});

const renderExplore = async (items, userId = 9) => {
  vi.mocked(groups.getHallOfFame).mockResolvedValueOnce({ data: items });
  render(
    <AuthContext.Provider value={{ user: { id: userId } }}>
      <MemoryRouter initialEntries={['/explore']}><Explore /></MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upload.image).mockResolvedValue({ data: { url: '/media/new.jpg' } });
});

describe('Explore Hall of Fame — participant photos', () => {
  it('lets a participant share a photo: upload, attach, and the card counts it', async () => {
    vi.mocked(groups.addPhoto).mockResolvedValueOnce({
      data: { id: 7, url: '/media/new.jpg', user_id: 9, user_name: 'Lea', can_delete: true },
    });
    await renderExplore([card()]);
    const add = screen.getByRole('button', { name: /Warst du dabei\? Teile dein Foto\./ });
    const input = add.closest('.ef-card').querySelectorAll('input[type="file"]')[1];
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    expect(upload.image).toHaveBeenCalledWith(file);
    expect(groups.addPhoto).toHaveBeenCalledWith(5, '/media/new.jpg');
    expect(toast.success).toHaveBeenCalledWith('Foto geteilt 🎉');
    expect(screen.getByRole('button', { name: 'Fotos ansehen' }).textContent).toContain('1 Foto');
    // Shared once → the button now just says "Foto teilen".
    expect(screen.getByRole('button', { name: /^Foto teilen$/ })).toBeTruthy();
  });

  it('shows no share button to somebody who was not there, and only the moment prompt on the owner\'s empty card', async () => {
    await renderExplore([
      card({ id: 1, is_participant: false, can_add_photo: false }),
      card({ id: 2, owner_id: 9, moment_photo_url: null }),
    ]);
    expect(screen.queryByRole('button', { name: /Teile dein Foto|Foto teilen/ })).toBeNull();
    expect(screen.getByText('📸 Teile deinen JAMIE Moment')).toBeTruthy();
  });

  it('explains the limit when the server refuses', async () => {
    vi.mocked(groups.addPhoto).mockRejectedValueOnce({ response: { data: { code: 'USER_LIMIT' } } });
    await renderExplore([card()]);
    const input = document.querySelectorAll('.ef-card input[type="file"]')[1];
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg')] } }); });
    expect(toast.error).toHaveBeenCalledWith('Du hast für dieses Event schon 5 Fotos geteilt.');
  });

  it('opens the gallery with who shared each photo and lets the uploader delete theirs', async () => {
    const mine = { id: 7, url: '/media/a.jpg', user_id: 9, user_name: 'Lea' };
    vi.mocked(groups.getPhotos).mockResolvedValueOnce({ data: [{ ...mine, can_delete: true }] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderExplore([card({ photos: [mine], photo_count: 1, my_photo_count: 1, moment_photo_url: '/media/m.jpg' })]);

    // Moment + 1 participant photo.
    fireEvent.click(screen.getByRole('button', { name: 'Fotos ansehen' }));
    await waitFor(() => expect(groups.getPhotos).toHaveBeenCalledWith(5));
    expect(screen.getByText('von Tina')).toBeTruthy();         // the moment leads, not deletable
    expect(screen.queryByRole('button', { name: 'Foto löschen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Nächstes Foto' }));
    expect(screen.getByText('von Lea')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Foto löschen' })); });
    expect(groups.deletePhoto).toHaveBeenCalledWith(5, 7);
    expect(toast.success).toHaveBeenCalledWith('Foto gelöscht');
    expect(screen.queryByRole('button', { name: 'Fotos ansehen' })).toBeNull(); // no participant photos left
  });
});

describe('HallOfFameGrid', () => {
  it('opens a standing event, keeps a deleted one as a plain card', () => {
    const onOpen = vi.fn();
    render(
      <HallOfFameGrid
        onOpen={onOpen}
        events={[
          { id: 1, name: 'Bar-Abend', date: '2026-10-01T19:00:00', cover_url: '/media/a.jpg', is_deleted: false },
          { id: 2, name: 'Uni Streik', date: '2026-09-20T12:00:00', cover_url: null, is_deleted: true, location: 'Wien' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Bar-Abend/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(screen.queryByRole('button', { name: /Uni Streik/ })).toBeNull();
    expect(screen.getByText('Uni Streik')).toBeTruthy();
    expect(screen.getByText('📍 Wien')).toBeTruthy();
  });
});
