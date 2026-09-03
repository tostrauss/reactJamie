import db from '../config/database.js';
import { geocodeLocation, resolveCreateLocation } from '../utils/geocode.js';
import { checkTextSafety } from '../config/moderation.js';
import { getCached, setCached, invalidatePrefix, deleteCached } from '../utils/cache.js';
import { postSystemMessage } from '../utils/systemMessage.js';
import { notifyJoinRequest, notifyGroupJoin, evictFromRoom, creatorHasAvatar, promoteFromWaitlist } from './groupController.js';
import { isUserPro } from './subscriptionController.js';
import { sendPushToUser, sendPushToUsers } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';
import { normalizeCategories } from '../utils/normalizeCategories.js';
import { checkImageField } from '../utils/safeUrl.js';
import { createEntityWithOwner, notifyCancellationFanout } from '../services/entityLifecycle.js';

const CLUBS_TTL = 30_000; // 30 s
const DISCOVER_EVENTS_KEY = 'discover_events';
const DISCOVER_EVENTS_TTL = 60_000; // 60 s — discover feed needn't be real-time

// Helper to ensure we always target clubs
const CLUB_TYPE = 'club';

// Ticket links are rendered as a tappable button on the event page, so only
// http(s) may pass — a `javascript:` or `data:` URL there would be an XSS
// vector. Returns the cleaned absolute URL, or null when absent/invalid.
// A bare "shop.example.com/tickets" is upgraded to https:// rather than
// rejected, since organisers paste links without a scheme all the time.
export const normalizeTicketUrl = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
};

// Anti-churn cap: a user may join any given club at most this many times
// (counted across leaves via group_join_counts) to stop join/leave spam.
const MAX_CLUB_JOINS = 2;

// Shared club management access. A club has ONE owner (groups.owner_id) plus any
// number of co-managers — members with group_members.role = 'admin'. This powers
// the paid "managed club" cooperation: JAMIE staff and the partner co-manage the
// same club (edit profile, create/delete events, handle join requests, remove
// regular members). DESTRUCTIVE / ownership actions (delete or cancel the club,
// assign/revoke managers) stay owner-only — see those handlers.
//
// Owner is checked first so the common case costs no extra query; the membership
// lookup only runs for non-owners.
const userManagesClub = async (clubId, ownerId, userId) => {
  if (ownerId != null && Number(ownerId) === Number(userId)) return true;
  const r = await db.query(
    "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin' LIMIT 1",
    [clubId, userId]
  );
  return r.rows.length > 0;
};

// ==========================================
// CREATE CLUB
// ==========================================
// (normalizeCategories moved to utils/normalizeCategories.js — one copy for
// groups AND clubs, imported above.)

