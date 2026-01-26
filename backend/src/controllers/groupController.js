import db from '../config/database.js';

export const createGroup = async (req, res) => {
  // 1. Get data from Frontend
  const { name, description, type, category, date, location, image_url } = req.body;
  const userId = req.session.userId; // Secure session ID

  // 2. Validations
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    // 3. Insert into Database
    // We use the same table for both, but 'type' distinguishes them
    const result = await db.query(
      `INSERT INTO groups (name, description, type, category, date, location, image_url, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, description, type || 'group', category, date, location, image_url, userId]
    );

    // 4. Auto-add creator as a member
    const newGroup = result.rows[0];
    await db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
      [newGroup.id, userId]
    );

    res.status(201).json(newGroup);
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Database creation failed' });
  }
};

export const getGroups = async (req, res) => {
  try {
    // Fetch groups and include the creator's username (optional but nice)
    const result = await db.query(`
      SELECT g.*, u.username as owner_name 
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      ORDER BY g.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
};

export const getGroupById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(`SELECT * FROM groups WHERE id = $1`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Group not found" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
};