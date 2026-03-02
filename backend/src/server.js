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
import socketHandler from './socket.js';

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// Helmet: security headers (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow uploaded images to load
  contentSecurityPolicy: false // Disable CSP for now (frontend served separately)
}));

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Compression: gzip responses
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Sanitize all inputs (strip HTML tags from body, query, params)
app.use(sanitizeInputs);

// General rate limit on all API routes
app.use('/api', generalLimiter);

// Serve uploaded files statically
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// SOCKET.IO
// ==========================================
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

// 404 handler
app.use((req, res) => {
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
