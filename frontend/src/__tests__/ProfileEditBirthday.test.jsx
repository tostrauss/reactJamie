import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// „Geburtstag unklar" (Tina 22.10.2026): the birthday may be changed once
// after onboarding and is locked afterwards (authController updateProfile).
// The page now always says how that works, and asks BEFORE a save would use
// up the one change — never when the date is set for the first time.
// Real German i18n.
const api = vi.hoisted(() => ({
  auth: { updateProfile: vi.fn() },
  upload: { image: vi.fn() },
  spotify: { getStatus: vi.fn(() => Promise.resolve({ data: { connected: false } })), disconnect: vi.fn() },
}));
vi.mock('../utils/api', () => api);
vi.mock('../utils/spotifyAuth', () => ({ connectSpotify: vi.fn() }));
vi.mock('../utils/platform', () => ({ isNativeIOS: () => false }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../components/SpotifySongPicker', () => ({ default: () => null }));
vi.mock('../components/ImageCropModal', () => ({ ImageCropModal: () => null }));

const { ProfileEdit } = await import('../pages/ProfileEdit');

const BASE = {
  id: 1, name: 'Elli', bio: '', location: 'Wien', gender: 'female', interests: ['Musik', 'Kunst', 'Mode'],
  date_of_birth: '1999-05-05', date_of_birth_changed: false, onboarding_completed: true,
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
const dobSelects = () => [...document.querySelectorAll('.dob-select')];   // day, month, year
// „Änderungen speichern" — a direct lookup: role queries scan the whole long
// form and are slow here.
const save = async () => {
  const btn = document.querySelector('.pe-save-btn');
  expect(btn.textContent).toContain('Änderungen speichern');
  await act(async () => { fireEvent.click(btn); });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.auth.updateProfile.mockResolvedValue({ data: BASE });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('ProfileEdit — birthday', () => {
  it('not set yet: says what saving it means, and setting it asks nothing', async () => {
    vi.spyOn(window, 'confirm');
    await renderEdit({ ...BASE, date_of_birth: null });
    expect(screen.getByText(/bestimmt deinen Altersfilter/)).toBeTruthy();
    const [d, m, y] = dobSelects();
    fireEvent.change(d, { target: { value: '01' } });
    fireEvent.change(m, { target: { value: '02' } });
    fireEvent.change(y, { target: { value: '1990' } });
    await save();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.auth.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1990-02-01' }));
  });

  it('changing a saved birthday asks first — „Abbrechen" saves nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderEdit(BASE);
    expect(screen.getByText('Dein Geburtsdatum kannst du nur einmal ändern.')).toBeTruthy();
    fireEvent.change(dobSelects()[2], { target: { value: '1998' } });
    await save();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('05.05.1998'));
    expect(window.confirm.mock.calls[0][0]).toContain('nur dieses eine Mal');
    expect(api.auth.updateProfile).not.toHaveBeenCalled();
  });

  it('… and saves after „OK"', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderEdit(BASE);
    fireEvent.change(dobSelects()[2], { target: { value: '1998' } });
    await save();
    expect(api.auth.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1998-05-05' }));
  });

  it('saving other fields with the birthday untouched asks nothing', async () => {
    vi.spyOn(window, 'confirm');
    await renderEdit(BASE);
    await save();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.auth.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1999-05-05' }));
  });

  it('locked: the selects are disabled and the hint says why', async () => {
    await renderEdit({ ...BASE, date_of_birth_changed: true });
    expect(dobSelects().every((s) => s.disabled)).toBe(true);
    expect(screen.getByText(/JAMIE ist erst ab 18/)).toBeTruthy();
  });
});
