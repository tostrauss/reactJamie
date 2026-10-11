import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Home's profile banner. A finished profile WITHOUT a picture still cannot
// join (server 403 requiresAvatar), but the banner only knew the onboarding
// flag and the birth date — so after „Überspringen" on onboarding's photo
// prompt Home said nothing (Tina's checklist 10.10.2026). Real German i18n.
vi.mock('../utils/api', () => {
  const empty = () => Promise.resolve({ data: [] });
  return {
    default: { get: vi.fn(empty) },
    groups: { getFavorites: vi.fn(empty), getJoined: vi.fn(empty) },
    clubs: { getAll: vi.fn(empty), getJoined: vi.fn(empty), getFavorites: vi.fn(empty) },
    deals: { getAll: vi.fn(empty) },
  };
});
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../components/MapView', () => ({ default: () => null }));

const { Home } = await import('../pages/Home');

const DONE = {
  id: 7, name: 'Tina', date_of_birth: '1994-05-12', gender: 'female',
  onboarding_completed: true, avatar_url: null,
};

const renderHome = async (user) => {
  render(
    <AuthContext.Provider value={{ user }}>
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/profile/edit" element={<div>PROFILE-EDIT</div>} />
          <Route path="/onboarding" element={<div>ONBOARDING-PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});   // let the feed requests settle
};
const banners = () => document.querySelectorAll('.profile-warning-banner');

describe('Home — profile banner', () => {
  it('finished profile without a picture: the Achtung banner, its button opens Profil bearbeiten', async () => {
    await renderHome(DONE);
    expect(banners()).toHaveLength(1);
    expect(screen.getByText('Achtung: Dein Profil ist nicht vollständig')).toBeTruthy();
    expect(screen.getByText('Füge ein Profilbild hinzu, um Gruppen & Clubs beizutreten.')).toBeTruthy();
    expect(screen.queryByText('Profil noch nicht vollständig')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Profilbild hinzufügen' })); });
    expect(screen.getByText('PROFILE-EDIT')).toBeTruthy();
  });

  it('no banner at all once the profile is finished AND has a picture', async () => {
    await renderHome({ ...DONE, avatar_url: '/media/uploads/a.webp' });
    expect(banners()).toHaveLength(0);
    expect(screen.queryByText('Achtung: Dein Profil ist nicht vollständig')).toBeNull();
  });

  it('an unfinished profile keeps the old banner (to the wizard) — one banner, never both', async () => {
    await renderHome({ ...DONE, onboarding_completed: false });
    expect(banners()).toHaveLength(1);
    expect(screen.getByText('Profil noch nicht vollständig')).toBeTruthy();
    expect(screen.queryByText('Achtung: Dein Profil ist nicht vollständig')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Profil jetzt abschließen' })); });
    expect(screen.getByText('ONBOARDING-PAGE')).toBeTruthy();
  });

  it('a missing birth date also keeps the old banner, picture or not', async () => {
    await renderHome({ ...DONE, date_of_birth: null });
    expect(banners()).toHaveLength(1);
    expect(screen.getByText('Profil noch nicht vollständig')).toBeTruthy();
    expect(screen.queryByText('Achtung: Dein Profil ist nicht vollständig')).toBeNull();
  });
});
