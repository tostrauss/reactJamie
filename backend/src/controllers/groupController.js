import db from '../config/database.js';
import { geocodeLocation } from '../utils/geocode.js';
import { checkTextSafety } from '../config/moderation.js';
import { sendPushToUser } from './pushController.js';
import { getCached, setCached, invalidatePrefix, deleteCached } from '../utils/cache.js';
import { postSystemMessage } from '../utils/systemMessage.js';
import { isUserPro } from './subscriptionController.js';

const GROUPS_TTL  = 30_000;  // 30 s — acceptable staleness for list views
const AVATARS_TTL = 60_000;  // 60 s — avatars change only on join/leave

// ==========================================
// PIONEER HELPER
// Checks if a newly-created group is the first in its ~50km cell.
// If yes: awards pioneer badge + a free 7-day boost.
// ==========================================
async function checkAndAwardPioneer(userId, groupId, lat, lng) {
  try {
    const RADIUS_KM = 50;

    // Count other active groups within radius (Haversine formula)
    const nearbyRes = await db.query(
      `SELECT COUNT(*) AS count FROM groups
       WHERE is_active = TRUE
         AND id != $1
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND (
           6371 * acos(
             LEAST(1, cos(radians($2)) * cos(radians(lat))
               * cos(radians(lng) - radians($3))
               + sin(radians($2)) * sin(radians(lat))
             )
           )
         ) < $4`,
      [groupId, lat, lng, RADIUS_KM]
    );

    if (parseInt(nearbyRes.rows[0].count) > 0) return; // not pioneer territory

    // Grid cell: 0.5° ≈ 40-55 km
    const latCell = Math.floor(lat / 0.5) * 0.5;
    const lngCell = Math.floor(lng / 0.5) * 0.5;

    // Race-safe insert — ON CONFLICT means someone else was faster
    const claim = await db.query(
      `INSERT INTO pioneer_claims (user_id, group_id, lat_cell, lng_cell)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lat_cell, lng_cell) DO NOTHING
       RETURNING id`,
      [userId, groupId, latCell, lngCell]
    );

    if (claim.rowCount === 0) return; // cell already claimed

    // Award pioneer badge
    await db.query('UPDATE users SET is_pioneer = TRUE WHERE id = $1', [userId]);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[pioneer] user ${userId} claimed cell (${latCell}, ${lngCell}) for group ${groupId}`);
    }
  } catch (err) {
    // Non-critical — must not fail group creation
    console.error('[pioneer] check error:', err.message);
  }
}

// ==========================================
// CREATE GROUP / CLUB
// ==========================================
export const createGroup = async (req, res) => {
  const { name, description, type, category, date, time, location, image_url, max_members, is_private, skill_level, chat_only_owner, target_age_min, target_age_max, is_recurring_weekly } = req.body;
  const userId = req.userId; // JWT auth (not session)

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  if (name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
  if (description && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });
  if (location && location.length > 200) return res.status(400).json({ error: 'Ort darf maximal 200 Zeichen lang sein' });

  try {
    // Per-user daily limit: max 10 groups/clubs created in 24 hours
    const dailyCount = await db.query(
      `SELECT COUNT(*) FROM groups WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (parseInt(dailyCount.rows[0].count) >= 10) {
      return res.status(429).json({ error: 'Du kannst maximal 10 Gruppen pro Tag erstellen.' });
    }

    const textToCheck = [name, description].filter(Boolean).join('\n');
    const { safe, reason } = await checkTextSafety(textToCheck);
    if (!safe) {
      return res.status(422).json({ error: reason });
    }

    // Combine date + time if both provided
    let dateTime = date || null;
    if (date && time) {
      dateTime = `${date}T${time}`;
    }

    // Events must be in the future (clubs have no date, so skip check).
    // Two modes:
    //   - date-only payload ("2026-06-15"): "today or later" is OK because
    //     the exact time is coordinated later in the chat.
    //   - date+time payload ("2026-06-15T18:00"): must be a future timestamp.
    if (dateTime && (type === 'group' || !type)) {
      const eventDate = new Date(dateTime);
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'Ungültiges Datum' });
      }
      const hasTime = typeof dateTime === 'string' && dateTime.includes('T');
      if (hasTime) {
        if (eventDate <= new Date()) {
          return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
        }
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const eventDay = new Date(eventDate);
        eventDay.setHours(0, 0, 0, 0);
        if (eventDay < today) {
          return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
        }
      }
    }

    // Validate max_members
    const parsedMax = parseInt(max_members, 10);
    if (max_members !== undefined && (isNaN(parsedMax) || parsedMax < 2 || parsedMax > 500)) {
      return res.status(400).json({ error: 'Maximale Teilnehmerzahl muss zwischen 2 und 500 liegen' });
    }

    // Validate target age range: optional, but if either bound is set it must
    // be a sane integer 14-99, and min <= max. Frontend should enforce this too.
    const parseAge = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? NaN : n;
    };
    const ageMin = parseAge(target_age_min);
    const ageMax = parseAge(target_age_max);
    if (Number.isNaN(ageMin) || Number.isNaN(ageMax)) {
      return res.status(400).json({ error: 'Ungültige Altersangabe' });
    }
    if ((ageMin !== null && (ageMin < 14 || ageMin > 99)) ||
        (ageMax !== null && (ageMax < 14 || ageMax > 99))) {
      return res.status(400).json({ error: 'Alter muss zwischen 14 und 99 liegen' });
    }
    if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
      return res.status(400).json({ error: 'Mindestalter darf nicht größer als Maximalalter sein' });
    }

    // Geocode location (non-blocking on failure)
    const coords = await geocodeLocation(location);

    // Weekly recurrence only applies to events (type='group'); silently ignored for clubs.
    const recurringWeekly = !!is_recurring_weekly && (type === 'group' || !type);

    const result = await db.query(
      `INSERT INTO groups (name, description, type, category, date, location, image_url, max_members, is_private, skill_level, owner_id, lat, lng, chat_only_owner, target_age_min, target_age_max, is_recurring_weekly)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [name, description, type || 'group', category, dateTime, location, image_url, max_members || 10, is_private || false, skill_level, userId, coords?.lat ?? null, coords?.lng ?? null, chat_only_owner || false, ageMin, ageMax, recurringWeekly]
    );

    const newGroup = result.rows[0];

    // Auto-add creator as member
    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [newGroup.id, userId, 'owner']
    );

    // Pioneer check (fire-and-forget — must not block the response)
    if (coords?.lat && coords?.lng) {
      checkAndAwardPioneer(userId, newGroup.id, coords.lat, coords.lng).catch(() => {});
    }

    // Welcome system message (fire-and-forget, no live broadcast — nobody is
    // in the chat yet anyway).
    const welcomeText = (type || 'group') === 'club'
      ? `Willkommen bei ${newGroup.name}! Stell euch kurz vor 👋`
      : `Willkommen bei ${newGroup.name}! Stell dich kurz vor 👋`;
    postSystemMessage(newGroup.id, welcomeText).catch(() => {});

    invalidatePrefix('groups:');
    invalidatePrefix('map:');
    res.status(201).json(newGroup);
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht erstellt werden' });
  }
};

// ==========================================
// GET ALL GROUPS (with filters)
// ==========================================
export const getGroups = async (req, res) => {
  try {
    const { type, search, category, location, upcoming, limit, offset } = req.query;

    if (search && search.length > 100) return res.status(400).json({ error: 'Suchbegriff zu lang' });

    // #1 Pro gate: non-Pro, non-admin callers see only 3 member previews per
    // group; Pro users AND admins see up to 4. The frontend blurs just the 4th
    // (bottom-right) tile as the "unlock with Pro" gate for the gated audience.
    //
    // Pro flag + caller age + admin flag in ONE round trip (was two: a separate
    // isUserPro subscriptions SELECT + a users SELECT, both before the cache
    // check). EXISTS predicate mirrors isUserPro exactly. Users without DOB are
    // included in everything (friendly default, Tina).
    let callerAge = null;
    let callerIsAdmin = false;
    let callerIsPro = false;
    if (req.userId) {
      try {
        const r = await db.query(
          `SELECT EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age,
                  is_admin,
                  EXISTS(
                    SELECT 1 FROM subscriptions s
                    WHERE s.user_id = users.id
                      AND (s.status = 'active' OR s.status = 'canceling')
                      AND s.current_period_end > NOW()
                  ) AS is_pro
           FROM users WHERE id = $1`,
          [req.userId]
        );
        callerAge = r.rows[0]?.age ?? null;
        callerIsAdmin = !!r.rows[0]?.is_admin;
        callerIsPro = !!r.rows[0]?.is_pro;
      } catch (err) {
        // subscriptions table not bootstrapped yet → no Pro; still need age/admin
        if (err.code === '42P01') {
          const r = await db.query(
            'SELECT EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age, is_admin FROM users WHERE id = $1',
            [req.userId]
          );
          callerAge = r.rows[0]?.age ?? null;
          callerIsAdmin = !!r.rows[0]?.is_admin;
        } else {
          throw err;
        }
      }
    }

    // Admins bypass the gate entirely → full 4 previews like Pro.
    const previewLimit = (callerIsPro || callerIsAdmin) ? 4 : 3;

    // Cache only filter combinations that don't involve free-text search or location
    // (those are low-frequency, high-variability and not worth the memory).
    // Pro flag + admin flag + caller age are part of the key so users with
    // different visibility never share a cache row.
    const cacheKey = !search && !location
      ? `groups:${type || ''}:${category || ''}:${upcoming || ''}:${limit || ''}:${offset || ''}:p${callerIsPro ? 1 : 0}:adm${callerIsAdmin ? 1 : 0}:a${callerAge ?? 'x'}`
      : null;
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }

    let query = `
      SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
             EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age,
             CASE WHEN g.members_count >= g.max_members THEN 1 ELSE 0 END as is_full,
             (
               SELECT COALESCE(json_agg(sub), '[]'::json)
               FROM (
                 SELECT u2.id, u2.name, u2.avatar_url,
                        EXTRACT(YEAR FROM AGE(u2.date_of_birth))::int AS age
                 FROM group_members gm
                 JOIN users u2 ON gm.user_id = u2.id
                 WHERE gm.group_id = g.id
                 ORDER BY gm.joined_at ASC
                 LIMIT ${previewLimit}
               ) sub
             ) AS member_previews,
             ages.age_min,
             ages.age_max,
             EXISTS (
               SELECT 1 FROM boosts b
               WHERE b.target_id = g.id AND b.target_type = g.type
                 AND b.boosted_until > NOW()
             ) AS is_boosted
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      LEFT JOIN LATERAL (
        SELECT MIN(EXTRACT(YEAR FROM AGE(uu.date_of_birth))::int) AS age_min,
               MAX(EXTRACT(YEAR FROM AGE(uu.date_of_birth))::int) AS age_max
        FROM group_members gmx
        JOIN users uu ON gmx.user_id = uu.id
        WHERE gmx.group_id = g.id AND uu.date_of_birth IS NOT NULL
      ) ages ON TRUE
      WHERE g.is_active = TRUE AND g.deleted_at IS NULL AND g.type IN ('group', 'club')
    `;
    const params = [];
    let paramIndex = 1;

    // Apply target-age hard filter. NULL caller age = pass everything; otherwise
    // exclude groups whose [min,max] range doesn't contain the caller.
    if (callerAge !== null) {
      query += ` AND (g.target_age_min IS NULL OR g.target_age_min <= $${paramIndex})
                 AND (g.target_age_max IS NULL OR g.target_age_max >= $${paramIndex})`;
      params.push(callerAge);
      paramIndex++;
    }

    if (type) {
      query += ` AND g.type = $${paramIndex++}`;
      params.push(type);
    }
    if (search) {
      query += ` AND (g.name ILIKE $${paramIndex} OR g.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category) {
      query += ` AND g.category ILIKE $${paramIndex++}`;
      params.push(category);
    }
    if (location) {
      query += ` AND g.location ILIKE $${paramIndex++}`;
      params.push(`%${location}%`);
    }
    if (upcoming === 'true') {
      // Weekly recurring events never go "past" — the next occurrence rolls
      // forward forever, so include them regardless of g.date.
      query += ` AND (g.date >= CURRENT_TIMESTAMP OR g.is_recurring_weekly = TRUE)`;
    }

    // Boosted entries float to the top (paid "Top-Platzierung", 24h) — the
    // EXISTS probe is served by idx_boosts_target. Then full groups sink,
    // newest first within each tier.
    query += ` ORDER BY is_boosted DESC, is_full ASC, g.created_at DESC`;

    const safeLimit = Math.min(parseInt(limit, 10) || 100, 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    query += ` LIMIT $${paramIndex++}`;
    params.push(safeLimit);
    if (safeOffset > 0) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(safeOffset);
    }

    const result = await db.query(query, params);
    if (cacheKey) setCached(cacheKey, result.rows, GROUPS_TTL);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ error: 'Gruppen konnten nicht geladen werden' });
  }
};

