// backend/src/server.js
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { RedisStore } from 'connect-redis';
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
    ['SESSION_SECRET',    'express-session signing key'],
    ['JWT_SECRET',        'JWT token signing key'],
    ['DATABASE_URL',      'PostgreSQL connection string'],
    ['EMAIL_FROM',        'verified Brevo sender address (e.g. noreply@jamie.app)'],
    ['BREVO_API_KEY',     'Brevo transactional email API key'],
    ['FRONTEND_URL',      'public frontend URL for email links'],
  ];

  let fatal = false;

  // Secrets must have sufficient entropy (min 32 chars)
  for (const key of ['JWT_SECRET', 'SESSION_SECRET']) {
    const val = process.env[key] || '';
    if (val.length < 32) {
      console.error(`FATAL: ${key} is too short (${val.length} chars) — use at least 32 random characters`);
      fatal = true;
    }
  }
  const WARNED = [
    ['SIGHTENGINE_API_USER',   'image moderation (nudity/gore) will be DISABLED'],
    ['SIGHTENGINE_API_SECRET', 'image moderation (nudity/gore) will be DISABLED'],
    ['OPENAI_API_KEY',         'text moderation will be DISABLED — unsafe content may pass through'],
    ['STRIPE_WEBHOOK_SECRET',              'Stripe boost webhook signature validation will FAIL'],
    ['STRIPE_SUBSCRIPTION_WEBHOOK_SECRET', 'Stripe subscription webhook signature validation will FAIL'],
    ['ADMIN_SECRET',                       'admin dashboard will be inaccessible'],
    ['GOOGLE_CLIENT_ID',                   'Google OAuth will use unverified userinfo endpoint (reduced security)'],
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
const PGStore = pgSession(session);

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
import boostRoutes from './routes/boostRoutes.js';
import { stripeWebhook } from './controllers/boostController.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import { subscriptionWebhook } from './controllers/subscriptionController.js';
import mapRoutes from './routes/mapRoutes.js';
import waitlistRoutes from './routes/waitlistRoutes.js';
import dealRoutes from './routes/dealRoutes.js';
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
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
        'https://nominatim.openstreetmap.org',
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
        'https://www.paypal.com',
        'https://*.tile.openstreetmap.org',
        'https://lh3.googleusercontent.com', // Google profile pictures
        ...(storageOrigin ? [storageOrigin] : []),
      ],
      scriptSrc: [
        "'self'",
        'https://js.stripe.com',
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
        'https://accounts.google.com',
        'https://appleid.cdn-apple.com',
      ],
      frameSrc: [
        'https://js.stripe.com',
        'https://hooks.stripe.com',
        'https://accounts.google.com',
        'https://appleid.apple.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
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

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Compression: gzip responses
app.use(compression());

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
  app.use(express.static(publicPath, { maxAge: '1d' }));
}

// Stripe webhooks — must receive raw body BEFORE express.json() parses it
app.post('/api/boost/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.post('/api/subscription/stripe/webhook', express.raw({ type: 'application/json' }), subscriptionWebhook);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Parse cookies (required for httpOnly auth_token cookie)
app.use(cookieParser());

// Sanitize all inputs (strip HTML tags from body, query, params)
app.use(sanitizeInputs);

// General rate limit on all API routes
app.use('/api', generalLimiter);

// Serve uploaded files statically — dev only (cloud storage is used in production)
if (process.env.NODE_ENV !== 'production') {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));
}

// Session Management — Redis store when available (sub-10ms), PG fallback
const sessionStore = redisClient
  ? new RedisStore({ client: redisClient, prefix: 'sess:' })
  : new PGStore({ pool: db.pool, tableName: 'session' });

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

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
app.use('/api/boost', boostRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/deals', dealRoutes);

// Health check — verifies DB connectivity for Railway health probes
app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unavailable', timestamp: new Date().toISOString() });
  }
});

// .well-known files (assetlinks.json + apple-app-site-association) are served
// as static files from the frontend (frontend/public/.well-known/).
// The backend does not need to handle these routes.

// ==========================================
// SOCKET.IO
// ==========================================
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
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

// SPA fallback — serves index.html for all non-API GET routes (React Router)
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.resolve(__dirname, '../public');
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// ==========================================
// ERROR HANDLING
// ==========================================
Sentry.setupExpressErrorHandler(app);

app.use((err, _req, res, _next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

// API 404 — only fires for unmatched /api/* routes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
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

// Catch-all safety nets — prevent silent crashes from fire-and-forget async tasks
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception — shutting down:', error);
  gracefulShutdown('uncaughtException');
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;

const runStartupMigrations = async () => {
  try {
    // Email OTP verification
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id         SERIAL PRIMARY KEY,
        email      VARCHAR(255) NOT NULL,
        code       VARCHAR(6)   NOT NULL,
        expires_at TIMESTAMPTZ  NOT NULL,
        used       BOOLEAN      DEFAULT FALSE,
        created_at TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email)`);

    // Analytics events
    await db.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id          BIGSERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type  VARCHAR(50)  NOT NULL,
        screen_name VARCHAR(120),
        duration_ms INTEGER,
        metadata    JSONB,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_user    ON analytics_events(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_type    ON analytics_events(event_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_screen  ON analytics_events(screen_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC)`);

    // Category suggestions
    await db.query(`
      CREATE TABLE IF NOT EXISTS category_suggestions (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        suggestion  TEXT NOT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Event reviews + trusted user columns
    await db.query(`
      CREATE TABLE IF NOT EXISTS event_reviews (
        id               SERIAL PRIMARY KEY,
        group_id         INTEGER NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
        reviewer_id      INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        reviewed_user_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        was_present      BOOLEAN NOT NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, reviewer_id, reviewed_user_id)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_event_reviews_group    ON event_reviews(group_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_event_reviews_reviewed ON event_reviews(reviewed_user_id)`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_trusted_user BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_count   INTEGER NOT NULL DEFAULT 0`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_lat_lng ON groups(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL`);

    // Geofencing & pioneer system
    await db.query(`CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE,
      country VARCHAR(10), ip VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist(country)`);
    await db.query(`CREATE TABLE IF NOT EXISTS country_votes (
      country VARCHAR(10) PRIMARY KEY, votes INTEGER NOT NULL DEFAULT 0)`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pioneer BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`CREATE TABLE IF NOT EXISTS pioneer_claims (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      lat_cell NUMERIC(6,2) NOT NULL, lng_cell NUMERIC(6,2) NOT NULL,
      claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lat_cell, lng_cell))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_pioneer_claims_cell ON pioneer_claims(lat_cell, lng_cell)`);

    // Soft delete for groups (preserves messages/reviews; hard delete on cascade never fires)
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_deleted_at ON groups(deleted_at) WHERE deleted_at IS NULL`);

    // Friend request expiration — 30-day auto-reject
    await db.query(`ALTER TABLE friendships ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_friendships_expires ON friendships(expires_at) WHERE status = 'pending'`);

    // Für Dich — Pro-exclusive venue deals
    await db.query(`
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
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_deals_active ON deals(is_active) WHERE is_active = TRUE`);
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS booking_url TEXT`);

    console.log('✅ Startup migrations done');
  } catch (err) {
    console.error('⚠️ Startup migration error:', err.message);
  }
};

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Socket.io ready`);
  await runStartupMigrations();
});

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
