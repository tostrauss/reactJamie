// backend/src/server.js
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import db from './config/database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pinoHttp from 'pino-http';
import cron from 'node-cron';
import { initSentry, Sentry } from './config/sentry.js';
import { redisClient, redisSubscriber } from './config/redis.js';
import { createAdapter } from '@socket.io/redis-adapter';
import { generalLimiter, authLimiter } from './middleware/rateLimiter.js';
import { sanitizeInputs } from './middleware/sanitize.js';

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
initSentry(); // Must run before Express setup to capture all errors

// ── Production boot-time env var validation ───────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const REQUIRED = [
    ['JWT_SECRET',        'JWT token signing key'],
    ['DATABASE_URL',      'PostgreSQL connection string'],
    ['EMAIL_FROM',        'verified sender address (e.g. noreply@jamie-app.com)'],
    ['RESEND_API_KEY',    'Resend transactional email API key (used by utils/email.js via api.resend.com)'],
    ['FRONTEND_URL',      'public frontend URL for email links'],
    // Cloud storage — production has no local /uploads serving, so missing keys mean every upload returns a URL that 404s
    ['STORAGE_ENDPOINT',  'Cloudflare R2 / S3 endpoint URL'],
    ['STORAGE_ACCESS_KEY','Cloud storage access key'],
    ['STORAGE_SECRET_KEY','Cloud storage secret key'],
    ['STORAGE_BUCKET',    'Cloud storage bucket name'],
    ['STORAGE_PUBLIC_URL','Public-read base URL for uploaded files'],
    // Web push — missing keys cause sendPushToUser to silently return, so notifications die without warning
    ['VAPID_PUBLIC_KEY',  'Web Push VAPID public key'],
    ['VAPID_PRIVATE_KEY', 'Web Push VAPID private key'],
    // Observability — without DSN, captureException is a no-op and day-1 crashes are invisible
    ['SENTRY_DSN',        'Sentry error reporting DSN'],
  ];

  let fatal = false;

  // Secrets must have sufficient entropy and must not be placeholder values
  for (const key of ['JWT_SECRET']) {
    const val = process.env[key] || '';
    if (val.length < 32) {
      console.error(`FATAL: ${key} is too short (${val.length} chars) — use at least 32 random characters`);
      fatal = true;
    }
    if (val.includes('CHANGE_ME') || val.includes('change_me') || val.includes('your_secret')) {
      console.error(`FATAL: ${key} is still a placeholder — generate a real secret`);
      fatal = true;
    }
  }
  const WARNED = [
    ['SIGHTENGINE_API_USER',   'image moderation (nudity/gore) will be DISABLED'],
    ['SIGHTENGINE_API_SECRET', 'image moderation (nudity/gore) will be DISABLED'],
    ['OPENAI_API_KEY',         'text moderation will be DISABLED — unsafe content may pass through'],
    ['STRIPE_SUBSCRIPTION_WEBHOOK_SECRET', 'Stripe subscription webhook signature validation will FAIL'],
    // Boost credit purchases: without this secret the /api/boost webhook returns
    // 503, so a customer's card IS charged but credits are NEVER applied. Warned
    // (not required) so the app still boots when boosts aren't sold yet.
    ['STRIPE_WEBHOOK_SECRET',  'Boost credit purchases will be CHARGED but never credited — webhook signature validation will FAIL'],
    ['STRIPE_PUBLISHABLE_KEY', 'Stripe checkout cannot render on the client — boost + Pro purchases will be unbuyable'],
    ['GOOGLE_CLIENT_ID',                   'Google OAuth will use unverified userinfo endpoint (reduced security)'],
    // APNs (iOS push) — without these, all iOS Capacitor users get zero push notifications.
    // Listed in WARNED rather than REQUIRED so the backend can still boot before iOS keys are issued.
    ['APNS_KEY_ID',    'iOS push notifications will be DISABLED'],
    ['APNS_TEAM_ID',   'iOS push notifications will be DISABLED'],
    ['APNS_KEY',       'iOS push notifications will be DISABLED'],
    ['APNS_BUNDLE_ID', 'iOS push notifications will be DISABLED'],
  ];
  for (const [key, desc] of REQUIRED) {
    if (!process.env[key]) {
      console.error(`FATAL: Missing required env var ${key} — ${desc}`);
      fatal = true;
    }
  }
  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    console.error('FATAL: DISABLE_RATE_LIMIT must not be set in production');
    fatal = true;
  }

  if (fatal) process.exit(1);

  for (const [key, warn] of WARNED) {
    if (!process.env[key]) {
      console.warn(`WARNING: Missing env var ${key} — ${warn}`);
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy — use real client IP for rate limiting
const server = http.createServer(app);
// Protect against slow-client / Slowloris attacks
server.keepAliveTimeout = 65_000; // 65s — must exceed Railway LB idle timeout (60s)
server.headersTimeout  = 66_000; // 1s > keepAliveTimeout

// ==========================================
// ROUTE IMPORTS
// ==========================================
import authRoutes from './routes/authRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import clubRoutes from './routes/clubRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dmRoutes from './routes/dmRoutes.js';
import friendshipRoutes from './routes/friendshipRoutes.js';
import spotifyRoutes from './routes/spotifyRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import pushRoutes from './routes/pushRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import { subscriptionWebhook } from './controllers/subscriptionController.js';
import { stripeWebhook as boostStripeWebhook } from './controllers/boostController.js';
import { appleServerNotification } from './controllers/iapController.js';
import { sendPushToUser } from './controllers/pushController.js';
import boostRoutes from './routes/boostRoutes.js';
import iapRoutes from './routes/iapRoutes.js';
import mapRoutes from './routes/mapRoutes.js';
import waitlistRoutes from './routes/waitlistRoutes.js';
import dealRoutes from './routes/dealRoutes.js';
import suggestionRoutes from './routes/suggestionRoutes.js';
import featureInterestRoutes from './routes/featureInterestRoutes.js';
import socketHandler from './socket.js';

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// Helmet: security headers (XSS, clickjacking, MIME sniffing, etc.)
const storageOrigin = process.env.STORAGE_PUBLIC_URL || null;
// SOCKET_CSP_ORIGIN: backend public URL used for WebSocket (wss:) in CSP.
// In monorepo deployments (frontend + backend same Railway service) this is the same as FRONTEND_URL.
// Set this env var if Socket.IO connects to a different domain than the frontend.
const socketOrigin = process.env.SOCKET_CSP_ORIGIN || null;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS: tell browsers to ONLY connect via HTTPS for the next year.
  // Only active when NODE_ENV=production so localhost stays usable on http.
  // Without this an attacker on the same network can SSL-strip cookie/JWT.
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  // X-Frame-Options: prevent the app from being iframed (clickjacking).
  // CSP frame-ancestors is also set below as the modern replacement.
  frameguard: { action: 'deny' },
  // Referrer-Policy: don't send the full URL (which may contain ?token=...)
  // to other origins on cross-origin navigations.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        'wss:', 'ws:', // Socket.IO WebSocket — allow any wss: since backend URL varies by deployment
        'https://api.spotify.com',
        'https://accounts.spotify.com',
        'https://api.stripe.com',
        'https://hooks.stripe.com',
        'https://nominatim.openstreetmap.org',
        // Google Maps JS API serves modules + XHR tiles from multiple subdomains
        // (khms*.googleapis.com, maps.googleapis.com, etc.) — wildcard required.
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        'https://*.ggpht.com', // Street View imagery
        'https://images.unsplash.com',
        'https://sentry.io', 'https://*.sentry.io', // Sentry error reporting
        ...(storageOrigin ? [storageOrigin] : []),
        ...(socketOrigin ? [socketOrigin, socketOrigin.replace('https://', 'wss://')] : []),
      ],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://i.scdn.co',
        'https://images.unsplash.com',
        'https://*.tile.openstreetmap.org',
        'https://lh3.googleusercontent.com', // Google profile pictures
        // Map tiles + raster panes come from sharded subdomains
        // (khms*.googleapis.com, mts*.googleapis.com, etc.) — wildcard required.
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        'https://*.ggpht.com',
        ...(storageOrigin ? [storageOrigin] : []),
      ],
      scriptSrc: [
        "'self'",
        "'unsafe-eval'", // required by Google OAuth GSI script + Google Maps internals
        'https://js.stripe.com',
        'https://accounts.google.com',
        'https://appleid.cdn-apple.com',
        'https://*.googleapis.com',
        'https://*.gstatic.com',
      ],
      frameSrc: [
        'https://js.stripe.com',
        'https://hooks.stripe.com',
        'https://accounts.google.com',
        'https://appleid.apple.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      mediaSrc: ["'self'", 'blob:', 'https://p.scdn.co'],
      workerSrc: ["'self'", 'blob:'], // Service worker + Workbox
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  },
}));

