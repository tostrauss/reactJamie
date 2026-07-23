import db from '../config/database.js';
import { getCached, setCached } from '../utils/cache.js';
import { geocodeAllowedRegion } from '../utils/geocode.js';

/**
 * GET /api/map/geocode?q=...
 * Austria-only geocode used by the create-group/club location field as a
 * fallback when Google Places doesn't surface a dropdown to pick from. Returns
 * { ok: true, lat, lng, label } when the text resolves to a place in Austria,
 * or { ok: false } otherwise.
 */
export const geocodeQuery = async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 2 || q.length > 200) {
      return res.status(400).json({ ok: false, error: 'invalid query' });
    }
    const result = await geocodeAllowedRegion(q);
    if (!result) return res.json({ ok: false });
    res.json({ ok: true, lat: result.lat, lng: result.lng, label: result.label });
  } catch (err) {
    console.error('Geocode query error:', err);
    res.status(500).json({ ok: false, error: 'geocode failed' });
  }
};

/**
 * GET /api/map/pins
 * Returns all active groups/clubs with lat/lng for map display.
 * Query params: type (group|club), category
 */
export const getMapPins = async (req, res) => {
  try {
    const { type, categories, dateFilter } = req.query;

    if (dateFilter && !['heute', 'morgen'].includes(dateFilter)) {
      return res.status(400).json({ error: 'dateFilter must be heute or morgen' });
    }

    const cacheKey = `map:${type || ''}:${categories || ''}:${dateFilter || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Date filter is only applied when the UI explicitly asks for Heute/Morgen.
    // Default (no filter) returns every active pin so the "Alle" view actually
    // shows clubs AND groups regardless of their event date.
    let dateCondition = '';
    if (dateFilter === 'heute') {
      dateCondition = `AND g.date >= CURRENT_DATE AND g.date < CURRENT_DATE + INTERVAL '1 day'`;
    } else if (dateFilter === 'morgen') {
      dateCondition = `AND g.date >= CURRENT_DATE + INTERVAL '1 day' AND g.date < CURRENT_DATE + INTERVAL '2 days'`;
    }

    // Approval gate: pending/rejected clubs never appear on the public map.
    // Groups (type='group') are unaffected — they keep their default
    // 'approved' status from the migration. Owners can still see their own
    // pending clubs via /api/clubs (list endpoint), just not on the map.
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
        AND g.approval_status = 'approved'
        -- Don't expose private groups' exact coordinates on the public,
        -- unauthenticated map (mirrors suggestionController's filter).
        AND g.is_private IS NOT TRUE
        -- Hide PAST dated entries always (even on "Alle"): groups + club events
        -- have a date, so once it's in the past the pin is stale. Clubs have no
        -- date (NULL) → always shown as ongoing venues. Future events appear.
        AND (g.date IS NULL OR g.date >= CURRENT_DATE)
        ${dateCondition}
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
        // OR-match: primary category (ILIKE) OR any of the multi-category array
        // overlaps the requested list (&&). NULL categories falls back to primary.
        query += ` AND (g.category ILIKE ANY($${paramIndex}::text[]) OR g.categories && $${paramIndex}::text[])`;
        params.push(list);
        paramIndex++;
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
