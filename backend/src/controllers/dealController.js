import db from '../config/database.js';
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

// Fire-and-forget: push a "Neues Angebot" to users whose location contains the
// deal's city. Only users with an active web push subscription are queried.
// Capped at 500 recipients per deal to bound the worst-case fan-out cost.
async function notifyNearbyUsersAboutDeal(deal) {
  if (!deal?.id) return;
  const city = cityFromAddress(deal.address);
  if (!city) return; // unknown city — skip rather than spam everyone
  try {
    const result = await db.query(
      `SELECT DISTINCT u.id
       FROM users u
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
// LIST DEALS  (visible to everyone, filtered by visible_until)
// ==========================================
// Pro gate removed 2026-06-09: Robert wants cooperations to mix into Explore
// + Home feeds for all users. Visibility is now controlled by visible_until
// (admin-set expiry) instead of subscription status.
export const getDeals = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, category, deal_label, description, address, lat, lng, photos, booking_url, visible_until, created_at
       FROM deals
       WHERE is_active = TRUE
         AND (visible_until IS NULL OR visible_until > NOW())
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getDeals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SINGLE DEAL  (visible to everyone)
// ==========================================
export const getDeal = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT id, name, category, deal_label, description, address, lat, lng, photos, booking_url, visible_until, created_at
       FROM deals
       WHERE id = $1 AND is_active = TRUE
         AND (visible_until IS NULL OR visible_until > NOW())`,
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
  const { name, category, deal_label, description, address, lat, lng, photos, booking_url, visible_until } = req.body;
  if (!name || !deal_label) {
    return res.status(400).json({ error: 'name and deal_label are required' });
  }
  const validationError = validateDealInputs({ lat, lng, booking_url, photos, name, deal_label, description, address });
  if (validationError) return res.status(400).json({ error: validationError });
  // visible_until: optional ISO date/datetime; NULL = no expiry
  let visibleUntilParsed = null;
  if (visible_until) {
    const d = new Date(visible_until);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'visible_until ist kein gültiges Datum' });
    visibleUntilParsed = d.toISOString();
  }
  try {
    const result = await db.query(
      `INSERT INTO deals (name, category, deal_label, description, address, lat, lng, photos, booking_url, visible_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
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
        visibleUntilParsed,
      ]
    );
    const newDeal = result.rows[0];
    // Fan out push notifications to nearby users — must never block or fail the
    // create response, so fire-and-forget with its own try/catch.
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
  const { name, category, deal_label, description, address, lat, lng, photos, booking_url, is_active, visible_until } = req.body;
  const validationError = validateDealInputs({ lat, lng, booking_url, photos, name, deal_label, description, address });
  if (validationError) return res.status(400).json({ error: validationError });
  let visibleUntilParsed = null;
  if (visible_until) {
    const d = new Date(visible_until);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'visible_until ist kein gültiges Datum' });
    visibleUntilParsed = d.toISOString();
  }
  // PARTIAL update: only columns the client actually sent are written. The
  // admin edit form sends a subset (no category/address/lat/lng/...) — the
  // old full-column UPDATE turned every absent field into NULL, which 500'd
  // on category (NOT NULL) and silently wiped address/coords/booking_url.
  // `undefined` = untouched; explicit `null` = clear (description, expiry).
  const fields = {};
  if (name !== undefined)        fields.name = name;
  if (category !== undefined)    fields.category = category;
  if (deal_label !== undefined)  fields.deal_label = deal_label;
  if (description !== undefined) fields.description = description;
  if (address !== undefined)     fields.address = address;
  if (lat !== undefined)         fields.lat = lat;
  if (lng !== undefined)         fields.lng = lng;
  if (photos !== undefined)      fields.photos = JSON.stringify(Array.isArray(photos) ? photos : []);
  if (booking_url !== undefined) fields.booking_url = booking_url || null;
  if (is_active !== undefined)   fields.is_active = !!is_active;
  if (visible_until !== undefined) fields.visible_until = visibleUntilParsed;

  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'Keine Änderungen übergeben' });

  try {
    // Column names come from the fixed allowlist above — not user input.
    const setSql = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
    const values = keys.map(k => fields[k]);
    values.push(id);
    const result = await db.query(
      `UPDATE deals SET ${setSql}, updated_at=CURRENT_TIMESTAMP
       WHERE id=$${keys.length + 1} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Deal not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('updateDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// GET REDEMPTION STATUS  (caller's status for this deal)
// ==========================================
// Returns { redeemed, count, max, redeemed_at } so the client can render
// "0/1 mal eingelöst" before, "1/1 mal eingelöst" after, and disable the
// redeem CTA once max is reached. max is 1 today (hard cap per user, ever).
const MAX_REDEMPTIONS_PER_USER = 1;

export const getRedemptionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT redeemed_at FROM deal_redemptions
       WHERE deal_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    const row = result.rows[0];
    res.json({
      redeemed: !!row,
      count: row ? 1 : 0,
      max: MAX_REDEMPTIONS_PER_USER,
      redeemed_at: row?.redeemed_at || null,
    });
  } catch (err) {
    console.error('getRedemptionStatus error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// REDEEM DEAL  (one-shot per user)
// ==========================================
// UNIQUE(deal_id, user_id) catches concurrent double-taps at the DB level;
// the unique_violation branch turns that into a 409 instead of a 500.
export const redeemDeal = async (req, res) => {
  const { id } = req.params;
  try {
    // Confirm the deal is still visible — admins may have disabled or expired
    // it after the user opened the page.
    const dealRes = await db.query(
      `SELECT id FROM deals
       WHERE id = $1 AND is_active = TRUE
         AND (visible_until IS NULL OR visible_until > NOW())`,
      [id]
    );
    if (!dealRes.rows.length) return res.status(404).json({ error: 'Deal not found' });

    const inserted = await db.query(
      `INSERT INTO deal_redemptions (deal_id, user_id) VALUES ($1, $2)
       RETURNING redeemed_at`,
      [id, req.userId]
    );
    res.status(201).json({
      redeemed: true,
      count: 1,
      max: MAX_REDEMPTIONS_PER_USER,
      redeemed_at: inserted.rows[0].redeemed_at,
    });
  } catch (err) {
    if (err.code === '23505') {
      // Already redeemed — surface as 409 with the existing timestamp so the
      // client can still render the proof screen if it wants to.
      const existing = await db.query(
        `SELECT redeemed_at FROM deal_redemptions
         WHERE deal_id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      return res.status(409).json({
        error: 'Already redeemed',
        redeemed: true,
        count: 1,
        max: MAX_REDEMPTIONS_PER_USER,
        redeemed_at: existing.rows[0]?.redeemed_at || null,
      });
    }
    console.error('redeemDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ADMIN — LIST DEALS  (includes expired + inactive, joins redemption count)
// ==========================================
// The public getDeals filters by is_active + visible_until; the admin view
// needs to see every deal that ever existed plus how many users have redeemed
// each. The LEFT JOIN keeps zero-redemption rows in the result.
export const getDealsForAdmin = async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT d.id, d.name, d.category, d.deal_label, d.description,
              d.address, d.lat, d.lng, d.photos, d.booking_url,
              d.visible_until, d.is_active, d.created_at, d.updated_at,
              COALESCE(r.cnt, 0)::int AS redemption_count,
              r.last_redeemed_at
       FROM deals d
       LEFT JOIN (
         SELECT deal_id,
                COUNT(*)::int AS cnt,
                MAX(redeemed_at) AS last_redeemed_at
         FROM deal_redemptions
         GROUP BY deal_id
       ) r ON r.deal_id = d.id
       ORDER BY d.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getDealsForAdmin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ADMIN — LIST REDEMPTIONS for a single deal
// ==========================================
// Returns each redeeming user with their name + email + timestamp. Lets the
// admin reconcile with the venue if a dispute comes up. Capped at 1000 rows
// per deal — we'll page if we ever ship a deal big enough to need it.
export const getDealRedemptions = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT dr.id, dr.redeemed_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM deal_redemptions dr
       JOIN users u ON u.id = dr.user_id
       WHERE dr.deal_id = $1
       ORDER BY dr.redeemed_at DESC
       LIMIT 1000`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('getDealRedemptions error:', err);
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
