// backend/src/server.js
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const server = http.createServer(app);
const SQLiteStore = SQLiteStoreFactory(session);

// Routes
import authRoutes from './routes/authRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import socketHandler from './socket.js';

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

// Session Management
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './' }), // Saved in root
  secret: process.env.SESSION_SECRET || 'dev_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);

// Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Initialize Socket logic
socketHandler(io);

// Error Handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});