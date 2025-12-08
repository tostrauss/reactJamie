import db from '../config/database.js';

export const createGroup = async (req, res) => {
  try {
    // ADDED: image_url and category
    const { title, description, type, category, image_url } = req.body;
    
    if (!['group', 'club'].includes(type)) {
      return res.status(400).json({ error: 'Invalid group type' });
    }

    const result = await db.query(
      'INSERT INTO groups (title, description, type, category, image_url, owner_id) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, type, category, image_url, req.userId]
    );

    // Add creator as member
    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
      [result.rows[0].id, req.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getGroups = async (req, res) => {
  try {
    const { type, search, category } = req.query;
    let query = `
      SELECT g.*, u.name as owner_name, COUNT(gm.id) as member_count
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id
      WHERE 1=1
    `;
    const params = [];

    // Filter by Type (Group/Club)
    if (type && ['group', 'club'].includes(type)) {
      query += ` AND g.type = ?`;
      params.push(type);
    }

    // ADDED: Filter by Category
    if (category && category !== 'all') {
      query += ` AND g.category = ?`;
      params.push(category);
    }

    // ADDED: Search by Title or Description
    if (search) {
      query += ` AND (g.title LIKE ? OR g.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ` GROUP BY g.id, u.name ORDER BY g.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ... keep existing getGroupById, joinGroup, leaveGroup, toggleFavorite, etc. ...
export const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT g.*, u.name as owner_name, COUNT(gm.id) as member_count
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id = ?
       GROUP BY g.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const joinGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if already member
    const existing = await db.query(
      'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Already a member' });
    }

    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
      [id, req.userId]
    );

    res.json({ message: 'Joined successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [id, req.userId]
    );

    res.json({ message: 'Left group' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      'SELECT * FROM favorites WHERE group_id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM favorites WHERE group_id = ? AND user_id = ?',
        [id, req.userId]
      );
      res.json({ favorited: false });
    } else {
      await db.query(
        'INSERT INTO favorites (group_id, user_id) VALUES (?, ?)',
        [id, req.userId]
      );
      res.json({ favorited: true });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getUserFavorites = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, COUNT(gm.id) as member_count
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       INNER JOIN favorites f ON g.id = f.group_id
       WHERE f.user_id = ?
       GROUP BY g.id`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getUserGroups = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, COUNT(gm.id) as member_count
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       INNER JOIN group_members ugm ON g.id = ugm.group_id
       WHERE ugm.user_id = ?
       GROUP BY g.id`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getGroupMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT u.id, u.name, u.avatar_url, u.location 
       FROM group_members gm 
       JOIN users u ON gm.user_id = u.id 
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};