// backend/src/config/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Nutze absoluten Pfad, damit es egal ist, von wo du den Server startest
const dbPath = path.resolve(__dirname, '../../database.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Verbindung zur Datenbank fehlgeschlagen:', err.message);
  } else {
    console.log('Verbunden mit der SQLite Datenbank.');
    
    // WICHTIG: Performance Tuning für Production
    // Aktiviert Write-Ahead Logging (bessere Performance bei gleichzeitigen Zugriffen)
    db.run('PRAGMA journal_mode = WAL;'); 
    // Erzwingt Fremdschlüssel-Constraints (wichtig für Datenintegrität)
    db.run('PRAGMA foreign_keys = ON;');
  }
});

module.exports = db;