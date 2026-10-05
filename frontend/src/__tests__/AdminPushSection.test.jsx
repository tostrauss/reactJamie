import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.date ? `${key}(${opts.date})` : key),
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));
vi.mock('../utils/api', () => ({ admin: { sendTestPush: vi.fn() } }));

const { admin } = await import('../utils/api');
const { AdminPushSection } = await import('../components/AdminPushSection');

beforeEach(() => { vi.mocked(admin.sendTestPush).mockReset(); });

const devices = [
  { id: 1, platform: 'web', host: 'fcm.googleapis.com', registered_at: '2026-10-03T10:00:00Z' },
  { id: 2, platform: 'apns', host: 'apns', registered_at: '2026-09-06T10:00:00Z' },
];

describe('AdminPushSection (support tool for "Push kommt nicht an")', () => {
  it('says plainly when the user has NO registered device — the first question in every push complaint', () => {
    const { getByText, queryByText } = render(<AdminPushSection userId={7} devices={[]} />);
    expect(getByText('admin.userModal.push.none')).toBeTruthy();
    // nothing to test-push to
    expect(queryByText('admin.userModal.push.test')).toBeNull();
  });

  it('lists devices by kind without ever showing an endpoint or token', () => {
    const { container, getByText } = render(<AdminPushSection userId={7} devices={devices} />);
    expect(getByText('admin.userModal.push.platform.android')).toBeTruthy();
    expect(getByText('admin.userModal.push.platform.iphone')).toBeTruthy();
    expect(container.textContent).toContain('fcm.googleapis.com');
    expect(container.textContent).not.toMatch(/fcm\/send/);
  });

  it('sends a test push and shows the push service verdict per device', async () => {
    vi.mocked(admin.sendTestPush).mockResolvedValue({ data: { results: [
      { id: 1, platform: 'web', host: 'fcm.googleapis.com', ok: true, status: 201 },
      { id: 2, platform: 'apns', host: 'apns', ok: false, reason: 'BadDeviceToken', pruned: true },
    ] } });
    const { getByText, container } = render(<AdminPushSection userId={7} devices={devices} />);
    await act(async () => { fireEvent.click(getByText('admin.userModal.push.test')); });
    expect(admin.sendTestPush).toHaveBeenCalledWith(7);
    expect(container.textContent).toContain('✓ admin.userModal.push.accepted (201)');
    expect(container.textContent).toContain('✗ admin.userModal.push.pruned');
    expect(getByText('admin.userModal.push.hint')).toBeTruthy();
  });

  it('shows an error when the request itself fails', async () => {
    vi.mocked(admin.sendTestPush).mockRejectedValue(new Error('500'));
    const { getByText } = render(<AdminPushSection userId={7} devices={devices} />);
    await act(async () => { fireEvent.click(getByText('admin.userModal.push.test')); });
    expect(getByText('admin.userModal.push.error')).toBeTruthy();
  });

  it('renders nothing against an older backend that does not send the field', () => {
    const { container } = render(<AdminPushSection userId={7} devices={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
