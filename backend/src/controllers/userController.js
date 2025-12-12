import db from '../config/database.js';

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT id, name, bio, location, avatar_url, interests, photos, gender, favorite_song FROM users WHERE id = ?',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    // Parse JSON fields
    try {
      if (typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song)
    } catch (e) {
      console.error('JSON Parse Error', e);
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};