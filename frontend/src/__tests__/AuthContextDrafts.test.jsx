import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

// The onboarding draft (birth date, gender, bio, place, answers) used to stay
// in localStorage after logout and after account deletion — on a shared
// device readable by the next person, and outliving the server-side erasure
// (review 11.10.2026). clearAuth now wipes every account's draft.
vi.mock('../utils/api', () => ({
  auth: {
    register: vi.fn(),
    logout: vi.fn(() => Promise.resolve()),
    getProfile: vi.fn(() => Promise.resolve({ data: {} })),
  },
  subscription: { getStatus: vi.fn(() => Promise.resolve({ data: { is_pro: false } })) },
  restoreSession: vi.fn(() => Promise.resolve({ token: null, unauthorized: false })),
  setMemToken: vi.fn(),
  clearMemToken: vi.fn(),
  clearApiCache: vi.fn(),
}));
vi.mock('../utils/pushNotifications', () => ({ unsubscribeFromPush: vi.fn(() => Promise.resolve()) }));

// This test runtime's localStorage is not dependable (see Onboarding.test) —
// a real Storage-shaped shim, since the purge walks key(i)/length itself.
const makeStorage = () => {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
};
const realLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
const ls = makeStorage();
Object.defineProperty(window, 'localStorage', { value: ls, configurable: true });
afterAll(() => {
  if (realLocalStorage) Object.defineProperty(window, 'localStorage', realLocalStorage);
});

const { auth } = await import('../utils/api');
const { AuthContext, AuthProvider } = await import('../context/AuthContext');
const { saveOnboardingDraft, draftKey, clearAllOnboardingDrafts } = await import('../utils/onboardingDraft');

let ctx;
const Probe = () => { ctx = useContext(AuthContext); return null; };
const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  ls.clear();
  vi.mocked(auth.register).mockReset();
});

describe('AuthContext — the onboarding draft does not outlive the session', () => {
  it('logout right after register (first-render user was null) removes the draft', async () => {
    vi.mocked(auth.register).mockResolvedValue({ data: { user: { id: 77, name: 'Neu', onboarding_completed: false }, token: 't' } });
    renderAuth();
    await act(async () => { await ctx.register('neu@x.com', 'Test1!abc', 'Neu', undefined, '1990-01-01', 'female'); });
    saveOnboardingDraft(77, { stepId: 'about', formData: { motivations: ['new_friends'], gender: 'female', date_of_birth: '1990-01-01', bio: 'Hallo' } });
    expect(ls.getItem(draftKey(77))).not.toBeNull();

    await act(async () => { await ctx.logout(); });
    expect(ls.getItem(draftKey(77))).toBeNull();
    expect(ls.getItem('jamie_user')).toBeNull();
  });

  it('also drops drafts other accounts left on the device, and keeps unrelated keys', () => {
    saveOnboardingDraft(1, { stepId: 'goals', formData: {} });
    saveOnboardingDraft(2, { stepId: 'goals', formData: {} });
    saveOnboardingDraft(3, { stepId: 'goals', formData: {} });
    ls.setItem('pwa-install-dismissed', '123');
    clearAllOnboardingDrafts();
    expect([0, 1, 2].map((i) => ls.key(i)).filter(Boolean)).toEqual(['pwa-install-dismissed']);
  });

  it('never throws when storage is denied', () => {
    const denied = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(() => clearAllOnboardingDrafts()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', denied);
    }
  });
});
