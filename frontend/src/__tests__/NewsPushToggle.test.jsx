import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Settings → „Neuigkeiten & Deals" (18.10.2026): the opt-in for JAMIE's news
// pushes. App Store Guideline 4.5.4 → it is OFF until the user turns it on,
// it reads its own value (users.push_news is not in the profile), and it hides
// on a server that cannot store it. Real German i18n (vitest.setup.js).
vi.mock('../utils/api', () => ({
  push: { getPreferences: vi.fn(), updatePreferences: vi.fn() },
}));
const toastError = vi.fn();
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }) }));

const { push } = await import('../utils/api');
const { NewsPushToggle } = await import('../components/NewsPushToggle');

const renderToggle = async () => {
  const utils = render(<NewsPushToggle />);
  await act(async () => {});
  return utils;
};
const switchEl = () => screen.queryByRole('checkbox', { name: 'Neuigkeiten & Deals' });

beforeEach(() => {
  vi.mocked(push.getPreferences).mockReset();
  vi.mocked(push.updatePreferences).mockReset();
  toastError.mockReset();
});

describe('NewsPushToggle', () => {
  it('reads the stored value: OFF by default, with its explanation', async () => {
    vi.mocked(push.getPreferences).mockResolvedValue({ data: { push_news: false } });
    await renderToggle();
    expect(switchEl()).toBeTruthy();
    expect(switchEl().checked).toBe(false);
    expect(switchEl().disabled).toBe(false);
    expect(screen.getByText('Updates und neue Deals von JAMIE als Push')).toBeTruthy();
  });

  it('turning it on sends exactly { push_news: true } and stays on', async () => {
    vi.mocked(push.getPreferences).mockResolvedValue({ data: { push_news: false } });
    vi.mocked(push.updatePreferences).mockResolvedValue({ data: { push_news: true } });
    await renderToggle();
    await act(async () => { fireEvent.click(switchEl()); });
    expect(push.updatePreferences).toHaveBeenCalledTimes(1);
    expect(push.updatePreferences).toHaveBeenCalledWith({ push_news: true });
    expect(switchEl().checked).toBe(true);
  });

  it('an existing opt-in shows ON and can be withdrawn', async () => {
    vi.mocked(push.getPreferences).mockResolvedValue({ data: { push_news: true } });
    vi.mocked(push.updatePreferences).mockResolvedValue({ data: { push_news: false } });
    await renderToggle();
    expect(switchEl().checked).toBe(true);
    await act(async () => { fireEvent.click(switchEl()); });
    expect(push.updatePreferences).toHaveBeenCalledWith({ push_news: false });
    expect(switchEl().checked).toBe(false);
  });

  it('a failed save flips back and says so', async () => {
    vi.mocked(push.getPreferences).mockResolvedValue({ data: { push_news: false } });
    vi.mocked(push.updatePreferences).mockRejectedValue(Object.assign(new Error('503'), { response: { status: 503, data: {} } }));
    await renderToggle();
    await act(async () => { fireEvent.click(switchEl()); });
    expect(switchEl().checked).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Einstellung konnte nicht gespeichert werden');
  });

  it('shown but disabled while the value is loading — no layout jump, no blind write', async () => {
    let resolve;
    vi.mocked(push.getPreferences).mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderToggle();
    expect(switchEl().disabled).toBe(true);
    await act(async () => { fireEvent.click(switchEl()); });
    expect(push.updatePreferences).not.toHaveBeenCalled();
    await act(async () => { resolve({ data: { push_news: false } }); });
    expect(switchEl().disabled).toBe(false);
  });

  it.each([
    ['the server cannot store it yet (push_news: null)', () => Promise.resolve({ data: { push_news: null } })],
    ['an older server without the route (404)', () => Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } }))],
  ])('hidden when %s', async (_label, answer) => {
    vi.mocked(push.getPreferences).mockImplementation(answer);
    const { container } = await renderToggle();
    expect(container.innerHTML).toBe('');
  });
});
