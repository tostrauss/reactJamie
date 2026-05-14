import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { generateToken, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { sendPasswordResetEmail, sendVerificationEmail, sendOTPEmail } from '../utils/email.js';

const parseUserJSONFields = (user) => {
  try {
    if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
    if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
    if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
  } catch (e) { console.error('Failed to parse user JSON fields:', e.message); }
  return user;
};

const SENSITIVE_FIELDS = [
  'password', 'spotify_access_token', 'spotify_refresh_token',
  'login_attempts', 'locked_until', 'google_id',
];
const sanitizeUserForClient = (user) => {
  for (const f of SENSITIVE_FIELDS) delete user[f];
  return user;
};

// ==========================================
// REGISTER
// ==========================================
export const register = async (req, res) => {
  try {
    const { email, password, name, date_of_birth } = req.body;

    // Age gating: must be 18+
    if (!date_of_birth) {
      return res.status(400).json({ error: 'Geburtsdatum ist erforderlich' });
    }
    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
    }
    const ageCutoff = new Date();
    ageCutoff.setFullYear(ageCutoff.getFullYear() - 18);
    if (dob > ageCutoff) {
      return res.status(400).json({ error: 'Du musst mindestens 18 Jahre alt sein, um JAMIE zu nutzen.' });
    }

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
      return res.status(400).json({ error: 'Diese E-Mail-Adresse ist bereits registriert' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert new user with RETURNING
    const insertResult = await db.query(
      'INSERT INTO users (email, password, name, date_of_birth) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hashedPassword, name, date_of_birth]
    );

    const newUserId = insertResult.rows[0].id;

    // Initialize boost wallet + generate referral code
    await db.query(
      'INSERT INTO boost_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [newUserId]
    );
    const refCode = 'JAMIE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await db.query(
      'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [newUserId, refCode]
    );

    // Redeem referral code if provided — record in boost_transactions so the standalone
    // redeemReferral endpoint can't be used again for the same pair
    const { referral_code } = req.body;
    if (referral_code) {
      try {
        const codeOwner = await db.query(
          'SELECT user_id FROM referral_codes WHERE UPPER(code) = UPPER($1)',
          [referral_code]
        );
        if (codeOwner.rows.length && codeOwner.rows[0].user_id !== newUserId) {
          const ownerId = codeOwner.rows[0].user_id;
          const refPaymentId = `ref_${ownerId}_to_${newUserId}`;
          // Insert transaction records first — UNIQUE constraint prevents double-dipping
          await db.query(
            `INSERT INTO boost_transactions (user_id, credits, amount_cents, payment_provider, payment_id, status)
             VALUES ($1, 1, 0, 'referral', $2, 'completed') ON CONFLICT DO NOTHING`,
            [newUserId, refPaymentId]
          );
          const inserted = await db.query(
            `INSERT INTO boost_transactions (user_id, credits, amount_cents, payment_provider, payment_id, status)
             VALUES ($1, 1, 0, 'referral', $2, 'completed') ON CONFLICT DO NOTHING RETURNING id`,
            [ownerId, `ref_${ownerId}_invited_${newUserId}`]
          );
          if (inserted.rowCount > 0) {
            // Only credit if not already credited (idempotency)
            await db.query(
              `INSERT INTO boost_credits (user_id, credits, total_earned) VALUES ($1, 1, 1)
               ON CONFLICT (user_id) DO UPDATE SET credits = boost_credits.credits + 1, total_earned = boost_credits.total_earned + 1`,
              [newUserId]
            );
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
      } catch (refErr) {
        // Referral errors must not block registration
        console.error('[referral]', refErr.message);
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
    sanitizeUserForClient(user);

    parseUserJSONFields(user);
    setAuthCookie(res, token);
    res.status(201).json({ user, token });
  } catch (error) {
    // Unique constraint violation — concurrent registration with the same email
    if (error.code === '23505' && error.constraint?.includes('email')) {
      return res.status(400).json({ error: 'Diese E-Mail-Adresse ist bereits registriert' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
};

// ==========================================
// LOGIN
// ==========================================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
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
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    }

    // Reset lockout on successful login
    await db.query(
      'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1',
      [user.id]
    );

    const token = generateToken(user.id);

    sanitizeUserForClient(user);
    parseUserJSONFields(user);

    setAuthCookie(res, token);
    res.json({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login fehlgeschlagen' });
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
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];
    sanitizeUserForClient(user);
    parseUserJSONFields(user);
    res.json(user);
  } catch (error) {
    console.error('GetProfile error:', error);
    res.status(500).json({ error: 'Profil konnte nicht geladen werden' });
  }
};

// ==========================================
// UPDATE PROFILE
// ==========================================
export const updateProfile = async (req, res) => {
  try {
    const { name, location, bio, gender, interests, photos, avatar_url, favorite_song, date_of_birth } = req.body;

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
           date_of_birth = CASE WHEN $10::text IS NOT NULL THEN $10::date ELSE date_of_birth END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [name, location, bio, gender, interestsStr, photosStr, avatar_url, songStr || null, req.userId, date_of_birth || null]
    );

    // Return updated profile
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    sanitizeUserForClient(user);
    parseUserJSONFields(user);
    res.json(user);
  } catch (error) {
    console.error('UpdateProfile error:', error);
    res.status(500).json({ error: 'Profil konnte nicht gespeichert werden' });
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
    sanitizeUserForClient(user);
    parseUserJSONFields(user);
    res.json(user);
  } catch (error) {
    console.error('CompleteOnboarding error:', error);
    res.status(500).json({ error: 'Onboarding fehlgeschlagen' });
  }
};

// ==========================================
// CHANGE PASSWORD
// ==========================================
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Altes und neues Passwort erforderlich' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mindestens 6 Zeichen erforderlich' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Großbuchstabe erforderlich' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Kleinbuchstabe erforderlich' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Zahl erforderlich' });
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Sonderzeichen erforderlich' });
    }

    const result = await db.query('SELECT password FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nutzer nicht gefunden' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashed, req.userId]);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('ChangePassword error:', error);
    res.status(500).json({ error: 'Passwort konnte nicht geändert werden' });
  }
};

// ==========================================
// DELETE ACCOUNT
// ==========================================
export const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;

    const result = await db.query('SELECT password, auth_provider FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];
    const isGoogleOnly = user.auth_provider === 'google' && !user.password;

    if (!isGoogleOnly) {
      if (!password) {
        return res.status(400).json({ error: 'Password required to delete account' });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: 'Password is incorrect' });
      }
    }

    // Delete user — cascades to all related data via FK ON DELETE CASCADE
    await db.query('DELETE FROM users WHERE id = $1', [req.userId]);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('DeleteAccount error:', error);
    res.status(500).json({ error: 'Konto konnte nicht gelöscht werden' });
  }
};

