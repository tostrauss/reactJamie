// backend/server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Sicherheits-Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173", // URL deines Frontends
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

// Routes importieren
const authRoutes = require('./src/routes/authRoutes');
const groupRoutes = require('./src/routes/groupRoutes');
const db = require('./config/database'); // Datenbankverbindung initialisieren
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
// Session Management
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './database' }),
  secret: process.env.SESSION_SECRET || 'dein_geheimes_sitzungsgeheimnis',
  resave: false,
  saveUninitialized: false,
}));

// ... andere Routes

app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);

// Socket.io Setup für Realtime Chat
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

require('./src/socket')(io); // Deine Socket Logik auslagern

// Globales Error Handling (damit der Server nicht crasht)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Etwas ist schiefgelaufen!' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});