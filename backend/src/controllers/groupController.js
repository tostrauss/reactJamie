import db from '../config/database.js';
import { geocodeLocation } from '../utils/geocode.js';
import { checkTextSafety } from '../config/moderation.js';
import { sendPushToUser } from './pushController.js';

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

    // Free 7-day boost (credits_spent = 0 = gifted)
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO boosts (user_id, target_type, target_id, credits_spent, boosted_until)
       VALUES ($1, 'group', $2, 0, $3)`,
      [userId, groupId, until]
    );

    console.log(`[pioneer] user ${userId} claimed cell (${latCell}, ${lngCell}) for group ${groupId}`);
  } catch (err) {
    // Non-critical — must not fail group creation
    console.error('[pioneer] check error:', err.message);
  }
}

// ==========================================
// CREATE GROUP / CLUB
// ==========================================
export const createGroup = async (req, res) => {
  const { name, description, type, category, date, time, location, image_url, max_members, is_private, skill_level } = req.body;
  const userId = req.userId; // JWT auth (not session)

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });

  try {
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

    // Events must be in the future (clubs have no date, so skip check)
    if (dateTime && (type === 'group' || !type)) {
      const eventDate = new Date(dateTime);
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'Ungültiges Datum' });
      }
      if (eventDate <= new Date()) {
        return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
      }
    }

    // Validate max_members
    const parsedMax = parseInt(max_members, 10);
    if (max_members !== undefined && (isNaN(parsedMax) || parsedMax < 2 || parsedMax > 500)) {
      return res.status(400).json({ error: 'Maximale Teilnehmerzahl muss zwischen 2 und 500 liegen' });
    }

    // Geocode location (non-blocking on failure)
    const coords = await geocodeLocation(location);

    const result = await db.query(
      `INSERT INTO groups (name, description, type, category, date, location, image_url, max_members, is_private, skill_level, owner_id, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [name, description, type || 'group', category, dateTime, location, image_url, max_members || 10, is_private || false, skill_level, userId, coords?.lat ?? null, coords?.lng ?? null]
    );

    const newGroup = result.rows[0];

    // Auto-add creator as member
    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [newGroup.id, userId, 'owner']
    );

    // Pioneer check (fire-and-forget — must not block the response)
    if (coords?.lat && coords?.lng) {
      checkAndAwardPioneer(userId, newGroup.id, coords.lat, coords.lng);
    }

    res.status(201).json(newGroup);
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Database creation failed' });
  }
};

// ==========================================
// GET ALL GROUPS (with filters)
// ==========================================
export const getGroups = async (req, res) => {
  try {
    const { type, search, category, location, upcoming, limit, offset } = req.query;

    let query = `
      SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
             CASE WHEN g.members_count >= g.max_members THEN 1 ELSE 0 END as is_full,
             CASE WHEN EXISTS (
               SELECT 1 FROM boosts b
               WHERE b.target_id = g.id AND b.target_type = g.type
                 AND b.boosted_until > CURRENT_TIMESTAMP
             ) THEN TRUE ELSE FALSE END as is_boosted
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      WHERE g.is_active = TRUE
    `;
    const params = [];
    let paramIndex = 1;

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
      query += ` AND g.date >= CURRENT_TIMESTAMP`;
    }

    query += ` ORDER BY is_boosted DESC, is_full ASC, g.created_at DESC`;

    if (limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(parseInt(limit, 10));
    }
    if (offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(parseInt(offset, 10));
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
};

// ==========================================
// GET SINGLE GROUP BY ID
// ==========================================
export const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = result.rows[0];

    // Check if current user is member/favorite/pending (if authenticated)
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
      group.is_member = memberCheck.rows.length > 0;
      group.is_favorite = favCheck.rows.length > 0;
      group.join_request_status = requestCheck.rows[0]?.status || null;
      group.waitlist_status = waitlistCheck.rows[0]?.status || null;
      group.waitlist_position = waitlistCheck.rows[0]?.position || null;
    }

    res.json(group);
  } catch (err) {
    console.error('Error fetching group:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ==========================================
// UPDATE GROUP (owner only)
// ==========================================
export const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, date, location, image_url, max_members, is_private, skill_level } = req.body;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    const textToCheck = [name, description].filter(Boolean).join('\n');
    if (textToCheck) {
      const { safe, reason } = await checkTextSafety(textToCheck);
      if (!safe) {
        return res.status(422).json({ error: reason });
      }
    }

    // Validate future date on update (groups only, clubs have no date)
    if (date !== undefined && date !== null) {
      const eventDate = new Date(date);
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'Ungültiges Datum' });
      }
      if (eventDate <= new Date()) {
        return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
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
           lat = CASE WHEN $5 IS NOT NULL THEN $11 ELSE lat END,
           lng = CASE WHEN $5 IS NOT NULL THEN $12 ELSE lng END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [name, description, category, date, location, image_url, max_members, is_private, skill_level, id, latUpdate, lngUpdate]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating group:', err);
    res.status(500).json({ error: 'Failed to update group' });
  }
};

