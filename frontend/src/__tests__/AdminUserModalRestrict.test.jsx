import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// "Einschränken" in Nutzer verwalten (Tina 12.10.2026): remove a picture that
// shows no real person, and freeze/unfreeze — instead of only "Account löschen".
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/api', () => ({
  admin: {
    getUserDetail: vi.fn(() => Promise.resolve({ data: {} })),
    removeUserAvatar: vi.fn(),
    setUserActive: vi.fn(),
    setUserRole: vi.fn(),
    deleteUser: vi.fn(),
  },
}));
vi.mock('../components/AdminPushSection', () => ({ AdminPushSection: () => null }));

const { admin } = await import('../utils/api');
const { AdminUserModal } = await import('../components/AdminUserModal');

const aleks = { id: 9, name: 'Aleks', email: 'a@x.com', avatar_url: '/media/uploads/sponge.webp', is_admin: false, is_active: true };
const renderModal = async (user = aleks, extra = {}) => {
  const utils = render(
    <MemoryRouter>
      <AdminUserModal user={user} currentUserId={1} onClose={vi.fn()} {...extra} />
    </MemoryRouter>,
  );
  await act(async () => {});
  return utils;
};
const freezeSwitch = (container) => {
  const all = container.querySelectorAll('[role="switch"]');
  return all[all.length - 1]; // admin, trusted, freeze — freeze is last
};

beforeEach(() => {
  vi.mocked(admin.removeUserAvatar).mockReset();
  vi.mocked(admin.setUserActive).mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('AdminUserModal — Einschränken', () => {
  it('removes the profile picture after a confirmation step and reports it', async () => {
    vi.mocked(admin.removeUserAvatar).mockResolvedValue({ data: { success: true } });
    const onUpdated = vi.fn();
    const { getByText, queryByText } = await renderModal(aleks, { onUpdated });
    fireEvent.click(getByText('admin.userModal.restrict.avatarBtn'));
    expect(admin.removeUserAvatar).not.toHaveBeenCalled();           // confirm first
    getByText('admin.userModal.restrict.avatarConfirm');
    await act(async () => { fireEvent.click(getByText('admin.userModal.restrict.avatarConfirmBtn')); });
    expect(admin.removeUserAvatar).toHaveBeenCalledWith(9);
    expect(toast.success).toHaveBeenCalledWith('admin.userModal.restrict.avatarDone');
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 9, avatar_url: null }));
    getByText('admin.userModal.restrict.avatarNone');
    expect(queryByText('admin.userModal.restrict.avatarBtn')).toBeNull();
  });

  it('cancel keeps the picture', async () => {
    const { getByText } = await renderModal();
    fireEvent.click(getByText('admin.userModal.restrict.avatarBtn'));
    fireEvent.click(getByText('admin.userModal.cancel'));
    expect(admin.removeUserAvatar).not.toHaveBeenCalled();
    getByText('admin.userModal.restrict.avatarBtn');
  });

  it('freezes and unfreezes through the existing endpoint, reverting on failure', async () => {
    vi.mocked(admin.setUserActive).mockResolvedValue({ data: { user: { id: 9, is_active: false } } });
    const { container } = await renderModal();
    const sw = freezeSwitch(container);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => { fireEvent.click(sw); });
    expect(admin.setUserActive).toHaveBeenCalledWith(9, false);
    expect(freezeSwitch(container).getAttribute('aria-checked')).toBe('true');
    expect(toast.success).toHaveBeenCalledWith('admin.userModal.restrict.frozenOn');

    vi.mocked(admin.setUserActive).mockRejectedValueOnce({ response: { data: { error: 'nope' } } });
    await act(async () => { fireEvent.click(freezeSwitch(container)); });
    expect(admin.setUserActive).toHaveBeenLastCalledWith(9, true);
    expect(freezeSwitch(container).getAttribute('aria-checked')).toBe('true');   // reverted
    expect(toast.error).toHaveBeenCalledWith('nope');
  });

  it('starts as "gesperrt" for an already frozen account', async () => {
    const { container } = await renderModal({ ...aleks, is_active: false });
    expect(freezeSwitch(container).getAttribute('aria-checked')).toBe('true');
  });

  it('is not offered for admins or for yourself', async () => {
    const a = await renderModal({ ...aleks, is_admin: true });
    expect(a.queryByText('admin.userModal.restrict.title')).toBeNull();
    a.unmount();
    const self = await renderModal({ ...aleks, id: 1 });
    expect(self.queryByText('admin.userModal.restrict.title')).toBeNull();
  });
});
