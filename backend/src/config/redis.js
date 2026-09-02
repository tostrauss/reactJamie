import Redis from 'ioredis';

const SHARED_OPTS = {
  connectTimeout: 5000,       // fail fast if Redis is unreachable at boot
  keepAlive: 10000,           // TCP keepalive every 10s — detect dead connections
  retryStrategy: (times) => {
    if (times > 10) return null; // stop retrying after 10 attempts
    return Math.min(times * 200, 3000);
  },
};

// Publisher: fail fast — don't queue commands while disconnected
const makePublisher = () => {
  const c = new Redis(process.env.REDIS_URL, {
    ...SHARED_OPTS,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
  });
  c.on('error', err => console.error('[Redis:pub]', err.message));
  return c;
};

// Subscriber: must stay connected for PubSub — retry indefinitely
const makeSubscriber = () => {
  const c = new Redis(process.env.REDIS_URL, {
    ...SHARED_OPTS,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });
  c.on('error', err => console.error('[Redis:sub]', err.message));
  return c;
};

// Both null when REDIS_URL is absent — callers must null-check
export const redisClient     = process.env.REDIS_URL ? makePublisher()  : null;
export const redisSubscriber = process.env.REDIS_URL ? makeSubscriber() : null;

// Single source of truth for "Redis is load-bearing" (replicas > 1): the boot
// gate, the Sentry warning, and /api/health all key on THIS, so the notions
// can't drift. Tolerant parse — 'true'/'1'/'TRUE' all count, so a slightly-off
// env value can't silently disable the very fail-loud it configures.
export const REDIS_REQUIRED = ['true', '1'].includes((process.env.REQUIRE_REDIS || '').trim().toLowerCase());

if (process.env.REDIS_URL) {
  console.log('[Redis] Connecting to', process.env.REDIS_URL.replace(/:\/\/.*@/, '://***@'));
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[Redis] REDIS_URL not set — Socket.IO and rate limiting will be single-instance only');
}