// CORS — supports comma-separated FRONTEND_URL for multiple origins (e.g. Vercel + custom domain)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(o => o.trim());

// Native app shells present non-web Origins on cross-origin XHR. CONFIRMED
// via Railway logs from the App Review session (2026-07-06 12:28:30, iPadOS
// 26.5, build 1.0(5)): the reviewer's WKWebView sent
//   Origin: capacitor://app.jamie-app.com
// (scheme falls back to capacitor:// despite iosScheme https on that WebKit),
// the old callback THREW on it → 500 without CORS headers → WebKit blocked
// the response → the app showed the client-generic "Login failed". Older/
// other WebKits may serialize the same origin as "null" or use the default
// capacitor://localhost. These are all OUR OWN clients — CORS is not an auth
// boundary (JWT/httpOnly cookie are), so allow every capacitor:// origin
// plus the known fallbacks explicitly.
const NATIVE_ORIGINS = ['null', 'https://localhost', 'http://localhost'];

const isAllowedOrigin = (origin) =>
  !origin // same-origin requests, curl, server-to-server
  || allowedOrigins.includes(origin)
  || NATIVE_ORIGINS.includes(origin)
  || origin.startsWith('capacitor://'); // Capacitor shell, any hostname/WebKit variant

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    // Deny WITHOUT throwing: a thrown error became a 500 with NO CORS headers,
    // which reads as a network failure in every client. callback(null, false)
    // answers normally but without ACAO — browsers still block cross-origin
    // readers, and we keep a log line to spot new legitimate origins.
    console.warn(`[CORS] denied origin: ${origin}`);
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Compression: gzip responses. Level 3 gives ~80% of level-6 savings at ~40% of the CPU cost.
app.use(compression({ level: 3, threshold: 1024 }));

// Request logging — structured JSON in production, human-readable in dev
app.use(pinoHttp({
  autoLogging: { ignore: req => req.url === '/api/health' },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
}));

// ==========================================
// FRONTEND STATIC SERVING — early, before session/body-parsing
// Static assets (JS/CSS/images) never need a session; serving them here
// avoids session-store errors aborting asset requests in production.
// ==========================================
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.resolve(__dirname, '../public');

  // Explicit handlers for the two .well-known files used for app deep links.
  // express.static guesses Content-Type from extension — apple-app-site-association
  // has no extension, so it gets served as application/octet-stream and Apple's
  // CDN rejects it. assetlinks.json has the right extension but Google requires
  // utf-8 application/json with no transformation.
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.type('application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publicPath, '.well-known', 'apple-app-site-association'));
  });
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.type('application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(publicPath, '.well-known', 'assetlinks.json'));
  });

  app.use(express.static(publicPath, {
    setHeaders(res, filePath) {
      // Vite emits hashed filenames (e.g. index-BdEtbxXM.js) — safe to cache forever
      if (/\.[a-f0-9]{8,}\.(js|css|woff2?)(\?.*)?$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html')) {
        // Always revalidate the entry point so clients pick up new deployments immediately
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('sw.js') || filePath.endsWith('sw.mjs') || filePath.endsWith('manifest.json') || filePath.endsWith('manifest.webmanifest')) {
        // The service worker + manifest must NEVER be served stale: a cached old
        // worker is exactly what strands returning visitors on a broken shell.
        // no-cache forces revalidation on every visit so worker updates (and the
        // skipWaiting fix) propagate on the next load instead of after ~24h.
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  }));
}

// Stripe webhooks — must receive raw body BEFORE express.json() parses it
app.post('/api/subscription/stripe/webhook', express.raw({ type: 'application/json' }), subscriptionWebhook);
app.post('/api/boost/stripe/webhook', express.raw({ type: 'application/json' }), boostStripeWebhook);
// Apple Server Notifications V2 also need the raw body (the payload is itself a JWS).
app.post('/api/iap/apple/notifications', express.raw({ type: 'application/json', limit: '1mb' }), appleServerNotification);

// Body parsing — text/JSON only; image uploads use multipart (multer). 50 kB covers the largest
// legitimate payload (full profile update with photo URLs + interests array = ~10 kB).
app.use(express.json({ limit: '50kb' }));
// extended: false uses the built-in querystring parser — no prototype pollution via nested objects
app.use(express.urlencoded({ extended: false }));

// Parse cookies (required for httpOnly auth_token cookie)
app.use(cookieParser());

// Sanitize all inputs (strip HTML tags from body, query, params)
app.use(sanitizeInputs);

// General rate limit on all API routes — skip health check to avoid Redis overhead on every probe
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return generalLimiter(req, res, next);
});

