/**
 * Backfill lat/lng on existing groups whose `location` was never geocoded.
 *
 * Run locally with:
 *   railway link
 *   railway run node scripts/backfill-group-coords.js
 *
 * Or from any machine that has DATABASE_URL set:
 *   DATABASE_URL="postgres://..." node scripts/backfill-group-coords.js
 *
 * Idempotent: only updates rows where lat IS NULL or lng IS NULL.
 * Rate-limited to ~1 req/s to respect Nominatim's usage policy.
 */
import 'dotenv/config';
import pg from 'pg';
import { geocodeLocation } from '../src/utils/geocode.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false'
    ? { rejectUnauthorized: false }
    : undefined,
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[backfill] Looking for groups with missing coordinates…');

  const { rows } = await pool.query(`
    SELECT id, name, location
    FROM groups
    WHERE (lat IS NULL OR lng IS NULL)
      AND location IS NOT NULL
      AND TRIM(location) <> ''
    ORDER BY id
  `);

  if (rows.length === 0) {
    console.log('[backfill] Nothing to do — every group already has coordinates.');
    await pool.end();
    return;
  }

  console.log(`[backfill] Found ${rows.length} groups to process.`);

  let ok = 0;
  let miss = 0;
  let fail = 0;

  for (const row of rows) {
    process.stdout.write(`  [#${row.id}] "${row.name}" — "${row.location}" … `);
    try {
      const coords = await geocodeLocation(row.location);
      if (!coords) {
        console.log('not found');
        miss++;
      } else {
        await pool.query(
          'UPDATE groups SET lat = $1, lng = $2 WHERE id = $3',
          [coords.lat, coords.lng, row.id]
        );
        console.log(`ok (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
        ok++;
      }
    } catch (err) {
      console.log('error:', err.message);
      fail++;
    }
    // Nominatim allows 1 req/s — sleep 1.1s to be safe
    await sleep(1100);
  }

  console.log(`\n[backfill] Done: ${ok} updated, ${miss} not-found, ${fail} errors.`);
  await pool.end();
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
