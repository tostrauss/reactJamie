import db from '../config/database.js';
import { getCached, setCached } from '../utils/cache.js';

/**
 * GET /api/map/pins
 * Returns all active groups/clubs with lat/lng for map display.
 * Query params: type (group|club), category
 */
export const getMapPins = async (req, res) => {
  try {
    const { type, categories } = req.query;

    const cacheKey = `map:${type || ''}:${categories || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    let query = `
      SELECT g.id, g.name, g.type, g.category, g.location,
             g.lat, g.lng, g.members_count, g.max_members,
             g.image_url, g.date, g.skill_level,
             u.name as owner_name
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      WHERE g.is_active = TRUE
        AND g.deleted_at IS NULL
        AND g.lat IS NOT NULL
        AND g.lng IS NOT NULL
    `;
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND g.type = $${paramIndex++}`;
      params.push(type);
    }
    if (categories) {
      if (typeof categories !== 'string' || categories.length > 500) {
        return res.status(400).json({ error: 'categories parameter invalid' });
      }
      const list = categories.split(',').map(c => c.trim()).filter(Boolean).slice(0, 20);
      if (list.length > 0) {
        query += ` AND g.category ILIKE ANY($${paramIndex++}::text[])`;
        params.push(list);
      }
    }

    query += ` ORDER BY g.created_at DESC LIMIT 500`;

    const result = await db.query(query, params);
    setCached(cacheKey, result.rows, 30_000);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching map pins:', err);
    res.status(500).json({ error: 'Kartendaten konnten nicht geladen werden' });
  }
};
