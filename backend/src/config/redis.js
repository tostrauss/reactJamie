import Redis from 'ioredis';

const makeClient = () => {
  const c = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  c.on('error', err => console.error('[Redis]', err.message));
  return c;
};

// Both undefined when REDIS_URL is absent — callers must null-check
export const redisClient     = process.env.REDIS_URL ? makeClient() : null;
export const redisSubscriber = process.env.REDIS_URL ? makeClient() : null;

if (process.env.REDIS_URL) {
  console.log('[Redis] Connecting to', process.env.REDIS_URL.replace(/:\/\/.*@/, '://***@'));
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[Redis] REDIS_URL not set — Socket.IO and rate limiting will be single-instance only');
}