// ==========================================
// GET SINGLE GROUP BY ID
// ==========================================
export const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age,
              (
                SELECT MIN(EXTRACT(YEAR FROM AGE(u2.date_of_birth))::int)
                FROM group_members gm
                JOIN users u2 ON gm.user_id = u2.id
                WHERE gm.group_id = g.id AND u2.date_of_birth IS NOT NULL
              ) AS age_min,
              (
                SELECT MAX(EXTRACT(YEAR FROM AGE(u3.date_of_birth))::int)
                FROM group_members gm2
                JOIN users u3 ON gm2.user_id = u3.id
                WHERE gm2.group_id = g.id AND u3.date_of_birth IS NOT NULL
              ) AS age_max
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.id = $1 AND g.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }

    const group = result.rows[0];

    // Check if current user is member/favorite/pending (if authenticated)
    if (req.userId) {
      const [memberCheck, favCheck, requestCheck, waitlistCheck] = await Promise.all([
        db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
        db.query('SELECT 1 FROM group_favorites WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
        db.query(
          `SELECT status FROM group_join_requests WHERE group_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 1`,
          [id, req.userId]
        ),
        db.query(
          `SELECT status, position FROM group_waitlist WHERE group_id = $1 AND user_id = $2`,
          [id, req.userId]
        ),
      ]);
      group.is_member = memberCheck.rows.length > 0;
      // Co-manager (clubs): owner OR a member promoted to role='admin'. Lets the
      // edit page + manage UI grant access to managers, not just the owner.
      group.my_role = memberCheck.rows[0]?.role || null;
      group.is_manager = Number(group.owner_id) === Number(req.userId) || memberCheck.rows[0]?.role === 'admin';
      group.is_favorite = favCheck.rows.length > 0;
      group.join_request_status = requestCheck.rows[0]?.status || null;
      group.waitlist_status = waitlistCheck.rows[0]?.status || null;
      group.waitlist_position = waitlistCheck.rows[0]?.position || null;
    }

    res.json(group);
  } catch (err) {
    console.error('Error fetching group:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// UPDATE GROUP (owner only)
// ==========================================
export const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, date, location, image_url, max_members, is_private, skill_level, chat_only_owner, target_age_min, target_age_max, is_recurring_weekly, moment_photo_url } = req.body;

    if (name !== undefined && name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
    if (description !== undefined && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });
    if (location !== undefined && location.length > 200) return res.status(400).json({ error: 'Ort darf maximal 200 Zeichen lang sein' });

    // Same age-range validation as createGroup; null clears the bound.
    const parseAgeUpdate = (v) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? NaN : n;
    };
    const ageMinU = parseAgeUpdate(target_age_min);
    const ageMaxU = parseAgeUpdate(target_age_max);
    if (Number.isNaN(ageMinU) || Number.isNaN(ageMaxU)) {
      return res.status(400).json({ error: 'Ungültige Altersangabe' });
    }
    if ((typeof ageMinU === 'number' && (ageMinU < 14 || ageMinU > 99)) ||
        (typeof ageMaxU === 'number' && (ageMaxU < 14 || ageMaxU > 99))) {
      return res.status(400).json({ error: 'Alter muss zwischen 14 und 99 liegen' });
    }
    if (typeof ageMinU === 'number' && typeof ageMaxU === 'number' && ageMinU > ageMaxU) {
      return res.status(400).json({ error: 'Mindestalter darf nicht größer als Maximalalter sein' });
    }

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    const textToCheck = [name, description].filter(Boolean).join('\n');
    if (textToCheck) {
      const { safe, reason } = await checkTextSafety(textToCheck);
      if (!safe) {
        return res.status(422).json({ error: reason });
      }
    }

    // Validate future date on update (groups only, clubs have no date).
    // Skip the future check when the (incoming or stored) event is weekly
    // recurring — past start dates are normal for recurring series. Date-only
    // payloads also pass when the date is today (time is set in chat).
    if (date !== undefined && date !== null) {
      const eventDate = new Date(date);
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'Ungültiges Datum' });
      }
      let recurringForCheck = !!is_recurring_weekly;
      if (is_recurring_weekly === undefined) {
        const cur = await db.query('SELECT is_recurring_weekly FROM groups WHERE id = $1', [id]);
        recurringForCheck = !!cur.rows[0]?.is_recurring_weekly;
      }
      if (!recurringForCheck) {
        const hasTime = typeof date === 'string' && date.includes('T');
        if (hasTime) {
          if (eventDate <= new Date()) {
            return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
          }
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const eventDay = new Date(eventDate);
          eventDay.setHours(0, 0, 0, 0);
          if (eventDay < today) {
            return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
          }
        }
      }
    }

    // Validate max_members is not set below current member count
    if (max_members !== undefined) {
      const parsedMax = parseInt(max_members, 10);
      if (isNaN(parsedMax) || parsedMax < 2 || parsedMax > 500) {
        return res.status(400).json({ error: 'Maximale Teilnehmerzahl muss zwischen 2 und 500 liegen' });
      }
      const countRes = await db.query('SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = $1', [id]);
      const currentCount = parseInt(countRes.rows[0]?.cnt ?? 0, 10);
      if (parsedMax < currentCount) {
        return res.status(400).json({ error: `Gruppe hat bereits ${currentCount} Mitglieder. Maximale Teilnehmerzahl darf nicht darunter liegen.` });
      }
    }

    // Re-geocode if location is being updated
    let latUpdate = null;
    let lngUpdate = null;
    if (location !== undefined) {
      const coords = await geocodeLocation(location);
      latUpdate = coords?.lat ?? null;
      lngUpdate = coords?.lng ?? null;
    }

    invalidatePrefix('groups:');
    if (location !== undefined) invalidatePrefix('map:');

    // Sentinels: ageMin/MaxU is `undefined` when client didn't touch the field
    // (keep existing), `null` when explicitly clearing, integer when setting.
    const result = await db.query(
      `UPDATE groups
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           date = COALESCE($4, date),
           location = COALESCE($5, location),
           image_url = COALESCE($6, image_url),
           max_members = COALESCE($7, max_members),
           is_private = COALESCE($8, is_private),
           skill_level = COALESCE($9, skill_level),
           chat_only_owner = COALESCE($13, chat_only_owner),
           target_age_min = CASE WHEN $14::text = '__keep__' THEN target_age_min ELSE NULLIF($14, '__null__')::int END,
           target_age_max = CASE WHEN $15::text = '__keep__' THEN target_age_max ELSE NULLIF($15, '__null__')::int END,
           is_recurring_weekly = COALESCE($16, is_recurring_weekly),
           moment_photo_url = COALESCE($17, moment_photo_url),
           lat = CASE WHEN $5 IS NOT NULL THEN $11 ELSE lat END,
           lng = CASE WHEN $5 IS NOT NULL THEN $12 ELSE lng END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [
        name, description, category, date, location, image_url, max_members, is_private, skill_level,
        id, latUpdate, lngUpdate, chat_only_owner ?? null,
        ageMinU === undefined ? '__keep__' : (ageMinU === null ? '__null__' : String(ageMinU)),
        ageMaxU === undefined ? '__keep__' : (ageMaxU === null ? '__null__' : String(ageMaxU)),
        is_recurring_weekly === undefined ? null : !!is_recurring_weekly,
        moment_photo_url ?? null,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht aktualisiert werden' });
  }
};

// ==========================================
// DELETE GROUP (owner only)
// ==========================================
export const deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Soft delete — preserves messages, reviews, and member history
    await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [id]);
    invalidatePrefix('groups:');
    invalidatePrefix('map:');
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    console.error('Error deleting group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht gelöscht werden' });
  }
};

// ==========================================
// JOIN GROUP
// ==========================================
export const joinGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Single query: group info + membership check via LEFT JOIN
    const groupRes = await db.query(
      `SELECT g.owner_id, g.name, g.members_count, g.max_members, g.is_private,
              gm.user_id AS already_member
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [id, req.userId]
    );
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (groupRes.rows[0].already_member) return res.status(400).json({ error: 'Already a member' });

    // Check capacity
    const g = groupRes.rows[0];
    if (g.members_count >= g.max_members) {
      return res.status(400).json({ error: 'Die Gruppe ist bereits voll' });
    }

    // Private group → create join request (or reset a previous rejection to pending)
    if (g.is_private) {
      const existingReq = await db.query(
        `SELECT status FROM group_join_requests WHERE group_id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (existingReq.rows.length > 0 && existingReq.rows[0].status === 'pending') {
        return res.status(400).json({ error: 'Beitrittsanfrage bereits ausstehend' });
      }

      await db.query(
        `INSERT INTO group_join_requests (group_id, user_id, message)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, user_id)
         DO UPDATE SET status = 'pending', message = $3, updated_at = CURRENT_TIMESTAMP`,
        [id, req.userId, message || null]
      );
      // Notify owner about the new join request (fire-and-forget)
      if (g.owner_id && Number(g.owner_id) !== Number(req.userId)) {
        notifyJoinRequest(req.userId, g.owner_id, g.name || '', id).catch(() => {});
      }
      return res.json({ message: 'Join request sent', status: 'pending' });
    }

    // Public group → join inside a transaction with FOR UPDATE to prevent TOCTOU race
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Re-check capacity under lock so concurrent requests can't both sneak in
      const locked = await client.query(
        'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (locked.rows[0].members_count >= locked.rows[0].max_members) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Die Gruppe ist bereits voll' });
      }
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [id, req.userId, 'member']
      );
      await client.query('DELETE FROM group_waitlist WHERE group_id = $1 AND user_id = $2', [id, req.userId]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Notify group owner (fire-and-forget)
    if (g.owner_id && Number(g.owner_id) !== Number(req.userId)) {
      notifyGroupJoin(req.userId, g.owner_id, g.name || '', id).catch(() => {});
    }

    // Post a "X ist beigetreten 🎉" system message, broadcast live to anyone
    // currently in the chat room. Fire-and-forget — never let it break the join.
    db.query('SELECT name FROM users WHERE id = $1', [req.userId])
      .then(r => {
        const name = r.rows[0]?.name || 'Jemand';
        postSystemMessage(id, `${name} ist der Gruppe beigetreten 🎉`, req.app.get('io')).catch(() => {});
      })
      .catch(() => {});

    deleteCached(`user_groups:${req.userId}`);
    res.json({ message: 'Joined group successfully', status: 'joined' });
  } catch (err) {
    console.error('Error joining group:', err);
    res.status(500).json({ error: 'Beitritt fehlgeschlagen' });
  }
};

// ==========================================
// LEAVE GROUP
// ==========================================
export const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent owner from leaving (they must delete the group)
    const group = await db.query('SELECT owner_id, members_count, max_members FROM groups WHERE id = $1', [id]);
    if (group.rows.length > 0 && Number(group.rows[0].owner_id) === Number(req.userId)) {
      return res.status(400).json({ error: 'Als Ersteller kannst du die Gruppe nicht verlassen – lösche sie stattdessen.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not a member of this group' });
    }

    // If group was full, notify first person on waitlist (spot just opened)
    const g = group.rows[0];
    if (g.members_count >= g.max_members) {
      const waitlistUser = await db.query(
        `SELECT user_id FROM group_waitlist
         WHERE group_id = $1 AND status = 'waiting'
         ORDER BY position ASC LIMIT 1`,
        [id]
      );

      if (waitlistUser.rows.length > 0) {
        const wUserId = waitlistUser.rows[0].user_id;

        // Mark as notified so frontend shows "Jetzt beitreten"
        await db.query(
          `UPDATE group_waitlist SET status = 'notified', notified_at = CURRENT_TIMESTAMP
           WHERE group_id = $1 AND user_id = $2`,
          [id, wUserId]
        );

        // In-app notification
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
           VALUES ($1, 'waitlist_opening', 'Platz frei!', 'Ein Platz ist in deiner Warteliste-Gruppe frei geworden.', 'group', $2)`,
          [wUserId, id]
        );

        // Push notification
        // group name already in `group.rows[0]` — no extra query needed
        const grpName = group.rows[0]?.name || '';
        sendPushToUser(wUserId, 'Platz frei!', `Ein Platz in "${grpName}" ist frei geworden`, `/group/${id}`);
      }
    }

    deleteCached(`user_groups:${req.userId}`);
    res.json({ message: 'Left group successfully' });
  } catch (err) {
    console.error('Error leaving group:', err);
    res.status(500).json({ error: 'Verlassen fehlgeschlagen' });
  }
};