export const createClub = async (req, res) => {
  const {
    name,
    description,
    category,
    categories,
    date,
    time,
    location,
    image_url,
    max_members,
    is_private,
    skill_level,
    events_owner_only
  } = req.body;
  const userId = req.userId;
  // Multi-category: `categories` is the full set (max 3, deduped); `category`
  // stays the PRIMARY (= categories[0]) for all single-category code paths.
  const catList = normalizeCategories(categories, category);
  const primaryCategory = catList[0] || category || null;

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  if (name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
  // Name must contain at least one letter or digit. Tina's call: "ned emoji" —
  // emoji-only names are unreadable in chat lists and unsearchable.
  if (!/[\p{L}\p{N}]/u.test(name)) {
    return res.status(400).json({ error: 'Club-Name muss mindestens einen Buchstaben oder eine Zahl enthalten' });
  }
  if (description && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });
  // See utils/safeUrl.js — this field renders to every viewer and had no check.
  {
    const bad = checkImageField(image_url);
    if (bad) return res.status(400).json({ error: bad });
  }

  try {
    // Profile-photo gate (Tina 2026-08-03) — same rule as createGroup.
    if (!(await creatorHasAvatar(userId))) {
      return res.status(403).json({
        error: 'Bitte lade zuerst ein Profilbild hoch, um einen Club zu gründen.',
        requiresAvatar: true,
      });
    }

    const textToCheck = [name, description].filter(Boolean).join('\n');
    const { safe, reason } = await checkTextSafety(textToCheck);
    if (!safe) return res.status(422).json({ error: reason });

    // Optional: allow a "next meetup" date for clubs
    let dateTime = date || null;
    if (date && time) {
      dateTime = `${date}T${time}`;
    }

    // Region gate: resolve coords only inside the launch markets, and REJECT a
    // location that resolves OUTSIDE them (see createGroup for the rationale).
    // Unresolvable location → club still created, just without a map pin.
    const geo = await resolveCreateLocation(location);
    if (!geo.ok) {
      return res.status(400).json({ error: 'Dieser Ort liegt außerhalb der verfügbaren Regionen (Österreich, Deutschland, Schweiz, Italien, Frankreich, Spanien).' });
    }
    const coords = geo.coords;

    // Approval workflow: clubs created by admins are auto-approved.
    // Everyone else lands in the moderation queue until a human approves.
    const adminCheck = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    const isAdminOwner = !!adminCheck.rows[0]?.is_admin;
    const approval = isAdminOwner ? 'approved' : 'pending';

    // Club row + owner membership in ONE transaction (audit risk #10) —
    // shared core in services/entityLifecycle.js.
    const newClub = await createEntityWithOwner(
      `INSERT INTO groups (
        name,
        description,
        type,
        category,
        categories,
        date,
        location,
        image_url,
        max_members,
        is_private,
        skill_level,
        owner_id,
        lat,
        lng,
        approval_status,
        events_owner_only
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        name,
        description,
        CLUB_TYPE,
        primaryCategory,
        catList.length ? catList : null,
        dateTime,
        location,
        image_url,
        max_members || 100, // Clubs are larger communities by default
        is_private || false,
        skill_level,
        userId,
        coords?.lat ?? null,
        coords?.lng ?? null,
        approval,
        events_owner_only || false
      ],
      userId
    );

    // Welcome system message — no live broadcast (chat is empty on creation).
    postSystemMessage(newClub.id, `Willkommen bei ${newClub.name}! Stell euch kurz vor 👋`).catch(() => {});

    // Notify admin that a new club is waiting for review (fire-and-forget).
    if (approval === 'pending') {
      import('../utils/email.js')
        .then(({ sendAdminClubPendingEmail }) => sendAdminClubPendingEmail?.(newClub, req.userId))
        .catch(() => {});
    }

    invalidatePrefix('clubs:');
    invalidatePrefix('map:');
    res.status(201).json(newClub);
  } catch (err) {
    console.error('Error creating club:', err);
    res.status(500).json({ error: 'Club konnte nicht erstellt werden' });
  }
};

// ==========================================
// GET ALL CLUBS (with filters)
// ==========================================
export const getClubs = async (req, res) => {
  try {
    const { search, category, location, featured, limit, offset } = req.query;

    // Cache key now includes caller identity so users only see their own pending
    // clubs in their cached row; admins get the full set.
    const cacheCallerKey = req.userId || 'anon';
    const cacheKey = !search && !location
      ? `clubs:${category || ''}:${featured || ''}:${limit || ''}:${offset || ''}:${cacheCallerKey}`
      : null;
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }

    // Approval gate: non-admin callers only see approved clubs (or their own).
    // A separate /api/admin/clubs/pending lists everything pending for the
    // moderation queue.
    const callerId = req.userId || 0;
    const callerIsAdmin = await db.query('SELECT is_admin FROM users WHERE id = $1', [callerId])
      .then(r => !!r.rows[0]?.is_admin)
      .catch(() => false);

    let query = `
      SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
             EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age,
             (
               SELECT COALESCE(json_agg(sub), '[]'::json)
               FROM (
                 SELECT u2.id, u2.name, u2.avatar_url,
                        EXTRACT(YEAR FROM AGE(u2.date_of_birth))::int AS age
                 FROM group_members gm
                 JOIN users u2 ON gm.user_id = u2.id
                 WHERE gm.group_id = g.id
                 ORDER BY gm.joined_at ASC
                 LIMIT 8
               ) sub
             ) AS member_previews,
             EXISTS (
               SELECT 1 FROM boosts b
               WHERE b.target_id = g.id AND b.target_type = g.type
                 AND b.boosted_until > NOW()
             ) AS is_boosted
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      WHERE g.is_active = TRUE
        AND g.type = $1
        AND (g.approval_status = 'approved'${callerIsAdmin ? '' : ' OR g.owner_id = $2'})
    `;
    const params = [CLUB_TYPE];
    let paramIndex = 2;
    if (!callerIsAdmin) {
      params.push(parseInt(callerId, 10) || 0);
      paramIndex = 3;
    }

    if (search) {
      query += ` AND (g.name ILIKE $${paramIndex} OR g.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category) {
      // OR-match: a club appears under any of its categories (multi-category),
      // falling back to the primary `category` for rows without an array.
      query += ` AND (g.category ILIKE $${paramIndex} OR $${paramIndex} = ANY(g.categories))`;
      params.push(category);
      paramIndex++;
    }
    if (location) {
      query += ` AND g.location ILIKE $${paramIndex++}`;
      params.push(`%${location}%`);
    }
    if (featured === 'true') {
      query += ` AND g.is_featured = TRUE`;
    }

    // Boosted clubs first (paid 24h "Top-Platzierung"), then newest.
    query += ` ORDER BY is_boosted DESC, g.created_at DESC`;

    const safeLimit = Math.min(parseInt(limit, 10) || 20, 100);
    query += ` LIMIT $${paramIndex++}`;
    params.push(safeLimit);
    if (offset) {
      const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
      query += ` OFFSET $${paramIndex++}`;
      params.push(safeOffset);
    }

    const result = await db.query(query, params);
    if (cacheKey) setCached(cacheKey, result.rows, CLUBS_TTL);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clubs:', err);
    res.status(500).json({ error: 'Clubs konnten nicht geladen werden' });
  }
};

// ==========================================
// GET SINGLE CLUB BY ID
// ==========================================
export const getClubById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.id = $1 AND g.type = $2`,
      [id, CLUB_TYPE]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    const club = result.rows[0];

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
      club.is_member = memberCheck.rows.length > 0;
      // Co-manager flag: owner OR a member promoted to role='admin'. The client
      // uses this to show the manage gear + edit access to managers, not just
      // the owner. (owner_id comes from the SELECT g.* above.)
      club.my_role = memberCheck.rows[0]?.role || null;
      club.is_manager = Number(club.owner_id) === Number(req.userId) || memberCheck.rows[0]?.role === 'admin';
      club.is_favorite = favCheck.rows.length > 0;
      club.join_request_status = requestCheck.rows[0]?.status || null;
      club.waitlist_status = waitlistCheck.rows[0]?.status || null;
      club.waitlist_position = waitlistCheck.rows[0]?.position || null;
    }

    res.json(club);
  } catch (err) {
    console.error('Error fetching club:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// UPDATE CLUB (owner only)
// ==========================================
export const updateClub = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      category,
      categories,
      date,
      location,
      image_url,
      max_members,
      is_private,
      skill_level,
      events_owner_only,
      chat_only_owner
    } = req.body;
    // Multi-category: catList = full set; category column tracks the primary.
    // Empty (neither sent) → null params → COALESCE keeps existing values.
    const catList = normalizeCategories(categories, category);

    if (name !== undefined && name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
    if (name !== undefined && !/[\p{L}\p{N}]/u.test(name)) {
      return res.status(400).json({ error: 'Club-Name muss mindestens einen Buchstaben oder eine Zahl enthalten' });
    }
    if (description !== undefined && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });
    {
      const bad = checkImageField(image_url);
      if (bad) return res.status(400).json({ error: bad });
    }

    // Normalize empty-string date to null. Frontend sends "" when the club has
    // no date set, but Postgres `''::timestamp` throws invalid-input — we want
    // null so COALESCE keeps the existing column value untouched.
    const dateValue = date === '' ? null : date;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    // Owner OR co-manager (role='admin') may edit the club profile. userManagesClub
    // casts to Number internally (req.userId from JWT may be a string).
    if (!(await userManagesClub(id, club.rows[0].owner_id, req.userId))) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const textToCheck = [name, description].filter(Boolean).join('\n');
    if (textToCheck) {
      const { safe, reason } = await checkTextSafety(textToCheck);
      if (!safe) return res.status(422).json({ error: reason });
    }

    // Re-geocode if location is being updated
    let latUpdate = null;
    let lngUpdate = null;
    if (location !== undefined) {
      // Region gate — see createGroup: reject out-of-region, no pin if unresolvable.
      const geo = await resolveCreateLocation(location);
      if (!geo.ok) {
        return res.status(400).json({ error: 'Dieser Ort liegt außerhalb der verfügbaren Regionen (Österreich, Deutschland, Schweiz, Italien, Frankreich, Spanien).' });
      }
      latUpdate = geo.coords?.lat ?? null;
      lngUpdate = geo.coords?.lng ?? null;
    }

    const result = await db.query(
      `UPDATE groups
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           categories = COALESCE($16, categories),
           date = COALESCE($4, date),
           location = COALESCE($5, location),
           image_url = COALESCE($6, image_url),
           max_members = COALESCE($7, max_members),
           is_private = COALESCE($8, is_private),
           skill_level = COALESCE($9, skill_level),
           events_owner_only = COALESCE($14, events_owner_only),
           chat_only_owner = COALESCE($15, chat_only_owner),
           lat = CASE WHEN $5 IS NOT NULL THEN $12 ELSE lat END,
           lng = CASE WHEN $5 IS NOT NULL THEN $13 ELSE lng END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10 AND type = $11
       RETURNING *`,
      [
        name,
        description,
        catList.length ? catList[0] : null,
        dateValue,
        location,
        image_url,
        max_members,
        is_private,
        skill_level,
        id,
        CLUB_TYPE,
        latUpdate,
        lngUpdate,
        events_owner_only ?? null,
        chat_only_owner ?? null,
        catList.length ? catList : null
      ]
    );

    invalidatePrefix('clubs:');
    invalidatePrefix('map:');
    // The Discover-events feed embeds each event's club_name + is_private — a
    // club rename or privacy flip must bust it too, or the events feed shows the
    // stale club name/visibility for up to 60s.
    invalidatePrefix(DISCOVER_EVENTS_KEY);
    invalidatePrefix('groups:'); // clubs also appear in the public groups feed
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating club:', err);
    // Log the details server-side only — err.message/err.code expose raw
    // Postgres constraint/column names to the client (no other controller
    // echoes them).
    res.status(500).json({ error: 'Club konnte nicht aktualisiert werden' });
  }
};

// ==========================================
// DELETE CLUB (owner only)
// ==========================================
export const deleteClub = async (req, res) => {
  try {
    const { id } = req.params;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (Number(club.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Soft delete — preserves messages, reviews, and member history.
    // Mirrors deleteGroup behaviour so audit trails are recoverable.
    await db.query('UPDATE groups SET deleted_at = NOW(), is_active = FALSE WHERE id = $1', [id]);
    invalidatePrefix('clubs:');
    invalidatePrefix('map:');
    // Chat-list + discover caches: drop the deleted club from every member's
    // "Chats" and from the public Events feed immediately (queries already
    // filter deleted_at — this removes the cache-staleness window).
    invalidatePrefix('user_groups:');
    invalidatePrefix(DISCOVER_EVENTS_KEY);
    res.json({ message: 'Club deleted successfully' });
  } catch (err) {
    console.error('Error deleting club:', err);
    res.status(500).json({ error: 'Club konnte nicht gelöscht werden' });
  }
};

// ==========================================
// JOIN CLUB
// ==========================================
export const joinClub = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Reject messages from non-members early
    if (message && (typeof message !== 'string' || message.length > 500)) {
      return res.status(400).json({ error: 'Nachricht darf maximal 500 Zeichen lang sein' });
    }

    const clubResult = await db.query(
      'SELECT id, is_private, owner_id, name FROM groups WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
      [id, CLUB_TYPE]
    );
    if (clubResult.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    const clubRow = clubResult.rows[0];
    const isPrivate = clubRow.is_private;

    const existing = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already a member' });

    // Profile-photo gate on JOIN (Tina/Tobi meeting 2026-08-04) — mirrors
    // joinGroup; was UX-only before, now enforced server-side.
    if (!(await creatorHasAvatar(req.userId))) {
      return res.status(403).json({
        error: 'Bitte lade zuerst ein Profilbild hoch, um beizutreten.',
        requiresAvatar: true,
      });
    }

    // Anti-churn: a user may join any given club at most MAX_CLUB_JOINS times.
    // The counter persists across leaves (group_members rows are deleted on
    // leave), so constant join/leave spam — which floods the chat with
    // beigetreten/verlassen system messages — is capped. Checked here so it
    // blocks both a public join and a new private join-request.
    const jc = await db.query(
      'SELECT join_count FROM group_join_counts WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if ((jc.rows[0]?.join_count || 0) >= MAX_CLUB_JOINS) {
      return res.status(403).json({
        error: 'Du bist diesem Club bereits zweimal beigetreten und kannst ihm nicht erneut beitreten.',
      });
    }

    if (isPrivate) {
      const existingReq = await db.query(
        `SELECT 1 FROM group_join_requests
         WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
        [id, req.userId]
      );
      if (existingReq.rows.length > 0) {
        return res.status(400).json({ error: 'Join request already pending' });
      }

      // UPSERT: a prior rejected/withdrawn request leaves a row with the same
      // (group_id, user_id) — a plain INSERT then hits the unique constraint
      // and 500s forever. Reset it to pending instead (mirrors joinGroup).
      await db.query(
        `INSERT INTO group_join_requests (group_id, user_id, message)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, user_id)
         DO UPDATE SET status = 'pending', message = $3, updated_at = CURRENT_TIMESTAMP`,
        [id, req.userId, message || null]
      );
      // Notify the club owner about the new request (fire-and-forget)
      if (clubRow.owner_id && Number(clubRow.owner_id) !== Number(req.userId)) {
        notifyJoinRequest(req.userId, clubRow.owner_id, clubRow.name || '', id).catch(() => {});
        // Same badge-staleness fix as joinGroup: bust the OWNER's cached
        // pending_request_count and ping their personal room (2026-08-04).
        deleteCached(`user_groups:${clubRow.owner_id}`);
        req.app.get('io')?.to(`user_${clubRow.owner_id}`).emit('join_request_update', {
          group_id: Number(id),
          group_name: clubRow.name,
        });
      }
      return res.json({ message: 'Join request sent', status: 'pending' });
    }

    // Public join — enforce capacity inside a transaction so concurrent joins
    // can never both pass the members_count check and exceed max_members.
    let didJoin = false;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const cap = await client.query(
        'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (cap.rows[0].max_members && cap.rows[0].members_count >= cap.rows[0].max_members) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Club is full' });
      }
      const memberIns = await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, req.userId, 'member']
      );
      // Bump the persistent join counter ONLY on a real insert. A concurrent
      // double-tap's second request no-ops here (ON CONFLICT DO NOTHING) but
      // would otherwise still bump the counter — double-counting one join and,
      // with MAX_CLUB_JOINS=2, locking the user out after a single later leave.
      if (memberIns.rowCount > 0) {
        await client.query(
          `INSERT INTO group_join_counts (group_id, user_id, join_count)
           VALUES ($1, $2, 1)
           ON CONFLICT (group_id, user_id)
           DO UPDATE SET join_count = group_join_counts.join_count + 1`,
          [id, req.userId]
        );
      }
      didJoin = memberIns.rowCount > 0;
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Notify the club owner about the new member (fire-and-forget) — mirrors
    // the public group join; before this, only PRIVATE club join-requests ever
    // pushed and a public join was silent (Tina 2026-08-02). Gated on a real
    // join so a double-tap doesn't double-notify the owner.
    if (didJoin && clubRow.owner_id && Number(clubRow.owner_id) !== Number(req.userId)) {
      notifyGroupJoin(req.userId, clubRow.owner_id, clubRow.name || '', id, 'club').catch(() => {});
    }

    res.json({ message: 'Joined club successfully', status: 'joined' });
  } catch (err) {
    console.error('Error joining club:', err);
    res.status(500).json({ error: 'Beitritt fehlgeschlagen' });
  }
};

