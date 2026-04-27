import * as Sentry from '@sentry/node';

export const initSentry = () => {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  });
  console.log('[Sentry] Initialized');
};

export { Sentry };
