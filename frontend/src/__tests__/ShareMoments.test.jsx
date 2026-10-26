import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// „Warst du dabei..“ (Tina, 22.10.2026): own past meetups still waiting for
// the caller's photo. The owner's photo becomes the event's moment, a
// participant's is added to the card; shared → off the list. Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../hooks/useOnPullRefresh', () => ({ default: () => {} }));
vi.mock('../utils/api', () => ({
  groups: { getMemoryPrompts: vi.fn(), update: vi.fn(), addPhoto: vi.fn() },
  upload: { image: vi.fn() },
}));
const { groups, upload } = await import('../utils/api');
const { ShareMoments } = await import('../pages/ShareMoments');

const prompt = (over = {}) => ({
  id: 1, name: 'Bar-Abend', type: 'group', category: 'Bar', date: '2026-10-20T19:00:00',
  location: 'Wien', owner_id: 9, image_url: null, moment_photo_url: null, ...over,
});

const renderPage = async (rows) => {
  vi.mocked(groups.getMemoryPrompts).mockResolvedValueOnce({ data: rows });
  render(
    <AuthContext.Provider value={{ user: { id: 9 } }}>
      <MemoryRouter initialEntries={['/explore/share']}>
        <Routes>
          <Route path="/explore/share" element={<ShareMoments />} />
          <Route path="/explore" element={<p>EXPLORE</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

const input = () => document.querySelector('input[type="file"]');
const pick = async (cardName, file = new File(['x'], 'p.jpg', { type: 'image/jpeg' })) => {
  const cardEl = screen.getByText(cardName).closest('.ef-card');
  fireEvent.click(cardEl.querySelector('.ef-moment-prompt'));
  await act(async () => { fireEvent.change(input(), { target: { files: [file] } }); });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upload.image).mockResolvedValue({ data: { url: '/media/new.jpg' } });
});

describe('ShareMoments — „Warst du dabei..“', () => {
  it('has its title and „zurück", and asks owner and participant differently', async () => {
    await renderPage([prompt(), prompt({ id: 2, name: 'Wandern', owner_id: 2, image_url: '/media/w.jpg' })]);
    expect(screen.getByRole('heading', { name: 'Warst du dabei..' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zurück/ })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    const own = screen.getByText('Bar-Abend').closest('.ef-card');
    expect(own.textContent).toContain('📸 Teile deinen JAMIE Moment');
    const theirs = screen.getByText('Wandern').closest('.ef-card');
    expect(theirs.textContent).toContain('📸 Teile dein Foto');
    expect(theirs.querySelector('img').getAttribute('src')).toBe('/media/w.jpg');
  });

  it('the owner\'s photo becomes the moment, and the meetup leaves the list', async () => {
    vi.mocked(groups.update).mockResolvedValueOnce({ data: {} });
    await renderPage([prompt()]);
    await pick('Bar-Abend');
    expect(upload.image).toHaveBeenCalled();
    expect(groups.update).toHaveBeenCalledWith(1, { moment_photo_url: '/media/new.jpg' });
    expect(groups.addPhoto).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Dein JAMIE Moment ist live! ✨');
    expect(screen.queryByText('Bar-Abend')).toBeNull();
    expect(screen.getByText('Gerade ist kein Treffen offen — nach deinem nächsten Event findest du es hier.')).toBeTruthy();
  });

  it('a participant adds a photo to the card', async () => {
    vi.mocked(groups.addPhoto).mockResolvedValueOnce({ data: { id: 7 } });
    await renderPage([prompt({ id: 2, name: 'Wandern', owner_id: 2 })]);
    await pick('Wandern');
    expect(groups.addPhoto).toHaveBeenCalledWith(2, '/media/new.jpg');
    expect(groups.update).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Foto geteilt 🎉');
    expect(screen.queryByText('Wandern')).toBeNull();
  });

  it('a refused photo keeps the meetup and says why', async () => {
    vi.mocked(groups.addPhoto).mockRejectedValueOnce({ response: { data: { code: 'USER_LIMIT' } } });
    await renderPage([prompt({ id: 2, name: 'Wandern', owner_id: 2 })]);
    await pick('Wandern');
    expect(toast.error).toHaveBeenCalledWith('Du hast für dieses Event schon 5 Fotos geteilt.');
    expect(screen.getByText('Wandern')).toBeTruthy();
  });

  it('refuses a file over 10 MB before uploading', async () => {
    await renderPage([prompt()]);
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await pick('Bar-Abend', big);
    expect(upload.image).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Bild ist zu groß (max. 10 MB).');
  });

  it('ignores the iOS ghost tap right after a pick — it would open the next meetup', async () => {
    vi.mocked(groups.update).mockResolvedValueOnce({ data: {} });
    await renderPage([prompt(), prompt({ id: 2, name: 'Wandern', owner_id: 2 })]);
    await pick('Bar-Abend');
    // The ghost tap lands on the card that moved up; a later change event
    // must not upload for it.
    fireEvent.click(screen.getByText('Wandern').closest('.ef-card').querySelector('.ef-moment-prompt'));
    await act(async () => { fireEvent.change(input(), { target: { files: [new File(['y'], 'q.jpg')] } }); });
    expect(upload.image).toHaveBeenCalledTimes(1);
    expect(groups.addPhoto).not.toHaveBeenCalled();
  });

  it('„zurück" without in-app history lands on Explore', async () => {
    await renderPage([]);
    fireEvent.click(screen.getByRole('button', { name: /zurück/ }));
    expect(screen.getByText('EXPLORE')).toBeTruthy();
  });
});
