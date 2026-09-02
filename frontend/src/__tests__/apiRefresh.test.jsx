import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the axios instance api.js builds so the test can drive its
// response-error interceptor and module functions directly (no network).
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

describe('restoreSession single-flight (audit 2026-09-02, risk #7)', () => {
  beforeEach(() => {
    api.clearMemToken();
    instanceRef.current.post.mockReset();
    instanceRef.current.mockClear();
  });

  it('N parallel restores share ONE /auth/refresh POST', async () => {
    let release;
    instanceRef.current.post.mockReturnValue(
      new Promise((r) => { release = () => r({ data: { token: 'fresh-tok' } }); })
    );
    const p1 = api.restoreSession();
    const p2 = api.restoreSession();
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(instanceRef.current.post).toHaveBeenCalledTimes(1);
    expect(instanceRef.current.post).toHaveBeenCalledWith('/auth/refresh', {});
    expect(r1.token).toBe('fresh-tok');
    expect(r2.token).toBe('fresh-tok');
  });

  it('flags unauthorized on 401 but NOT on a network failure', async () => {
    instanceRef.current.post.mockRejectedValueOnce({ response: { status: 401 } });
    expect(await api.restoreSession()).toEqual({ token: null, unauthorized: true });
    instanceRef.current.post.mockRejectedValueOnce(new Error('Network Error'));
    expect(await api.restoreSession()).toEqual({ token: null, unauthorized: false });
  });
});

describe('429 handling (audit risk #11 — no amplification)', () => {
  beforeEach(() => {
    api.clearMemToken();
    instanceRef.current.post.mockReset();
    instanceRef.current.mockClear();
  });

  const make429 = (headers = {}, method = 'get') => ({
    config: { url: '/groups', method },
    response: { status: 429, headers },
  });

  it('retries ONCE when the server sends a small Retry-After (GET only)', async () => {
    const result = await errorHandler(make429({ 'retry-after': '0' }));
    expect(instanceRef.current).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/groups', _retried429: true })
    );
    expect(result.data).toBe('retried-ok');
  });

  it('does NOT retry without Retry-After', async () => {
    const err = make429({});
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current).not.toHaveBeenCalled();
  });

  it('does NOT retry when Retry-After is large (server wants a real backoff)', async () => {
    const err = make429({ 'retry-after': '30' });
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current).not.toHaveBeenCalled();
  });

  it('does NOT retry writes, and never retries twice', async () => {
    const postErr = make429({ 'retry-after': '0' }, 'post');
    await expect(errorHandler(postErr)).rejects.toBe(postErr);

    const again = make429({ 'retry-after': '0' });
    again.config._retried429 = true;
    await expect(errorHandler(again)).rejects.toBe(again);
    expect(instanceRef.current).not.toHaveBeenCalled();
  });
});

describe('401 session expiry (rescue removed — review 2026-09-02)', () => {
  beforeEach(() => {
    api.clearMemToken();
    instanceRef.current.post.mockReset();
    instanceRef.current.mockClear();
  });

  it('an expired-session 401 fires NO refresh (same cookie would 401 too) and clears the token', async () => {
    api.setMemToken('stale-tok');
    const err = { config: { url: '/groups/1', method: 'get' }, response: { status: 401 } };
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current.post).not.toHaveBeenCalled();
    expect(instanceRef.current).not.toHaveBeenCalled();
  });

  it('a login 401 (wrong password) is left entirely alone', async () => {
    const err = { config: { url: '/auth/login', method: 'post' }, response: { status: 401 } };
    await expect(errorHandler(err)).rejects.toBe(err);
    expect(instanceRef.current.post).not.toHaveBeenCalled();
  });
});
