/**
 * Reconcile groups where members_count > max_members.
 *
 * Default mode (non-destructive): raise max_members up to members_count so the
 * invariant holds without removing anyone. Use --prune to delete the newest
 * members back down to max_members instead.
 *
 * Usage:
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:DB_SSL_REJECT_UNAUTHORIZED = "false"
 *   node scripts/reconcile-group-capacity.js           # bump max_members
 *   node scripts/reconcile-group-capacity.js --prune   # remove newest members
 *   node scripts/reconcile-group-capacity.js --dry     # report only
 */
import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry');
const prune  = args.has('--prune');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false'
    ? { rejectUnauthorized: false }
    : undefined,
});

await client.connect();

const offenders = await client.query(`
  SELECT id, name, type, members_count, max_members
  FROM groups
  WHERE max_members IS NOT NULL
    AND members_count > max_members
  ORDER BY members_count - max_members DESC, id ASC
`);

if (offenders.rows.length === 0) {
  console.log('No groups exceed max_members. Nothing to do.');
  await client.end();
  process.exit(0);
}

console.log(`Found ${offenders.rows.length} group(s) over capacity:\n`);
for (const g of offenders.rows) {
  console.log(`  #${g.id} [${g.type}] "${g.name}" — ${g.members_count}/${g.max_members}`);
}

if (dryRun) {
  console.log('\n--dry — no changes made.');
  await client.end();
  process.exit(0);
}

console.log(`\nMode: ${prune ? 'PRUNE (delete newest members)' : 'BUMP (raise max_members)'}`);

let touched = 0;
for (const g of offenders.rows) {
  if (prune) {
    // Remove the (members_count - max_members) most-recently-joined non-owner
    // members. Owners are kept regardless to preserve admin ability.
    const removeN = g.members_count - g.max_members;
    const victims = await client.query(
      `SELECT user_id FROM group_members
       WHERE group_id = $1 AND role != 'owner'
       ORDER BY joined_at DESC
       LIMIT $2`,
      [g.id, removeN]
    );
    if (victims.rows.length === 0) {
      console.log(`  #${g.id}: no non-owner members to remove — skipped`);
      continue;
    }
    const ids = victims.rows.map(r => r.user_id);
    await client.query(
      `DELETE FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])`,
      [g.id, ids]
    );
    console.log(`  #${g.id}: removed ${ids.length} member(s) (user_id ${ids.join(', ')})`);
  } else {
    await client.query(
      `UPDATE groups SET max_members = members_count, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [g.id]
    );
    console.log(`  #${g.id}: max_members ${g.max_members} → ${g.members_count}`);
  }
  touched++;
}

console.log(`\nDone — ${touched} group(s) reconciled.`);
await client.end();
