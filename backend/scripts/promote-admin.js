/**
 * One-off: grant or revoke admin rights on a user.
 * Usage:
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:DB_SSL_REJECT_UNAUTHORIZED = "false"
 *   node scripts/promote-admin.js tobias.p.strauss@gmail.com [grant|revoke]
 * Defaults to grant.
 */
import 'dotenv/config';
import pg from 'pg';

const email = process.argv[2];
const action = (process.argv[3] || 'grant').toLowerCase();

if (!email) {
  console.error('Usage: node scripts/promote-admin.js <email> [grant|revoke]');
  process.exit(1);
}
if (!['grant', 'revoke'].includes(action)) {
  console.error('Action must be "grant" or "revoke" — got:', action);
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
  'UPDATE users SET is_admin = $1 WHERE LOWER(email) = LOWER($2) RETURNING id, email, is_admin',
  [action === 'grant', email]
);

if (result.rowCount === 0) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

console.log(`Admin ${action} applied:`, result.rows);
await client.end();
