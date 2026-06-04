import db from '../config/database.js';
import { isUserPro } from './subscriptionController.js';
import { sendPushToUser } from './pushController.js';

// Try to extract the city from a free-form address. Most DACH addresses end in
// "PLZ City" (e.g. "Hauptstraße 1, 1010 Wien"). We take the last comma-separated
// segment, strip a leading postal code, and trim. Returns null on failure.
function cityFromAddress(addr) {
  if (!addr || typeof addr !== 'string') return null;
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  const cleaned = last.replace(/^\d{3,6}\s+/, '').trim();
  return cleaned.length >= 2 ? cleaned : null;
}

// Fire-and-forget: push a "Neues Angebot" to Pro users whose location contains
// the deal's city. Only users with an active web push subscription are queried.
// Capped at 500 recipients per deal to bound the worst-case fan-out cost.
async function notifyNearbyUsersAboutDeal(deal) {
  if (!deal?.id) return;
  const city = cityFromAddress(deal.address);
  if (!city) return; // unknown city — skip rather than spam everyone
  try {
    const result = await db.query(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN subscriptions s ON s.user_id = u.id
         AND s.status IN ('active','canceling')
         AND s.current_period_end > NOW()
       JOIN push_subscriptions ps ON ps.user_id = u.id
       WHERE u.is_active = TRUE
         AND u.location ILIKE $1
       LIMIT 500`,
      [`%${city}%`]
    );
    for (const row of result.rows) {
      sendPushToUser(
        row.id,
        `Neues Angebot in ${city}`,
        `${deal.name} — ${deal.deal_label}`,
        `/deal/${deal.id}`
      );
    }
  } catch (err) {
    console.error('[deals] notifyNearbyUsersAboutDeal failed:', err.message);
  }
}

function validateDealInputs({ lat, lng, booking_url, photos, name, deal_label, description, address }) {
  if (lat !== null && lat !== undefined) {
    const n = parseFloat(lat);
    if (isNaN(n) || n < -90 || n > 90) return 'lat must be between -90 and 90';
  }
  if (lng !== null && lng !== undefined) {
    const n = parseFloat(lng);
    if (isNaN(n) || n < -180 || n > 180) return 'lng must be between -180 and 180';
  }
  if (booking_url) {
    try {
      const u = new URL(booking_url);
      if (!['http:', 'https:'].includes(u.protocol)) return 'booking_url must use http or https';
    } catch {
      return 'booking_url is not a valid URL';
    }
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > 255)) return 'name invalid';
  if (deal_label !== undefined && (typeof deal_label !== 'string' || deal_label.length > 100)) return 'deal_label invalid';
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 2000)) return 'description invalid';
  if (address !== undefined && address !== null && (typeof address !== 'string' || address.length > 500)) return 'address invalid';
  if (photos !== undefined && photos !== null) {
    if (!Array.isArray(photos) || photos.length > 12) return 'photos must be an array of <=12 URLs';
    for (const p of photos) {
      if (typeof p !== 'string' || p.length > 1024) return 'photo URL invalid';
      // Each photo must be a parseable http(s) URL — blocks javascript:, data:, etc.
      try {
        const u = new URL(p);
        if (!['http:', 'https:'].includes(u.protocol)) return 'photo URL must be http(s)';
      } catch {
        return 'photo URL is not a valid URL';
      }
    }
  }
  return null;
}

// ==========================================
// LIST DEALS  (Pro-gated)
// ==========================================
export const getDeals = async (req, res) => {
  try {
    const pro = await isUserPro(req.userId);
    if (!pro) {
      return res.status(403).json({ error: 'Pro subscription required', code: 'PRO_REQUIRED' });
    }
    const result = await db.query(
      `SELECT id, name, category, deal_label, description, address, lat, lng, photos, booking_url, created_at
       FROM deals
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getDeals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SINGLE DEAL  (Pro-gated)
// ==========================================
export const getDeal = async (req, res) => {
  try {
    const pro = await isUserPro(req.userId);
    if (!pro) {
      return res.status(403).json({ error: 'Pro subscription required', code: 'PRO_REQUIRED' });
    }
    const { id } = req.params;
    const result = await db.query(
      `SELECT id, name, category, deal_label, description, address, lat, lng, photos, booking_url, created_at
       FROM deals WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Deal not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('getDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ADMIN — CREATE DEAL
// ==========================================
export const createDeal = async (req, res) => {
  const { name, category, deal_label, description, address, lat, lng, photos, booking_url } = req.body;
  if (!name || !deal_label) {
    return res.status(400).json({ error: 'name and deal_label are required' });
  }
  const validationError = validateDealInputs({ lat, lng, booking_url, photos, name, deal_label, description, address });
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const result = await db.query(
      `INSERT INTO deals (name, category, deal_label, description, address, lat, lng, photos, booking_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        name,
        category || 'Lokal',
        deal_label,
        description || null,
        address || null,
        lat ?? null,
        lng ?? null,
        JSON.stringify(Array.isArray(photos) ? photos : []),
        booking_url || null,
      ]
    );
    const newDeal = result.rows[0];
    // Fan out push notifications to nearby Pro users — must never block or
    // fail the create response, so fire-and-forget with its own try/catch.
    notifyNearbyUsersAboutDeal(newDeal).catch(() => {});
    res.status(201).json(newDeal);
  } catch (err) {
    console.error('createDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ADMIN — UPDATE DEAL
// ==========================================
export const updateDeal = async (req, res) => {
  const { id } = req.params;
  const { name, category, deal_label, description, address, lat, lng, photos, booking_url, is_active } = req.body;
  const validationError = validateDealInputs({ lat, lng, booking_url, photos, name, deal_label, description, address });
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const result = await db.query(
      `UPDATE deals
       SET name=$1, category=$2, deal_label=$3, description=$4,
           address=$5, lat=$6, lng=$7, photos=$8, booking_url=$9, is_active=$10,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=$11 RETURNING *`,
      [name, category, deal_label, description, address, lat ?? null, lng ?? null,
       JSON.stringify(Array.isArray(photos) ? photos : []), booking_url || null,
       is_active ?? true, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Deal not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ADMIN — DELETE DEAL (soft)
// ==========================================
export const deleteDeal = async (req, res) => {
  try {
    await db.query(
      'UPDATE deals SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Deal deactivated' });
  } catch (err) {
    console.error('deleteDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
