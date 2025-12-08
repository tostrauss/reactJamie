import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const dbPath = process.env.DB_PATH || './database.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('✓ Connected to SQLite database');
    initializeDatabase();
  }
});

db.configure('busyTimeout', 5000);

const initializeDatabase = () => {
  const schemaPath = path.join(process.cwd(), 'src', 'config', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8')
    .split(';')
    .filter(sql => sql.trim().length > 0);
  
  schema.forEach((statement, index) => {
    db.run(statement, (err) => {
      if (err && !err.message.includes('UNIQUE constraint failed')) {
        console.error(`Schema initialization error (${index}):`, err);
      }
      if (index === schema.length - 1) {
        console.log('✓ Database schema initialized');
      }
    });
  });
};

// Wrapper for query compatibility
export const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows: rows || [] });
      });
    } else if (sql.trim().toUpperCase().startsWith('INSERT')) {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ rows: [{ id: this.lastID }], changes: this.changes });
      });
    } else {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ rows: [], changes: this.changes });
      });
    }
  });
};

export default { query };
