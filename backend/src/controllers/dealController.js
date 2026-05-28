import db from '../config/database.js';
import { isUserPro } from './subscriptionController.js';

function validateDealInputs({ lat, lng, booking_url }) {
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
  const validationError = validateDealInputs({ lat, lng, booking_url });
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
    res.status(201).json(result.rows[0]);
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
  const validationError = validateDealInputs({ lat, lng, booking_url });
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
