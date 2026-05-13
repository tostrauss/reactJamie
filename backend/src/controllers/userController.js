import db from '../config/database.js';

// ==========================================
// GET USER BY ID (public profile)
// ==========================================
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT id, name, bio, location, avatar_url, interests, photos, gender, favorite_song, created_at,
              date_of_birth, is_trusted_user
       FROM users WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];

    // Parse JSON fields
    try {
      if (typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
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

    const result = await db.query(
      `SELECT id, name, avatar_url, location, bio
       FROM users 
       WHERE name ILIKE $1
       LIMIT 20`,
      [`%${q}%`]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};