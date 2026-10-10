import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Profil bearbeiten names what the join rule still misses (10.10.2026). The
// rule — 18+ birth date, gender, at least 3 interests — used to be checked only
// by the onboarding wizard's flag; a profile completed here stayed blocked.
// The server now unlocks it on save; this notice is the to-do list until then.
// Real German i18n.
vi.mock('../utils/api', () => ({
  auth: { updateProfile: vi.fn() },
  upload: { image: vi.fn() },
  spotify: { getStatus: vi.fn(() => Promise.resolve({ data: { connected: false } })), disconnect: vi.fn() },
}));
vi.mock('../utils/spotifyAuth', () => ({ connectSpotify: vi.fn() }));
vi.mock('../utils/platform', () => ({ isNativeIOS: () => false }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../components/SpotifySongPicker', () => ({ default: () => null }));
vi.mock('../components/ImageCropModal', () => ({ ImageCropModal: () => null }));

const { ProfileEdit } = await import('../pages/ProfileEdit');

const STUCK = {
  id: 1, name: 'Elli', bio: '', location: 'Wien', gender: '', interests: ['Musik'],
  date_of_birth: '1999-05-05', onboarding_completed: false,
  avatar_url: '/media/uploads/a.webp', photos: [], pinnwand: [],
};
const renderEdit = async (user) => {
  render(
    <AuthContext.Provider value={{ user, setUser: vi.fn() }}>
      <MemoryRouter><ProfileEdit /></MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};
const notice = () => document.querySelector('.pe-join-missing');

describe('ProfileEdit — what the join rule still misses', () => {
  it('names every missing part in one line and goes away as the page meets the rule', async () => {
    await renderEdit(STUCK);
    expect(notice().textContent).toBe('Damit du Gruppen beitreten kannst, fehlt noch: dein Geschlecht, mindestens 3 Interessen.');
    fireEvent.click(screen.getByText('Weiblich'));
    expect(notice().textContent).toBe('Damit du Gruppen beitreten kannst, fehlt noch: mindestens 3 Interessen.');
    fireEvent.click(screen.getByText('Kunst'));
    fireEvent.click(screen.getByText('Brettspiele'));      // from the former editor-only list
    expect(notice()).toBeNull();
  });

  it('a missing or under-18 birth date is named too', async () => {
    await renderEdit({ ...STUCK, gender: 'female', interests: ['Musik', 'Kunst', 'Mode'], date_of_birth: null });
    expect(notice().textContent).toBe('Damit du Gruppen beitreten kannst, fehlt noch: dein Geburtsdatum.');
  });

  it('nothing once the server has unlocked the profile', async () => {
    await renderEdit({ ...STUCK, onboarding_completed: true });
    expect(notice()).toBeNull();
  });

  it('both former lists are offered: Mode (wizard) and Brettspiele (editor)', async () => {
    await renderEdit({ ...STUCK, onboarding_completed: true });
    expect(screen.getByText('Mode')).toBeTruthy();
    expect(screen.getByText('Brettspiele')).toBeTruthy();
  });
});
