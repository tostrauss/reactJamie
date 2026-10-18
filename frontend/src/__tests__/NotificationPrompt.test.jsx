import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// The start-up half of web push (Lea, 18.10.2026): the daily [push-diag]
// `start` line is read BEFORE the silent repair touches the subscription, and
// a leftover subscription no longer keeps the "Aktivieren" banner away.
const store = vi.hoisted(() => new Map());
vi.mock('../utils/safeStorage', () => {
  const s = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return { safeStorage: s, safeSession: s, default: s };
});
const state = vi.hoisted(() => ({ permission: 'default', supported: true, order: [] }));
vi.mock('../utils/pushNotifications', () => ({
  isPushSupported: () => state.supported,
  getPushPermission: () => state.permission,
  subscribeToPush: vi.fn(async () => true),
  syncPushSubscription: vi.fn(async () => { state.order.push('sync'); return true; }),
  reportPushStartDiagnostics: vi.fn(async () => { state.order.push('start'); }),
}));

const push = await import('../utils/pushNotifications');
const { NotificationPrompt } = await import('../components/NotificationPrompt');

const TITLE = 'Benachrichtigungen aktivieren';
const mountAndSettle = async () => {
  render(<NotificationPrompt />);
  await act(async () => {});                          // the async effect
  act(() => { vi.advanceTimersByTime(3000); });       // the banner's settle delay
};

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  state.permission = 'default';
  state.supported = true;
  state.order = [];
  vi.mocked(push.syncPushSubscription).mockClear();
  vi.mocked(push.reportPushStartDiagnostics).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('NotificationPrompt on app start', () => {
  it("permission 'default' shows the banner — no subscription check can hold it back any more", async () => {
    await mountAndSettle();
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(push.reportPushStartDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("permission 'granted': the start line is taken first, then the silent repair runs, no banner", async () => {
    state.permission = 'granted';
    await mountAndSettle();
    expect(state.order).toEqual(['start', 'sync']);
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("permission 'denied': no banner (WebPushDeniedBanner owns that case)", async () => {
    state.permission = 'denied';
    await mountAndSettle();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(push.syncPushSubscription).not.toHaveBeenCalled();
  });

  it('a browser without push still reports its start, then stays silent', async () => {
    state.supported = false;
    await mountAndSettle();
    expect(push.reportPushStartDiagnostics).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('within the 14-day snooze after „Später" the banner stays away', async () => {
    store.set('jamie_push_prompt_dismissed', String(Date.now() - 864e5));
    await mountAndSettle();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

// Right after a join (or join request) the ask makes sense on its own — it may
// cut the 14-day snooze short, never a "Später" from the last 24 h.
describe('contextual ask after a join', () => {
  const joined = () => act(() => {
    window.dispatchEvent(new Event('jamie:push-prompt-after-join'));
    vi.advanceTimersByTime(1200);
  });

  it('shows the prompt after a join although the 14-day snooze still runs (dismissed 2 days ago)', async () => {
    store.set('jamie_push_prompt_dismissed', String(Date.now() - 2 * 864e5));
    await mountAndSettle();
    expect(screen.queryByText(TITLE)).toBeNull();
    joined();
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  it('not within 24 h of a „Später"', async () => {
    store.set('jamie_push_prompt_dismissed', String(Date.now() - 2 * 60 * 60 * 1000));
    await mountAndSettle();
    joined();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it.each([
    ['granted', true],
    ['denied', true],
    ['default', false],   // no Push API at all
  ])("not when the permission is %s (supported: %s) — only an unanswered one is asked", async (permission, supported) => {
    store.set('jamie_push_prompt_dismissed', String(Date.now() - 2 * 864e5));
    state.permission = permission;
    state.supported = supported;
    await mountAndSettle();
    joined();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
