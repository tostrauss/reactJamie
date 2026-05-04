import db from '../config/database.js';
import { geocodeLocation } from '../utils/geocode.js';

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
    skill_level
  } = req.body;
  const userId = req.userId;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    // Optional: allow a "next meetup" date for clubs
    let dateTime = date || null;
    if (date && time) {
      dateTime = `${date}T${time}`;
    }

    // Geocode location (non-blocking on failure)
    const coords = await geocodeLocation(location);

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
        lng
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        coords?.lng ?? null
      ]
    );

    const newClub = result.rows[0];

    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [newClub.id, userId, 'owner']
    );

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

    let query = `
      SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      WHERE g.is_active = TRUE
        AND g.type = $1
    `;
    const params = [CLUB_TYPE];
    let paramIndex = 2;

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
      skill_level
    } = req.body;

    const club = await db.query(
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

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
           lat = CASE WHEN $5 IS NOT NULL THEN $12 ELSE lat END,
           lng = CASE WHEN $5 IS NOT NULL THEN $13 ELSE lng END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10 AND type = $11
       RETURNING *`,
      [
        name,
        description,
        category,
        date,
        location,
        image_url,
        max_members,
        is_private,
        skill_level,
        id,
        CLUB_TYPE,
        latUpdate,
        lngUpdate
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating club:', err);
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
      'SELECT owner_id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    await db.query('DELETE FROM groups WHERE id = $1 AND type = $2', [id, CLUB_TYPE]);
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

    const clubResult = await db.query(
      'SELECT * FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (clubResult.rows.length === 0) return res.status(404).json({ error: 'Club not found' });

    const existing = await db.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already a member' });

    const c = clubResult.rows[0];
    if (c.max_members && c.members_count >= c.max_members) {
      return res.status(400).json({ error: 'Club is full' });
    }

    if (c.is_private) {
      const existingReq = await db.query(
        `SELECT * FROM group_join_requests 
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
      return res.json({ message: 'Join request sent', status: 'pending' });
    }

    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [id, req.userId, 'member']
    );

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
        error: 'Als Ersteller kannst du den Club nicht verlassen â€“ lÃ¶sche ihn stattdessen.'
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

    // Ensure this is a club
    const club = await db.query(
      'SELECT id FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    const request = await db.query(
      'SELECT * FROM group_join_requests WHERE id = $1 AND group_id = $2',
      [requestId, id]
    );
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const joinReq = request.rows[0];

    if (action === 'accept') {
      await db.query(
        `UPDATE group_join_requests 
         SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [requestId]
      );

      await db.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, joinReq.user_id, 'member']
      );

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
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    if (parseInt(userId, 10) === req.userId) {
      return res.status(400).json({
        error: 'Cannot remove yourself. Delete the club instead.'
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

    const club = await db.query(
      'SELECT * FROM groups WHERE id = $1 AND type = $2',
      [id, CLUB_TYPE]
    );
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found' });
    if (club.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });

    const members = await db.query(
      'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2',
      [id, req.userId]
    );

    await db.query(
      'UPDATE groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    const clubName = club.rows[0].name;
    const io = req.app?.get('io');

    for (const member of members.rows) {
      const notifResult = await db.query(
        `INSERT INTO notifications (
          user_id,
          sender_id,
          type,
          title,
          message,
          reference_type,
          reference_id
        ) 
         VALUES ($1, $2, 'club_cancelled', $3, $4, 'club', $5)
         RETURNING *`,
        [
          member.user_id,
          req.userId,
          `${clubName} wurde geschlossen`,
          reason || 'Der Club wurde vom Ersteller geschlossen.',
          id
        ]
      );

      const notification = notifResult.rows[0];
      if (io) {
        io.to(`user_${member.user_id}`).emit('new_notification', notification);
      }
    }

    res.json({ message: 'Club cancelled and members notified', notified: members.rows.length });
  } catch (err) {
    console.error('Error cancelling club:', err);
    res.status(500).json({ error: 'Club konnte nicht deaktiviert werden' });
  }
};

// Reuse shared categories endpoint from groups
export { getCategories } from './groupController.js';