// ==========================================
// DELETE GROUP (owner only)
// ==========================================
export const deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    await db.query('DELETE FROM groups WHERE id = $1', [id]);
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    console.error('Error deleting group:', err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
};

// ==========================================
// JOIN GROUP
// ==========================================
export const joinGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Check group exists
    const group = await db.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });

    // Check already member
    const existing = await db.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already a member' });

    // Check capacity
    const g = group.rows[0];
    if (g.members_count >= g.max_members) {
      return res.status(400).json({ error: 'Die Gruppe ist bereits voll' });
    }

    // Private group → create join request (or reset a previous rejection to pending)
    if (g.is_private) {
      const existingReq = await db.query(
        `SELECT * FROM group_join_requests WHERE group_id = $1 AND user_id = $2`,
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
      return res.json({ message: 'Join request sent', status: 'pending' });
    }

    // Public group → join directly
    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [id, req.userId, 'member']
    );
    await db.query('UPDATE groups SET members_count = members_count + 1 WHERE id = $1', [id]);
    // Clean up any leftover waitlist entry for this user
    await db.query('DELETE FROM group_waitlist WHERE group_id = $1 AND user_id = $2', [id, req.userId]);

    // Notify group owner (fire-and-forget)
    if (g.owner_id && g.owner_id !== req.userId) {
      notifyGroupJoin(req.userId, g.owner_id, g.name || g.title);
    }

    res.json({ message: 'Joined group successfully', status: 'joined' });
  } catch (err) {
    console.error('Error joining group:', err);
    res.status(500).json({ error: 'Failed to join group' });
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
    if (group.rows.length > 0 && group.rows[0].owner_id === req.userId) {
      return res.status(400).json({ error: 'Als Ersteller kannst du die Gruppe nicht verlassen – lösche sie stattdessen.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not a member of this group' });
    }

    // Decrement member count
    await db.query(
      'UPDATE groups SET members_count = GREATEST(members_count - 1, 0) WHERE id = $1',
      [id]
    );

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
        const grpName = (await db.query('SELECT name FROM groups WHERE id = $1', [id])).rows[0]?.name || '';
        sendPushToUser(wUserId, 'Platz frei!', `Ein Platz in "${grpName}" ist frei geworden`, `/group/${id}`);
      }
    }

    res.json({ message: 'Left group successfully' });
  } catch (err) {
    console.error('Error leaving group:', err);
    res.status(500).json({ error: 'Failed to leave group' });
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
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
};

// ==========================================
// GET USER FAVORITES
// ==========================================
export const getUserFavorites = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM group_favorites gf
       JOIN groups g ON gf.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE gf.user_id = $1
       ORDER BY gf.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
};

// ==========================================
// GET GROUP MEMBERS
// ==========================================
export const getGroupMembers = async (req, res) => {
  try {
    const { id } = req.params;
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
    console.error('Error fetching members:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

// ==========================================
// GET USER'S JOINED GROUPS
// ==========================================
export const getUserGroups = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, gm.role,
              lm.content as last_message,
              lm.created_at as last_message_time,
              lm_user.name as last_message_sender
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
       ORDER BY lm.created_at DESC NULLS LAST, gm.joined_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user groups:', err);
    res.status(500).json({ error: 'Failed to fetch user groups' });
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
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    const result = await db.query(
      `SELECT jr.*, u.name as user_name, u.avatar_url as user_avatar, u.bio as user_bio,
              u.interests as user_interests, u.date_of_birth as user_dob,
              u.is_trusted_user as user_trusted
       FROM group_join_requests jr
       JOIN users u ON jr.user_id = u.id
       WHERE jr.group_id = $1 AND jr.status = 'pending'
       ORDER BY jr.created_at DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching join requests:', err);
    res.status(500).json({ error: 'Failed to fetch join requests' });
  }
};

// ==========================================
// HANDLE JOIN REQUEST (accept/reject)
// ==========================================
export const handleJoinRequest = async (req, res) => {
  try {
    const { id, requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    // Get the request
    const request = await db.query(
      'SELECT * FROM group_join_requests WHERE id = $1 AND group_id = $2',
      [requestId, id]
    );
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const joinReq = request.rows[0];

    if (action === 'accept') {
      await db.query(
        `UPDATE group_join_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId]
      );
      await db.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, joinReq.user_id, 'member']
      );
      await db.query(
        'UPDATE groups SET members_count = members_count + 1 WHERE id = $1',
        [id]
      );

      // Notify the accepted user (group name already fetched above)
      const gname = (await db.query('SELECT name FROM groups WHERE id = $1', [id])).rows[0]?.name || '';
      sendPushToUser(joinReq.user_id, 'Beitrittsanfrage akzeptiert', `Du bist jetzt Mitglied von "${gname}"`, `/group/${id}`);

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
    res.status(500).json({ error: 'Failed to handle request' });
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
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

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

    await db.query(
      'UPDATE groups SET members_count = GREATEST(members_count - 1, 0) WHERE id = $1',
      [id]
    );

    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Error kicking member:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