// ==========================================
// GDPR DATA EXPORT (Art. 15 DSGVO)
// ==========================================
export const exportData = async (req, res) => {
  try {
    const [userRes, groupsRes, messagesRes, friendsRes] = await Promise.all([
      db.query(
        `SELECT id, email, name, username, gender, date_of_birth, bio, location,
                avatar_url, photos, interests, favorite_song, pinterest_url,
                onboarding_completed, is_verified, created_at
         FROM users WHERE id = $1`,
        [req.userId]
      ),
      db.query(
        `SELECT g.id, g.name, g.type, g.category, g.date, g.location, gm.role, gm.joined_at
         FROM groups g JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1 ORDER BY gm.joined_at DESC`,
        [req.userId]
      ),
      db.query(
        `SELECT content, created_at FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
        [req.userId]
      ),
      db.query(
        `SELECT u.name, u.email, f.status, f.created_at
         FROM friendships f
         JOIN users u ON u.id = CASE
           WHEN f.requester_id = $1 THEN f.addressee_id
           ELSE f.requester_id
         END
         WHERE (f.requester_id = $1 OR f.addressee_id = $1)
           AND f.status = 'accepted'`,
        [req.userId]
      ),
    ]);

    res.json({
      exported_at: new Date().toISOString(),
      profile: userRes.rows[0] || null,
      groups: groupsRes.rows,
      messages: messagesRes.rows,
      friends: friendsRes.rows,
    });
  } catch (error) {
    console.error('exportData error:', error);
    res.status(500).json({ error: 'Export fehlgeschlagen' });
  }
};

// ==========================================
// TOKEN REFRESH
// Issues a fresh 7-day JWT for an authenticated user.
// Call when token exp < 24h away to avoid silent logouts on mobile.
// ==========================================
export const refreshToken = async (req, res) => {
  try {
    const result = await db.query('SELECT id, is_active FROM users WHERE id = $1', [req.userId]);
    if (!result.rows[0] || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Account nicht gefunden oder deaktiviert' });
    }
    const token = generateToken(req.userId);
    setAuthCookie(res, token);
    res.json({ token });
  } catch (error) {
    console.error('refreshToken error:', error);
    res.status(500).json({ error: 'Token refresh fehlgeschlagen' });
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

    // Prefix ensures password-reset tokens cannot be used as email-verification tokens
    const token = 'pr_' + crypto.randomBytes(32).toString('hex');
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

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Mindestens 6 Zeichen erforderlich' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Großbuchstabe erforderlich' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Kleinbuchstabe erforderlich' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Zahl erforderlich' });
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Mindestens 1 Sonderzeichen erforderlich' });
    }

    // Only accept password-reset tokens (pr_ prefix) — not email-verification tokens
    const result = await db.query(
      "SELECT * FROM password_reset_tokens WHERE token = $1 AND token LIKE 'pr_%' AND used = FALSE AND expires_at > NOW()",
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link. Bitte fordere einen neuen an.' });
    }

    const resetToken = result.rows[0];

    // Hash new password and update
    const hashed = await bcrypt.hash(newPassword, 12);
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
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.json({ message: 'E-Mail ist bereits verifiziert' });
    }

    // Delete old tokens, create new one
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    // Prefix ensures email-verification tokens cannot be used as password-reset tokens
    const token = 'ev_' + crypto.randomBytes(32).toString('hex');
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

    // crypto.randomInt is a CSPRNG — Math.random() is not safe for security codes
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.query(
      'INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP for ${email}: ${code}`);
      return res.json({ message: 'Code gesendet', devCode: code });
    }

    try {
      await sendOTPEmail(email, code, name || '');
    } catch (emailErr) {
      console.error('Failed to send OTP email:', emailErr);
      return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
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

    // Only accept email-verification tokens (ev_ prefix) — not password-reset tokens
    const result = await db.query(
      "SELECT * FROM password_reset_tokens WHERE token = $1 AND token LIKE 'ev_%' AND used = FALSE AND expires_at > NOW()",
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
// ==========================================
// GOOGLE OAUTH LOGIN
// ==========================================
export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential fehlt' });

    let email, name, picture, googleId;
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (clientId) {
      // Preferred path: cryptographically verify the ID token (Google One Tap / Sign-In)
      try {
        const oauthClient = new OAuth2Client(clientId);
        const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: clientId });
        const payload = ticket.getPayload();
        email    = payload.email;
        name     = payload.name;
        picture  = payload.picture;
        googleId = payload.sub;
      } catch {
        return res.status(401).json({ error: 'Google Token ungültig' });
      }
    } else {
      // Fallback: exchange token for user info via Google userinfo endpoint
      // (used when GOOGLE_CLIENT_ID is not set — audience is not verified)
      const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${credential}` },
      });
      if (!googleRes.ok) return res.status(401).json({ error: 'Google Token ungültig' });
      const data = await googleRes.json();
      email    = data.email;
      name     = data.name;
      picture  = data.picture;
      googleId = data.sub;
    }

    if (!email) return res.status(400).json({ error: 'Kein E-Mail von Google' });

    // Find or create user
    let userResult = await db.query(
      'SELECT * FROM users WHERE email = $1 OR google_id = $2',
      [email, googleId]
    );

    let userId;
    if (userResult.rows.length > 0) {
      // Existing user — link google_id if not set
      userId = userResult.rows[0].id;
      if (!userResult.rows[0].google_id) {
        await db.query('UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2', [googleId, userId]);
      }
      if (picture && !userResult.rows[0].avatar_url) {
        await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [picture, userId]);
      }
    } else {
      // New user — create account (no password, Google-only).
      // date_of_birth is intentionally NULL; onboarding collects and validates it (18+ gate).
      const insert = await db.query(
        `INSERT INTO users (email, name, avatar_url, google_id, is_verified)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [email, name || email.split('@')[0], picture || null, googleId]
      );
      userId = insert.rows[0].id;

      // Initialize boost wallet
      await db.query(
        'INSERT INTO boost_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [userId]
      );
      const refCode = 'JAMIE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      await db.query(
        'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, refCode]
      );
    }

    const fullUser = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = fullUser.rows[0];
    sanitizeUserForClient(user);
    parseUserJSONFields(user);

    const token = generateToken(user.id);
    setAuthCookie(res, token);
    res.json({ user, token });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Google Login fehlgeschlagen' });
  }
};

// ==========================================
// LOGOUT — clears the httpOnly auth cookie
// ==========================================
export const logout = (_req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
};
