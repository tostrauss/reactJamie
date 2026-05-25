import db from '../config/database.js';

const TRUST_THRESHOLD = 3;

async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ==========================================
// GET PENDING REVIEWS
// Returns groups that ended 6h+ ago where user was a member
// and has not yet submitted any reviews for that group.
// ==========================================
export const getPendingReviews = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         g.id        AS group_id,
         g.name      AS group_name,
         g.type,
         g.date      AS event_date,
         g.image_url,
         COALESCE(
           json_agg(
             json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url)
           ) FILTER (WHERE u.id IS NOT NULL AND u.id != $1),
           '[]'
         ) AS members
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       JOIN group_members all_gm ON all_gm.group_id = g.id
       JOIN users u ON u.id = all_gm.user_id
       WHERE g.type = 'group'
         AND g.date IS NOT NULL
         AND g.date + INTERVAL '6 hours' < NOW()
         AND g.date > NOW() - INTERVAL '14 days'
         AND NOT EXISTS (
           SELECT 1 FROM event_reviews er
           WHERE er.group_id = g.id AND er.reviewer_id = $1
         )
       GROUP BY g.id
       ORDER BY g.date DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getPendingReviews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SUBMIT ATTENDANCE REVIEW
// Body: { group_id, attendances: [{ user_id, was_present }] }
// ==========================================
export const submitReview = async (req, res) => {
  const { group_id, attendances } = req.body;
  if (!group_id || !Array.isArray(attendances)) {
    return res.status(400).json({ error: 'group_id and attendances[] required' });
  }
  if (attendances.length > 100) {
    return res.status(400).json({ error: 'Zu viele Teilnehmer in einer Anfrage' });
  }

  try {
    // Verify reviewer was a member
    const memberCheck = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [group_id, req.userId]
    );
    if (!memberCheck.rows.length) {
      return res.status(403).json({ error: 'Nur Mitglieder können bewerten' });
    }

    // Prevent duplicate submission
    const dupCheck = await db.query(
      'SELECT 1 FROM event_reviews WHERE group_id = $1 AND reviewer_id = $2 LIMIT 1',
      [group_id, req.userId]
    );
    if (dupCheck.rows.length) {
      return res.status(409).json({ error: 'Bereits bewertet' });
    }


    await withTransaction(async (client) => {
      // Sentinel row — marks the event as "seen" so it never reappears, even on skip
      await client.query(
        `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present)
         VALUES ($1, $2, $2, FALSE) ON CONFLICT DO NOTHING`,
        [group_id, req.userId]
      );

      const filtered = attendances.filter(a => a.user_id !== req.userId);
      if (filtered.length === 0) return;

      // Bulk INSERT — one round trip instead of N
      const valuesClauses = filtered.map(
        (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      ).join(', ');
      const insertParams = filtered.flatMap(a => [group_id, req.userId, a.user_id, a.was_present]);
      await client.query(
        `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present)
         VALUES ${valuesClauses} ON CONFLICT DO NOTHING`,
        insertParams
      );

      // Bulk UPDATE trusted_count — one round trip for all reviewed users
      const userIds = filtered.map(a => a.user_id);
      await client.query(
        `UPDATE users u
         SET trusted_count  = COALESCE(sub.c, 0),
             is_trusted_user = COALESCE(sub.c, 0) >= $2
         FROM (
           SELECT reviewed_user_id,
                  COUNT(DISTINCT reviewer_id) AS c
           FROM event_reviews
           WHERE reviewed_user_id = ANY($1) AND was_present = TRUE
           GROUP BY reviewed_user_id
         ) sub
         WHERE u.id = sub.reviewed_user_id`,
        [userIds, TRUST_THRESHOLD]
      );
    });

    res.json({ success: true });
  } catch (err) {
    console.error('submitReview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
