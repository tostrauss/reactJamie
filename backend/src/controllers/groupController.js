import db from '../config/database.js';
import { geocodeLocation } from '../utils/geocode.js';

// ==========================================
// CREATE GROUP / CLUB
// ==========================================
export const createGroup = async (req, res) => {
  const { name, description, type, category, date, time, location, image_url, max_members, is_private, skill_level } = req.body;
  const userId = req.userId; // JWT auth (not session)

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    // Combine date + time if both provided
    let dateTime = date || null;
    if (date && time) {
      dateTime = `${date}T${time}`;
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

    // Check if current user is member/favorite (if authenticated)
    if (req.userId) {
      const memberCheck = await db.query(
        'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      group.is_member = memberCheck.rows.length > 0;

      const favCheck = await db.query(
        'SELECT * FROM group_favorites WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      group.is_favorite = favCheck.rows.length > 0;
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
      return res.status(400).json({ error: 'Group is full' });
    }

    // Private group → create join request (or reset a previous rejection to pending)
    if (g.is_private) {
      const existingReq = await db.query(
        `SELECT * FROM group_join_requests WHERE group_id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (existingReq.rows.length > 0 && existingReq.rows[0].status === 'pending') {
        return res.status(400).json({ error: 'Join request already pending' });
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
      return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or delete the group.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not a member of this group' });
    }

    // Check if there's a waitlist and notify first person
    const g = group.rows[0];
    if (g.members_count === g.max_members) {
      const waitlistUser = await db.query(
        `SELECT user_id FROM group_waitlist
         WHERE group_id = $1 AND status = 'waiting'
         ORDER BY position ASC LIMIT 1`,
        [id]
      );

      if (waitlistUser.rows.length > 0) {
        // Notify first person on waitlist
        await db.query(
          `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
           VALUES ($1, 'waitlist_opening', 'Platz frei!', 'Ein Platz ist in deiner Warteliste-Gruppe frei geworden.', 'group', $2)`,
          [waitlistUser.rows[0].user_id, id]
        );

        // Mark as notified
        await db.query(
          `UPDATE group_waitlist SET status = 'notified', notified_at = CURRENT_TIMESTAMP
           WHERE group_id = $1 AND user_id = $2`,
          [id, waitlistUser.rows[0].user_id]
        );
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
      `SELECT jr.*, u.name as user_name, u.avatar_url as user_avatar, u.bio as user_bio
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
      // Update request status
      await db.query(
        `UPDATE group_join_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId]
      );

      // Add user as member
      await db.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, joinReq.user_id, 'member']
      );

      res.json({ message: 'Request accepted', status: 'accepted' });
    } else if (action === 'reject') {
      await db.query(
        `UPDATE group_join_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId]
      );
      res.json({ message: 'Request rejected', status: 'rejected' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "accept" or "reject".' });
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
      return res.status(400).json({ error: 'Cannot remove yourself. Delete the group instead.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User is not a member of this group' });
    }

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