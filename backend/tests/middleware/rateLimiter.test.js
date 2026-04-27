import { describe, it, expect, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// No Redis in tests
vi.mock('../../src/config/redis.js', () => ({
  redisClient: null,
  redisSubscriber: null
}));

const { generalLimiter, authLimiter, strictLimiter } = await import('../../src/middleware/rateLimiter.js');

describe('rate limiters', () => {
  it('exports generalLimiter as a function', () => {
    expect(typeof generalLimiter).toBe('function');
  });

  it('exports authLimiter as a function', () => {
    expect(typeof authLimiter).toBe('function');
  });

  it('exports strictLimiter as a function', () => {
    expect(typeof strictLimiter).toBe('function');
  });

  it('falls back to in-memory store when Redis is absent', async () => {
    // Limiter should be callable (not throw) when redisClient is null
    const req = { ip: '127.0.0.1', headers: {}, method: 'GET', url: '/test', path: '/test', query: {} };
    const res = { set: vi.fn(), setHeader: vi.fn(), status: vi.fn(() => res), json: vi.fn(), send: vi.fn(), end: vi.fn(), getHeader: vi.fn() };
    const next = vi.fn();
    await expect(generalLimiter(req, res, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});
