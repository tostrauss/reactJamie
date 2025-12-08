import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import { generateToken } from '../middleware/auth.js';

export const completeOnboarding = async (req, res) => {
  try {
    const { gender, location, interests, bio, photos } = req.body;
    
    // Store arrays as JSON strings for SQLite
    const interestsStr = JSON.stringify(interests || []);
    const photosStr = JSON.stringify(photos || []);

    const result = await db.query(
      `UPDATE users 
       SET gender = ?, location = ?, interests = ?, bio = ?, photos = ?, onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [gender, location, interestsStr, bio, photosStr, req.userId]
    );

    // Fetch updated user
    const updatedUser = await db.query('SELECT * FROM users WHERE id = ?', [req.userId]);
    res.json(updatedUser.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const userExists = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.query(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name]
    );

    const token = generateToken(result.rows[0].id);
    res.status(201).json({
      user: result.rows[0],
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, bio, avatar_url, location, gender, interests, photos FROM users WHERE id = ?',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
    try {
        if (typeof interests === 'string') user.interests = JSON.parse(interests);
        if (typeof photos === 'string') user.photos = JSON.parse(photos);
      } catch (e) {
        // Ignore JSON parse errors
        }
        res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, bio, location } = req.body;
    
    const result = await db.query(
      'UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), location = COALESCE(?, location), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, bio, location, req.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
