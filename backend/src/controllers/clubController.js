import db from '../config/database.js';
import { geocodeLocation } from '../utils/geocode.js';
import { checkTextSafety } from '../config/moderation.js';
import { getCached, setCached, invalidatePrefix } from '../utils/cache.js';
import { postSystemMessage } from '../utils/systemMessage.js';
import { notifyJoinRequest } from './groupController.js';

const CLUBS_TTL = 30_000; // 30 s

// Helper to ensure we always target clubs
const CLUB_TYPE = 'club';

// ==========================================
// CREATE CLUB
// ==========================================
export const createClub = async (req, res) => {
  const {
    name,
    description,
    category,
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

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  if (name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
  if (description && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });

  try {
    const textToCheck = [name, description].filter(Boolean).join('\n');
    const { safe, reason } = await checkTextSafety(textToCheck);
    if (!safe) return res.status(422).json({ error: reason });

    // Optional: allow a "next meetup" date for clubs
    let dateTime = date || null;
    if (date && time) {
      dateTime = `${date}T${time}`;
    }

    // Geocode location (non-blocking on failure)
    const coords = await geocodeLocation(location);

    // Approval workflow: clubs created by admins are auto-approved.
    // Everyone else lands in the moderation queue until a human approves.
    const adminCheck = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    const isAdminOwner = !!adminCheck.rows[0]?.is_admin;
    const approval = isAdminOwner ? 'approved' : 'pending';

    const result = await db.query(
      `INSERT INTO groups (
        name,
        description,
        type,
        category,
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        name,
        description,
        CLUB_TYPE,
        category,
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
      ]
    );

    const newClub = result.rows[0];

    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [newClub.id, userId, 'owner']
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
             (
               SELECT COALESCE(json_agg(sub), '[]'::json)
               FROM (
                 SELECT u2.id, u2.name, u2.avatar_url
                 FROM group_members gm
                 JOIN users u2 ON gm.user_id = u2.id
                 WHERE gm.group_id = g.id
                 ORDER BY gm.joined_at ASC
                 LIMIT 8
               ) sub
             ) AS member_previews
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
      query += ` AND g.category ILIKE $${paramIndex++}`;
      params.push(category);
    }
    if (location) {
      query += ` AND g.location ILIKE $${paramIndex++}`;
      params.push(`%${location}%`);
    }
    if (featured === 'true') {
      query += ` AND g.is_featured = TRUE`;
    }

    query += ` ORDER BY g.created_at DESC`;

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
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
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
        db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
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
      date,
      location,
      image_url,
      max_members,
      is_private,
      skill_level,
      events_owner_only,
      chat_only_owner
    } = req.body;

    if (name !== undefined && name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
    if (description !== undefined && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });

    // Normalize empty-string date to null. Frontend sends "" when the club has
    // no date set, but Postgres `''::timestamp` throws invalid-input — we want
    // null so COALESCE keeps the existing column value untouched.
    const dateValue = date === '' ? null : date;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    // Cast both sides to Number — req.userId from JWT may come back as string
    // depending on how the token was signed; strict !== would lock the owner
    // out of their own club.
    if (Number(club.rows[0].owner_id) !== Number(req.userId)) {
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
      const coords = await geocodeLocation(location);
      latUpdate = coords?.lat ?? null;
      lngUpdate = coords?.lng ?? null;
    }

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
        category,
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
        chat_only_owner ?? null
      ]
    );

    invalidatePrefix('clubs:');
    if (location !== undefined) invalidatePrefix('map:');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating club:', err);
    res.status(500).json({
      error: 'Club konnte nicht aktualisiert werden',
      detail: err.message,
      code: err.code,
    });
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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Soft delete — preserves messages, reviews, and member history.
    // Mirrors deleteGroup behaviour so audit trails are recoverable.
    await db.query('UPDATE groups SET deleted_at = NOW(), is_active = FALSE WHERE id = $1', [id]);
    invalidatePrefix('clubs:');
    invalidatePrefix('map:');
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

    if (isPrivate) {
      const existingReq = await db.query(
        `SELECT 1 FROM group_join_requests
         WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
        [id, req.userId]
      );
      if (existingReq.rows.length > 0) {
        return res.status(400).json({ error: 'Join request already pending' });
      }

      await db.query(
        'INSERT INTO group_join_requests (group_id, user_id, message) VALUES ($1, $2, $3)',
        [id, req.userId, message || null]
      );
      // Notify the club owner about the new request (fire-and-forget)
      if (clubRow.owner_id && clubRow.owner_id !== req.userId) {
        notifyJoinRequest(req.userId, clubRow.owner_id, clubRow.name || '', id).catch(() => {});
      }
      return res.json({ message: 'Join request sent', status: 'pending' });
    }

    // Public join — enforce capacity inside a transaction so concurrent joins
    // can never both pass the members_count check and exceed max_members.
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
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, req.userId, 'member']
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // "X ist beigetreten 🎉" — live to the chat room.
    db.query('SELECT name FROM users WHERE id = $1', [req.userId])
      .then(r => {
        const name = r.rows[0]?.name || 'Jemand';
        postSystemMessage(id, `${name} ist dem Club beigetreten 🎉`, req.app.get('io')).catch(() => {});
      })
      .catch(() => {});

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
    if (club.rows.length > 0 && club.rows[0].owner_id === req.userId) {
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

    await db.query(
      'INSERT INTO group_favorites (group_id, user_id) VALUES ($1, $2)',
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
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.location, gm.role, gm.joined_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [id]
    );
    res.json(result.rows);
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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Keine Berechtigung' });

    const result = await db.query(
      `SELECT jr.*, u.name as user_name, u.avatar_url as user_avatar, u.bio as user_bio
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
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Keine Berechtigung' });

    const request = await db.query(
      'SELECT * FROM group_join_requests WHERE id = $1 AND group_id = $2',
      [requestId, id]
    );
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const joinReq = request.rows[0];

    if (action === 'accept') {
      // Enforce capacity inside a transaction so two concurrent accepts
      // can't both push the club over max_members. Mirror of the same
      // fix in groupController.handleJoinRequest.
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const cap = await client.query(
          'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (cap.rows[0].members_count >= cap.rows[0].max_members) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Club ist bereits voll. Anfrage kann nicht angenommen werden.' });
        }
        await client.query(
          `UPDATE group_join_requests
           SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
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

      // "X ist beigetreten 🎉" — fire-and-forget, live to chat room.
      db.query('SELECT name FROM users WHERE id = $1', [joinReq.user_id])
        .then(r => {
          const name = r.rows[0]?.name || 'Jemand';
          postSystemMessage(id, `${name} ist dem Club beigetreten 🎉`, req.app.get('io')).catch(() => {});
        })
        .catch(() => {});

      res.json({ message: 'Request accepted', status: 'accepted' });
    } else if (action === 'reject') {
      await db.query(
        `UPDATE group_join_requests 
         SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [requestId]
      );
      res.json({ message: 'Request rejected', status: 'rejected' });
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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Keine Berechtigung' });

    if (parseInt(userId, 10) === req.userId) {
      return res.status(400).json({
        error: 'Du kannst dich nicht selbst entfernen. Lösche den Club stattdessen.'
      });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User is not a member of this club' });
    }

    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Error kicking club member:', err);
    res.status(500).json({ error: 'Mitglied konnte nicht entfernt werden' });
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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Keine Berechtigung' });

    await db.query(
      'UPDATE groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    invalidatePrefix('clubs:');
    invalidatePrefix('map:');

    const clubName = club.rows[0].name;
    const io = req.app?.get('io');

    if (members.rows.length > 0) {
      const title = `${clubName} wurde geschlossen`;
      const body = reason || 'Der Club wurde vom Ersteller geschlossen.';
      const valuesClauses = members.rows.map(
        (_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, 'club_cancelled', $${i * 5 + 3}, $${i * 5 + 4}, 'club', $${i * 5 + 5})`
      ).join(', ');
      const params = members.rows.flatMap(m => [m.user_id, req.userId, title, body, id]);
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

    res.json({ message: 'Club cancelled and members notified', notified: members.rows.length });
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
    if (membership.rows.length === 0 && club.rows[0].owner_id !== req.userId) {
      return res.status(403).json({ error: 'Nur für Clubmitglieder sichtbar', code: 'NOT_MEMBER' });
    }

    const isPast = past === 'true';
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.parent_club_id = $1
         AND g.is_active = TRUE
         AND g.deleted_at IS NULL
         AND ($2 = TRUE  AND g.date < NOW()
              OR $2 = FALSE AND (g.date IS NULL OR g.date >= NOW()))
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
// CREATE EVENT UNDER A CLUB (members only)
// ==========================================
export const createClubEvent = async (req, res) => {
  const { id } = req.params;
  const { name, description, date, time, location, max_members } = req.body;
  const userId = req.userId;

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  if (!date) return res.status(400).json({ error: 'Datum ist erforderlich' });

  try {
    const club = await db.query(
      'SELECT id, name, category, owner_id, events_owner_only FROM groups WHERE id = $1 AND type = $2',
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
    // the founder (owner) may add events. Members can still see them.
    if (club.rows[0].events_owner_only && club.rows[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Nur der Club-Gründer darf Events erstellen' });
    }

    const { safe, reason } = await checkTextSafety([name, description].filter(Boolean).join('\n'));
    if (!safe) return res.status(422).json({ error: reason });

    const dateTime = date && time ? `${date}T${time}` : date;
    const coords = await geocodeLocation(location || club.rows[0].location || null);

    const result = await db.query(
      `INSERT INTO groups
         (name, description, type, category, date, location, max_members, owner_id,
          parent_club_id, is_private, lat, lng)
       VALUES ($1, $2, 'event', $3, $4, $5, $6, $7, $8, FALSE, $9, $10)
       RETURNING *`,
      [
        name.trim(),
        description || null,
        club.rows[0].category || null,
        dateTime,
        location || null,
        max_members || 20,
        userId,
        parseInt(id, 10),
        coords?.lat ?? null,
        coords?.lng ?? null,
      ]
    );

    const event = result.rows[0];
    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [event.id, userId, 'owner']
    );

    invalidatePrefix('clubs:');
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
    const isClubOwner = club.rows[0]?.owner_id === req.userId;
    const isEventOwner = event.rows[0].owner_id === req.userId;

    if (!isClubOwner && !isEventOwner) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    await db.query(
      'UPDATE groups SET is_active = FALSE, deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [eventId]
    );

    res.json({ message: 'Veranstaltung gelöscht' });
  } catch (err) {
    console.error('Error deleting club event:', err);
    res.status(500).json({ error: 'Veranstaltung konnte nicht gelöscht werden' });
  }
};

// Reuse shared categories endpoint from groups
export { getCategories } from './groupController.js';

