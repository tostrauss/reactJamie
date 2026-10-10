import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Reihenfolge der Profilfotos und der Pinnwand nachträglich ändern (Wunsch
// 10.10.2026). Tap a photo → move bar under its grid; slot 1 of the profile
// photos is the profile picture (avatar_url). Real German i18n.
vi.mock('../utils/api', () => ({
  auth: { updateProfile: vi.fn() },
  upload: { image: vi.fn() },
  spotify: {
    getStatus: vi.fn(() => Promise.resolve({ data: { connected: false } })),
    disconnect: vi.fn(),
  },
}));
vi.mock('../utils/spotifyAuth', () => ({ connectSpotify: vi.fn() }));
vi.mock('../utils/platform', () => ({ isNativeIOS: () => false }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../components/SpotifySongPicker', () => ({ default: () => null }));
vi.mock('../components/ImageCropModal', () => ({ ImageCropModal: () => null }));

const { auth } = await import('../utils/api');
const { ProfileEdit } = await import('../pages/ProfileEdit');

const u = (n) => `/media/uploads/${n}.webp`;
const USER = {
  id: 1, name: 'Ann', bio: '', location: 'Wien', gender: 'female', interests: [],
  date_of_birth: '1995-03-03',
  avatar_url: u('p1'), photos: [u('p2'), u('p3')],
  pinnwand: [u('w1'), u('w2'), u('w3')],
};
const HINT = 'Tippe auf ein Foto, um die Reihenfolge zu ändern.';

const renderEdit = async (user = USER) => {
  render(
    <AuthContext.Provider value={{ user, setUser: vi.fn() }}>
      <MemoryRouter><ProfileEdit /></MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};
const profileGrid = () => document.querySelectorAll('.pe-photo-grid')[0];
const pinnwandGrid = () => document.querySelectorAll('.pe-photo-grid')[1];
const srcs = (grid) => [...grid.querySelectorAll('.pe-photo-cell img')].map((i) => i.getAttribute('src'));
const pick = (grid, n, total) => fireEvent.click(within(grid).getByRole('button', { name: `Foto ${n} von ${total} auswählen` }));
const btn = (name) => screen.getByRole('button', { name });
const save = async () => {
  fireEvent.click(btn('Änderungen speichern'));
  await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledTimes(1));
  return auth.updateProfile.mock.calls[0][0];
};

beforeEach(() => {
  vi.mocked(auth.updateProfile).mockReset();
  vi.mocked(auth.updateProfile).mockResolvedValue({ data: USER });
});

describe('ProfileEdit — Reihenfolge der Fotos ändern', () => {
  it('shows a hint under each grid, and the move bar only once a photo is tapped', async () => {
    await renderEdit();
    expect(screen.getAllByText(HINT)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Als Profilbild' })).toBeNull();
    pick(profileGrid(), 3, 3);
    expect(btn('Als Profilbild')).toBeTruthy();
    expect(screen.getAllByText(HINT)).toHaveLength(1);   // the Pinnwand keeps its hint
    expect(within(profileGrid()).getByRole('button', { name: 'Foto 3 von 3 auswählen' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('„Als Profilbild“ moves the photo to slot 1 and saves it as avatar_url, the rest in order', async () => {
    await renderEdit();
    pick(profileGrid(), 3, 3);
    fireEvent.click(btn('Als Profilbild'));
    expect(srcs(profileGrid())).toEqual([u('p3'), u('p1'), u('p2')]);
    expect(profileGrid().querySelector('.pe-photo-cell--profile img').getAttribute('src')).toBe(u('p3'));
    const payload = await save();
    expect(payload.avatar_url).toBe(u('p3'));
    expect(payload.photos).toEqual([u('p1'), u('p2')]);
    expect(payload.pinnwand).toEqual([u('w1'), u('w2'), u('w3')]);
  });

  it('the selection follows the photo, and the arrows stop at both ends', async () => {
    await renderEdit();
    pick(profileGrid(), 3, 3);
    expect(btn('Einen Platz nach hinten').disabled).toBe(true);
    fireEvent.click(btn('Einen Platz nach vorne'));
    expect(srcs(profileGrid())).toEqual([u('p1'), u('p3'), u('p2')]);
    fireEvent.click(btn('Einen Platz nach vorne'));
    expect(srcs(profileGrid())).toEqual([u('p3'), u('p1'), u('p2')]);
    expect(btn('Einen Platz nach vorne').disabled).toBe(true);
    expect(btn('Als Profilbild').disabled).toBe(true);
    expect(screen.getByText('Jetzt an Platz 1 von 3')).toBeTruthy();
  });

  it('reorders the Pinnwand on its own and saves it in the new order', async () => {
    await renderEdit();
    pick(pinnwandGrid(), 1, 3);
    fireEvent.click(btn('Einen Platz nach hinten'));
    expect(srcs(pinnwandGrid())).toEqual([u('w2'), u('w1'), u('w3')]);
    fireEvent.click(btn('Fertig'));
    expect(screen.queryByRole('button', { name: 'Einen Platz nach hinten' })).toBeNull();
    const payload = await save();
    expect(payload.pinnwand).toEqual([u('w2'), u('w1'), u('w3')]);
    expect(payload.avatar_url).toBe(u('p1'));
    expect(payload.photos).toEqual([u('p2'), u('p3')]);
  });

  it('removing a photo closes the bar; removing slot 1 promotes the next photo', async () => {
    await renderEdit();
    pick(profileGrid(), 2, 3);
    fireEvent.click(within(profileGrid()).getAllByRole('button', { name: 'Foto entfernen' })[0]);
    expect(screen.queryByRole('button', { name: 'Als Profilbild' })).toBeNull();
    expect(srcs(profileGrid())).toEqual([u('p2'), u('p3')]);
    const payload = await save();
    expect(payload.avatar_url).toBe(u('p2'));
    expect(payload.photos).toEqual([u('p3')]);
  });

  it('loads Onboarding-shaped data (avatar also inside photos) in display order', async () => {
    await renderEdit({ ...USER, avatar_url: u('p2'), photos: [u('p1'), u('p2'), u('p3')] });
    expect(srcs(profileGrid())).toEqual([u('p2'), u('p1'), u('p3')]);
  });

  it('offers nothing to reorder with a single photo', async () => {
    await renderEdit({ ...USER, photos: [], pinnwand: [u('w1')] });
    expect(screen.queryByText(HINT)).toBeNull();
    pick(profileGrid(), 1, 1);
    expect(screen.queryByRole('button', { name: 'Als Profilbild' })).toBeNull();
  });
});