// Permissions-Policy: restrict browser features this app doesn't use
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(), camera=(), display-capture=(), usb=(), serial=(), battery=()');
  next();
});

// Serve uploaded files statically — dev only (cloud storage is used in production)
if (process.env.NODE_ENV !== 'production') {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));
}

// ==========================================
// API ROUTES — ALL MOUNTED
// ==========================================

// Auth routes with stricter rate limiting
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/friends', friendshipRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/boost', boostRoutes);
app.use('/api/iap', iapRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/feature-interest', featureInterestRoutes);

// Health check — verifies DB + optional services for Railway health probes.
// In production we return ONLY {status} so an attacker can't fingerprint
// our infra topology (which subsystem failed) from a public endpoint.
app.get('/api/health', async (_req, res) => {
  const checks = { db: 'error', redis: 'skipped' };
  let allOk = true;
  try {
    await db.query('SELECT 1');
    checks.db = 'ok';
  } catch {
    allOk = false;
  }
  if (redisClient) {
    try {
      await redisClient.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      allOk = false;
    }
  }
  const status = allOk ? 'ok' : 'degraded';
  if (process.env.NODE_ENV === 'production') {
    return res.status(allOk ? 200 : 503).json({ status });
  }
  res.status(allOk ? 200 : 503).json({ status, ...checks, timestamp: new Date().toISOString() });
});
// HEAD /api/health — for cheap uptime monitors that only care about status code
app.head('/api/health', async (_req, res) => {
  try { await db.query('SELECT 1'); res.status(200).end(); }
  catch { res.status(503).end(); }
});

// .well-known files (assetlinks.json + apple-app-site-association) are served
// as static files from the frontend (frontend/public/.well-known/).
// The backend does not need to handle these routes.

// ==========================================
// SOCKET.IO
// ==========================================
const io = new Server(server, {
  cors: {
    // Same rules as the HTTP CORS above — incl. capacitor:// origins — or
    // the polling transport breaks in the iOS app the same way HTTP did.
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST']
  },
  // Detect dead mobile connections faster: default pingInterval=25s, pingTimeout=20s means
  // a dropped connection occupies a server slot for up to 45s. These values cut that to 15s.
  pingInterval: 10000,
  pingTimeout: 5000,
  // Limit message size — prevents a single client from sending a large payload and
  // hogging memory. 100 kB is more than enough for any chat message or event payload.
  maxHttpBufferSize: 1e5,
});

// Redis adapter for horizontal scaling — no-op when REDIS_URL is absent
if (redisClient && redisSubscriber) {
  io.adapter(createAdapter(redisClient, redisSubscriber));
  console.log('[Socket.IO] Redis adapter enabled');
}

// Initialize Socket logic
socketHandler(io);

// Make io accessible to controllers (for realtime notifications)
app.set('io', io);

// ==========================================
// ERROR HANDLING
// ==========================================
Sentry.setupExpressErrorHandler(app);

app.use((err, _req, res, _next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

// API 404 — fires for all unmatched /api/* routes (must be before the SPA fallback)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// SPA fallback — serves index.html for all non-API GET routes (React Router).
// Placed AFTER the API 404 handler so unknown API GETs return JSON, not HTML.
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.resolve(__dirname, '../public');
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await Promise.all([
        redisClient?.quit().catch(() => {}),
        redisSubscriber?.quit().catch(() => {}),
      ]);
    } catch { /* ignore */ }
    db.pool.end(() => {
      console.log('Database pool closed.');
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch-all safety nets — report to Sentry so day-1 crashes aren't invisible
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
  try {
    Sentry?.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
      tags: { source: 'unhandledRejection' },
    });
  } catch { /* never let the reporter itself crash the process */ }
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception — shutting down:', error);
  try {
    Sentry?.captureException(error, { tags: { source: 'uncaughtException' } });
    // Block briefly so the event flushes before the process exits
    await Sentry?.flush?.(2000);
  } catch { /* ignore */ }
  gracefulShutdown('uncaughtException');
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5000; // 5000 in dev so Vite dev server can use 3000 (see vite.config.js proxy)

// Helper: run a single migration step, log and continue on error
const migrate = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`⚠️ Migration "${label}" failed: ${err.message}`);
  }
};