// ==========================================
// TOGGLE FAVORITE
// ==========================================
export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if already favorited
    const existing = await db.query(
      'SELECT * FROM group_favorites WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (existing.rows.length > 0) {
      // Remove favorite
      await db.query(
        'DELETE FROM group_favorites WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      return res.json({ favorited: false, message: 'Removed from favorites' });
    }

    // Add favorite
    await db.query(
      'INSERT INTO group_favorites (group_id, user_id) VALUES ($1, $2)',
      [id, req.userId]
    );
    res.json({ favorited: true, message: 'Added to favorites' });
  } catch (err) {
    console.error('Error toggling favorite:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET USER FAVORITES
// ==========================================
export const getUserFavorites = async (req, res) => {
  try {
    // Filter by type='group' so this endpoint only returns group favourites —
    // clubs live in the same table and have their own /api/clubs/user/favorites
    // endpoint. Without the type filter Profile.jsx concatenated both lists
    // and rendered every favourited club twice.
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM group_favorites gf
       JOIN groups g ON gf.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE gf.user_id = $1
         AND g.deleted_at IS NULL
         AND g.is_active = TRUE
         AND g.type = 'group'
       ORDER BY gf.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET GROUP MEMBERS
// ==========================================
export const getGroupMembers = async (req, res) => {
  try {
    const { id } = req.params;

    // No is_private 403 for GROUPS here: the Home feed embeds member_previews
    // for private groups to every viewer, so hiding the same people on the
    // detail page only rendered an empty photo grid (tester bug 2026-06-11).
    // "Privat" gates JOINING (request flow), not the member preview — the
    // Pro gate below limits what non-members see either way.
    const groupRes = await db.query(
      'SELECT type, is_private FROM groups WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }

    const isCallerMember = (await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    )).rows.length > 0;

    // CLUBS resolve through this route too (legacy /group/:id links — same
    // table). Their roster privacy is owned by getClubMembers, which 403s
    // private clubs to non-members; mirror that here so the club rule cannot
    // be bypassed by swapping /clubs/ for /groups/ in the URL.
    if (groupRes.rows[0].type === 'club' && groupRes.rows[0].is_private && !isCallerMember) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const fullList = await db.query(
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.location, u.is_trusted_user,
              gm.role, gm.joined_at,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
         -- Hide blocked users from each other (bidirectional), same rule the
         -- user-search surface enforces.
         AND u.id NOT IN (
           SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
           FROM friendships
           WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2)
         )
       ORDER BY gm.joined_at ASC`,
      [id, req.userId]
    );
    const total = fullList.rows.length;

    // #1 Pro gate: members of the group always see the whole roster (they're
    // already in the group). Non-members who are NOT Pro see only the first
    // 3 entries; the frontend renders the next slot as a blurred locked tile
    // with a ProModal CTA. Pro non-members get the full roster (that is the
    // ProModal's literal promise, "alle Mitglieder sehen" — note this is more
    // than the Home feed's 4-preview cap); admins bypass like staff everywhere.
    const callerIsPro = req.userId ? await isUserPro(req.userId) : false;
    let callerIsAdmin = false;
    if (!isCallerMember && !callerIsPro && req.userId) {
      const adm = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      callerIsAdmin = !!adm.rows[0]?.is_admin;
    }
    if (!isCallerMember && !callerIsPro && !callerIsAdmin) {
      return res.json({
        // Same field set the Home feed previews expose (+ the trusted badge
        // the grids render). bio/location/role/joined_at stay members-only.
        members: fullList.rows.slice(0, 3).map(m => ({
          id: m.id,
          name: m.name,
          avatar_url: m.avatar_url,
          age: m.age,
          is_trusted_user: m.is_trusted_user,
        })),
        total_count: total,
        gated: true,
      });
    }
    return res.json({
      members: fullList.rows,
      total_count: total,
      gated: false,
    });
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ error: 'Mitglieder konnten nicht geladen werden' });
  }
};

// ==========================================
// GET USER'S JOINED GROUPS
// ==========================================
export const getUserGroups = async (req, res) => {
  try {
    const cacheKey = `user_groups:${req.userId}`;
    // ?fresh=1 — used by the nav unread badge, which must reflect read
    // markers immediately. Bypasses the cache in BOTH directions: no stale
    // read, and no setCached either (writing here could re-cache a result
    // that raced a concurrent read-stamp invalidation).
    const fresh = req.query.fresh === '1';
    if (!fresh) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }

    const result = await db.query(
      `SELECT g.id, g.name, g.type, g.category, g.image_url, g.is_private,
              g.max_members, g.members_count, g.location, g.date, g.deleted_at,
              g.chat_only_owner, g.parent_club_id,
              u.name as owner_name, gm.role,
              lm.content as last_message,
              lm.created_at as last_message_time,
              lm_user.name as last_message_sender,
              (SELECT COUNT(*)::int FROM messages m2
                WHERE m2.group_id = g.id
                  AND m2.created_at > COALESCE(gm.last_read_at, gm.joined_at)
                  AND m2.user_id IS DISTINCT FROM $1
                  AND m2.message_type IS DISTINCT FROM 'system'
              ) AS unread_count
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       LEFT JOIN LATERAL (
         SELECT m.content, m.created_at, m.user_id
         FROM messages m
         WHERE m.group_id = g.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON TRUE
       LEFT JOIN users lm_user ON lm.user_id = lm_user.id
       WHERE gm.user_id = $1
         AND g.deleted_at IS NULL
       ORDER BY lm.created_at DESC NULLS LAST, gm.joined_at DESC`,
      [req.userId]
    );
    if (!fresh) setCached(cacheKey, result.rows, 15_000);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user groups:', err);
    res.status(500).json({ error: 'Gruppen konnten nicht geladen werden' });
  }
};

// ==========================================
// GET JOIN REQUESTS (owner only)
// ==========================================
export const getJoinRequests = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    const result = await db.query(
      `SELECT jr.*, u.name as user_name, u.avatar_url as user_avatar, u.bio as user_bio,
              u.interests as user_interests, u.date_of_birth as user_dob,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS user_age,
              u.is_trusted_user as user_trusted
       FROM group_join_requests jr
       JOIN users u ON jr.user_id = u.id
       WHERE jr.group_id = $1 AND jr.status = 'pending'
       ORDER BY jr.created_at DESC
       LIMIT 100`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching join requests:', err);
    res.status(500).json({ error: 'Anfragen konnten nicht geladen werden' });
  }
};

// ==========================================
// HANDLE JOIN REQUEST (accept/reject)
// ==========================================
export const handleJoinRequest = async (req, res) => {
  try {
    const { id, requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    // Verify ownership + fetch group name in one query
    const [groupRes, request] = await Promise.all([
      db.query('SELECT owner_id, name FROM groups WHERE id = $1', [id]),
      db.query('SELECT user_id, status FROM group_join_requests WHERE id = $1 AND group_id = $2', [requestId, id]),
    ]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(groupRes.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const joinReq = request.rows[0];
    const gname = groupRes.rows[0].name;

    if (action === 'accept') {
      // Enforce capacity inside a transaction to prevent race with concurrent accepts
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const cap = await client.query(
          'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (cap.rows[0].members_count >= cap.rows[0].max_members) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Gruppe ist bereits voll. Anfrage kann nicht angenommen werden.' });
        }
        await client.query(
          `UPDATE group_join_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [requestId]
        );
        await client.query(
          'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, joinReq.user_id, 'member']
        );
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      sendPushToUser(joinReq.user_id, 'Beitrittsanfrage akzeptiert', `Du bist jetzt Mitglied von "${gname}"`, `/group/${id}`);

      // Post "X ist beigetreten 🎉" so existing members see it. Fire-and-forget.
      db.query('SELECT name FROM users WHERE id = $1', [joinReq.user_id])
        .then(r => {
          const name = r.rows[0]?.name || 'Jemand';
          postSystemMessage(id, `${name} ist der Gruppe beigetreten 🎉`, req.app.get('io')).catch(() => {});
        })
        .catch(() => {});

      res.json({ message: 'Request accepted', status: 'accepted' });
    } else if (action === 'reject') {
      await db.query(
        `UPDATE group_join_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId]
      );
      res.json({ message: 'Request rejected', status: 'rejected' });
    } else {
      res.status(400).json({ error: 'Ungültige Aktion' });
    }
  } catch (err) {
    console.error('Error handling join request:', err);
    res.status(500).json({ error: 'Anfrage konnte nicht verarbeitet werden' });
  }
};

// ==========================================
// KICK/REMOVE MEMBER (owner only)
// ==========================================
export const kickMember = async (req, res) => {
  try {
    const { id, userId } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Cannot kick yourself (owner)
    if (parseInt(userId, 10) === req.userId) {
      return res.status(400).json({ error: 'Du kannst dich nicht selbst entfernen – lösche die Gruppe stattdessen.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Nutzer ist kein Mitglied dieser Gruppe' });
    }

    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Error kicking member:', err);
    res.status(500).json({ error: 'Mitglied konnte nicht entfernt werden' });
  }
};

// ==========================================
// CANCEL GROUP/EVENT (owner only — notifies all members)
// ==========================================
export const cancelGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Verify ownership + fetch members in parallel
    const [groupRes, members] = await Promise.all([
      db.query('SELECT owner_id, name FROM groups WHERE id = $1', [id]),
      db.query('SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2', [id, req.userId]),
    ]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(groupRes.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Mark group as inactive (soft delete)
    await db.query(
      'UPDATE groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    invalidatePrefix('groups:');
    invalidatePrefix('map:');

    const groupName = groupRes.rows[0].name;
    const io = req.app?.get('io');

    if (members.rows.length > 0) {
      const title = `${groupName} wurde abgesagt`;
      const body = reason || 'Das Event wurde vom Ersteller abgesagt.';
      // Batch into chunks of 1000 to avoid PostgreSQL's 65535 bind-parameter limit (5 params × 1000 = 5000)
      const CHUNK = 1000;
      for (let start = 0; start < members.rows.length; start += CHUNK) {
        const chunk = members.rows.slice(start, start + CHUNK);
        const valuesClauses = chunk.map(
          (_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, 'group_cancelled', $${i * 5 + 3}, $${i * 5 + 4}, 'group', $${i * 5 + 5})`
        ).join(', ');
        const params = chunk.flatMap(m => [m.user_id, req.userId, title, body, id]);
        const notifResult = await db.query(
          `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
           VALUES ${valuesClauses} RETURNING *`,
          params
        );
        if (io) {
          for (const notif of notifResult.rows) {
            io.to(`user_${notif.user_id}`).emit('new_notification', notif);
          }
        }
      }
    }

    res.json({ message: 'Group cancelled and members notified', notified: members.rows.length });
  } catch (err) {
    console.error('Error cancelling group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht deaktiviert werden' });
  }
};

// ==========================================
// JOIN WAITLIST
// ==========================================
export const joinWaitlist = async (req, res) => {
  try {
    const { id } = req.params;

    // Three checks in parallel: group exists, already member, already on waitlist
    const [groupRes, memberCheck, waitlistCheck] = await Promise.all([
      db.query('SELECT members_count, max_members FROM groups WHERE id = $1', [id]),
      db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
      db.query('SELECT position FROM group_waitlist WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
    ]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (memberCheck.rows.length > 0) return res.status(400).json({ error: 'Already a member' });
    if (waitlistCheck.rows.length > 0) {
      return res.json({ message: 'Already on waitlist', position: waitlistCheck.rows[0].position });
    }

    const g = groupRes.rows[0];
    if (g.members_count < g.max_members) {
      return res.status(400).json({ error: 'Group not full. Join directly.' });
    }

    const result = await db.query(
      'INSERT INTO group_waitlist (group_id, user_id) VALUES ($1, $2) RETURNING *',
      [id, req.userId]
    );

    res.json({ message: 'Added to waitlist', position: result.rows[0].position });
  } catch (err) {
    console.error('Error joining waitlist:', err);
    res.status(500).json({ error: 'Warteliste-Beitritt fehlgeschlagen' });
  }
};

// ==========================================
// LEAVE WAITLIST
// ==========================================
export const leaveWaitlist = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM group_waitlist WHERE group_id = $1 AND user_id = $2 RETURNING position',
      [id, req.userId]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not on waitlist' });
    }
    res.json({ message: 'Removed from waitlist' });
  } catch (err) {
    console.error('Error leaving waitlist:', err);
    res.status(500).json({ error: 'Warteliste verlassen fehlgeschlagen' });
  }
};

