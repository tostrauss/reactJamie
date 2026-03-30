import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateToken } from '../middleware/auth.js';
import { sendPasswordResetEmail, sendVerificationEmail, sendOTPEmail } from '../utils/email.js';

const parseUserJSONFields = (user) => {
  try {
    if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
    if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
    if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
  } catch (e) { console.error('Failed to parse user JSON fields:', e.message); }
  return user;
};

// ==========================================
// REGISTER
// ==========================================
export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Password policy validation (server-side mirror of frontend rules)
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Mindestens 6 Zeichen erforderlich' });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: 'Mindestens 1 Großbuchstabe erforderlich' });
    }
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({ error: 'Mindestens 1 Kleinbuchstabe erforderlich' });
    }
    if (!/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Mindestens 1 Zahl erforderlich' });
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ error: 'Mindestens 1 Sonderzeichen erforderlich' });
    }

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

    // Initialize boost wallet + generate referral code
    await db.query(
      'INSERT INTO boost_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [newUserId]
    );
    const refCode = 'JAMIE-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    await db.query(
      'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [newUserId, refCode]
    );

    // Redeem referral code if provided
    const { referral_code } = req.body;
    if (referral_code) {
      const codeOwner = await db.query(
        'SELECT user_id FROM referral_codes WHERE UPPER(code) = UPPER($1)',
        [referral_code]
      );
      if (codeOwner.rows.length && codeOwner.rows[0].user_id !== newUserId) {
        const ownerId = codeOwner.rows[0].user_id;
        // Credit new user
        await db.query(
          `INSERT INTO boost_credits (user_id, credits, total_earned) VALUES ($1, 1, 1)
           ON CONFLICT (user_id) DO UPDATE SET credits = boost_credits.credits + 1, total_earned = boost_credits.total_earned + 1`,
          [newUserId]
        );
        // Credit code owner
        await db.query(
          `UPDATE boost_credits SET credits = credits + 1, total_earned = total_earned + 1 WHERE user_id = $1`,
          [ownerId]
        );
        await db.query(
          'UPDATE referral_codes SET used_count = used_count + 1 WHERE user_id = $1',
          [ownerId]
        );
      }
    }

    // Fetch full user object
    const userResult = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [newUserId]
    );
    const user = userResult.rows[0];

    // Generate token & clean response
    const token = generateToken(user.id);
    delete user.password;

    parseUserJSONFields(user);
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

    // Account lockout check
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return res.status(429).json({
        locked: true,
        error: `Account gesperrt. Versuche es in ${minutesLeft} Minute${minutesLeft !== 1 ? 'n' : ''} erneut.`
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      const attempts = (user.login_attempts || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
      await db.query(
        'UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockUntil, user.id]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset lockout on successful login
    await db.query(
      'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1',
      [user.id]
    );

    const token = generateToken(user.id);

    parseUserJSONFields(user);
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

    parseUserJSONFields(user);
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

    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    if (bio && bio.length > 500) {
      return res.status(400).json({ error: 'Bio cannot exceed 500 characters' });
    }
    if (location && location.length > 255) {
      return res.status(400).json({ error: 'Location cannot exceed 255 characters' });
    }

    const interestsStr = interests ? JSON.stringify(interests) : null;
    const photosStr = photos ? JSON.stringify(photos) : null;

    // favorite_song: allow explicit null to clear it
    const hasFavSong = 'favorite_song' in req.body;
    const songStr = favorite_song ? JSON.stringify(favorite_song) : (hasFavSong ? null : undefined);

    await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           location = COALESCE($2, location),
           bio = COALESCE($3, bio),
           gender = COALESCE($4, gender),
           interests = COALESCE($5, interests),
           photos = COALESCE($6, photos),
           avatar_url = COALESCE($7, avatar_url),
           favorite_song = ${hasFavSong ? '$8' : 'COALESCE($8, favorite_song)'},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [name, location, bio, gender, interestsStr, photosStr, avatar_url, songStr || null, req.userId]
    );

    // Return updated profile
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    delete user.password;

    parseUserJSONFields(user);
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

    parseUserJSONFields(user);
    res.json(user);
  } catch (error) {
    console.error('CompleteOnboarding error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// CHANGE PASSWORD
// ==========================================
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const result = await db.query('SELECT password FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashed, req.userId]);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('ChangePassword error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==========================================
// DELETE ACCOUNT
// ==========================================
export const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password required to delete account' });
    }

    const result = await db.query('SELECT password FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    // Delete user - cascades to all related data
    await db.query('DELETE FROM users WHERE id = $1', [req.userId]);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('DeleteAccount error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};

// ==========================================
// FORGOT PASSWORD (request reset link)
// ==========================================
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-Mail ist erforderlich' });
    }

    // Always return success to prevent email enumeration
    const successMsg = { message: 'Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.' };

    const result = await db.query('SELECT id, name FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.json(successMsg);
    }

    const user = result.rows[0];

    // Delete any existing tokens for this user
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    // Send email (non-blocking - don't fail if email fails)
    try {
      await sendPasswordResetEmail(email, token, user.name);
    } catch (emailErr) {
      console.error('Failed to send reset email:', emailErr);
    }

    res.json(successMsg);
  } catch (error) {
    console.error('ForgotPassword error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// RESET PASSWORD (with token)
// ==========================================
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
    }

    // Find valid token
    const result = await db.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link. Bitte fordere einen neuen an.' });
    }

    const resetToken = result.rows[0];

    // Hash new password and update
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashed, resetToken.user_id]);

    // Mark token as used
    await db.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetToken.id]);

    res.json({ message: 'Passwort erfolgreich zurückgesetzt. Du kannst dich jetzt einloggen.' });
  } catch (error) {
    console.error('ResetPassword error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SEND VERIFICATION EMAIL
// ==========================================
export const sendVerification = async (req, res) => {
  try {
    const result = await db.query('SELECT id, email, name, is_verified FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.json({ message: 'E-Mail ist bereits verifiziert' });
    }

    // Delete old tokens, create new one
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    try {
      await sendVerificationEmail(user.email, token, user.name);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr);
      return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
    }

    res.json({ message: 'Bestätigungs-E-Mail gesendet' });
  } catch (error) {
    console.error('SendVerification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SEND EMAIL OTP (pre-registration, no auth)
// ==========================================
export const sendEmailCode = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'E-Mail ist erforderlich' });

    // Check email not already registered
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Diese E-Mail ist bereits registriert' });
    }

    // Delete any old codes for this email
    await db.query('DELETE FROM email_verification_codes WHERE email = $1', [email]);

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.query(
      'INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );

    try {
      await sendOTPEmail(email, code, name || '');
    } catch (emailErr) {
      if (process.env.NODE_ENV !== 'production') {
        // In development: log the code so you can test without a verified Resend domain
        console.warn(`[DEV] OTP email failed — use this code for ${email}: ${code}`);
      } else {
        console.error('Failed to send OTP email:', emailErr);
        return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
      }
    }

    res.json({ message: 'Code gesendet' });
  } catch (error) {
    console.error('sendEmailCode error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// VERIFY EMAIL OTP (pre-registration, no auth)
// ==========================================
export const verifyEmailCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'E-Mail und Code erforderlich' });

    const result = await db.query(
      'SELECT * FROM email_verification_codes WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()',
      [email, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Code' });
    }

    // Mark as used
    await db.query('UPDATE email_verification_codes SET used = TRUE WHERE id = $1', [result.rows[0].id]);

    res.json({ verified: true });
  } catch (error) {
    console.error('verifyEmailCode error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// VERIFY EMAIL (with token)
// ==========================================
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token erforderlich' });
    }

    const result = await db.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link.' });
    }

    const resetToken = result.rows[0];

    // Mark user as verified
    await db.query('UPDATE users SET is_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [resetToken.user_id]);

    // Mark token as used
    await db.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetToken.id]);

    res.json({ message: 'E-Mail erfolgreich verifiziert!' });
  } catch (error) {
    console.error('VerifyEmail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};