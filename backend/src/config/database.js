import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Support both Railway-style DATABASE_URL and individual env vars
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD or DATABASE_URL must be set in production');
  process.exit(1);
}

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'jamie_db',
    };

// Production-ready connection pool
const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

// Prevent runaway queries from hanging the server
pool.on('connect', (client) => {
  client.query('SET statement_timeout = 30000'); // 30s max per statement
});

export default {
  query: (text, params) => pool.query(text, params),
  pool,
};
