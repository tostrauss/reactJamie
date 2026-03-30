import db from '../config/database.js';

/**
 * GET /api/map/pins
 * Returns all active groups/clubs with lat/lng for map display.
 * Query params: type (group|club), category
 */
export const getMapPins = async (req, res) => {
  try {
    const { type, category } = req.query;

    let query = `
      SELECT g.id, g.name, g.type, g.category, g.location,
             g.lat, g.lng, g.members_count, g.max_members,
             g.image_url, g.date, g.skill_level,
             u.name as owner_name
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      WHERE g.is_active = TRUE
        AND g.lat IS NOT NULL
        AND g.lng IS NOT NULL
    `;
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND g.type = $${paramIndex++}`;
      params.push(type);
    }
    if (category) {
      query += ` AND g.category ILIKE $${paramIndex++}`;
      params.push(category);
    }

    query += ` ORDER BY g.created_at DESC LIMIT 500`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching map pins:', err);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
};
