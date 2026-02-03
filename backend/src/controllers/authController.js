import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import { generateToken } from '../middleware/auth.js';

// ==========================================
// REGISTER
// ==========================================
export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user exists
    const userExists = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user with RETURNING
    const insertResult = await db.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id',
      [email, hashedPassword, name]
    );

    const newUserId = insertResult.rows[0].id;

    // Fetch full user object
    const userResult = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [newUserId]
    );
    const user = userResult.rows[0];

    // Generate token & clean response
    const token = generateToken(user.id);
    delete user.password;

    // Parse JSON fields for frontend
    try {
      if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {}

    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// LOGIN
// ==========================================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);

    // Parse JSON fields
    try {
      if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {}

    delete user.password;

    res.json({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// GET PROFILE
// ==========================================
export const getProfile = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    delete user.password;

    // Parse JSON fields
    try {
      if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {}

    res.json(user);
  } catch (error) {
    console.error('GetProfile error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// UPDATE PROFILE
// ==========================================
export const updateProfile = async (req, res) => {
  try {
    const { name, location, bio, gender, interests, photos, avatar_url, favorite_song } = req.body;

    const interestsStr = interests ? JSON.stringify(interests) : null;
    const photosStr = photos ? JSON.stringify(photos) : null;
    const songStr = favorite_song ? JSON.stringify(favorite_song) : null;

    await db.query(
      `UPDATE users 
       SET name = COALESCE($1, name),
           location = COALESCE($2, location),
           bio = COALESCE($3, bio),
           gender = COALESCE($4, gender),
           interests = COALESCE($5, interests),
           photos = COALESCE($6, photos),
           avatar_url = COALESCE($7, avatar_url),
           favorite_song = COALESCE($8, favorite_song),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [name, location, bio, gender, interestsStr, photosStr, avatar_url, songStr, req.userId]
    );

    // Return updated profile
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    delete user.password;

    // Parse JSON fields
    try {
      if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) {}

    res.json(user);
  } catch (error) {
    console.error('UpdateProfile error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// COMPLETE ONBOARDING
// ==========================================
export const completeOnboarding = async (req, res) => {
  try {
    const { gender, location, interests, bio, photos, avatar_url, favorite_song } = req.body;

    const interestsStr = JSON.stringify(interests || []);
    const photosStr = JSON.stringify(photos || []);
    const songStr = favorite_song ? JSON.stringify(favorite_song) : null;

    await db.query(
      `UPDATE users 
       SET gender = $1, 
           location = $2, 
           interests = $3, 
           bio = $4, 
           photos = $5, 
           avatar_url = $6, 
           favorite_song = $7, 
           onboarding_completed = TRUE, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8`,
      [gender, location, interestsStr, bio, photosStr, avatar_url, songStr, req.userId]
    );

    // Return updated user
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    delete user.password;

    // Parse JSON fields
    try {
      if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
      if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
      if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
    } catch (e) { console.error('JSON parse error:', e); }

    res.json(user);
  } catch (error) {
    console.error('CompleteOnboarding error:', error);
    res.status(500).json({ error: error.message });
  }
};