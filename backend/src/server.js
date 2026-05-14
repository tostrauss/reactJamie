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
    ['EMAIL_FROM',        'verified sender address (e.g. noreply@jamie.app)'],
    ['RESEND_API_KEY',    'Resend transactional email API key'],
    ['FRONTEND_URL',      'public frontend URL for email links'],
  ];

  let fatal = false;

  // Secrets must have sufficient entropy and must not be placeholder values
  for (const key of ['JWT_SECRET', 'SESSION_SECRET']) {
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
// Protect against slow-client / Slowloris attacks
server.keepAliveTimeout = 65_000; // 65s — must exceed Railway LB idle timeout (60s)
server.headersTimeout  = 66_000; // 1s > keepAliveTimeout
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
  app.use(express.static(publicPath, {
    setHeaders(res, filePath) {
      // Vite emits hashed filenames (e.g. index-BdEtbxXM.js) — safe to cache forever
      if (/\.[a-f0-9]{8,}\.(js|css|woff2?)(\?.*)?$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html')) {
        // Always revalidate the entry point so clients pick up new deployments immediately
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  }));
}

// Stripe webhooks — must receive raw body BEFORE express.json() parses it
app.post('/api/subscription/stripe/webhook', express.raw({ type: 'application/json' }), subscriptionWebhook);

// Body parsing — keep small; largest legitimate payload is a JSON with a text message, not binary
app.use(express.json({ limit: '2mb' }));
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

// Session Management — Redis store when available (sub-10ms), PG fallback
const SESSION_TTL_SEC = 24 * 60 * 60; // 1 day — must match cookie maxAge
const sessionStore = redisClient
  ? new RedisStore({ client: redisClient, prefix: 'sess:', ttl: SESSION_TTL_SEC })
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
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/deals', dealRoutes);

// Health check — verifies DB + optional services for Railway health probes
app.get('/api/health', async (_req, res) => {
  const checks = { db: 'error', redis: 'skipped', timestamp: new Date().toISOString() };
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
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', ...checks });
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

// Helper: run a single migration step, log and continue on error
const migrate = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`⚠️ Migration "${label}" failed: ${err.message}`);
  }
};

const runStartupMigrations = async () => {
  // Wait up to 30s for DB to be reachable before running migrations.
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await db.query('SELECT 1');
      break;
    } catch {
      if (attempt === 6) {
        console.error('⚠️ DB not reachable after 30s — startup migrations skipped');
        return;
      }
      console.log(`[migrations] Waiting for DB... (${attempt}/6)`);
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
  await migrate('users google_id col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`));
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
  await migrate('groups.deleted_at', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_deleted_at ON groups(deleted_at) WHERE deleted_at IS NULL`);
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

  // ── Optional: boost_transactions index (table created by boost_migration.sql) ──
  await migrate('idx_boost_txn_payment_id', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_boost_txn_payment_id ON boost_transactions(payment_id) WHERE payment_id IS NOT NULL`));

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
  await migrate('groups.chat_only_owner', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_only_owner BOOLEAN DEFAULT FALSE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_chat_only_owner ON groups(chat_only_owner) WHERE chat_only_owner = TRUE`);
  });
  await migrate('idx_groups_category_lower', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_groups_category_lower ON groups(LOWER(category))`));
  await migrate('idx_groups_feed + map', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_feed ON groups(type, created_at DESC) WHERE is_active = TRUE AND deleted_at IS NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_map  ON groups(type, category, created_at DESC) WHERE is_active = TRUE AND deleted_at IS NULL AND lat IS NOT NULL AND lng IS NOT NULL`);
  });

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
  await migrate('chk_gm_role', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE group_members ADD CONSTRAINT chk_gm_role
        CHECK (role IN ('owner','admin','member'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`));

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