// ==========================================
// LEAVE CLUB
// ==========================================
export const leaveClub = async (req, res) => {
  try {
    const { id } = req.params;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length > 0 && Number(club.rows[0].owner_id) === Number(req.userId)) {
      return res.status(400).json({
        error: 'Als Ersteller kannst du den Club nicht verlassen – lösche ihn stattdessen.'
      });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not a member of this club' });
    }

    // A seat just opened — clubs have waitlists too (getClubById serves
    // waitlist_status/position), but only the GROUP leave/kick handlers ever
    // promoted; club-side departures left waiters at "waiting" forever.
    promoteFromWaitlist(id).then(promoted => {
      if (promoted) {
        sendPushToUser(promoted.userId, pushTexts('slotFreed', { groupName: promoted.groupName }), null, `/club/${id}`);
      }
    }).catch(() => {});
    deleteCached('user_groups:' + req.userId);

    res.json({ message: 'Left club successfully' });
  } catch (err) {
    console.error('Error leaving club:', err);
    res.status(500).json({ error: 'Verlassen fehlgeschlagen' });
  }
};

// ==========================================
// TOGGLE CLUB FAVORITE
// ==========================================
export const toggleClubFavorite = async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure the club exists and is a club
    const club = await db.query(
      'SELECT id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    const existing = await db.query(
      'SELECT * FROM group_favorites WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM group_favorites WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      return res.json({ favorited: false, message: 'Removed from favorites' });
    }

    // ON CONFLICT: double-tap race — the loser used to 500 on the PK.
    await db.query(
      'INSERT INTO group_favorites (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, req.userId]
    );
    res.json({ favorited: true, message: 'Added to favorites' });
  } catch (err) {
    console.error('Error toggling club favorite:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET USER FAVORITE CLUBS
// ==========================================
export const getUserFavoriteClubs = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM group_favorites gf
       JOIN groups g ON gf.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE gf.user_id = $1 AND g.type = $2
         AND g.deleted_at IS NULL
         AND g.is_active = TRUE
       ORDER BY gf.created_at DESC`,
      [req.userId, CLUB_TYPE]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching favorite clubs:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET CLUB MEMBERS
// ==========================================
export const getClubMembers = async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure this is a club AND read is_private together — saves a round trip.
    const club = await db.query(
      'SELECT id, is_private FROM groups WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Privacy gate: roster of a private club is hidden from non-members.
    // Public clubs (the default) let any authenticated user see the roster
    // so the ClubDetail page works while browsing before joining.
    if (club.rows[0].is_private) {
      const member = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      if (member.rows.length === 0) return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const result = await db.query(
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.location, u.is_trusted_user,
              gm.role, gm.joined_at,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
         -- Hide blocked users from each other (bidirectional).
         AND u.id NOT IN (
           SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
           FROM friendships
           WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2)
         )
       ORDER BY gm.joined_at ASC`,
      [id, req.userId]
    );
    const total = result.rows.length;

    // Pro gate — mirrors getGroupMembers so "alle Mitglieder sehen" is a
    // uniform Pro perk across groups AND clubs. Members of the club already see
    // the whole roster; non-member non-Pro non-admins get only the first 3 + a
    // gated flag (the frontend renders the rest as a locked Pro upsell). The
    // isCallerMember check was already computed above for private clubs.
    const isCallerMember = (await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    )).rows.length > 0;
    const callerIsPro = req.userId ? await isUserPro(req.userId) : false;
    let callerIsAdmin = false;
    if (!isCallerMember && !callerIsPro && req.userId) {
      const adm = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      callerIsAdmin = !!adm.rows[0]?.is_admin;
    }
    if (!isCallerMember && !callerIsPro && !callerIsAdmin) {
      return res.json({
        members: result.rows.slice(0, 3).map(m => ({
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
    res.json({ members: result.rows, total_count: total, gated: false });
  } catch (err) {
    console.error('Error fetching club members:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET USER'S CLUBS
// ==========================================
export const getUserClubs = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, gm.role
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE gm.user_id = $1 AND g.type = $2
         AND g.deleted_at IS NULL
       ORDER BY gm.joined_at DESC`,
      [req.userId, CLUB_TYPE]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user clubs:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET JOIN REQUESTS (owner only)
// ==========================================
export const getClubJoinRequests = async (req, res) => {
  try {
    const { id } = req.params;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (!(await userManagesClub(id, club.rows[0].owner_id, req.userId))) return res.status(403).json({ error: 'Keine Berechtigung' });

    const result = await db.query(
      `SELECT jr.*, u.name as user_name, u.avatar_url as user_avatar, u.bio as user_bio,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS user_age
       FROM group_join_requests jr
       JOIN users u ON jr.user_id = u.id
       WHERE jr.group_id = $1 AND jr.status = 'pending'
       ORDER BY jr.created_at DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching club join requests:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// HANDLE JOIN REQUEST (accept/reject)
// ==========================================
export const handleClubJoinRequest = async (req, res) => {
  try {
    const { id, requestId } = req.params;
    const { action } = req.body;

    const club = await db.query(
      'SELECT owner_id, name FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (!(await userManagesClub(id, club.rows[0].owner_id, req.userId))) return res.status(403).json({ error: 'Keine Berechtigung' });

    const request = await db.query(
      'SELECT * FROM group_join_requests WHERE id = $1 AND group_id = $2',
      [requestId, id]
    );
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const joinReq = request.rows[0];

    // The badge counts against the OWNER's chat list (a co-manager may be the
    // one processing) — bust the owner's cached pending_request_count for every
    // action, plus the processor's own if they differ.
    deleteCached(`user_groups:${club.rows[0].owner_id}`);
    deleteCached(`user_groups:${req.userId}`);

    if (action === 'accept') {
      // Re-verify the applicant still has a profile photo at acceptance time —
      // mirrors groupController.handleJoinRequest. The joinClub gate only runs
      // at REQUEST time, so this closes the TOCTOU hole (request with a photo,
      // clear it, then get accepted) and blocks legacy pre-2026-08-04 requests.
      if (!(await creatorHasAvatar(joinReq.user_id))) {
        return res.status(422).json({
          error: 'Dieser Nutzer hat noch kein Profilbild und kann noch nicht aufgenommen werden.',
          requiresAvatar: true,
        });
      }
      // Enforce capacity inside a transaction so two concurrent accepts
      // can't both push the club over max_members. Mirror of the same
      // fix in groupController.handleJoinRequest.
      let didAccept = false;
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
          [id]
        );
        // Status guard FIRST: a double-click on "Annehmen" (or re-accepting an
        // old request) must be a no-op — otherwise the second pass re-adds the
        // member and re-bumps the churn counter, and if the club filled in
        // between it would 400 "full" on what is really an already-accepted
        // request. Only a real pending→accepted transition proceeds.
        const upd = await client.query(
          `UPDATE group_join_requests
           SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'pending'`,
          [requestId]
        );
        if (upd.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.json({ message: 'Request already handled', status: 'accepted' });
        }
        const cap = await client.query(
          'SELECT members_count, max_members FROM groups WHERE id = $1',
          [id]
        );
        if (cap.rows[0].max_members && cap.rows[0].members_count >= cap.rows[0].max_members) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Club ist bereits voll. Anfrage kann nicht angenommen werden.' });
        }
        const memberIns = await client.query(
          'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, joinReq.user_id, 'member']
        );
        // Bump the churn counter only on a real insert (see joinClub note).
        if (memberIns.rowCount > 0) {
          await client.query(
            `INSERT INTO group_join_counts (group_id, user_id, join_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (group_id, user_id)
             DO UPDATE SET join_count = group_join_counts.join_count + 1`,
            [id, joinReq.user_id]
          );
        }
        await client.query('COMMIT');
        didAccept = true;
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Notify the requester they're in (parity with group join-accept).
      if (didAccept) {
        sendPushToUser(joinReq.user_id, pushTexts('joinAccepted', { name: club.rows[0].name || '' }), null, `/club/${id}`);
      }

      res.json({ message: 'Request accepted', status: 'accepted' });
    } else if (action === 'reject') {
      await db.query(
        `UPDATE group_join_requests 
         SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [requestId]
      );
      res.json({ message: 'Request rejected', status: 'rejected' });
    } else if (action === 'undo') {
      // Undo an accidental reject → back to pending (mirrors the group handler;
      // the unified Anfragen swipe deck offers undo for both entity types).
      // Only touches a currently-rejected row — never resurrects an accepted one.
      await db.query(
        `UPDATE group_join_requests
         SET status = 'pending', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'rejected'`,
        [requestId]
      );
      res.json({ message: 'Request restored', status: 'pending' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "accept" or "reject".' });
    }
  } catch (err) {
    console.error('Error handling club join request:', err);
    res.status(500).json({ error: 'Anfrage konnte nicht verarbeitet werden' });
  }
};

// ==========================================
// KICK/REMOVE MEMBER (owner only)
// ==========================================
export const kickClubMember = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (!(await userManagesClub(id, club.rows[0].owner_id, req.userId))) return res.status(403).json({ error: 'Keine Berechtigung' });

    if (parseInt(userId, 10) === req.userId) {
      return res.status(400).json({
        error: 'Du kannst dich nicht selbst entfernen. Lösche den Club stattdessen.'
      });
    }

    // Only regular members can be kicked — never the owner or a co-manager
    // (role='admin'). Managers are removed via the dedicated demote endpoint, so
    // a co-manager can't kick the owner or another manager out from under them.
    const result = await db.query(
      "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'member'",
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User is not a member of this club' });
    }

    // Evict the removed member's live sockets from the chat room (see kickMember).
    await evictFromRoom(req.app.get('io'), userId, id);

    // Freed seat → promote the next waiter (mirrors leaveClub/kickMember).
    promoteFromWaitlist(id).then(promoted => {
      if (promoted) {
        sendPushToUser(promoted.userId, pushTexts('slotFreed', { groupName: promoted.groupName }), null, `/club/${id}`);
      }
    }).catch(() => {});
    deleteCached('user_groups:' + userId);

    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Error kicking club member:', err);
    res.status(500).json({ error: 'Mitglied konnte nicht entfernt werden' });
  }
};

// ==========================================
// ADD CO-MANAGER (owner only) — promote an existing member to role='admin'.
// Powers the paid "managed club" cooperation: the owner grants a second party
// (JAMIE staff or the partner) shared management of the club. The target must
// already be a member, so the flow is: they join → owner promotes them here.
// ==========================================
export const addClubManager = async (req, res) => {
  try {
    const { id } = req.params;
    const targetUserId = parseInt(req.body.userId, 10);
    if (!targetUserId || targetUserId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    // Only the OWNER assigns/revokes managers — co-managers cannot mint more.
    if (Number(club.rows[0].owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Nur der Eigentümer kann Manager verwalten' });
    }
    if (targetUserId === Number(club.rows[0].owner_id)) {
      return res.status(400).json({ error: 'Der Eigentümer ist bereits Manager' });
    }

    // Promote member → admin. The role filter makes this idempotent-safe and
    // ensures the target is genuinely a normal member (not already a manager).
    const upd = await db.query(
      "UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2 AND role = 'member' RETURNING user_id",
      [id, targetUserId]
    );
    if (upd.rows.length === 0) {
      return res.status(404).json({ error: 'Nutzer ist kein normales Mitglied dieses Clubs' });
    }

    invalidatePrefix('clubs:');
    res.json({ message: 'Manager hinzugefügt', userId: targetUserId });
  } catch (err) {
    console.error('Error adding club manager:', err);
    res.status(500).json({ error: 'Manager konnte nicht hinzugefügt werden' });
  }
};

// ==========================================
// REMOVE CO-MANAGER (owner only) — demote role='admin' back to 'member'.
// Keeps their club membership; only revokes management rights.
// ==========================================
export const removeClubManager = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const targetUserId = parseInt(userId, 10);

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (Number(club.rows[0].owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Nur der Eigentümer kann Manager verwalten' });
    }

    const upd = await db.query(
      "UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2 AND role = 'admin' RETURNING user_id",
      [id, targetUserId]
    );
    if (upd.rows.length === 0) {
      return res.status(404).json({ error: 'Nutzer ist kein Manager dieses Clubs' });
    }

    invalidatePrefix('clubs:');
    res.json({ message: 'Manager entfernt', userId: targetUserId });
  } catch (err) {
    console.error('Error removing club manager:', err);
    res.status(500).json({ error: 'Manager konnte nicht entfernt werden' });
  }
};

// ==========================================
// CANCEL CLUB (soft delete + notify)
// ==========================================
export const cancelClub = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Fetch club info + members in parallel
    const [club, members] = await Promise.all([
      db.query('SELECT owner_id, name FROM groups WHERE id = $1 AND type = $2', [id, CLUB_TYPE]),
      db.query('SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2', [id, req.userId]),
    ]);
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (Number(club.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    await db.query(
      'UPDATE groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    invalidatePrefix('clubs:');
    invalidatePrefix('map:');
    invalidatePrefix('user_groups:');     // reflect closure in chat lists now
    invalidatePrefix(DISCOVER_EVENTS_KEY); // and drop its events from discovery

    const clubName = club.rows[0].name;
    const io = req.app?.get('io');

    let notified = 0;
    if (members.rows.length > 0) {
      // Chunked + live-emitting fan-out — shared core (services/
      // entityLifecycle.js). The old inline copy here was UNCHUNKED: a club
      // past ~13k members would have blown Postgres' bind-parameter limit
      // and notified nobody.
      notified = await notifyCancellationFanout({
        memberIds: members.rows.map(m => m.user_id),
        senderId: req.userId,
        type: 'club_cancelled',
        referenceType: 'club',
        referenceId: id,
        title: `${clubName} wurde geschlossen`,
        body: reason || 'Der Club wurde vom Ersteller geschlossen.',
        io,
      });
    }

    // Report what was actually INSERTED, not the member count — one source of truth.
    res.json({ message: 'Club cancelled and members notified', notified });
  } catch (err) {
    console.error('Error cancelling club:', err);
    res.status(500).json({ error: 'Club konnte nicht deaktiviert werden' });
  }
};

// ==========================================
// GET EVENTS FOR A CLUB
// ==========================================
export const getClubEvents = async (req, res) => {
  try {
    const { id } = req.params;
    const { past } = req.query;

    const club = await db.query(
      'SELECT id, owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club nicht gefunden' });

    // Events are members-only. Non-authenticated callers and non-members get 403
    // so the frontend can render a locked state (rather than showing 0 events
    // and confusing the user about whether the club is just empty).
    if (!req.userId) return res.status(403).json({ error: 'Login erforderlich', code: 'NOT_MEMBER' });
    const membership = await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (membership.rows.length === 0 && Number(club.rows[0].owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Nur für Clubmitglieder sichtbar', code: 'NOT_MEMBER' });
    }

    const isPast = past === 'true';
    // Split upcoming/past by DAY (CURRENT_DATE), NOT by exact moment (NOW()).
    // getDiscoverEvents already does this on purpose ("so an event happening
    // later today isn't dropped at midnight"). When this list used NOW() while
    // Discover used CURRENT_DATE, an event earlier today — or nudged just past
    // NOW() by the naive-timestamp club-event time offset — showed up under
    // "Club Events entdecken" but was invisible to the club owner in their own
    // club view (the exact bug reported 2026-07-23). Same granularity → the
    // owner sees exactly what Discover shows.
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.parent_club_id = $1
         AND g.is_active = TRUE
         AND g.deleted_at IS NULL
         AND ($2 = TRUE  AND g.date < CURRENT_DATE
              OR $2 = FALSE AND (g.date IS NULL OR g.date >= CURRENT_DATE))
       ORDER BY g.date ASC NULLS LAST`,
      [id, isPast]
    );

    // Attach is_member for authenticated users
    if (req.userId && result.rows.length > 0) {
      const eventIds = result.rows.map(e => e.id);
      const memberRows = await db.query(
        `SELECT group_id FROM group_members WHERE user_id = $1 AND group_id = ANY($2)`,
        [req.userId, eventIds]
      );
      const memberSet = new Set(memberRows.rows.map(r => r.group_id));
      for (const event of result.rows) {
        event.is_member = memberSet.has(event.id);
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching club events:', err);
    res.status(500).json({ error: 'Veranstaltungen konnten nicht geladen werden' });
  }
};

// ==========================================
// DISCOVER EVENTS — upcoming events from PUBLIC clubs
// ==========================================
// Powers the "Events für dich" row + the standalone Events page. Unlike
// getClubEvents (members-only), this is open discovery, but deliberately
// limited to events whose parent club is public (is_private = FALSE) so we
// never leak a private club's agenda.
export const getDiscoverEvents = async (req, res) => {
  try {
    // Robert (2026-06-17): the Events page ("Club Events entdecken") shows EVERY
    // upcoming club event — from PUBLIC *and* PRIVATE clubs — to everyone. This
    // is an explicit product decision that reverses the earlier public-only
    // privacy gate (a private club's event titles are now discoverable).
    //
    // Same list for everyone → cached; createClubEvent/deleteClubEvent bust the
    // cache so new/removed events appear instantly. Date compares by DAY
    // (CURRENT_DATE) so an event happening later today isn't dropped at midnight.
    // Category + time ("today"/"this week") filtering is done client-side on the
    // Events page off this single feed.
    const cached = getCached(DISCOVER_EVENTS_KEY);
    if (cached) return res.json(cached);

    const result = await db.query(
      // NB: groups has NO `time` column — date+time live in `date` (TIMESTAMP).
      // Selecting e.time threw "column does not exist" → 500 → the Events page
      // silently showed "Noch keine Events" even when events existed. Fixed.
      `SELECT e.id, e.name, e.date, e.location,
              e.category, e.max_members, e.is_recurring_weekly, e.image_url,
              c.id AS club_id, c.name AS club_name, c.image_url AS club_image, c.is_private
       FROM groups e
       JOIN groups c ON e.parent_club_id = c.id
       WHERE e.type = 'event'
         AND e.is_active = TRUE
         AND e.deleted_at IS NULL
         AND (e.date IS NULL OR e.date >= CURRENT_DATE)
         AND c.type = $1
         AND c.deleted_at IS NULL
       ORDER BY e.date ASC NULLS LAST
       LIMIT 200`,
      [CLUB_TYPE]
    );
    setCached(DISCOVER_EVENTS_KEY, result.rows, DISCOVER_EVENTS_TTL);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching discover events:', err);
    res.status(500).json({ error: 'Veranstaltungen konnten nicht geladen werden' });
  }
};

// ==========================================
// CREATE EVENT UNDER A CLUB (members only)
// ==========================================
export const createClubEvent = async (req, res) => {
  const { id } = req.params;
  const { name, description, date, time, location, max_members, is_recurring_weekly, ticket_url } = req.body;
  const userId = req.userId;

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  if (!date) return res.status(400).json({ error: 'Datum ist erforderlich' });

  // Paid events are a Pro feature (Tina/Tobi 2026-09-03). The frontend gates
  // the toggle behind the ProModal, but that's bypassable with a direct API
  // call — so validate the link AND the subscription here too.
  const ticketUrl = normalizeTicketUrl(ticket_url);
  if (ticket_url && !ticketUrl) {
    return res.status(400).json({ error: 'Ungültiger Ticket-Link (nur http/https)' });
  }
  if (ticketUrl && !(await isUserPro(userId))) {
    return res.status(403).json({ error: 'Kostenpflichtige Events sind ein Pro-Feature.', code: 'PRO_REQUIRED' });
  }

  try {
    const club = await db.query(
      'SELECT id, name, category, owner_id, events_owner_only, location, is_private, lat, lng FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club nicht gefunden' });

    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: 'Nur Mitglieder können Events erstellen' });
    }

    // Owner-only gate: when the club founder restricted event creation, only
    // the founder (owner) OR a co-manager (role='admin') may add events — regular
    // members still just see them. Reuses the role already fetched above.
    const canManageEvents =
      Number(club.rows[0].owner_id) === Number(userId) || membership.rows[0]?.role === 'admin';
    if (club.rows[0].events_owner_only && !canManageEvents) {
      return res.status(403).json({ error: 'Nur Gründer oder Manager dürfen Events erstellen' });
    }

    const { safe, reason } = await checkTextSafety([name, description].filter(Boolean).join('\n'));
    if (!safe) return res.status(422).json({ error: reason });

    const dateTime = date && time ? `${date}T${time}` : date;
    // Ort is optional in the event form — an empty field inherits the CLUB's
    // location (text AND coords). The inherited text must be stored too, not
    // just geocoded: otherwise the event renders without any address line.
    const eventLocation = (location && location.trim()) || club.rows[0].location || null;
    // Inherited (or identical) location → inherit the club's pin too: no
    // Nominatim call, no drift between club pin and event pin. Only a custom
    // location still geocodes (unrestricted, as before — club events carry no
    // region gate by design).
    const inheritsClubPin =
      eventLocation != null &&
      eventLocation === club.rows[0].location &&
      club.rows[0].lat != null;
    const coords = inheritsClubPin
      ? { lat: club.rows[0].lat, lng: club.rows[0].lng }
      : await geocodeLocation(eventLocation);

    // An event inherits its parent club's privacy: a PRIVATE club's events are
    // private too, so joinGroup routes joins through owner approval instead of an
    // instant public join (a non-member of a private club must be let in, not
    // walk in). Previously this was hardcoded FALSE, which made every private
    // club's events publicly joinable and marked "Öffentlich".
    const eventIsPrivate = !!club.rows[0].is_private;

    // Event row + owner membership in ONE transaction (audit risk #10) —
    // shared core in services/entityLifecycle.js.
    const event = await createEntityWithOwner(
      `INSERT INTO groups
         (name, description, type, category, date, location, max_members, owner_id,
          parent_club_id, is_private, lat, lng, is_recurring_weekly, ticket_url)
       VALUES ($1, $2, 'event', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        name.trim(),
        description || null,
        club.rows[0].category || null,
        dateTime,
        eventLocation,
        max_members || 20,
        userId,
        parseInt(id, 10),
        eventIsPrivate,
        coords?.lat ?? null,
        coords?.lng ?? null,
        !!is_recurring_weekly,
        ticketUrl,
      ],
      userId
    );

    invalidatePrefix('clubs:');
    invalidatePrefix(DISCOVER_EVENTS_KEY);
    invalidatePrefix('map:'); // a geocoded event is a new map pin

    // Notify club members about the new event (fire-and-forget, excludes the
    // creator). Deep-links to the event detail page.
    // Bulk variant: identical payload for every member, so one subscriptions
    // SELECT covers the whole club instead of one per member (a 300-member
    // club otherwise fired 300 round trips behind a single event creation).
    db.query('SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2', [id, userId])
      .then(({ rows }) => {
        const clubName = club.rows[0].name || 'Club';
        sendPushToUsers(
          rows.map(r => r.user_id),
          pushTexts('clubEvent', { clubName, eventName: name.trim() }),
          null,
          `/group/${event.id}`
        );
      })
      .catch(() => {});

    res.status(201).json(event);
  } catch (err) {
    console.error('Error creating club event:', err);
    res.status(500).json({ error: 'Veranstaltung konnte nicht erstellt werden' });
  }
};

// ==========================================
// DELETE CLUB EVENT (club owner or event owner)
// ==========================================
export const deleteClubEvent = async (req, res) => {
  try {
    const { id, eventId } = req.params;

    const event = await db.query(
      'SELECT owner_id, parent_club_id FROM groups WHERE id = $1 AND parent_club_id = $2',
      [eventId, id]
    );
    if (event.rows.length === 0) return res.status(404).json({ error: 'Veranstaltung nicht gefunden' });

    const club = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    const isEventOwner = Number(event.rows[0].owner_id) === Number(req.userId);
    // Club owner / co-manager (role='admin'), or the member who created the event.
    const canManage = await userManagesClub(id, club.rows[0]?.owner_id, req.userId);

    if (!canManage && !isEventOwner) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    await db.query(
      'UPDATE groups SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [eventId]
    );

    invalidatePrefix('clubs:');
    invalidatePrefix(DISCOVER_EVENTS_KEY);
    invalidatePrefix('map:'); // removed event → drop its map pin
    res.json({ message: 'Veranstaltung gelöscht' });
  } catch (err) {
    console.error('Error deleting club event:', err);
    res.status(500).json({ error: 'Veranstaltung konnte nicht gelöscht werden' });
  }
};

// ==========================================
// UPDATE CLUB EVENT (club owner/manager or event owner)
// ==========================================
// Partial update — only fields present in the body change (COALESCE keeps the
// rest). Same permission model as deleteClubEvent (club owner/manager OR the
// member who created the event) and the same cache busts so the club page,
// the discover feed, and the map all reflect the edit immediately.
export const updateClubEvent = async (req, res) => {
  const { id, eventId } = req.params;
  const { name, description, date, time, location, max_members, is_recurring_weekly, image_url, ticket_url } = req.body;
  const userId = req.userId;

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  {
    const bad = checkImageField(image_url);
    if (bad) return res.status(400).json({ error: bad });
  }

  // Ticket link (Pro-only, same rules as createClubEvent). An explicit empty
  // string clears it — that's "back to a free event" and needs no Pro check.
  let ticketUrl = null;
  if (ticket_url !== undefined) {
    const isClearing = typeof ticket_url === 'string' && !ticket_url.trim();
    ticketUrl = isClearing ? '' : normalizeTicketUrl(ticket_url);
    if (!isClearing && !ticketUrl) {
      return res.status(400).json({ error: 'Ungültiger Ticket-Link (nur http/https)' });
    }
    if (ticketUrl && !(await isUserPro(userId))) {
      return res.status(403).json({ error: 'Kostenpflichtige Events sind ein Pro-Feature.', code: 'PRO_REQUIRED' });
    }
  }

  try {
    const event = await db.query(
      `SELECT owner_id, parent_club_id FROM groups WHERE id = $1 AND parent_club_id = $2 AND type = 'event'`,
      [eventId, id]
    );
    if (event.rows.length === 0) return res.status(404).json({ error: 'Veranstaltung nicht gefunden' });

    const club = await db.query('SELECT owner_id, location FROM groups WHERE id = $1', [id]);
    const isEventOwner = Number(event.rows[0].owner_id) === Number(userId);
    const canManage = await userManagesClub(id, club.rows[0]?.owner_id, userId);
    if (!canManage && !isEventOwner) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const textToCheck = [name, description].filter(Boolean).join('\n');
    if (textToCheck) {
      const { safe, reason } = await checkTextSafety(textToCheck);
      if (!safe) return res.status(422).json({ error: reason });
    }

    // date/time only rebuilt when a date is supplied (mirrors createClubEvent).
    // `date || null`: an empty string must mean "keep existing" (COALESCE) —
    // ''::timestamp is a 500, not a no-op.
    const dateTime = date !== undefined ? (date && time ? `${date}T${time}` : (date || null)) : null;

    // Re-geocode only when location changes. Empty string inherits the club's
    // location (text + coords) — same fallback as createClubEvent.
    let eventLocation = null;
    let coords = null;
    if (location !== undefined) {
      eventLocation = (location && location.trim()) || club.rows[0]?.location || null;
      coords = await geocodeLocation(eventLocation);
    }

    const result = await db.query(
      `UPDATE groups
         SET name                = COALESCE($1, name),
             description         = COALESCE($2, description),
             date                = COALESCE($3, date),
             location            = COALESCE($4, location),
             max_members         = COALESCE($5, max_members),
             is_recurring_weekly = COALESCE($6, is_recurring_weekly),
             image_url           = COALESCE($10, image_url),
             -- '' clears the link (free event again); NULL leaves it untouched.
             ticket_url          = CASE WHEN $11 IS NULL THEN ticket_url
                                        WHEN $11 = '' THEN NULL
                                        ELSE $11 END,
             lat = CASE WHEN $4 IS NOT NULL THEN $7 ELSE lat END,
             lng = CASE WHEN $4 IS NOT NULL THEN $8 ELSE lng END,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        name !== undefined ? String(name).trim() : null,
        description !== undefined ? (description || null) : null,
        dateTime,
        eventLocation,
        max_members !== undefined ? (parseInt(max_members, 10) || null) : null,
        is_recurring_weekly === undefined ? null : !!is_recurring_weekly,
        coords?.lat ?? null,
        coords?.lng ?? null,
        eventId,
        image_url !== undefined ? (image_url || null) : null,
        ticketUrl,
      ]
    );

    invalidatePrefix('clubs:');
    invalidatePrefix(DISCOVER_EVENTS_KEY);
    invalidatePrefix('map:'); // location/coords may have moved the pin
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating club event:', err);
    res.status(500).json({ error: 'Veranstaltung konnte nicht aktualisiert werden' });
  }
};

// Reuse shared categories endpoint from groups
export { getCategories } from './groupController.js';

