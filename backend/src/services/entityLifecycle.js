// Shared lifecycle core for the polymorphic `groups` table (groups, clubs,
// club events). clubController historically re-implemented groupController's
// flows in lockstep (audit 2026-09-02, code-health lens): the same fix had to
// land twice, and twice it didn't — cancelClub shipped WITHOUT the chunking
// cancelGroup had. The shared cores live here; controllers keep their
// entity-specific validation/authorization and pass the differences in.
import db from '../config/database.js';

// Entity row + owner membership in ONE transaction (audit risk #10): under
// pool pressure the second INSERT could fail and leave an ownerless entity
// whose chat/roster is broken for its own creator. `insertSql` must INSERT
// INTO groups ... RETURNING *.
export async function createEntityWithOwner(insertSql, params, ownerId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(insertSql, params);
    const entity = result.rows[0];
    await client.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [entity.id, ownerId, 'owner']
    );
    await client.query('COMMIT');
    return entity;
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }
}

// Cancellation fan-out: batched notifications INSERT + live `new_notification`
// emit per recipient. Chunked at 1000 rows (7 params × 1000 = 7000 binds,
// safely under Postgres' 65535 bind-parameter ceiling) — cancelClub's old
// unchunked copy would have errored out and notified NOBODY on a huge club.
// Everything is parameterized, including type/reference_type.
export async function notifyCancellationFanout({ memberIds, senderId, type, referenceType, referenceId, title, body, io }) {
  let notified = 0;
  const CHUNK = 1000;
  for (let start = 0; start < memberIds.length; start += CHUNK) {
    const chunk = memberIds.slice(start, start + CHUNK);
    const valuesClauses = chunk.map((_, i) => {
      const b = i * 7;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    }).join(', ');
    const params = chunk.flatMap(uid => [uid, senderId, type, title, body, referenceType, referenceId]);
    const notifResult = await db.query(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
       VALUES ${valuesClauses} RETURNING *`,
      params
    );
    notified += notifResult.rows.length;
    if (io) {
      for (const notif of notifResult.rows) {
        io.to(`user_${notif.user_id}`).emit('new_notification', notif);
      }
    }
  }
  return notified;
}