// ==========================================
// CANCEL GROUP/EVENT (owner only — notifies all members)
// ==========================================
export const cancelGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Verify ownership
    const group = await db.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    // Get all members for notification
    const members = await db.query(
      'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2',
      [id, req.userId]
    );

    // Mark group as inactive (soft delete)
    await db.query(
      'UPDATE groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    // Create notification for each member
    const groupName = group.rows[0].name;
    for (const member of members.rows) {
      await db.query(
        `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
         VALUES ($1, $2, 'group_cancelled', $3, $4, 'group', $5)`,
        [member.user_id, req.userId, `${groupName} wurde abgesagt`, reason || 'Das Event wurde vom Ersteller abgesagt.', id]
      );
    }

    res.json({ message: 'Group cancelled and members notified', notified: members.rows.length });
  } catch (err) {
    console.error('Error cancelling group:', err);
    res.status(500).json({ error: 'Failed to cancel group' });
  }
};

// ==========================================
// JOIN WAITLIST
// ==========================================
export const joinWaitlist = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await db.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const g = group.rows[0];
    if (g.members_count < g.max_members) {
      return res.status(400).json({ error: 'Group not full. Join directly.' });
    }

    const existing = await db.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member' });
    }

    const waitlistCheck = await db.query(
      'SELECT * FROM group_waitlist WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (waitlistCheck.rows.length > 0) {
      return res.json({ message: 'Already on waitlist', position: waitlistCheck.rows[0].position });
    }

    const result = await db.query(
      'INSERT INTO group_waitlist (group_id, user_id) VALUES ($1, $2) RETURNING *',
      [id, req.userId]
    );

    res.json({ message: 'Added to waitlist', position: result.rows[0].position });
  } catch (err) {
    console.error('Error joining waitlist:', err);
    res.status(500).json({ error: 'Failed to join waitlist' });
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
    res.status(500).json({ error: 'Failed to leave waitlist' });
  }
};

// ==========================================
// GET WAITLIST FOR A GROUP
// ==========================================
export const getWaitlist = async (req, res) => {
  try {
    const { id } = req.params;
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
    res.status(500).json({ error: 'Failed to fetch waitlist' });
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
    res.status(500).json({ error: 'Failed to check waitlist' });
  }
};

// ==========================================
// GET MEMBER AVATARS FOR CARD DISPLAY
// ==========================================
export const getGroupMemberAvatars = async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit, 10) || 4;
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
    res.status(500).json({ error: 'Failed to fetch avatars' });
  }
};

// ==========================================
// INVITE FRIEND TO GROUP (owner only)
// ==========================================
export const inviteMember = async (req, res) => {
  try {
    const { id, friendId } = req.params;

    const group = await db.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (group.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    const g = group.rows[0];

    const memberCount = await db.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [id]);
    if (g.max_members && parseInt(memberCount.rows[0].count) >= g.max_members) {
      return res.status(400).json({ error: 'Group is full' });
    }

    const existing = await db.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, friendId]
    );
    if (existing.rows.length) return res.status(400).json({ error: 'Already a member' });

    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [id, friendId, 'member']
    );

    await db.query(
      'UPDATE groups SET members_count = members_count + 1 WHERE id = $1',
      [id]
    );

    await db.query(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, 'group_invite', $3, $4, 'group', $5)`,
      [friendId, req.userId, `Einladung: ${g.name}`, `Du wurdest zur Gruppe "${g.name}" eingeladen!`, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error inviting member:', err);
    res.status(500).json({ error: 'Failed to invite member' });
  }
};

// ── Push helper (fire-and-forget) ───────────────────────────────────────────
async function notifyGroupJoin(joinerUserId, ownerUserId, groupName) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [joinerUserId]);
    const name = rows[0]?.name || 'Jemand';
    sendPushToUser(ownerUserId, 'Neues Mitglied', `${name} ist "${groupName}" beigetreten`, '/my-groups');
  } catch { /* non-critical */ }
}

// ==========================================
// GET CATEGORIES
// ==========================================
export const getCategories = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM categories ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};