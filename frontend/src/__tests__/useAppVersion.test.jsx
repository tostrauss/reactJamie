import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Settings → Version showed a hard-coded "1.3" on every client; support could
// not tell which iPhone build a tester runs (1.4.1 cannot show chat photos).
vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn(async () => ({ version: '1.4.3', build: '12' })) } }));
const { useAppVersion } = await import('../hooks/useAppVersion');

afterEach(() => { delete window.Capacitor; });

describe('useAppVersion', () => {
  it('native: the binary\'s version and build', async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBeNull(); // pending
    await waitFor(() => expect(result.current).toBe('1.4.3 (12)'));
  });

  it('web / TWA: "Web" — never a made-up number', () => {
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBe('Web');
  });
});
