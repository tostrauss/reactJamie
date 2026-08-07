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
             json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url,
                               'age', EXTRACT(YEAR FROM AGE(u.date_of_birth))::int)
           ) FILTER (WHERE u.id IS NOT NULL AND u.id != $1),
           '[]'
         ) AS members
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       JOIN group_members all_gm ON all_gm.group_id = g.id
       JOIN users u ON u.id = all_gm.user_id
       WHERE g.type = 'group'
         AND g.did_not_take_place = FALSE
         AND g.date IS NOT NULL
         -- "Past" = the event's DAY is over. Date-only events store at midnight,
         -- so the old "date + 6h < NOW()" surfaced the review at 06:00 ON the
         -- event day, before it happened (Lea's 14:00 picnic). Day-based
         -- (CURRENT_DATE) mirrors the club feed and never fires early.
         AND g.date < CURRENT_DATE
         AND g.date > NOW() - INTERVAL '14 days'
         AND NOT EXISTS (
           SELECT 1 FROM event_reviews er
           WHERE er.group_id = g.id AND er.reviewer_id = $1
         )
         AND NOT EXISTS (
           SELECT 1 FROM event_review_dismissals d
           WHERE d.group_id = g.id AND d.user_id = $1
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
  // not_held: the event never happened. There's no honest attendance to record,
  // so skip the whole "who was there" step — just close the prompt (sentinel)
  // and, when the OWNER reports it, mark the event so nobody else is nagged.
  const { group_id, attendances, not_held } = req.body;
  if (!group_id || (!not_held && !Array.isArray(attendances))) {
    return res.status(400).json({ error: 'group_id and attendances[] required' });
  }
  if (Array.isArray(attendances) && attendances.length > 100) {
    return res.status(400).json({ error: 'Zu viele Teilnehmer in einer Anfrage' });
  }

  try {
    // Verify reviewer was a member AND fetch the event date + owner in one go.
    const memberCheck = await db.query(
      `SELECT g.date, g.owner_id
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       WHERE gm.group_id = $1 AND gm.user_id = $2`,
      [group_id, req.userId]
    );
    if (!memberCheck.rows.length) {
      return res.status(403).json({ error: 'Nur Mitglieder können bewerten' });
    }

    // Only allow reviews AFTER the event ended (6h grace) — submitReview had no
    // date guard, so a member could review a future/just-created event. Mirrors
    // the window used by getPendingReviews.
    const eventDate = memberCheck.rows[0].date;
    if (!eventDate || new Date(eventDate).getTime() + 6 * 60 * 60 * 1000 > Date.now()) {
      return res.status(400).json({ error: 'Bewertung erst nach dem Event möglich' });
    }

    // Prevent duplicate submission
    const dupCheck = await db.query(
      'SELECT 1 FROM event_reviews WHERE group_id = $1 AND reviewer_id = $2 LIMIT 1',
      [group_id, req.userId]
    );
    if (dupCheck.rows.length) {
      return res.status(409).json({ error: 'Bereits bewertet' });
    }

    // "Event didn't take place": close this reviewer's prompt with the sentinel
    // (no attendance rows → no one's trusted_count is touched). If the reporter
    // is the owner, flag the whole event so getPendingReviews stops prompting
    // every other member too.
    if (not_held) {
      const isOwner = Number(memberCheck.rows[0].owner_id) === Number(req.userId);
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present)
           VALUES ($1, $2, $2, FALSE) ON CONFLICT DO NOTHING`,
          [group_id, req.userId]
        );
        await client.query(
          `DELETE FROM event_review_dismissals WHERE group_id = $1 AND user_id = $2`,
          [group_id, req.userId]
        );
        if (isOwner) {
          await client.query(`UPDATE groups SET did_not_take_place = TRUE WHERE id = $1`, [group_id]);
        }
      });
      return res.json({ success: true, not_held: true });
    }


    await withTransaction(async (client) => {
      // Sentinel row — marks the event as reviewed by this user so it never
      // reappears (getPendingReviews and getReviewForGroup both gate on it).
      await client.query(
        `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present)
         VALUES ($1, $2, $2, FALSE) ON CONFLICT DO NOTHING`,
        [group_id, req.userId]
      );
      // A real submission supersedes any earlier "skip" — drop the dismissal.
      await client.query(
        `DELETE FROM event_review_dismissals WHERE group_id = $1 AND user_id = $2`,
        [group_id, req.userId]
      );

      const filtered = attendances.filter(a =>
        a && Number.isInteger(a.user_id) && a.user_id !== req.userId && typeof a.was_present === 'boolean'
      );
      if (filtered.length === 0) return;

      // Verify each reviewed user was actually a member of this group. Without
      // this check, a reviewer can fabricate "was_present" entries for any
      // user_id and inflate their trusted_count (3 distinct fake reviewers
      // grant the trusted badge).
      const candidateIds = [...new Set(filtered.map(a => a.user_id))];
      const realMembersRes = await client.query(
        'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])',
        [group_id, candidateIds]
      );
      const realMemberSet = new Set(realMembersRes.rows.map(r => r.user_id));
      const verified = filtered.filter(a => realMemberSet.has(a.user_id));
      if (verified.length === 0) return;

      // Bulk INSERT — one round trip instead of N
      const valuesClauses = verified.map(
        (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      ).join(', ');
      const insertParams = verified.flatMap(a => [group_id, req.userId, a.user_id, a.was_present]);
      await client.query(
        `INSERT INTO event_reviews (group_id, reviewer_id, reviewed_user_id, was_present)
         VALUES ${valuesClauses} ON CONFLICT DO NOTHING`,
        insertParams
      );

      // Bulk UPDATE trusted_count — one round trip for all reviewed users
      const userIds = verified.map(a => a.user_id);
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

// ==========================================
// DISMISS ("snooze") the attendance review for an event
// Suppresses the auto-popup WITHOUT writing a fake review — the member can
// still re-open it manually later (getReviewForGroup ignores dismissals).
// This replaces the old "skip = permanent sentinel" behaviour so an accidental
// close is no longer final.
// ==========================================
export const dismissReview = async (req, res) => {
  const { group_id } = req.body;
  if (!Number.isInteger(group_id)) {
    return res.status(400).json({ error: 'group_id required' });
  }
  try {
    await db.query(
      `INSERT INTO event_review_dismissals (group_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [group_id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('dismissReview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// GET REVIEW FOR ONE GROUP (manual re-open)
// Returns the attendance payload for a single past group event the caller was
// a member of, so they can open the review modal on demand — even after they
// skipped it. Deliberately ignores dismissals (that's the whole point) but
// still respects a real submission and the 6h-after-event window.
// 404 when not eligible: not a member, not a past one-off group event, or
// already submitted.
// ==========================================
export const getReviewForGroup = async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  if (!Number.isInteger(groupId)) {
    return res.status(400).json({ error: 'Invalid group id' });
  }
  try {
    const result = await db.query(
      `SELECT
         g.id        AS group_id,
         g.name      AS group_name,
         g.date      AS event_date,
         g.image_url,
         COALESCE(
           json_agg(
             json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url,
                               'age', EXTRACT(YEAR FROM AGE(u.date_of_birth))::int)
           ) FILTER (WHERE u.id IS NOT NULL AND u.id != $1),
           '[]'
         ) AS members
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       JOIN group_members all_gm ON all_gm.group_id = g.id
       JOIN users u ON u.id = all_gm.user_id
       WHERE g.id = $2
         AND g.type = 'group'
         AND g.date IS NOT NULL
         AND g.date < CURRENT_DATE   -- day-based, see getPendingReviews (never before the event day)
         AND g.is_recurring_weekly IS NOT TRUE
         AND NOT EXISTS (
           SELECT 1 FROM event_reviews er
           WHERE er.group_id = g.id AND er.reviewer_id = $1
         )
       GROUP BY g.id`,
      [req.userId, groupId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Not eligible for review' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('getReviewForGroup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
