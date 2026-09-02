import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// DATE columns (date_of_birth, analytics_daily.day) come back as plain
// 'YYYY-MM-DD' strings instead of JS Dates. node-pg's default parses a DATE
// into a Date at SERVER-LOCAL midnight, which JSON-serializes shifted on any
// non-UTC machine (e.g. local dev on a Vienna-TZ Windows box: 1990-01-01 →
// "1989-12-31T23:00:00.000Z"). The client echoing that shifted value back
// would then silently move the stored birthday −1 day AND burn the one-time
// birthday change (see updateProfile). A calendar date has no timezone —
// keep it a string end-to-end. OID 1082 = DATE. TIMESTAMP columns
// (groups.date etc.) are OID 1114 and deliberately untouched.
pg.types.setTypeParser(1082, (v) => v);

// Support both Railway-style DATABASE_URL and individual env vars
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD or DATABASE_URL must be set in production');
  process.exit(1);
}

// DB_SSL_REJECT_UNAUTHORIZED=false is needed for Railway/Supabase self-signed certs.
// Default: reject (secure). Explicitly set to 'false' only when the provider requires it.
const sslConfig =
  process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false;

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'jamie_db',
    };

// Production-ready connection pool.
// DB_POOL_MAX can be set per-environment (Railway allows up to ~100 connections
// on most plans). 50 lets us serve 1 000 concurrent users comfortably while
// leaving headroom for admin connections and Railway's internal processes.
const pool = new Pool({
  ...poolConfig,
  max: parseInt(process.env.DB_POOL_MAX, 10) || (process.env.NODE_ENV === 'production' ? 50 : 5),
  min: process.env.NODE_ENV === 'production' ? 5 : 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

// Sizing rule when scaling replicas (audit 2026-09-02, risk #5): Postgres has
// ONE global connection ceiling (~100 on common Railway plans) shared by ALL
// replicas → set DB_POOL_MAX = floor((PG max_connections − headroom) / replicas),
// e.g. 2 replicas on a 100-conn plan → 40 each with 20 headroom. Beyond 2
// replicas, front with PgBouncer (transaction mode) instead of shrinking further.
console.log(`[db-pool] max=${pool.options.max} min=${pool.options.min} (DB_POOL_MAX env ${process.env.DB_POOL_MAX ? 'set' : 'unset'})`);

// Log when the pool is exhausted — signals need to raise DB_POOL_MAX or add caching
pool.on('connect', () => {
  if (pool.totalCount >= pool.options.max) {
    console.warn(`[db-pool] At max capacity: ${pool.totalCount}/${pool.options.max} connections`);
  }
});

// Prevent runaway queries from hanging the server
pool.on('connect', (client) => {
  client.query('SET statement_timeout = 30000'); // 30s max per statement
});

export default {
  query: (text, params) => pool.query(text, params),
  pool,
};
