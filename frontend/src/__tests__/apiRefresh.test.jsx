import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the axios instance api.js builds so the test can drive its
// response-error interceptor directly (no network, no jsdom navigation).
const { instanceRef } = vi.hoisted(() => ({ instanceRef: {} }));

vi.mock('axios', () => {
  // The instance must be CALLABLE (the interceptor retries via
  // `axiosInstance(config)`) and carry the interceptor registries + verbs.
  const instance = vi.fn(async (config) => ({ config, data: 'retried-ok' }));
  instance.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) instance[m] = vi.fn();
  instanceRef.current = instance;
  return { default: { create: vi.fn(() => instance) } };
});

vi.mock('../i18n', () => ({ default: { language: 'de' } }));

const api = await import('../utils/api');

// The second argument of the response interceptor registration is the error
// handler under test.
const errorHandler = instanceRef.current.interceptors.response.use.mock.calls[0][1];

const make401 = (url = '/groups/1', method = 'get') => ({
  config: { url, method },
  response: { status: 401 },
});

describe('401 refresh-and-retry (audit 2026-09-02, risk #7)', () => {
  beforeEach(() => {
    api.clearMemToken();
    instanceRef.current.post.mockReset();
    instanceRef.current.mockClear();
  });

  it('refreshes once and replays the original request on success', async () => {
    instanceRef.current.post.mockResolvedValue({ data: { token: 'fresh-tok' } });
    const result = await errorHandler(make401());
    expect(instanceRef.current.post).toHaveBeenCalledWith('/auth/refresh', {});
    // The original request was replayed through the instance.
    expect(instanceRef.current).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/groups/1', _retriedAfterRefresh: true })
    );
    expect(result.data).toBe('retried-ok');
  });

  it('is single-flight: N parallel 401s share ONE refresh call', async () => {
    let release;
    instanceRef.current.post.mockReturnValue(
      new Promise((r) => { release = () => r({ data: { token: 'fresh-tok' } }); })
    );
    const p1 = errorHandler(make401('/a'));
    const p2 = errorHandler(make401('/b'));
    const p3 = errorHandler(make401('/c'));
    release();
    await Promise.all([p1, p2, p3]);
    expect(instanceRef.current.post).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a request already retried once rejects instead of refreshing again', async () => {
    instanceRef.current.post.mockResolvedValue({ data: { token: 'fresh-tok' } });
    const err = make401();
    err.config._retriedAfterRefresh = true;
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current.post).not.toHaveBeenCalled();
  });

  it('never tries to rescue an auth attempt (login 401 = wrong password)', async () => {
    const err = { config: { url: '/auth/login', method: 'post' }, response: { status: 401 } };
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current.post).not.toHaveBeenCalled();
  });

  it('falls through to rejection when the refresh itself fails (dead cookie)', async () => {
    instanceRef.current.post.mockRejectedValue({ response: { status: 401 } });
    const err = make401();
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current.post).toHaveBeenCalledTimes(1);
    // No replay happened.
    expect(instanceRef.current).not.toHaveBeenCalled();
  });

  it('never rescues (or logs out) the guest token', async () => {
    api.setMemToken('guest_token');
    const err = make401('/groups/1', 'get'); // safe method → no guest bounce either
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current.post).not.toHaveBeenCalled();
  });
});
