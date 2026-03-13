// backend/src/server.js
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import compression from 'compression';
import db from './config/database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { generalLimiter, authLimiter } from './middleware/rateLimiter.js';
import { sanitizeInputs } from './middleware/sanitize.js';

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable must be set in production');
  process.exit(1);
}

const app = express();
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
import socketHandler from './socket.js';

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// Helmet: security headers (XSS, clickjacking, MIME sniffing, etc.)
const storageOrigin = process.env.STORAGE_PUBLIC_URL || null;
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        'https://api.spotify.com',
        'https://api.stripe.com',
        'https://hooks.stripe.com',
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
        ...(storageOrigin ? [storageOrigin] : []),
      ],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://i.scdn.co',         // Spotify album art
        'https://images.unsplash.com',
        'https://www.paypal.com',
        ...(storageOrigin ? [storageOrigin] : []),
      ],
      scriptSrc: [
        "'self'",
        'https://js.stripe.com',
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'", 'https://p.scdn.co'], // Spotify audio previews
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
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

// Stripe webhook — must receive raw body BEFORE express.json() parses it
app.post('/api/boost/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

// Session Management
app.use(session({
  store: new PGStore({
    pool: db.pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'jamie-secret-key-change-in-production',
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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Digital Asset Links — required for Android TWA
// Set env vars: ANDROID_PACKAGE, ANDROID_SHA256
// If using Play App Signing (recommended), also set ANDROID_SHA256_PLAY
// (Play Console → Setup → App Signing → "App signing key certificate" SHA-256)
app.get('/.well-known/assetlinks.json', (_req, res) => {
  const packageName = process.env.ANDROID_PACKAGE || 'jamie.app';

  // Collect all configured fingerprints (your keystore + optional Play-managed key)
  const fingerprints = [
    process.env.ANDROID_SHA256,       // your release keystore fingerprint
    process.env.ANDROID_SHA256_PLAY,  // Play App Signing fingerprint (if using)
  ].filter(Boolean);

  if (fingerprints.length === 0) {
    fingerprints.push('CONFIGURE_ANDROID_SHA256_ENV_VAR');
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints
    }
  }]);
});

// Apple App Site Association — enables Universal Links for iOS (deep linking, password reset emails)
// Set env vars: APPLE_TEAM_ID, APPLE_BUNDLE_ID
app.get('/.well-known/apple-app-site-association', (_req, res) => {
  const teamId = process.env.APPLE_TEAM_ID || 'REPLACE_TEAM_ID';
  const bundleId = process.env.APPLE_BUNDLE_ID || 'jamie.app';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    applinks: {
      apps: [],
      details: [{
        appIDs: [`${teamId}.${bundleId}`],
        components: [
          { '/': '/reset-password*', comment: 'Password reset deep link' },
          { '/': '/verify-email*', comment: 'Email verification deep link' },
        ]
      }]
    },
    webcredentials: {
      apps: [`${teamId}.${bundleId}`]
    }
  });
});

// ==========================================
// SOCKET.IO
// ==========================================
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Initialize Socket logic
socketHandler(io);

// Make io accessible to controllers (for realtime notifications)
app.set('io', io);

// ==========================================
// ERROR HANDLING
// ==========================================
app.use((err, _req, res, _next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

// 404 handler
app.use((_req, res) => {
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

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Socket.io ready`);
});