const runStartupMigrations = async () => {
  // Wait up to 90s for DB to be reachable before running migrations.
  // Railway Postgres can take 60-75s to accept connections on a cold start.
  for (let attempt = 1; attempt <= 18; attempt++) {
    try {
      await db.query('SELECT 1');
      break;
    } catch {
      if (attempt === 18) {
        console.error('⚠️ DB not reachable after 90s — startup migrations skipped');
        return;
      }
      console.log(`[migrations] Waiting for DB... (${attempt}/18)`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Each block runs independently — a failing index never skips a critical table.

  // ── Critical app tables ────────────────────────────────────────────────────
  await migrate('email_verification_codes', () => db.query(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) NOT NULL,
      code       VARCHAR(6)   NOT NULL,
      expires_at TIMESTAMPTZ  NOT NULL,
      used       BOOLEAN      DEFAULT FALSE,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )`));
  await migrate('idx_evc_email', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email)`));
  await migrate('email_verification_codes attempts col', () =>
    db.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`));
  // Binds a successful OTP verification to a subsequent /register call. Without this,
  // the OTP step lives only on the frontend and /api/auth/register can be called
  // directly with any email, enabling account-squatting against waitlisted users.
  await migrate('email_verification_codes verified_at col', () =>
    db.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`));

  // Case-insensitive email uniqueness. The base schema has UNIQUE(email)
  // which is case-sensitive — so "User@x.com" and "user@x.com" could
  // create separate accounts. This expression index enforces normalization
  // at the DB layer regardless of code path.
  await migrate('users LOWER(email) unique', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`));

  // Trigram indexes so the admin user search (name / email / location ILIKE
  // '%term%') uses an index instead of a full table scan as the user base
  // grows. One GIN index per column matches each ILIKE predicate; the planner
  // BitmapOrs them. pg_trgm is a trusted extension (installable without
  // superuser on PG13+). All wrapped in migrate() so a permissions failure on
  // a locked-down host degrades to a seq scan rather than blocking boot.
  await migrate('pg_trgm extension', () =>
    db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`));
  await migrate('idx_users_name_trgm', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_users_name_trgm ON users USING gin (name gin_trgm_ops)`));
  await migrate('idx_users_email_trgm', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops)`));
  await migrate('idx_users_location_trgm', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_users_location_trgm ON users USING gin (location gin_trgm_ops)`));

  // Public likes on Hall-of-Fame "moment" posts. One row per (group, user);
  // the poster (group owner) gets a push on each new like and the count shows
  // on the card. Kept separate from group_favorites (private bookmarks).
  await migrate('event_likes', () => db.query(`
    CREATE TABLE IF NOT EXISTS event_likes (
      group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    )`));
  await migrate('idx_event_likes_group', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_event_likes_group ON event_likes(group_id)`));

  // Pin name length at the DB layer too — the base schema declared
  // VARCHAR with no limit (unbounded), so a single user could push
  // a megabyte-long name through that bypassed app-layer validation.
  await migrate('users name length cap', () =>
    db.query(`ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(100)`).catch(() => null));

  // CHECK constraint on groups.type so the enum can't be bypassed.
  await migrate('chk_groups_type', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_type
        CHECK (type IN ('group','club','event'));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`));

  // Multi-category: a club/group can belong to several (sub)categories. The
  // singular `category` stays the PRIMARY (= categories[0]) so all existing
  // single-category display + filter code keeps working unchanged; `categories`
  // holds the full set for OR-match discovery.
  await migrate('groups.categories', () =>
    db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS categories text[]`));

  // Lat/lng must be within valid earth bounds. Without this, app-layer
  // validation can be bypassed by any insert path that forgets to call
  // the validator, and a row with lat=999 silently breaks Haversine.
  await migrate('chk_groups_lat_lng', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_lat_range
        CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`).then(() => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_lng_range
        CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`)));

  // max_members must be sane. A group of 0 or negative members is broken;
  // 10_000 is more than any real social meetup.
  await migrate('chk_groups_max_members', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_max_members
        CHECK (max_members IS NULL OR (max_members BETWEEN 1 AND 10000));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`));

  // Each user owns exactly one referral code. Without this unique index
  // an ON CONFLICT DO NOTHING insert path can silently produce multiple
  // codes per user, splitting their referral count across rows.
  await migrate('referral_codes user_id unique', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_user_unique ON referral_codes(user_id)`));

  // Country votes ledger so we can deduplicate per (email, country).
  // Without this, joinWaitlist double-counts on every re-submission.
  await migrate('waitlist_votes ledger', async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS waitlist_votes (
      email   VARCHAR(255) NOT NULL,
      country VARCHAR(10)  NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (email, country)
    )`);
  });

  await migrate('analytics_events', () => db.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id          BIGSERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type  VARCHAR(50)  NOT NULL,
      screen_name VARCHAR(120),
      duration_ms INTEGER,
      metadata    JSONB,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_analytics_*', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_user    ON analytics_events(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_type    ON analytics_events(event_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_screen  ON analytics_events(screen_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC)`);
  });
  // subject_id: nullable FK-ish reference to whatever the screen is "about"
  // (e.g. the group/club id for ClubDetail/GroupDetail). Lets the admin
  // dashboard answer "which specific club is viewed most?" instead of just
  // "how many ClubDetail views total". Plain INTEGER (no FK) so analytics
  // survive group deletion.
  await migrate('analytics_subject_id', async () => {
    await db.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS subject_id INTEGER`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_subject ON analytics_events(screen_name, subject_id) WHERE subject_id IS NOT NULL`);
  });

  await migrate('category_suggestions', () => db.query(`
    CREATE TABLE IF NOT EXISTS category_suggestions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      suggestion  TEXT NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

  await migrate('event_reviews', () => db.query(`
    CREATE TABLE IF NOT EXISTS event_reviews (
      id               SERIAL PRIMARY KEY,
      group_id         INTEGER NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
      reviewer_id      INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      reviewed_user_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      was_present      BOOLEAN NOT NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, reviewer_id, reviewed_user_id)
    )`));
  await migrate('idx_event_reviews_*', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_event_reviews_group    ON event_reviews(group_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_event_reviews_reviewed ON event_reviews(reviewed_user_id)`);
  });

  await migrate('users trusted cols', async () => {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_trusted_user BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_count   INTEGER NOT NULL DEFAULT 0`);
  });
  // Per-member chat read marker — unread counts for group/club chats are
  // COUNT(non-system messages newer than COALESCE(last_read_at, joined_at)).
  // DEFAULT NOW() is load-bearing twice: (1) Postgres fills EXISTING rows with
  // the default at ALTER time, so the deploy moment counts as "all read" —
  // without it every long-standing group would flood members with their
  // entire message history as unread; (2) new members start stamped at join
  // time, matching the joined_at fallback.
  await migrate('group_members last_read_at', () =>
    db.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP DEFAULT NOW()`));
  // Per-user "hide chat" flag for group/club chats (mirrors dm_conversations.is_archived
  // for DMs). The chat list moves archived rows into the "Ausgeblendet" section.
  await migrate('group_members archived', () =>
    db.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`));
  await migrate('users google_id col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`));
  await migrate('users apple_id col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id TEXT UNIQUE`));
  await migrate('groups lat/lng cols', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_lat_lng ON groups(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL`);
  });

  // ── Geofencing & pioneer system ────────────────────────────────────────────
  await migrate('waitlist', () => db.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE,
      country VARCHAR(10), ip VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`));
  await migrate('idx_waitlist_country', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist(country)`));
  await migrate('country_votes', () =>
    db.query(`CREATE TABLE IF NOT EXISTS country_votes (country VARCHAR(10) PRIMARY KEY, votes INTEGER NOT NULL DEFAULT 0)`));
  await migrate('users pioneer/admin cols', async () => {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pioneer BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin   BOOLEAN NOT NULL DEFAULT FALSE`);
  });
  await migrate('pioneer_claims', () => db.query(`
    CREATE TABLE IF NOT EXISTS pioneer_claims (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      lat_cell NUMERIC(6,2) NOT NULL, lng_cell NUMERIC(6,2) NOT NULL,
      claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lat_cell, lng_cell))`));
  await migrate('idx_pioneer_claims_cell', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_pioneer_claims_cell ON pioneer_claims(lat_cell, lng_cell)`));

  // ── Schema additions ───────────────────────────────────────────────────────
  await migrate('users.last_seen col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`));
  // Pinnwand = separate Pinterest-style gallery, distinct from the profile
  // carousel `photos`. JSON array of image URLs.
  await migrate('users.pinnwand col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pinnwand JSONB NOT NULL DEFAULT '[]'::jsonb`));
  await migrate('groups.deleted_at', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_deleted_at ON groups(deleted_at) WHERE deleted_at IS NULL`);
  });
  await migrate('groups.parent_club_id', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS parent_club_id INTEGER REFERENCES groups(id) ON DELETE CASCADE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_parent_club ON groups(parent_club_id) WHERE parent_club_id IS NOT NULL`);
  });
  // Approval workflow for user-created clubs.
  // Default 'approved' so existing rows + Admin/seed creates stay visible.
  // createClub flips to 'pending' for non-admin owners; admins can then
  // approve/reject via /api/admin/clubs/*.
  await migrate('groups.approval_status', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_approval_status ON groups(approval_status) WHERE type = 'club'`);
    await db.query(`DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_approval_status
        CHECK (approval_status IN ('approved','pending','rejected'));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`);
  });
  await migrate('friendships.expires_at', async () => {
    await db.query(`ALTER TABLE friendships ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_friendships_expires ON friendships(expires_at) WHERE status = 'pending'`);
  });

  // ── Deals table ────────────────────────────────────────────────────────────
  await migrate('deals', () => db.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      category     VARCHAR(100) NOT NULL DEFAULT 'Lokal',
      deal_label   VARCHAR(100) NOT NULL,
      description  TEXT,
      address      VARCHAR(255),
      lat          DOUBLE PRECISION,
      lng          DOUBLE PRECISION,
      photos       JSONB NOT NULL DEFAULT '[]',
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('deals indexes', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_deals_active ON deals(is_active) WHERE is_active = TRUE`);
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS booking_url TEXT`);
  });
  // Cooperation deals: admin sets "Sichtbar bis" so promos expire automatically.
  // NULL = no expiry. Filtered server-side; client never needs to check.
  await migrate('deals.visible_until', async () => {
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS visible_until TIMESTAMP`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_deals_visible_until ON deals(visible_until) WHERE is_active = TRUE`);
  });

  // Global redemption cap: once this many distinct users have redeemed a deal it
  // auto-goes-offline (dropped from the public feed + no further redemptions) —
  // Robert (2026-06-17): "nach 100 Leuten nehmen wir den deal offline". DEFAULT 100
  // applies the rule to all deals (incl. existing rows); admins can raise it or set
  // NULL for unlimited per deal. Per-user cap (1) is separate, see dealController.
  await migrate('deals.max_redemptions', async () => {
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS max_redemptions INTEGER DEFAULT 100`);
  });

  // Recurring deals: a perk can be redeemable once per day / week instead of
  // once-ever — e.g. SOHO's "Welcome Shot jeden Donnerstag". redeem_interval
  // ('once' | 'daily' | 'weekly') drives a period_key on each redemption; the
  // UNIQUE(deal_id, user_id, period_key) then enforces "once per period"
  // atomically (replaces the old once-ever UNIQUE(deal_id, user_id)).
  await migrate('deals.redeem_interval', () =>
    db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS redeem_interval TEXT NOT NULL DEFAULT 'once'`));
  await migrate('deal_redemptions.period_key', async () => {
    await db.query(`ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS period_key TEXT NOT NULL DEFAULT 'once'`);
    // Drop the once-ever uniqueness (auto-named by Postgres) and replace it with
    // a per-period one. Existing rows all carry period_key='once', so they map
    // 1:1 onto the new index without conflict.
    await db.query(`ALTER TABLE deal_redemptions DROP CONSTRAINT IF EXISTS deal_redemptions_deal_id_user_id_key`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS deal_redemptions_period_uq
                    ON deal_redemptions (deal_id, user_id, period_key)`);
  });

  // Weekday-restricted deals: a bar can limit redemption to specific weekdays
  // (e.g. "nur donnerstags"). redeem_days holds ISO weekday numbers (1=Mon …
  // 7=Sun); NULL/empty = any day. Redemption is gated server-side; the client
  // disables the button + labels it on other days.
  await migrate('deals.redeem_days', () =>
    db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS redeem_days INTEGER[]`));

  // ── Subscriptions table (Stripe Pro) ─────────────────────────────────────────
  await migrate('subscriptions', () => db.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                     SERIAL PRIMARY KEY,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT UNIQUE,
      status                 TEXT NOT NULL DEFAULT 'pending',
      current_period_end     TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
  await migrate('idx_subscriptions_user', () =>
    db.query(`CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id)`));

  // ── Boost & Referral system ────────────────────────────────────────────────
  // Folded from boost_migration.sql so fresh Railway deploys self-bootstrap
  // these tables. Without this, register() crashes on INSERT INTO boost_credits.
  await migrate('referral_codes', () => db.query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code       VARCHAR(20) NOT NULL UNIQUE,
      used_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_referral_codes', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code)`);
  });
  await migrate('boost_credits', () => db.query(`
    CREATE TABLE IF NOT EXISTS boost_credits (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      credits       INTEGER NOT NULL DEFAULT 0,
      total_earned  INTEGER NOT NULL DEFAULT 0
    )`));
  await migrate('boosts', () => db.query(`
    CREATE TABLE IF NOT EXISTS boosts (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type   VARCHAR(10) NOT NULL CHECK (target_type IN ('group', 'club')),
      target_id     INTEGER NOT NULL,
      credits_spent INTEGER NOT NULL DEFAULT 1,
      boosted_until TIMESTAMP NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_boosts_target', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_boosts_target ON boosts(target_type, target_id)`));
  await migrate('boost_transactions', () => db.query(`
    CREATE TABLE IF NOT EXISTS boost_transactions (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credits          INTEGER NOT NULL,
      amount_cents     INTEGER NOT NULL,
      currency         VARCHAR(3) NOT NULL DEFAULT 'EUR',
      payment_provider VARCHAR(20),
      payment_id       TEXT,
      status           VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_boost_txn_payment_id', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_boost_txn_payment_id ON boost_transactions(payment_id) WHERE payment_id IS NOT NULL`));

  // ── Push subscriptions (web-push VAPID + APNs) ────────────────────────────
  // Folded from push_subscriptions_migration.sql.
  await migrate('push_subscriptions', () => db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform     VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'apns')),
      endpoint     TEXT,
      p256dh       TEXT,
      auth_key     TEXT,
      device_token TEXT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, endpoint),
      UNIQUE(user_id, device_token)
    )`));
  await migrate('idx_push_subscriptions_user', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`));

  // ── Reports / Content Moderation ──────────────────────────────────────────
  // Folded from reports_migration.sql.
  await migrate('reports', () => db.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id              SERIAL PRIMARY KEY,
      reporter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_type   VARCHAR(20) NOT NULL CHECK (reported_type IN ('user', 'group', 'message')),
      reported_id     INTEGER NOT NULL,
      reason          VARCHAR(50) NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'harassment', 'fake', 'other')),
      details         TEXT,
      status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at     TIMESTAMP,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reporter_id, reported_type, reported_id)
    )`));
  await migrate('idx_reports', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status, created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_type, reported_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id)`);
  });

  // ── Password reset tokens table ───────────────────────────────────────────
  await migrate('password_reset_tokens', () => db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used       BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

  // ── Performance indexes ────────────────────────────────────────────────────
  await migrate('performance indexes', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_is_active     ON groups(is_active) WHERE is_active = TRUE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_members_user   ON group_members(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_members_group  ON group_members(group_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_messages_group       ON messages(group_id, created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prt_token            ON password_reset_tokens(token)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prt_expires          ON password_reset_tokens(expires_at) WHERE used = FALSE`);
  });
  // ── Index hygiene + preview-ordering index ─────────────────────────────────
  // schema.sql (the production bootstrap) and the 'performance indexes' block
  // above both create overlapping indexes on the hottest WRITE tables, so every
  // INSERT maintained 3 indexes where 1 suffices. Drop the duplicates/redundant
  // prefixes and add idx_gm_group_joined so the member-preview subqueries
  // (ORDER BY joined_at LIMIT 3/4) stop early instead of scan+sort.
  await migrate('index dedup 2026-06', async () => {
    // messages: keep idx_msg_group_created(group_id, created_at DESC); the other
    // two are an exact dup and a redundant (group_id) prefix.
    await db.query(`DROP INDEX IF EXISTS idx_messages_group`);
    await db.query(`DROP INDEX IF EXISTS idx_msg_group`);
    // group_members: PK is (group_id, user_id) and the new joined index covers
    // group_id-prefix lookups; keep idx_gm_user for the user_id direction only.
    await db.query(`DROP INDEX IF EXISTS idx_group_members_user`);
    await db.query(`DROP INDEX IF EXISTS idx_group_members_group`);
    await db.query(`DROP INDEX IF EXISTS idx_gm_group`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gm_group_joined ON group_members(group_id, joined_at)`);
    // groups: idx_groups_is_active (partial) + idx_groups_type_active cover
    // these; the bare (is_active) and (type) indexes are redundant.
    await db.query(`DROP INDEX IF EXISTS idx_groups_active`);
    await db.query(`DROP INDEX IF EXISTS idx_groups_type`);
  });
  // ── Hot-path join/favorites/waitlist indexes ──────────────────────────────
  // Every group detail page fires 3+ lookups against these tables. Without
  // composite indexes they are sequential scans even on small tables.
  await migrate('idx_hot_path_tables', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gjr_group_user   ON group_join_requests(group_id, user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gjr_pending       ON group_join_requests(group_id, status) WHERE status = 'pending'`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gfav_group_user  ON group_favorites(group_id, user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gwl_group_user   ON group_waitlist(group_id, user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gwl_waiting       ON group_waitlist(group_id, position) WHERE status = 'waiting'`);
  });
  // ── Friendship query indexes ───────────────────────────────────────────────
  // OR-condition friend lookups (requester OR addressee) use these independently.
  await migrate('idx_friendships_directional', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_fs_requester_status  ON friendships(requester_id, status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_fs_addressee_status  ON friendships(addressee_id, status)`);
  });
  // The only uniqueness was directional UNIQUE(requester_id, addressee_id), so a
  // symmetric race (A→B and B→A at once) could create two rows for one pair.
  // Dedupe any existing unordered-pair duplicates (keep the earliest id), then
  // add a normalized unique index so the reverse direction collides at the DB.
  await migrate('uniq_friend_pair', async () => {
    await db.query(`
      DELETE FROM friendships f
      USING friendships f2
      WHERE f.id > f2.id
        AND LEAST(f.requester_id, f.addressee_id)    = LEAST(f2.requester_id, f2.addressee_id)
        AND GREATEST(f.requester_id, f.addressee_id) = GREATEST(f2.requester_id, f2.addressee_id)`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_friend_pair
      ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))`);
  });
  await migrate('groups.chat_only_owner', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_only_owner BOOLEAN DEFAULT FALSE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_chat_only_owner ON groups(chat_only_owner) WHERE chat_only_owner = TRUE`);
  });
  await migrate('groups.events_owner_only', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS events_owner_only BOOLEAN DEFAULT FALSE`);
  });
  // Tina's call (2026-06-09): default Clubs to "only founder creates events"
  // — most clubs in DACH are operator-led, so the default should match the
  // common case. Existing rows are NOT migrated: that's an explicit choice by
  // each existing owner. Only the column default + new INSERTs change.
  await migrate('groups.events_owner_only default true', async () => {
    await db.query(`ALTER TABLE groups ALTER COLUMN events_owner_only SET DEFAULT TRUE`);
  });
  // Target audience age range. NULL on both sides means "no restriction"
  // (group is visible to everyone), which matches the existing default.
  // "JAMIE Moment" photo: a post-event picture uploaded by the owner from the
  // Hall of Fame page. Decoupled from `image_url` (the pre-event cover) so we
  // can show the planned image until the owner replaces it with the real
  // moment afterwards. Hall of Fame renders moment_photo_url ?? image_url.
  await migrate('groups.moment_photo_url', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS moment_photo_url TEXT`);
  });
  // Timestamp the moment-prompt push so the cron only fires once per event.
  // Stays NULL until the cron sends, then gates re-sends forever (even if the
  // owner later uploads + deletes their moment photo).
  await migrate('groups.moment_prompt_sent_at', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS moment_prompt_sent_at TIMESTAMPTZ`);
  });

  // Weekly recurring events for groups (type='group'). NULL/FALSE = one-off.
  // The `date` column stays as the *first* occurrence; the frontend computes
  // the next occurrence (date + N*7 days) when displaying / exporting to
  // calendar. We deliberately do NOT pre-generate child rows: one weekly
  // event for 5 years would be 260 rows per series, and any change to the
  // start time would fan out to every child. A flag + helper keeps it cheap.
  await migrate('groups.is_recurring_weekly', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_recurring_weekly BOOLEAN NOT NULL DEFAULT FALSE`);
  });

  await migrate('groups.target_age_min_max', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS target_age_min INTEGER`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS target_age_max INTEGER`);
    // Postgres has no IF NOT EXISTS for table constraints, so wrap each ADD
    // CONSTRAINT in a DO block that swallows duplicate_object errors.
    await db.query(`DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_target_age_range
        CHECK (target_age_min IS NULL OR target_age_min BETWEEN 14 AND 99);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
    await db.query(`DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_target_age_min_max
        CHECK (target_age_min IS NULL OR target_age_max IS NULL OR target_age_min <= target_age_max);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
  });
  // Direct messaging tables were only defined in seed schema.sql, so any DB
  // bootstrapped without that seed (e.g. fresh Railway plugin instance) blew up
  // with "relation does not exist" on every DM read/write. These idempotent
  // CREATEs make sure the tables show up on first server start.
  await migrate('direct_messages table', async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id                  SERIAL PRIMARY KEY,
        sender_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content             TEXT NOT NULL,
        message_type        VARCHAR(20) DEFAULT 'text',
        is_read             BOOLEAN DEFAULT FALSE,
        is_deleted_sender   BOOLEAN DEFAULT FALSE,
        is_deleted_receiver BOOLEAN DEFAULT FALSE,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(receiver_id, is_read) WHERE is_read = FALSE`);
  });
  await migrate('dm_conversations table', async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS dm_conversations (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        other_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_message_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL,
        last_message_at TIMESTAMP,
        unread_count    INTEGER DEFAULT 0,
        is_archived     BOOLEAN DEFAULT FALSE,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, other_user_id)
      )
    `);
    // getConversations does WHERE user_id = $1 ORDER BY updated_at DESC. The
    // intended composite was historically created as `idx_dmc_user`, which
    // collides with schema.sql's idx_dmc_user(user_id) — IF NOT EXISTS then
    // silently skipped it, so the ORDER BY fell back to a sort. Recreate under
    // a distinct name (table is guaranteed to exist at this point).
    await db.query(`DROP INDEX IF EXISTS idx_dmc_user`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dmc_user_updated ON dm_conversations(user_id, updated_at DESC)`);
  });
  await migrate('idx_groups_category_lower', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_groups_category_lower ON groups(LOWER(category))`));
  await migrate('idx_groups_feed + map', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_feed ON groups(type, created_at DESC) WHERE is_active = TRUE AND deleted_at IS NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_map  ON groups(type, category, created_at DESC) WHERE is_active = TRUE AND deleted_at IS NULL AND lat IS NOT NULL AND lng IS NOT NULL`);
  });
  // Discover-events feed: lets Postgres walk upcoming events in date order and
  // stop at LIMIT 60 without sorting the whole events set (clubController.getDiscoverEvents).
  await migrate('idx_groups_event_date', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_groups_event_date ON groups(date) WHERE type = 'event' AND is_active = TRUE AND deleted_at IS NULL`));

  // ── Full-text search (requires pg_trgm extension) ─────────────────────────
  await migrate('pg_trgm + gin indexes', async () => {
    await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_name_gin     ON groups USING gin(name gin_trgm_ops)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_desc_gin     ON groups USING gin(description gin_trgm_ops)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_location_gin ON groups USING gin(location gin_trgm_ops)`);
  });

  // ── DB-level CHECK constraints ─────────────────────────────────────────────
  await migrate('chk_friendship_status', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE friendships ADD CONSTRAINT chk_friendship_status
        CHECK (status IN ('pending','accepted','blocked'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`));
  // Fix: original constraint was missing 'rejected' and 'expired', breaking respondFriendRequest and the nightly cron
  await migrate('chk_friendship_status_v2', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE friendships DROP CONSTRAINT IF EXISTS chk_friendship_status;
      ALTER TABLE friendships ADD CONSTRAINT chk_friendship_status
        CHECK (status IN ('pending','accepted','blocked','rejected','expired'));
    END $$`));
  await migrate('chk_gm_role', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE group_members ADD CONSTRAINT chk_gm_role
        CHECK (role IN ('owner','admin','member'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`));

  // ── IAP receipt ledger ────────────────────────────────────────────────────
  // Folded from iap_migration.sql so fresh Railway deploys self-bootstrap
  // without an extra manual step.
  await migrate('iap_receipts', () => db.query(`
    CREATE TABLE IF NOT EXISTS iap_receipts (
      id                BIGSERIAL PRIMARY KEY,
      user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform          TEXT   NOT NULL CHECK (platform IN ('apple', 'google')),
      product_id        TEXT   NOT NULL,
      product_type      TEXT   NOT NULL CHECK (product_type IN ('boost', 'subscription')),
      transaction_id    TEXT   NOT NULL,
      original_transaction_id TEXT,
      environment       TEXT,
      raw_receipt       TEXT NOT NULL,
      payload           JSONB NOT NULL,
      credited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at        TIMESTAMPTZ
    )`));
  await migrate('idx_iap_receipts', async () => {
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS iap_receipts_platform_txid_idx ON iap_receipts (platform, transaction_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS iap_receipts_user_idx           ON iap_receipts (user_id, product_type, credited_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS iap_receipts_origtx_idx         ON iap_receipts (original_transaction_id) WHERE original_transaction_id IS NOT NULL`);
  });

  // ── Deal redemption ledger ───────────────────────────────────────────────
  // Folded from deal_redemptions_migration.sql so fresh Railway deploys
  // self-bootstrap. UNIQUE (deal_id, user_id) enforces the "once per user"
  // cap at the DB level — even a parallel double-tap can't sneak two rows in.
  await migrate('deal_redemptions', () => db.query(`
    CREATE TABLE IF NOT EXISTS deal_redemptions (
      id          BIGSERIAL PRIMARY KEY,
      deal_id     BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (deal_id, user_id)
    )`));
  await migrate('idx_deal_redemptions', () => db.query(
    `CREATE INDEX IF NOT EXISTS deal_redemptions_user_idx ON deal_redemptions (user_id, redeemed_at DESC)`
  ));

  // ── Coming-soon interest signals ──────────────────────────────────────────
  // "Benachrichtige mich" on not-yet-launched features (Pro / buyable Boosts).
  // One row per (user, feature); UNIQUE makes repeat taps idempotent. Lets us
  // notify + optionally discount exactly the interested users at launch.
  await migrate('feature_interest', async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS feature_interest (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        feature    VARCHAR(30) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, feature)
      )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_feature_interest_feature ON feature_interest(feature, created_at DESC)`);
  });

  // ── Profile-completion trigger: drop the unfillable pinterest_url field ────
  // The original trigger counted 10 fields incl. pinterest_url, which has no UI
  // to set it — so a fully completed profile maxed out at 90%. Redefine the
  // function over the 9 reachable fields, then fire a no-op UPDATE so existing
  // rows recompute immediately (BEFORE UPDATE triggers run on every UPDATE).
  await migrate('profile_completion drops pinterest_url', async () => {
    await db.query(`
      CREATE OR REPLACE FUNCTION calculate_profile_completion()
      RETURNS TRIGGER AS $$
      DECLARE
          total_fields INTEGER := 9;
          filled INTEGER := 0;
      BEGIN
          IF NEW.name IS NOT NULL AND NEW.name <> '' THEN filled := filled + 1; END IF;
          IF NEW.gender IS NOT NULL THEN filled := filled + 1; END IF;
          IF NEW.date_of_birth IS NOT NULL THEN filled := filled + 1; END IF;
          IF NEW.bio IS NOT NULL AND NEW.bio <> '' THEN filled := filled + 1; END IF;
          IF NEW.location IS NOT NULL AND NEW.location <> '' THEN filled := filled + 1; END IF;
          IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url <> '' THEN filled := filled + 1; END IF;
          IF NEW.photos IS NOT NULL AND jsonb_array_length(NEW.photos) > 0 THEN filled := filled + 1; END IF;
          IF NEW.interests IS NOT NULL AND jsonb_array_length(NEW.interests) > 0 THEN filled := filled + 1; END IF;
          IF NEW.favorite_song IS NOT NULL THEN filled := filled + 1; END IF;
          NEW.profile_completion := (filled * 100) / total_fields;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    // Recompute every existing row under the new formula (fires the trigger).
    await db.query(`UPDATE users SET updated_at = NOW() WHERE profile_completion <> 100`);
  });

  console.log('✅ Startup migrations done');
};

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Socket.io ready`);
  // Warm up DB pool — acquires one connection so the first real request isn't the cold-start
  db.query('SELECT 1').catch(() => {});
  await runStartupMigrations();
});

// Self-ping every 14 minutes — prevents Railway from sleeping the container
// (Railway free tier idles after ~30 min without traffic)
if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL) {
  const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/health`
    : null;
  if (selfUrl) {
    cron.schedule('*/14 * * * *', () => {
      fetch(selfUrl).catch(() => {});
    });
  }
}

