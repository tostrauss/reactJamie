import db from '../config/database.js';

// ==========================================
// GET USER BY ID (public profile)
// ==========================================
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT id, name, bio, location, avatar_url, interests, photos, pinnwand, gender, favorite_song, created_at,
              is_trusted_user,
              EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age
       FROM users
       WHERE id = $1
         -- Block is bidirectional: a user the caller blocked (or who blocked the
         -- caller) is invisible on the direct profile route too, mirroring the
         -- searchUsers + group-roster rules. Without this, a blocked/harassing
         -- user could still load the blocker's full profile via /user/:id.
         AND id NOT IN (
           SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
           FROM friendships
           WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2)
         )`,
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      // Same 404 whether the user doesn't exist or a block hides them — never
      // reveal to a blocked user that they were specifically blocked.
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];

    // Parse JSON fields
    try {
      if (typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (typeof user.pinnwand === 'string') user.pinnwand = JSON.parse(user.pinnwand);
      if (typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {
      console.error('JSON Parse Error:', e);
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// SEARCH USERS
// ==========================================
export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    if (q.length > 100) return res.status(400).json({ error: 'Suchbegriff zu lang' });

    // Exclude anyone the caller has blocked AND anyone who has blocked the caller —
    // a blocked user should be effectively invisible to the blocker, and the
    // blocker should also disappear from the blockee's search to avoid letting
    // them reach out via a different path.
    const result = await db.query(
      `SELECT id, name, avatar_url, location, bio
       FROM users
       WHERE name ILIKE $1
         AND id <> $2
         AND id NOT IN (
           SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
           FROM friendships
           WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2)
         )
       LIMIT 20`,
      [`%${q}%`, req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};