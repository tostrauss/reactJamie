import db from '../config/database.js';
import { getCached, setCached } from '../utils/cache.js';

const SUGGEST_TTL = 60_000; // 60s — stale-but-acceptable; nightly cron will repopulate group churn faster

// ==========================================
// SUGGEST GROUPS/CLUBS — personalized for the caller
// ==========================================
// Scoring signals:
//   • +6 per accepted friend who is a member of the group  (social proof — Robert's "Leute die in den Gruppen sind")
//   • +10 if the group's category matches one of my interests  (Robert's "nach ihren Interessen")
//   • + interest_overlap_with_members  (people-like-me signal — sum across members of how many interests they share with me)
//   • Recency tiebreak (newer first within same score)
//
// Excludes:
//   • groups I'm already a member of
//   • groups owned by users I've blocked (in either direction)
//   • inactive / deleted groups
//   • single-event groups whose date has already passed
//
// Returns a flat list ordered by score DESC, with the score components attached
// so the UI can show "weil 3 Freunde dabei sind" / "passt zu deinem Interesse Tennis".
//
// Query params:
//   type  — 'group' | 'club' | undefined (both)
//   limit — default 12, max 30
export const getSuggestions = async (req, res) => {
  try {
    const userId = req.userId;
    const { type } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);

    if (type && !['group', 'club'].includes(type)) {
      return res.status(400).json({ error: 'Ungültiger Typ' });
    }

    const cacheKey = `suggest:${userId}:${type || 'all'}:${limit}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Pull the caller's interests once. Doing it in a CTE would require casting
    // between text[] / jsonb and ends up uglier than a 1-row pre-fetch.
    const meRes = await db.query(
      `SELECT interests FROM users WHERE id = $1`,
      [userId]
    );
    if (meRes.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    let interests = meRes.rows[0].interests || [];
    // schema.sql declares interests as JSONB, but legacy rows written via
    // JSON.stringify could come back as a string — normalize defensively.
    if (typeof interests === 'string') {
      try { interests = JSON.parse(interests); } catch { interests = []; }
    }
    if (!Array.isArray(interests)) interests = [];

    // No interests AND no friends → fall back to "trending" (newest, member-count weighted).
    // We still let the query run; it just won't add any interest/friend scoring.
    const interestsJson = JSON.stringify(interests);

    const params = [userId, interestsJson, limit];
    let typeClause = '';
    if (type) {
      typeClause = `AND g.type = $4`;
      params.push(type);
    } else {
      typeClause = `AND g.type IN ('group','club')`;
    }

    const sql = `
      WITH my_interests AS (
        SELECT LOWER(value) AS tag
        FROM jsonb_array_elements_text($2::jsonb)
      ),
      blocked AS (
        SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS uid
        FROM friendships
        WHERE status = 'blocked' AND (requester_id = $1 OR addressee_id = $1)
      ),
      my_friends AS (
        SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships
        WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
      )
      SELECT g.*,
             u.name AS owner_name, u.avatar_url AS owner_avatar,
             COALESCE(friends_score.cnt, 0) AS friends_in_group,
             CASE WHEN EXISTS (
               SELECT 1 FROM my_interests mi
               WHERE LOWER(g.category) = mi.tag
                  OR LOWER(g.name) LIKE '%' || mi.tag || '%'
             ) THEN 1 ELSE 0 END AS interest_match,
             COALESCE(member_overlap.score, 0) AS member_interest_overlap,
             (
               SELECT json_agg(json_build_object('id', sub.id, 'name', sub.name, 'avatar_url', sub.avatar_url))
               FROM (
                 SELECT u2.id, u2.name, u2.avatar_url
                 FROM group_members gm
                 JOIN users u2 ON gm.user_id = u2.id
                 WHERE gm.group_id = g.id
                 ORDER BY gm.joined_at ASC
                 LIMIT 3
               ) sub
             ) AS member_previews
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt
        FROM group_members gm
        JOIN my_friends mf ON mf.friend_id = gm.user_id
        WHERE gm.group_id = g.id
      ) friends_score ON TRUE
      LEFT JOIN LATERAL (
        -- For each other member of the group, count how many of their interest
        -- tags are also in my_interests. Sum across members → "people-like-me"
        -- score. Capped per-member at 5 so a single super-matching user can't
        -- dominate the ranking.
        SELECT COALESCE(SUM(LEAST(per_member.overlap, 5)), 0)::int AS score
        FROM (
          SELECT (
            SELECT COUNT(*)
            FROM jsonb_array_elements_text(u3.interests) ui
            JOIN my_interests mi ON LOWER(ui) = mi.tag
          ) AS overlap
          FROM group_members gm
          JOIN users u3 ON gm.user_id = u3.id
          WHERE gm.group_id = g.id
            AND u3.id <> $1
            AND u3.interests IS NOT NULL
            AND jsonb_typeof(u3.interests) = 'array'
          LIMIT 50
        ) per_member
      ) member_overlap ON TRUE
      WHERE g.is_active = TRUE
        AND g.deleted_at IS NULL
        ${typeClause}
        AND g.id NOT IN (SELECT group_id FROM group_members WHERE user_id = $1)
        AND g.owner_id <> $1
        AND g.owner_id NOT IN (SELECT uid FROM blocked)
        AND (g.type = 'club' OR g.date IS NULL OR g.date >= CURRENT_TIMESTAMP)
        AND (g.is_private IS NOT TRUE)
      ORDER BY
        (COALESCE(friends_score.cnt, 0) * 6
         + (CASE WHEN EXISTS (
              SELECT 1 FROM my_interests mi
              WHERE LOWER(g.category) = mi.tag
                 OR LOWER(g.name) LIKE '%' || mi.tag || '%'
            ) THEN 10 ELSE 0 END)
         + COALESCE(member_overlap.score, 0)
        ) DESC,
        g.created_at DESC
      LIMIT $3
    `;

    const result = await db.query(sql, params);

    // Attach a stable score + the primary reason so the UI can render a chip
    // like "3 Freunde dabei" or "passt zu Tennis". The reason is chosen by
    // priority: friends > interest match > similar people.
    const out = result.rows.map(row => {
      const score = (row.friends_in_group || 0) * 6
                  + (row.interest_match ? 10 : 0)
                  + (row.member_interest_overlap || 0);

      let reason = null;
      if (row.friends_in_group >= 1) {
        reason = { kind: 'friends', count: row.friends_in_group };
      } else if (row.interest_match) {
        reason = { kind: 'interest', category: row.category };
      } else if (row.member_interest_overlap >= 3) {
        reason = { kind: 'similar' };
      }

      return { ...row, _score: score, _reason: reason };
    });

    setCached(cacheKey, out, SUGGEST_TTL);
    res.json(out);
  } catch (err) {
    console.error('Error fetching suggestions:', err);
    res.status(500).json({ error: 'Vorschläge konnten nicht geladen werden' });
  }
};