// ==========================================
// GET WAITLIST FOR A GROUP
// ==========================================
export const getWaitlist = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });
    const result = await db.query(
      `SELECT w.*, u.name, u.avatar_url, u.bio
       FROM group_waitlist w
       JOIN users u ON w.user_id = u.id
       WHERE w.group_id = $1 AND w.status = 'waiting'
       ORDER BY w.position ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching waitlist:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET USER'S WAITLIST STATUS FOR A GROUP
// ==========================================
export const getUserWaitlistStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT * FROM group_waitlist WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ on_waitlist: false });
    }
    res.json({
      on_waitlist: true,
      position: result.rows[0].position,
      status: result.rows[0].status
    });
  } catch (err) {
    console.error('Error checking waitlist:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET MEMBER AVATARS FOR CARD DISPLAY
// ==========================================
export const getGroupMemberAvatars = async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 4, 50);

    const group = await db.query('SELECT is_private FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.json([]);

    if (group.rows[0].is_private) {
      // Private groups: auth-dependent, no shared cache
      if (!req.userId) return res.json([]);
      const member = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      if (member.rows.length === 0) return res.json([]);
    } else {
      // Public groups: all users see the same avatars — cache aggressively
      const cacheKey = `avatars:${id}:${limit}`;
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);

      const result = await db.query(
        `SELECT u.id, u.avatar_url, u.name,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
         FROM group_members gm
         JOIN users u ON gm.user_id = u.id
         WHERE gm.group_id = $1
         ORDER BY gm.joined_at ASC
         LIMIT $2`,
        [id, limit]
      );
      setCached(cacheKey, result.rows, AVATARS_TTL);
      return res.json(result.rows);
    }

    const result = await db.query(
      `SELECT u.id, u.avatar_url, u.name
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC
       LIMIT $2`,
      [id, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching avatars:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// INVITE FRIEND TO GROUP (owner only)
// ==========================================
export const inviteMember = async (req, res) => {
  try {
    const { id, friendId } = req.params;

    const group = await db.query('SELECT owner_id, name, max_members FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    const g = group.rows[0];

    // Friendship + existing-member check can race-safely run outside the txn —
    // friendship status doesn't change between checks, and the (group_id,user_id)
    // PK on group_members blocks duplicates regardless.
    const [friendship, existing] = await Promise.all([
      db.query(
        `SELECT 1 FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
        [req.userId, friendId]
      ),
      db.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [id, friendId]),
    ]);
    if (friendship.rows.length === 0) return res.status(403).json({ error: 'Nur Freunde können eingeladen werden' });
    if (existing.rows.length) return res.status(400).json({ error: 'Already a member' });

    // Capacity check + insert inside a transaction with FOR UPDATE so two
    // concurrent invites cannot both pass the count check and both insert,
    // pushing the group over max_members. Mirrors joinGroup / handleJoinRequest.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (locked.rows[0].max_members && locked.rows[0].members_count >= locked.rows[0].max_members) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Group is full' });
      }
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, friendId, 'member']
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await db.query(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, 'group_invite', $3, $4, 'group', $5)`,
      [friendId, req.userId, `Einladung: ${g.name}`, `Du wurdest zur Gruppe "${g.name}" eingeladen!`, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error inviting member:', err);
    res.status(500).json({ error: 'Einladung fehlgeschlagen' });
  }
};

// ── Push helpers (fire-and-forget) ──────────────────────────────────────────
export async function notifyJoinRequest(requesterUserId, ownerUserId, groupName, groupId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [requesterUserId]);
    const name = rows[0]?.name || 'Jemand';
    const target = groupName ? `"${groupName}"` : 'deiner Gruppe';
    sendPushToUser(
      ownerUserId,
      'Neue Beitrittsanfrage',
      `${name} möchte ${target} beitreten`,
      `/group/${groupId}/requests`
    );
  } catch { /* non-critical */ }
}

async function notifyGroupJoin(joinerUserId, ownerUserId, groupName, groupId) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [joinerUserId]);
    const name = rows[0]?.name || 'Jemand';
    // Link to the group itself — '/my-groups' is not a real route (the SW
    // opened it on tap and the owner landed on the 404 page).
    sendPushToUser(ownerUserId, 'Neues Mitglied', `${name} ist "${groupName}" beigetreten`, groupId ? `/group/${groupId}` : '/chats');
  } catch { /* non-critical */ }
}

// ==========================================
// GET CATEGORIES — 1-hour in-memory cache (categories change rarely)
// ==========================================
let _categoriesCache = null;
let _categoriesCacheExp = 0;

export const getCategories = async (_req, res) => {
  try {
    if (_categoriesCache && Date.now() < _categoriesCacheExp) {
      return res.json(_categoriesCache);
    }
    const result = await db.query('SELECT * FROM categories ORDER BY name ASC');
    _categoriesCache = result.rows;
    _categoriesCacheExp = Date.now() + 60 * 60 * 1000;
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
  }
};