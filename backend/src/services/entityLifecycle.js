// Shared lifecycle core for the polymorphic `groups` table (groups, clubs,
// club events). clubController historically re-implemented groupController's
// flows in lockstep (audit 2026-09-02, code-health lens): the same fix had to
// land twice, and twice it didn't — cancelClub shipped WITHOUT the chunking
// cancelGroup had. The shared cores live here; controllers keep their
// entity-specific validation/authorization and pass the differences in.
import db from '../config/database.js';

// Entity row + owner membership ATOMICALLY (audit risk #10): without this,
// a failure between the two INSERTs left an ownerless entity whose
// chat/roster is broken for its own creator. Implemented as ONE
// data-modifying CTE — both arms run in the same implicit transaction and
// snapshot, so it's atomic with a single round trip and NO pool-client
// checkout (an explicit BEGIN/COMMIT doubled per-create pool occupancy and
// its unguarded ROLLBACK could mask the real error on a dead connection —
// review 2026-09-02). Triggers (members_count) fire normally.
// `insertSql` must INSERT INTO groups ... RETURNING *.
export async function createEntityWithOwner(insertSql, params, ownerId) {
  const ownerParam = params.length + 1;
  const result = await db.query(
    `WITH ins AS (${insertSql}),
          member AS (
            INSERT INTO group_members (group_id, user_id, role)
            SELECT id, $${ownerParam}, 'owner' FROM ins
          )
     SELECT * FROM ins`,
    [...params, ownerId]
  );
  return result.rows[0];
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
