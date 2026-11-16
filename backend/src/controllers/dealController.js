import db from '../config/database.js';
import { sendPushToUsers } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';
import { resolveCreateLocation } from '../utils/geocode.js';

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
// Only users who opted in to news & deals pushes (users.push_news, default
// OFF — App Store Guideline 4.5.4, the same opt-in the news push honours,
// 16.11.2026): before, every account in the city got this ad. Fails CLOSED
// like newsController: a missing column (boot window) is never consent.
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
         AND u.push_news = TRUE
         AND u.location ILIKE $1
       LIMIT 500`,
      [`%${city}%`]
    );
    // One bulk send (single subscriptions SELECT) instead of up to 500
    // sequential per-user sends.
    await sendPushToUsers(
      result.rows.map(r => r.id),
      pushTexts('newDeal', { city, dealText: `${deal.name} — ${deal.deal_label}` }),
      null,
      `/deal/${deal.id}`
    );
  } catch (err) {
    if (err?.code === '42703') {
      console.warn('[deals] users.push_news missing (boot window) — no deal push sent');
      return;
    }
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
       FROM deals d
       WHERE is_active = TRUE
         AND (visible_until IS NULL OR visible_until > NOW())
         -- Auto-offline once the global redemption cap is hit (NULL = unlimited).
         -- Counts the CURRENT round only, so "Neue Runde starten" reopens a
         -- capped deal (a 'once' deal's period_key IS its round).
         AND (max_redemptions IS NULL
              OR (SELECT COUNT(*) FROM deal_redemptions dr
                   WHERE dr.deal_id = d.id AND dr.period_key = (${PERIOD_KEY_SQL})) < max_redemptions)
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
const REDEEM_INTERVALS = ['once', 'daily', 'weekly'];

// Sanitize a weekday array → sorted unique ISO weekday ints (1=Mon … 7=Sun).
// Empty / absent / invalid → null (no weekday restriction).
function parseRedeemDays(input) {
  if (!Array.isArray(input)) return null;
  const days = [...new Set(input.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
  return days.length ? days : null;
}

export const createDeal = async (req, res) => {
  const { name, category, deal_label, description, address, lat, lng, photos, booking_url, visible_until, max_redemptions, redeem_interval, redeem_days } = req.body;
  if (!name || !deal_label) {
    return res.status(400).json({ error: 'name and deal_label are required' });
  }
  const intervalParsed = REDEEM_INTERVALS.includes(redeem_interval) ? redeem_interval : 'once';
  const redeemDaysParsed = parseRedeemDays(redeem_days);
  // Global redemption cap. undefined → DB default (100); ''/null → unlimited.
  let maxRedemptionsParsed = 100;
  if (max_redemptions === null || max_redemptions === '') {
    maxRedemptionsParsed = null;
  } else if (max_redemptions !== undefined) {
    const n = parseInt(max_redemptions, 10);
    if (Number.isNaN(n) || n < 1) return res.status(400).json({ error: 'max_redemptions muss eine positive Zahl sein' });
    maxRedemptionsParsed = n;
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
  // If the client gave an address but no coordinates, geocode it (Austria-first,
  // same as groups/clubs) so the deal-detail map can render. Non-blocking on
  // failure — the deal still saves, just without a map pin.
  let dealLat = lat ?? null;
  let dealLng = lng ?? null;
  if ((dealLat === null || dealLng === null) && address) {
    // Region gate — reject an address that resolves outside the launch markets.
    const geo = await resolveCreateLocation(address);
    if (!geo.ok) {
      return res.status(400).json({ error: 'Diese Adresse liegt außerhalb der verfügbaren Regionen (Österreich, Deutschland, Schweiz, Italien, Frankreich, Spanien).' });
    }
    if (geo.coords) { dealLat = geo.coords.lat; dealLng = geo.coords.lng; }
  }
  try {
    const result = await db.query(
      `INSERT INTO deals (name, category, deal_label, description, address, lat, lng, photos, booking_url, visible_until, max_redemptions, redeem_interval, redeem_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        name,
        category || 'Lokal',
        deal_label,
        description || null,
        address || null,
        dealLat,
        dealLng,
        JSON.stringify(Array.isArray(photos) ? photos : []),
        booking_url || null,
        visibleUntilParsed,
        maxRedemptionsParsed,
        intervalParsed,
        redeemDaysParsed,
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
  const { name, category, deal_label, description, address, lat, lng, photos, booking_url, is_active, visible_until, max_redemptions, redeem_interval, redeem_days } = req.body;
  if (redeem_interval !== undefined && !REDEEM_INTERVALS.includes(redeem_interval)) {
    return res.status(400).json({ error: 'redeem_interval muss once, daily oder weekly sein' });
  }
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
  if (redeem_interval !== undefined) fields.redeem_interval = redeem_interval;
  if (redeem_days !== undefined) fields.redeem_days = parseRedeemDays(redeem_days);
  if (visible_until !== undefined) fields.visible_until = visibleUntilParsed;
  if (max_redemptions !== undefined) {
    // ''/null → unlimited; otherwise a positive int.
    if (max_redemptions === null || max_redemptions === '') {
      fields.max_redemptions = null;
    } else {
      const n = parseInt(max_redemptions, 10);
      if (Number.isNaN(n) || n < 1) return res.status(400).json({ error: 'max_redemptions muss eine positive Zahl sein' });
      fields.max_redemptions = n;
    }
  }

  // Address changed but no explicit coordinates sent → re-geocode so the map
  // pin follows the new address (mirrors group/club update behaviour). Explicit
  // lat/lng in the request still win.
  if (address !== undefined && address && lat === undefined && lng === undefined) {
    // Region gate — reject an address that resolves outside the launch markets.
    const geo = await resolveCreateLocation(address);
    if (!geo.ok) {
      return res.status(400).json({ error: 'Diese Adresse liegt außerhalb der verfügbaren Regionen (Österreich, Deutschland, Schweiz, Italien, Frankreich, Spanien).' });
    }
    if (geo.coords) { fields.lat = geo.coords.lat; fields.lng = geo.coords.lng; }
  }

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

// SQL fragment deriving the CURRENT period key from a deals row aliased `d`.
// 'once' deals key on a constant (→ once ever); daily/weekly key on the
// calendar day / ISO week so a user may redeem again next period. Computed in
// Postgres (handles ISO weeks correctly) and reused by status + redeem so both
// always agree. No user input — safe to interpolate.
// 'once' deals additionally carry the admin's redeem_round: round 0 stays the
// bare 'once' every existing row was written with; "Neue Runde starten" bumps
// it to 'once:1', 'once:2', … so the same users may redeem again while the old
// rows stay in the stats. Defined with `const` BEFORE getDeals runs (module
// scope, evaluated at import), so the template above may reference it.
const PERIOD_KEY_SQL = `CASE d.redeem_interval
    WHEN 'daily'  THEN 'd:' || to_char(now(), 'YYYY-MM-DD')
    WHEN 'weekly' THEN 'w:' || to_char(now(), 'IYYY-IW')
    ELSE CASE WHEN COALESCE(d.redeem_round, 0) = 0 THEN 'once' ELSE 'once:' || d.redeem_round END END`;

// True when the deal has no weekday restriction OR today (ISO weekday 1=Mon …
// 7=Sun, in the DB's timezone) is one of the allowed days. Reused by status +
// redeem so the displayed gate and the enforced gate always agree.
const REDEEMABLE_TODAY_SQL = `(d.redeem_days IS NULL
    OR cardinality(d.redeem_days) = 0
    OR EXTRACT(ISODOW FROM now())::int = ANY(d.redeem_days))`;

// ── Deals at events (P4 v1, Tina 16.11.2026) ──────────────────────────────
// What an event may show: a deal that is live and can still be redeemed, by
// exactly redeemDeal's rule — active, not past visible_until, and the cap of
// the CURRENT round only for 'once' deals. A daily/weekly deal runs on its
// schedule (redeemDeal never caps it), so it must not drop off the event when
// one day's quota is used up — unlike the feed (getDeals), which hides any
// deal at its period cap. A weekday restriction is no reason to hide it:
// DealDetail shows the allowed days. Alias `d`, like PERIOD_KEY_SQL above.
const DEAL_VISIBLE_SQL = `d.is_active = TRUE
         AND (d.visible_until IS NULL OR d.visible_until > NOW())
         AND (d.redeem_interval <> 'once'
              OR (SELECT COUNT(*) FROM deal_redemptions dr
                   WHERE dr.deal_id = d.id AND dr.period_key = (${PERIOD_KEY_SQL}))
                 < COALESCE(d.max_redemptions, 2147483647))`;

/**
 * The visible deal of each event, in ONE query for a whole list (the event
 * page asks for one id, the club's event list for all of its events).
 * → Map(group_id → { id, name, deal_label, photo, verified }). Every JAMIE
 * deal is put up by an admin, so all count as checked („Geprüfter Partner“) —
 * club-made deals (v2) will have to earn `verified`. Never throws: a missing
 * table (boot window, 42P01) is simply „no deal“, anything else is logged and
 * the page still loads without one.
 */
export async function getDealsForEvents(groupIds) {
  const deals = new Map();
  const ids = [...new Set((groupIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return deals;
  try {
    const { rows } = await db.query(
      `SELECT ed.group_id, d.id, d.name, d.deal_label, d.photos->>0 AS photo
         FROM event_deals ed
         JOIN deals d ON d.id = ed.deal_id
        WHERE ed.group_id = ANY($1::int[])
          AND ${DEAL_VISIBLE_SQL}`,
      [ids]
    );
    for (const r of rows) {
      deals.set(r.group_id, { id: r.id, name: r.name, deal_label: r.deal_label, photo: r.photo || null, verified: true });
    }
  } catch (err) {
    if (err?.code !== '42P01') console.error('[deals] event deal lookup failed:', err.message);
  }
  return deals;
}

// The events each deal hangs on, for the admin list. Soft-deleted events drop
// out (their link stays behind but nothing shows it); a missing table (boot
// window) reads as none. → Map(deal_id → [{ id, name, date }]).
async function attachedEventsByDeal() {
  const byDeal = new Map();
  try {
    const { rows } = await db.query(
      `SELECT ed.deal_id, g.id, g.name, g.date
         FROM event_deals ed
         JOIN groups g ON g.id = ed.group_id
        WHERE g.deleted_at IS NULL
        ORDER BY g.date ASC NULLS LAST, g.id`
    );
    for (const r of rows) {
      if (!byDeal.has(r.deal_id)) byDeal.set(r.deal_id, []);
      byDeal.get(r.deal_id).push({ id: r.id, name: r.name, date: r.date });
    }
  } catch (err) {
    if (err?.code !== '42P01') console.error('[deals] attached events lookup failed:', err.message);
  }
  return byDeal;
}

export const getRedemptionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    // redeemed = redeemed in the CURRENT period (not ever) for periodic deals.
    const result = await db.query(
      `SELECT d.redeem_interval,
              d.redeem_days,
              ${REDEEMABLE_TODAY_SQL} AS redeemable_today,
              dr.redeemed_at
       FROM deals d
       LEFT JOIN deal_redemptions dr
         ON dr.deal_id = d.id AND dr.user_id = $2 AND dr.period_key = (${PERIOD_KEY_SQL})
       WHERE d.id = $1
       ORDER BY dr.redeemed_at DESC
       LIMIT 1`,
      [id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Deal not found' });
    const row = result.rows[0];
    res.json({
      redeemed: !!row.redeemed_at,
      count: row.redeemed_at ? 1 : 0,
      max: MAX_REDEMPTIONS_PER_USER,
      redeemed_at: row.redeemed_at || null,
      redeem_interval: row.redeem_interval || 'once',
      redeem_days: row.redeem_days || null,
      redeemable_today: row.redeemable_today !== false,
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
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the deal row so concurrent redeems of the SAME deal serialize. This
    // makes the 'once' global max_redemptions cap exact — without the lock two
    // users redeeming at the cap boundary could both pass the COUNT check below
    // and overshoot by 1-2. Mirrors the FOR UPDATE capacity pattern used for
    // group joins. Also confirms the deal is still visible (admins may have
    // disabled/expired it after the page opened) + fetches the weekday gate.
    const dealRes = await client.query(
      `SELECT d.id, d.redeem_days, ${REDEEMABLE_TODAY_SQL} AS redeemable_today
       FROM deals d
       WHERE d.id = $1 AND d.is_active = TRUE
         AND (d.visible_until IS NULL OR d.visible_until > NOW())
       FOR UPDATE`,
      [id]
    );
    if (!dealRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Weekday gate: e.g. "nur donnerstags einlösbar". Distinct 422 so the
    // client can show the allowed days instead of a generic error.
    if (dealRes.rows[0].redeemable_today === false) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Dieser Deal ist heute nicht einlösbar.',
        code: 'WRONG_DAY',
        redeem_days: dealRes.rows[0].redeem_days || [],
      });
    }

    // Atomic redeem under the deal-row lock. period_key is derived per the
    // deal's interval (once/daily/weekly) so UNIQUE(deal_id,user_id,period_key)
    // enforces "once per period" and absorbs concurrent double-taps. The global
    // max_redemptions cap applies ONLY to 'once' deals — recurring deals run on
    // schedule, so a lifetime cap would wrongly take them offline. 0 rows ⇒
    // already redeemed this period (conflict) OR ('once') cap hit.
    const inserted = await client.query(
      `INSERT INTO deal_redemptions (deal_id, user_id, period_key)
       SELECT d.id, $2, (${PERIOD_KEY_SQL})
       FROM deals d
       WHERE d.id = $1
         AND (
           d.redeem_interval <> 'once'
           OR (SELECT COUNT(*) FROM deal_redemptions
                WHERE deal_id = d.id AND period_key = (${PERIOD_KEY_SQL}))
                < COALESCE(d.max_redemptions, 2147483647)
         )
       ON CONFLICT (deal_id, user_id, period_key) DO NOTHING
       RETURNING redeemed_at`,
      [id, req.userId]
    );
    if (inserted.rows.length) {
      await client.query('COMMIT');
      return res.status(201).json({
        redeemed: true,
        count: 1,
        max: MAX_REDEMPTIONS_PER_USER,
        redeemed_at: inserted.rows[0].redeemed_at,
      });
    }

    // No row inserted — tell apart "already redeemed THIS period" (keep their
    // proof, 409) from "global cap reached" (deal is now offline, 410 Gone).
    const existing = await client.query(
      `SELECT dr.redeemed_at
       FROM deals d
       JOIN deal_redemptions dr
         ON dr.deal_id = d.id AND dr.user_id = $2 AND dr.period_key = (${PERIOD_KEY_SQL})
       WHERE d.id = $1
       ORDER BY dr.redeemed_at DESC
       LIMIT 1`,
      [id, req.userId]
    );
    await client.query('COMMIT');
    if (existing.rows.length) {
      return res.status(409).json({
        error: 'Already redeemed',
        redeemed: true,
        count: 1,
        max: MAX_REDEMPTIONS_PER_USER,
        redeemed_at: existing.rows[0].redeemed_at,
      });
    }
    return res.status(410).json({ error: 'Dieser Deal ist nicht mehr verfügbar.', code: 'DEAL_SOLD_OUT' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('redeemDeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// ==========================================
// ADMIN — LIST DEALS  (includes expired + inactive, joins redemption count)
// ==========================================
// The public getDeals filters by is_active + visible_until; the admin view
// needs to see every deal that ever existed plus how many users have redeemed
// each. The LEFT JOIN keeps zero-redemption rows in the result.
// Since 16.11.2026 each row also carries `events` — the events the deal hangs
// on ([{ id, name, date }], P4 v1), additive for the dashboard.
export const getDealsForAdmin = async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT d.id, d.name, d.category, d.deal_label, d.description,
              d.address, d.lat, d.lng, d.photos, d.booking_url,
              d.visible_until, d.is_active, d.max_redemptions, d.created_at, d.updated_at,
              d.redeem_interval, COALESCE(d.redeem_round, 0)::int AS redeem_round,
              COALESCE(r.cnt, 0)::int AS redemption_count,
              r.last_redeemed_at,
              -- Current round only: this is what the cap compares against.
              (SELECT COUNT(*)::int FROM deal_redemptions dr
                WHERE dr.deal_id = d.id AND dr.period_key = (${PERIOD_KEY_SQL})) AS round_redemption_count
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
    const events = await attachedEventsByDeal();
    res.json(result.rows.map((d) => ({ ...d, events: events.get(d.id) || [] })));
  } catch (err) {
    console.error('getDealsForAdmin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// ADMIN — DEAL AT AN EVENT   PUT /api/deals/event/:groupId   body: { deal_id }
// ==========================================
// P4 v1 (Tina 16.11.2026): a JAMIE admin hangs ONE deal on an event — a club
// event or a meetup, also a café's deal that belongs to no club at all (Café
// Soleá at a JAMIE event). deal_id null takes it off again. The event page
// (getGroupById) and the club's event list (getClubEvents) then embed it
// while DEAL_VISIBLE_SQL holds. Answers { group_id, deal_id, deal }: `deal` is
// what the event page shows right now — null for one attached but not
// visible (expired, inactive, sold out), so the dashboard can say so.
// No cache to bust: neither reader is cached, and no feed carries the deal.
const toPositiveInt = (v) => {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

export const setEventDeal = async (req, res) => {
  const groupId = toPositiveInt(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: 'Ungültige Event-ID' });
  const rawDealId = req.body?.deal_id;
  const dealId = rawDealId === null ? null : toPositiveInt(rawDealId);
  if (rawDealId !== null && !dealId) {
    return res.status(400).json({ error: 'deal_id muss eine Deal-ID oder null sein' });
  }
  try {
    const event = await db.query('SELECT type FROM groups WHERE id = $1 AND deleted_at IS NULL', [groupId]);
    if (!event.rows.length) return res.status(404).json({ error: 'Event nicht gefunden' });
    if (event.rows[0].type !== 'event' && event.rows[0].type !== 'group') {
      return res.status(400).json({ error: 'Deals hängen an Events und Treffen, nicht an Clubs.', code: 'NOT_AN_EVENT' });
    }
    if (dealId === null) {
      await db.query('DELETE FROM event_deals WHERE group_id = $1', [groupId]);
    } else {
      const deal = await db.query('SELECT 1 FROM deals WHERE id = $1', [dealId]);
      if (!deal.rows.length) return res.status(404).json({ error: 'Deal not found' });
      // One deal per event: hanging another one replaces it.
      await db.query(
        `INSERT INTO event_deals (group_id, deal_id, attached_by) VALUES ($1, $2, $3)
         ON CONFLICT (group_id) DO UPDATE
           SET deal_id = EXCLUDED.deal_id, attached_by = EXCLUDED.attached_by, created_at = NOW()`,
        [groupId, dealId, req.userId]
      );
    }
    const shown = await getDealsForEvents([groupId]);
    console.log(`[admin] user ${req.userId} ${dealId ? `attached deal ${dealId} to` : 'took the deal off'} group ${groupId}`);
    res.json({ group_id: groupId, deal_id: dealId, deal: shown.get(groupId) || null });
  } catch (err) {
    if (err?.code === '42P01') {
      // Boot window: event_deals is not there yet.
      return res.status(503).json({
        error: 'Deals an Events sind gleich wieder verfügbar. Bitte versuche es in einer Minute erneut.',
        code: 'EVENT_DEALS_UNAVAILABLE',
      });
    }
    // The event or the deal was hard-deleted between the check and the write.
    if (err?.code === '23503') return res.status(404).json({ error: 'Event oder Deal nicht gefunden' });
    console.error('setEventDeal error:', err);
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
// ADMIN — NEW ROUND  ("Neue Runde starten")
// ==========================================
// Reopens a 'once' deal for everyone who already redeemed it, keeping every
// old redemption for the stats/CSV. Only meaningful for 'once' deals — daily
// and weekly ones roll over on their own, so we refuse instead of silently
// doing nothing. The bump is atomic; the cap restarts because it counts the
// current round only.
//
// Optional body.visible_until (Tina 26.09.2026, "nur das Datum aktualisieren"):
// a deal is a library entry — reopening it usually means a new end date too,
// so both happen in one call. Absent = keep the date, null/'' = no expiry.
export const startNewRound = async (req, res) => {
  const { visible_until } = req.body || {};
  const setDate = visible_until !== undefined;
  let visibleUntilParsed = null;
  if (visible_until) {
    const d = new Date(visible_until);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'visible_until ist kein gültiges Datum' });
    if (d.getTime() < Date.now() - 24 * 3600 * 1000) return res.status(400).json({ error: 'Das neue Ablaufdatum liegt in der Vergangenheit' });
    visibleUntilParsed = d.toISOString();
  }
  try {
    const result = await db.query(
      `UPDATE deals
          SET redeem_round = COALESCE(redeem_round, 0) + 1,
              visible_until = CASE WHEN $2::boolean THEN $3::timestamp ELSE visible_until END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND redeem_interval = 'once'
        RETURNING id, redeem_round, visible_until`,
      [req.params.id, setDate, visibleUntilParsed]
    );
    if (!result.rows.length) {
      const exists = await db.query('SELECT redeem_interval FROM deals WHERE id = $1', [req.params.id]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Deal not found' });
      return res.status(409).json({ error: 'Nur einmalig einlösbare Deals haben Runden — wöchentliche/tägliche starten von selbst neu.', code: 'NOT_ONCE' });
    }
    res.json({ id: result.rows[0].id, redeem_round: result.rows[0].redeem_round, visible_until: result.rows[0].visible_until });
  } catch (err) {
    console.error('startNewRound error:', err);
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
