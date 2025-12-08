import db from '../config/database.js';

export const createGroup = async (req, res) => {
  try {
    const { title, description, type } = req.body;
    
    if (!['group', 'club'].includes(type)) {
      return res.status(400).json({ error: 'Invalid group type' });
    }

    const result = await db.query(
      'INSERT INTO groups (title, description, type, owner_id) VALUES (?, ?, ?, ?)',
      [title, description, type, req.userId]
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
    const { type } = req.query;
    let query = `
      SELECT g.*, u.name as owner_name, COUNT(gm.id) as member_count
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id
    `;
    
    if (type && ['group', 'club'].includes(type)) {
      query += ` WHERE g.type = ?`;
    }
    
    query += ` GROUP BY g.id, u.name ORDER BY g.created_at DESC`;

    const result = type 
      ? await db.query(query, [type])
      : await db.query(query);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

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
    const result = await pool.query(
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