// Analytics retention: purge events older than 90 days, runs every day at 03:00
cron.schedule('0 3 * * *', async () => {
  try {
    const result = await db.query(
      `DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '90 days'`
    );
    console.log(`[cron] analytics_events purged: ${result.rowCount} rows deleted`);
  } catch (err) {
    console.error('[cron] analytics purge failed:', err.message);
  }
});

// JAMIE Moment push prompt: every 15 min, claim past events whose owner
// hasn't uploaded a moment photo yet and send them a one-shot reminder.
//
// Window: 2 h ≤ now − date ≤ 24 h
//   • For timed events (e.g. 18:00 start): fires 2h after — they're 1h into
//     the second drink, perfect "share your moment" timing.
//   • For date-only events (stored at midnight): fires later in the day; if
//     that falls into night, the OS quiet-hours handling defers delivery.
//
// Atomic UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) claims
// the rows so two Railway instances never fire the same push. The
// moment_prompt_sent_at flag stays set forever once written — even if the
// owner uploads + deletes, we never re-spam.
cron.schedule('*/15 * * * *', async () => {
  try {
    const claimed = await db.query(`
      UPDATE groups
      SET moment_prompt_sent_at = NOW()
      WHERE id IN (
        SELECT id FROM groups
        WHERE type = 'group'
          AND date IS NOT NULL
          AND moment_photo_url IS NULL
          AND moment_prompt_sent_at IS NULL
          AND deleted_at IS NULL
          AND date + INTERVAL '2 hours' <= NOW()
          AND date + INTERVAL '24 hours' >= NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT 200
      )
      RETURNING id, owner_id, name
    `);
    for (const ev of claimed.rows) {
      try {
        await sendPushToUser(
          ev.owner_id,
          '📸 Teile deinen JAMIE Moment',
          `Wie war ${ev.name}? Lade jetzt dein Erinnerungsfoto hoch und hol's in die Hall of Fame.`,
          '/explore',
        );
      } catch (err) {
        console.error(`[cron] moment push failed for group ${ev.id}:`, err.message);
      }
    }
    if (claimed.rowCount > 0) {
      console.log(`[cron] moment prompts sent: ${claimed.rowCount}`);
    }
  } catch (err) {
    console.error('[cron] moment prompt cron failed:', err.message);
  }
});

// Friend request expiration: auto-reject pending requests older than 30 days, runs at 04:00
cron.schedule('0 4 * * *', async () => {
  try {
    const result = await db.query(
      `UPDATE friendships SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
    if (result.rowCount > 0) {
      console.log(`[cron] friendships expired: ${result.rowCount} requests auto-rejected`);
    }
  } catch (err) {
    console.error('[cron] friendship expiry failed:', err.message);
  }
});
