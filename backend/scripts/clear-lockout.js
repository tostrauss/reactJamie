/**
 * One-off: clear login_attempts + locked_until for a given email.
 * Usage:
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:DB_SSL_REJECT_UNAUTHORIZED = "false"
 *   node scripts/clear-lockout.js tobias.p.strauss@gmail.com
 */
import 'dotenv/config';
import pg from 'pg';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/clear-lockout.js <email>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false'
    ? { rejectUnauthorized: false }
    : undefined,
});

await client.connect();
const result = await client.query(
  'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE LOWER(email) = LOWER($1) RETURNING id, email, is_admin',
  [email]
);
console.log('Cleared lockout for:', result.rows);
await client.end();
