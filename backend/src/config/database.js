// backend/src/config/database.js
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure db file is in backend root, not inside src/config
const dbPath = path.resolve(__dirname, '../../database.db');

const sqlite = sqlite3.verbose();
const dbConnection = new sqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ DB Connection Error:', err.message);
  } else {
    console.log('✅ Connected to SQLite database.');
    dbConnection.run('PRAGMA journal_mode = WAL;');
    dbConnection.run('PRAGMA foreign_keys = ON;');
  }
});

// Wrapper to mimic PostgreSQL 'db.query' style
const db = {
  query: (text, params = []) => {
    return new Promise((resolve, reject) => {
      // Check if it's a SELECT query
      if (text.trim().toUpperCase().startsWith('SELECT')) {
        dbConnection.all(text, params, (err, rows) => {
          if (err) return reject(err);
          resolve({ rows }); // Return object resembling Postgres result
        });
      } else {
        // INSERT, UPDATE, DELETE
        // Note: SQLite doesn't support "RETURNING" fully in older versions, 
        // but this handles the basic run.
        dbConnection.run(text, params, function (err) {
          if (err) return reject(err);
          // Return "rows" with one item containing the new ID for inserts
          resolve({ 
            rows: [{ id: this.lastID }], 
            rowCount: this.changes 
          });
        });
      }
    });
  }
};

export default db;