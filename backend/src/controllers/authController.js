import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import { generateToken } from '../middleware/auth.js';

export const completeOnboarding = async (req, res) => {
  try {
    // ADDED: avatar_url to destructuring
    const { gender, location, interests, bio, photos, avatar_url, favorite_song } = req.body;
    
    const interestsStr = JSON.stringify(interests || []);
    const photosStr = JSON.stringify(photos || []);
    const songStr = favorite_song ? JSON.stringify(favorite_song) : null;

    // ADDED: Update avatar_url in the database query
    await db.query(
      `UPDATE users 
       SET gender = ?, location = ?, interests = ?, bio = ?, photos = ?, avatar_url = ?, favorite_song = ?, onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [gender, location, interestsStr, bio, photosStr, avatar_url, songStr, req.userId]
    );
    
    const result = await db.query('SELECT * FROM users WHERE id = ?', [req.userId]);
    const user = result.rows[0];

    // JSON Strings zurück in Arrays parsen für das Frontend
    try {
      if (user.interests) user.interests = JSON.parse(user.interests);
      if (user.photos) user.photos = JSON.parse(user.photos);
      if (user.favorite_song) user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) { console.error(e); }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check duplicate
    const userExists = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert
    const insertResult = await db.query(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name]
    );

    // CRITICAL: Sofort den neuen User abrufen
    const newUserId = insertResult.rows[0].id;
    const userResult = await db.query('SELECT * FROM users WHERE id = ?', [newUserId]);
    const user = userResult.rows[0];

    const token = generateToken(user.id);
    
    // Passwort nicht zurücksenden
    delete user.password;

    res.status(201).json({ user, token });
  } catch (error) {
    console.error("Register Error:", error);
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
    
    // JSON Parsen falls nötig
    try {
      if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {}

    delete user.password; // Passwort entfernen

    res.json({ user, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    delete user.password;

    try {
      if (user.interests) user.interests = JSON.parse(user.interests);
      if (user.photos) user.photos = JSON.parse(user.photos);
    } catch (e) {}

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    // Basic implementation for profile updates
    const { name, location, bio, gender, interests, photos, avatar_url, favorite_song } = req.body;
    
    const interestsStr = JSON.stringify(interests || []);
    const photosStr = JSON.stringify(photos || []);
    const songStr = favorite_song ? JSON.stringify(favorite_song) : null;

    await db.query(
      `UPDATE users 
       SET name = COALESCE(?, name),
           location = COALESCE(?, location),
           bio = COALESCE(?, bio),
           gender = COALESCE(?, gender),
           interests = COALESCE(?, interests),
           photos = COALESCE(?, photos),
           avatar_url = COALESCE(?, avatar_url),
           favorite_song = COALESCE(?, favorite_song),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, location, bio, gender, interestsStr, photosStr, avatar_url, songStr, req.userId]
    );

    // Return updated profile
    const result = await db.query('SELECT * FROM users WHERE id = ?', [req.userId]);
    const user = result.rows[0];
    
    try {
      if (user.interests) user.interests = JSON.parse(user.interests);
      if (user.photos) user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {}

    res.json(user); 
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};