import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { generateToken, setAuthCookie, clearAuthCookie, invalidateSessionCache } from '../middleware/auth.js';
import { sendPasswordResetEmail, sendVerificationEmail, sendOTPEmail } from '../utils/email.js';
import { REFERRAL_CREDITS_ENABLED } from '../config/features.js';
import { normalizeLocale } from '../utils/pushLocale.js';
import { checkTextSafety } from '../config/moderation.js';

// Validate that a user-supplied image field is an internal/https(s) URL, not a
// javascript:/data: payload or an arbitrary external host. Mirrors the http(s)
// enforcement dealController already applies to deal photos. Returns true if OK.
const isSafeImageUrl = (u) => {
  if (typeof u !== 'string' || u.length > 1024) return false;
  // Same-origin, root-relative path to our OWN upload routes. These are URLs the
  // app itself mints: production serves uploads through the same-origin "/media"
  // proxy (STORAGE_PUBLIC_URL can be "/media"), and the dev fallback writes to
  // "/uploads/…". A single leading slash only — "//host" / "/\host" are
  // protocol-relative (→ external origin) and must NOT count as same-origin.
  // Without this, a relative avatar/photo URL (which still renders fine) was
  // rejected on save → profiles with a picture could not be saved at all.
  if (/^\/(?:media|uploads)\/[^/\\]/.test(u)) return true;
  try {
    const proto = new URL(u).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
};

// Persist the app language (X-App-Locale, set by the frontend axios
// interceptor) for server-initiated push i18n. Fire-and-forget; the guarded
// UPDATE only writes on change, and a missing column (pre-migration boot)
// must never break login.
function persistLocale(req, userId) {
  const raw = req.headers?.['x-app-locale'];
  if (!raw) return;
  const locale = normalizeLocale(raw);
  db.query(
    'UPDATE users SET locale = $1 WHERE id = $2 AND locale IS DISTINCT FROM $1',
    [locale, userId]
  ).catch(() => {});
}

const parseUserJSONFields = (user) => {
  try {
    if (user.interests && typeof user.interests === 'string') user.interests = JSON.parse(user.interests);
    if (user.photos && typeof user.photos === 'string') user.photos = JSON.parse(user.photos);
    if (user.pinnwand && typeof user.pinnwand === 'string') user.pinnwand = JSON.parse(user.pinnwand);
    if (user.favorite_song && typeof user.favorite_song === 'string') user.favorite_song = JSON.parse(user.favorite_song);
  } catch (e) { console.error('Failed to parse user JSON fields:', e.message); }
  return user;
};

const SENSITIVE_FIELDS = [
  'password', 'spotify_access_token', 'spotify_refresh_token',
  'login_attempts', 'locked_until', 'google_id', 'apple_id',
];
const sanitizeUserForClient = (user) => {
  for (const f of SENSITIVE_FIELDS) delete user[f];
  return user;
};

// Normalize email — lowercase + trim. Stops "User@x.com" and "user@x.com"
// being treated as different accounts in DB lookups.
const normalizeEmail = (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

// RFC-loose validation — Postgres VARCHAR(255), reject obvious garbage. The
// real verification is via OTP/verification email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isValidEmail = (email) => typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);

// Bcrypt only uses the first 72 bytes; longer inputs waste CPU and let an
// attacker DoS the server with megabyte-sized passwords.
const MAX_PASSWORD_LENGTH = 200;

// Whitelist of accepted gender values. App lets users skip this field
// (NULL is OK) but if they set one, it must be a known token. Defined
// once at module scope so both updateProfile and completeOnboarding share it.
const GENDER_VALUES = new Set(['male', 'female', 'diverse', 'prefer_not_to_say']);

// Constant-time-ish dummy bcrypt to equalize login response time when a user
// does not exist. Without this, lookup time differs between existing and
// missing emails, enabling user enumeration via timing.
//
// IMPORTANT: must be a REAL bcrypt hash. A malformed string makes
// bcrypt.compare return immediately, defeating the timing equalization
// (this was the bug in the previous hardcoded placeholder hash).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('jamie-dummy-password-not-used-anywhere', 12);

// Columns safe to send to the client — excludes password, tokens, lockout fields.
// Used where we don't need sensitive fields (getProfile, post-register, post-Google-login).
const SAFE_USER_COLS = `
  id, email, auth_provider, auth_provider_id, name, username, gender,
  date_of_birth, date_of_birth_changed, bio, location, avatar_url, photos, pinnwand, interests, favorite_song,
  pinterest_url, spotify_token_expiry, spotify_connected, onboarding_completed,
  onboarding_step, profile_completion, is_verified, is_active, last_seen,
  is_admin, created_at, updated_at, is_pioneer, is_trusted_user, trusted_count
`;

// ==========================================
// REGISTER
// ==========================================
export const register = async (req, res) => {
  try {
    const { password, name, date_of_birth } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
    }
    if (!name || typeof name !== 'string' || !name.trim() || name.length > 100) {
      return res.status(400).json({ error: 'Name ist erforderlich (max. 100 Zeichen)' });
    }
    // The display name is the most-visible user content in the app (every member
    // list, chat row, friend request) and reaches minors — moderate it like we
    // already moderate group/club names. The deterministic blocklist catches
    // slurs even if the OpenAI layer is unavailable (fail-open).
    const nameCheck = await checkTextSafety(name);
    if (!nameCheck.safe) {
      return res.status(422).json({ error: nameCheck.reason || 'Name enthält unzulässige Inhalte' });
    }

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
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Mindestens 6 Zeichen erforderlich' });
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort darf maximal ${MAX_PASSWORD_LENGTH} Zeichen lang sein` });
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

    // Check if user exists (case-insensitive — already normalized to lowercase)
    const userExists = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [email]
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Diese E-Mail-Adresse ist bereits registriert' });
    }

    // Bind the OTP step to /register. Skipped in dev because sendEmailCode auto-
    // verifies via devCode (see Register.jsx step 3) and the table may not exist
    // on a fresh local DB before the first OTP request. In production, without
    // this check, /api/auth/register can be called directly with any email,
    // enabling account-squatting against the 410 waitlisted users.
    if (process.env.NODE_ENV === 'production') {
      try {
        const otpCheck = await db.query(
          `SELECT id FROM email_verification_codes
           WHERE email = $1
             AND verified_at IS NOT NULL
             AND verified_at > NOW() - INTERVAL '30 minutes'
           ORDER BY id DESC
           LIMIT 1`,
          [email]
        );
        if (otpCheck.rows.length === 0) {
          return res.status(400).json({
            error: 'E-Mail-Bestätigung erforderlich. Bitte fordere einen neuen Code an.',
            code: 'EMAIL_NOT_VERIFIED'
          });
        }
        // Single-use: consume the verified row so the same OTP can't be replayed
        // for a second account on the same email after the previous one is deleted.
        await db.query('DELETE FROM email_verification_codes WHERE id = $1', [otpCheck.rows[0].id]);
      } catch (otpErr) {
        // Missing table on a fresh prod boot — fail closed so we never silently bypass.
        if (otpErr.code === '42P01') {
          return res.status(503).json({ error: 'Registrierung ist gerade nicht verfügbar. Bitte versuche es in einer Minute erneut.' });
        }
        throw otpErr;
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert new user with RETURNING (email stored lowercase)
    const insertResult = await db.query(
      'INSERT INTO users (email, password, name, date_of_birth) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hashedPassword, name.trim(), date_of_birth]
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
    // redeemReferral endpoint can't be used again for the same pair.
    // Gated behind REFERRAL_CREDITS_ENABLED (Tina, 2026-06-24: "keine Gratis-Boosts"):
    // when off, registering with a code grants no boost credits to either side.
    const { referral_code } = req.body;
    if (referral_code && REFERRAL_CREDITS_ENABLED) {
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

    // Fetch user for response (safe columns only — no password/tokens)
    const userResult = await db.query(
      `SELECT ${SAFE_USER_COLS} FROM users WHERE id = $1`,
      [newUserId]
    );
    const user = userResult.rows[0];

    const token = generateToken(user.id);
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
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich' });
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      // Match the generic auth-failure response. Status 401 keeps the
      // enumeration surface the same as wrong-password / missing-user.
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = $1',
      [email]
    );

    // Constant-time-ish lookup: run a dummy bcrypt compare if the user is
    // missing so request timing does not leak which emails exist.
    if (result.rows.length === 0) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    }

    const user = result.rows[0];

    // Account lockout check — return the SAME generic error as wrong password,
    // so an attacker can't distinguish "locked because exists" from
    // "wrong password". Authenticated users still get a clear message because
    // they will quickly succeed on a correct password (lockout TTL).
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      // Still consume time so timing is consistent
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      const minutesLeft = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return res.status(429).json({
        locked: true,
        error: `Account gesperrt. Versuche es in ${minutesLeft} Minute${minutesLeft !== 1 ? 'n' : ''} erneut.`
      });
    }

    if (!user.password) {
      // Run dummy compare to keep timing constant vs. real password path
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      return res.status(401).json({ error: 'Dieses Konto verwendet Google-Anmeldung. Bitte melde dich mit Google an.' });
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
    // Update last_seen non-fatally (column may not exist on older DBs yet)
    db.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]).catch(() => {});
    persistLocale(req, user.id);

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
      `SELECT ${SAFE_USER_COLS} FROM users WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const user = result.rows[0];
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
    const { name, location, bio, gender, interests, photos, pinnwand, avatar_url, favorite_song, date_of_birth } = req.body;

    if (name !== undefined && (!name || typeof name !== 'string' || !name.trim() || name.length > 100)) {
      return res.status(400).json({ error: 'Name darf nicht leer sein (max. 100 Zeichen)' });
    }
    if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 500)) {
      return res.status(400).json({ error: 'Bio darf maximal 500 Zeichen lang sein' });
    }
    // Moderate the visible free-text fields (name, bio) — same coverage the
    // group/club create paths already have. Only checks fields actually present.
    const toModerate = [name, bio].filter(v => typeof v === 'string' && v.trim());
    for (const text of toModerate) {
      const { safe, reason } = await checkTextSafety(text);
      if (!safe) return res.status(422).json({ error: reason || 'Eingabe enthält unzulässige Inhalte' });
    }
    if (location !== undefined && location !== null && (typeof location !== 'string' || location.length > 255)) {
      return res.status(400).json({ error: 'Ort darf maximal 255 Zeichen lang sein' });
    }
    if (interests !== undefined && interests !== null) {
      if (!Array.isArray(interests) || interests.length > 30) {
        return res.status(400).json({ error: 'Maximal 30 Interessen erlaubt' });
      }
      if (interests.some(i => typeof i !== 'string' || i.length > 50)) {
        return res.status(400).json({ error: 'Ungültiges Interesse' });
      }
    }
    if (photos !== undefined && photos !== null) {
      if (!Array.isArray(photos) || photos.length > 6) {
        return res.status(400).json({ error: 'Maximal 6 Fotos erlaubt' });
      }
      // Require http(s) URLs so a crafted client can't store a javascript:/data:
      // payload or an unmoderated external host that is then served to others.
      if (photos.some(p => !isSafeImageUrl(p))) {
        return res.status(400).json({ error: 'Ungültige Foto-URL' });
      }
    }
    if (avatar_url !== undefined && avatar_url !== null && avatar_url !== '' && !isSafeImageUrl(avatar_url)) {
      return res.status(400).json({ error: 'Ungültige Avatar-URL' });
    }
    if (gender !== undefined && gender !== null && !GENDER_VALUES.has(gender)) {
      return res.status(400).json({ error: 'Ungültige Geschlechtsangabe' });
    }

    // Pinnwand = separate Pinterest-style gallery (distinct from the carousel
    // `photos`). More images allowed for the "vibe check".
    if (pinnwand !== undefined && pinnwand !== null) {
      if (!Array.isArray(pinnwand) || pinnwand.length > 12) {
        return res.status(400).json({ error: 'Maximal 12 Pinnwand-Fotos erlaubt' });
      }
      if (pinnwand.some(p => !isSafeImageUrl(p))) {
        return res.status(400).json({ error: 'Ungültige Pinnwand-URL' });
      }
    }

    const interestsStr = interests ? JSON.stringify(interests) : null;
    const photosStr = photos ? JSON.stringify(photos) : null;
    const pinnwandStr = pinnwand ? JSON.stringify(pinnwand) : null;

    // favorite_song: allow explicit null to clear it
    const hasFavSong = 'favorite_song' in req.body;
    const songStr = favorite_song ? JSON.stringify(favorite_song) : (hasFavSong ? null : undefined);
    // bio/location: when the key is present (ProfileEdit always sends it, as ''
    // → null when cleared) write it directly so the user CAN clear the field;
    // COALESCE would keep the old value and the clear silently reverted.
    const hasBio = 'bio' in req.body;
    const hasLocation = 'location' in req.body;

    // ── Birthday: editable exactly once after onboarding ─────────────────────
    // The birthday is the app's age signal (18+ gate, age filters, group age
    // ranges), so we let a user correct a signup typo once and then lock it —
    // no repeated flip-flopping to dodge age filters. Setting it for the first
    // time (Google sign-ups start NULL) is the onboarding baseline and does not
    // consume that one change.
    const incomingDob = (typeof date_of_birth === 'string' && date_of_birth.trim())
      ? date_of_birth.trim().slice(0, 10)
      : null;
    let lockDob = false;
    if (incomingDob !== null) {
      const cur = await db.query(
        `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS dob, date_of_birth_changed
         FROM users WHERE id = $1`,
        [req.userId]
      );
      const currentDob = cur.rows[0]?.dob || null;
      const alreadyChanged = cur.rows[0]?.date_of_birth_changed === true;

      if (incomingDob !== currentDob) {
        // Validate the new birthday the same way registration does.
        const dob = new Date(incomingDob);
        if (isNaN(dob.getTime())) {
          return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
        }
        const ageCutoff = new Date();
        ageCutoff.setFullYear(ageCutoff.getFullYear() - 18);
        if (dob > ageCutoff) {
          return res.status(400).json({ error: 'Du musst mindestens 18 Jahre alt sein, um JAMIE zu nutzen.' });
        }
        // Changing an EXISTING birthday is the one-time action; setting a NULL
        // birthday for the first time is the onboarding baseline (no lock).
        if (currentDob !== null) {
          if (alreadyChanged) {
            return res.status(403).json({ error: 'Dein Geburtsdatum kann nur einmal geändert werden.' });
          }
          lockDob = true;
        }
      }
    }

    await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           location = ${hasLocation ? '$2::varchar' : 'COALESCE($2::varchar, location)'},
           country = ${hasLocation
             // Column refs in SET read the OLD row, so this compares old vs new
             // location. Reset country whenever the city changes → the group
             // feed re-geocodes on next load. Without this a once-wrong country
             // (e.g. 'DE' for an Austrian town name) stuck forever, even after
             // the user corrected their profile city.
             // $2 MUST carry an explicit ::varchar cast here AND in the SET
             // above: reusing the bare untyped placeholder in two contexts made
             // Postgres deduce conflicting types (varchar vs text) and abort the
             // whole UPDATE with 42P08 → every profile save from the edit page
             // 500'd ("Profil konnte nicht gespeichert werden").
             ? 'CASE WHEN location IS DISTINCT FROM $2::varchar THEN NULL ELSE country END'
             : 'country'},
           bio = ${hasBio ? '$3' : 'COALESCE($3, bio)'},
           gender = COALESCE($4, gender),
           interests = COALESCE($5, interests),
           photos = COALESCE($6, photos),
           avatar_url = COALESCE($7, avatar_url),
           favorite_song = ${hasFavSong ? '$8' : 'COALESCE($8, favorite_song)'},
           date_of_birth = CASE WHEN $10::text IS NOT NULL THEN $10::date ELSE date_of_birth END,
           date_of_birth_changed = CASE WHEN $12 THEN TRUE ELSE date_of_birth_changed END,
           pinnwand = COALESCE($11, pinnwand),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [name, location, bio, gender, interestsStr, photosStr, avatar_url, songStr || null, req.userId, incomingDob, pinnwandStr, lockDob]
    );

    // Return updated profile
    const result = await db.query(
      `SELECT ${SAFE_USER_COLS} FROM users WHERE id = $1`,
      [req.userId]
    );
    const user = result.rows[0];
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

    // Mirror the validation surface of updateProfile so a malicious client
    // can't bypass it by going through onboarding first.
    if (gender !== undefined && gender !== null && !GENDER_VALUES.has(gender)) {
      return res.status(400).json({ error: 'Ungültige Geschlechtsangabe' });
    }
    if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 500)) {
      return res.status(400).json({ error: 'Bio darf maximal 500 Zeichen lang sein' });
    }
    if (typeof bio === 'string' && bio.trim()) {
      const { safe, reason } = await checkTextSafety(bio);
      if (!safe) return res.status(422).json({ error: reason || 'Bio enthält unzulässige Inhalte' });
    }
    if (location !== undefined && location !== null && (typeof location !== 'string' || location.length > 255)) {
      return res.status(400).json({ error: 'Ort darf maximal 255 Zeichen lang sein' });
    }
    if (interests !== undefined && interests !== null) {
      if (!Array.isArray(interests) || interests.length > 30) {
        return res.status(400).json({ error: 'Maximal 30 Interessen erlaubt' });
      }
      if (interests.some(i => typeof i !== 'string' || i.length > 50)) {
        return res.status(400).json({ error: 'Ungültiges Interesse' });
      }
    }
    if (photos !== undefined && photos !== null) {
      if (!Array.isArray(photos) || photos.length > 6) {
        return res.status(400).json({ error: 'Maximal 6 Fotos erlaubt' });
      }
      if (photos.some(p => !isSafeImageUrl(p))) {
        return res.status(400).json({ error: 'Ungültige Foto-URL' });
      }
    }
    if (avatar_url !== undefined && avatar_url !== null && avatar_url !== '' && !isSafeImageUrl(avatar_url)) {
      return res.status(400).json({ error: 'Ungültige Avatar-URL' });
    }

    const interestsStr = JSON.stringify(interests || []);
    const photosStr = JSON.stringify(photos || []);
    const songStr = favorite_song ? JSON.stringify(favorite_song) : null;

    // Preserve values the onboarding form doesn't re-send: location is captured
    // at registration, avatar_url comes from the Google/Apple profile picture.
    // An unconditional SET nuked both (empty string / NULL) — COALESCE/NULLIF
    // keeps the existing value when the field arrives empty, and photos only
    // overwrite when a non-empty array was actually uploaded.
    await db.query(
      `UPDATE users
       SET gender = $1,
           location = COALESCE(NULLIF($2, ''), location),
           country = CASE WHEN NULLIF($2, '') IS NOT NULL
                           AND location IS DISTINCT FROM NULLIF($2, '')
                          THEN NULL ELSE country END,
           interests = $3,
           bio = $4,
           photos = CASE WHEN $5::jsonb = '[]'::jsonb THEN photos ELSE $5::jsonb END,
           avatar_url = COALESCE($6, avatar_url),
           favorite_song = $7,
           onboarding_completed = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [gender, location, interestsStr, bio, photosStr, avatar_url, songStr, req.userId]
    );

    // Return updated user
    const result = await db.query(
      `SELECT ${SAFE_USER_COLS} FROM users WHERE id = $1`,
      [req.userId]
    );
    const user = result.rows[0];
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

    if (!currentPassword || !newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Altes und neues Passwort erforderlich' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mindestens 6 Zeichen erforderlich' });
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort darf maximal ${MAX_PASSWORD_LENGTH} Zeichen lang sein` });
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

    if (!result.rows[0].password) {
      return res.status(400).json({ error: 'Dieses Konto verwendet Google-Anmeldung. Passwort kann nicht geändert werden.' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    // Bump the revocation watermark so every OTHER existing session (stolen or
    // on a shared device) is evicted. Then issue a fresh token for THIS session
    // so the user who just changed their password isn't logged out of the tab
    // they did it in.
    await db.query(
      'UPDATE users SET password = $1, sessions_valid_after = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashed, req.userId]
    );
    invalidateSessionCache(req.userId);
    const freshToken = generateToken(req.userId);
    setAuthCookie(res, freshToken);

    res.json({ message: 'Password changed successfully', token: freshToken });
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
    // Passwordless accounts (Google/Apple sign-in) have password = NULL and
    // can't supply one. Gate on the password's existence, NOT on auth_provider
    // — auth_provider is never written by googleLogin/appleLogin, so it stays
    // 'email' for every social account and the old check locked them all out
    // of deletion (Apple 5.1.1(v) + GDPR Art. 17 violation).
    const isPasswordless = !user.password;

    if (!isPasswordless) {
      if (!password) {
        return res.status(400).json({ error: 'Password required to delete account' });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: 'Password is incorrect' });
      }
    }

    // Cancel any live Stripe subscription BEFORE deleting (the subscriptions
    // row cascade-deletes with the user, but Stripe keeps billing the saved
    // card otherwise). Best-effort — never block the GDPR deletion on Stripe.
    try {
      if (process.env.STRIPE_SECRET_KEY) {
        const subs = await db.query(
          `SELECT stripe_subscription_id FROM subscriptions
           WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL
             AND (status = 'active' OR status = 'canceling')`,
          [req.userId]
        );
        if (subs.rows.length) {
          const { default: Stripe } = await import('stripe');
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
          for (const s of subs.rows) {
            try { await stripe.subscriptions.cancel(s.stripe_subscription_id); }
            catch (e) { console.error('Stripe cancel on delete failed:', e.message); }
          }
        }
      }
    } catch (e) { console.error('Stripe cancel block failed:', e.message); }

    // groups.owner_id is ON DELETE CASCADE, so deleting an owner would DELETE
    // their groups/clubs — destroying communities for every other member.
    // Transfer ownership of any multi-member group to its earliest other
    // member first; solo-owned groups then cascade away harmlessly.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `WITH transfer AS (
           SELECT DISTINCT ON (gm.group_id) gm.group_id, gm.user_id AS new_owner
           FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           WHERE g.owner_id = $1 AND gm.user_id <> $1
           ORDER BY gm.group_id, gm.joined_at ASC
         ),
         upd_groups AS (
           UPDATE groups g SET owner_id = t.new_owner
           FROM transfer t WHERE g.id = t.group_id
           RETURNING g.id, t.new_owner
         )
         UPDATE group_members gm SET role = 'owner'
         FROM upd_groups u
         WHERE gm.group_id = u.id AND gm.user_id = u.new_owner`,
        [req.userId]
      );
      // Delete user — remaining (solo-owned) groups + all other rows cascade.
      await client.query('DELETE FROM users WHERE id = $1', [req.userId]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Evict the cached session state now so any other live token for this
    // (now-deleted) account is rejected immediately rather than after the TTL.
    invalidateSessionCache(req.userId);
    clearAuthCookie(res);
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
        // GDPR data portability covers the requesting user's OWN data. A
        // friend's email is the FRIEND's personal data, not the exporter's, so
        // it must NOT be included (jus-student feedback, 2026-06-14). We keep
        // only the friendship relationship: the friend's display name + status.
        `SELECT u.name AS friend_name, f.status, f.created_at
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
      // Note: all timestamps are UTC (ISO-8601 "Z"). Local time = UTC + your
      // timezone offset (e.g. Austria is UTC+2 in summer).
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
    // Refresh runs on every session restore → existing users get their locale
    // stored without ever logging in again.
    persistLocale(req, req.userId);
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
    const email = normalizeEmail(req.body.email);

    if (!email || !isValidEmail(email)) {
      // Return generic success to keep this endpoint enumeration-proof
      // even for malformed input.
      return res.json({ message: 'Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.' });
    }

    // Always return success to prevent email enumeration
    const successMsg = { message: 'Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.' };

    const result = await db.query('SELECT id, name FROM users WHERE LOWER(email) = $1', [email]);
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

    if (!token || !newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mindestens 6 Zeichen erforderlich' });
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort darf maximal ${MAX_PASSWORD_LENGTH} Zeichen lang sein` });
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

    // Hash new password and update. Bump the revocation watermark so a reset —
    // the classic "someone else has my account" recovery — evicts EVERY existing
    // session (the attacker's included); the user then logs in fresh.
    const hashed = await bcrypt.hash(newPassword, 12);
    await db.query(
      'UPDATE users SET password = $1, sessions_valid_after = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashed, resetToken.user_id]
    );
    invalidateSessionCache(resetToken.user_id);

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

    // Delete only existing email-verification tokens, leave password-reset tokens intact
    await db.query("DELETE FROM password_reset_tokens WHERE user_id = $1 AND token LIKE 'ev_%'", [user.id]);

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
    const email = normalizeEmail(req.body.email);
    const { name } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });

    // Check email not already registered (case-insensitive)
    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Diese E-Mail ist bereits registriert' });
    }

    // Ensure table exists (guards against startup migration race on cold boot)
    await db.query(`CREATE TABLE IF NOT EXISTS email_verification_codes (
      id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL,
      code VARCHAR(6) NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())`);

    // ── Per-EMAIL throttle (2M2M TV-spike readiness, 2026-08-04) ─────────
    // The per-IP registrationLimiter was raised for carrier-NAT bursts, so
    // the anti-abuse load moved here: 60s resend cooldown + max 6 codes/h
    // per address. In-DB (not express-rate-limit) on purpose — it must hold
    // across replicas and survive restarts, and it protects the VICTIM's
    // inbox from mail-bombing regardless of how many IPs an attacker has.
    const throttle = await db.query(
      `SELECT MAX(created_at) AS last_sent,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS hour_count
       FROM email_verification_codes WHERE email = $1`,
      [email]
    );
    const { last_sent, hour_count } = throttle.rows[0] || {};
    if (last_sent && Date.now() - new Date(last_sent).getTime() < 60_000) {
      return res.status(429).json({ error: 'Code wurde gerade gesendet – bitte warte eine Minute, bevor du einen neuen anforderst.' });
    }
    if ((hour_count || 0) >= 6) {
      return res.status(429).json({ error: 'Zu viele Codes angefordert. Bitte versuche es in einer Stunde erneut.' });
    }

    // Invalidate (not delete) old codes for this email — the rows stay as the
    // send-history the throttle above counts. Opportunistic cleanup of stale
    // rows keeps the table small.
    await db.query('UPDATE email_verification_codes SET used = TRUE WHERE email = $1 AND used = FALSE', [email]);
    db.query(`DELETE FROM email_verification_codes WHERE created_at < NOW() - INTERVAL '24 hours'`).catch(() => {});

    // crypto.randomInt is a CSPRNG — Math.random() is not safe for security codes
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const inserted = await db.query(
      'INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3) RETURNING id',
      [email, code, expiresAt]
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP for ${email}: ${code}`);
      return res.json({ message: 'Code gesendet', devCode: code });
    }

    try {
      await sendOTPEmail(email, code, name || '');
    } catch (emailErr) {
      console.error('Failed to send OTP email:', emailErr.message);
      // Delete ONLY the just-inserted code (so it can't be guessed without the
      // email being delivered) — older rows are the per-email throttle history
      // and must survive.
      await db.query('DELETE FROM email_verification_codes WHERE id = $1', [inserted.rows[0].id]).catch(() => {});
      return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden. Bitte versuche es erneut oder kontaktiere den Support.' });
    }

    res.json({ message: 'Code gesendet' });
  } catch (error) {
    console.error('sendEmailCode error:', error.message, { code: error.code, detail: error.detail });
    res.status(500).json({ error: 'Registrierung fehlgeschlagen. Bitte versuche es erneut.' });
  }
};

// ==========================================
// VERIFY EMAIL OTP (pre-registration, no auth)
// ==========================================
export const verifyEmailCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!email || !code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'E-Mail und 6-stelliger Code erforderlich' });
    }

    // Brute-force protection: cap failed attempts per email at 5 within the
    // code's 10-minute validity window. After 5 failures we invalidate the
    // code so the attacker has to request a new one (rate-limited by IP).
    const result = await db.query(
      'SELECT id, code, attempts FROM email_verification_codes WHERE email = $1 AND used = FALSE AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Code' });
    }

    const row = result.rows[0];
    if ((row.attempts || 0) >= 5) {
      await db.query('UPDATE email_verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(429).json({ error: 'Zu viele Versuche. Fordere einen neuen Code an.' });
    }

    // Constant-time compare on the 6-digit code itself
    const stored = String(row.code);
    const a = Buffer.from(stored.padEnd(6, '0'));
    const b = Buffer.from(code.padEnd(6, '0'));
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      await db.query('UPDATE email_verification_codes SET attempts = COALESCE(attempts, 0) + 1 WHERE id = $1', [row.id]).catch(() => {});
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Code' });
    }

    // Mark as used + stamp verified_at so /register can confirm the OTP step happened
    await db.query(
      'UPDATE email_verification_codes SET used = TRUE, verified_at = NOW() WHERE id = $1',
      [row.id]
    );

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

    // Detect token type: ID tokens are 3-part JWTs; access tokens are opaque strings.
    // useGoogleLogin (implicit flow) gives an access_token; GoogleLogin component gives an id_token.
    // We support both so the frontend can use either approach.
    const isIdToken = credential.split('.').length === 3;

    if (clientId && isIdToken) {
      // Preferred path: verify ID token audience against our client ID (most secure)
      try {
        const oauthClient = new OAuth2Client(clientId);
        const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: clientId });
        const payload = ticket.getPayload();
        // Only trust a PROVEN email — finishGoogleLogin links this address onto
        // any existing local account with the same email, so an unverified
        // Google email could hijack a password account sharing that address.
        if (payload.email_verified === false) {
          return res.status(401).json({ error: 'Google-E-Mail ist nicht verifiziert' });
        }
        email    = payload.email;
        name     = payload.name;
        picture  = payload.picture;
        googleId = payload.sub;
      } catch {
        return res.status(401).json({ error: 'Google Token ungültig' });
      }
    } else {
      // Access token path (useGoogleLogin implicit flow). SECURITY: Google's
      // userinfo endpoint returns the token owner's profile for ANY valid
      // access token, regardless of which OAuth client minted it — so an access
      // token issued for a DIFFERENT app would be accepted here and let an
      // attacker sign in as that user. We MUST verify the token's audience
      // (aud/azp) matches OUR client id before trusting it.
      const expectedAud = process.env.GOOGLE_CLIENT_ID;
      if (!expectedAud) {
        return res.status(503).json({ error: 'Google-Login ist nicht konfiguriert' });
      }
      const tokenInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(credential)}`
      );
      if (!tokenInfoRes.ok) return res.status(401).json({ error: 'Google Token ungültig' });
      const tokenInfo = await tokenInfoRes.json();
      if (tokenInfo.aud !== expectedAud && tokenInfo.azp !== expectedAud) {
        return res.status(401).json({ error: 'Google Token ungültig' });
      }

      const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${credential}` },
      });
      if (!googleRes.ok) return res.status(401).json({ error: 'Google Token ungültig' });
      const data = await googleRes.json();
      if (!data.email) return res.status(401).json({ error: 'Google Token ungültig' });
      // Require a verified email (tokeninfo/userinfo return it as string/bool)
      // before linking — see the ID-token path for the account-hijack rationale.
      const gVerified = data.email_verified ?? tokenInfo.email_verified;
      if (gVerified === false || gVerified === 'false') {
        return res.status(401).json({ error: 'Google-E-Mail ist nicht verifiziert' });
      }
      // Defense in depth: tokeninfo.sub must match the userinfo subject.
      if (tokenInfo.sub && data.sub && tokenInfo.sub !== data.sub) {
        return res.status(401).json({ error: 'Google Token ungültig' });
      }
      email    = data.email;
      name     = data.name;
      picture  = data.picture;
      googleId = data.sub;
    }

    await finishGoogleLogin({ email, name, picture, googleId }, res);
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Google Login fehlgeschlagen' });
  }
};

// Shared find-or-create + token issuance for BOTH Google entry points
// (googleLogin's credential/access-token paths above, and googleLoginCode's
// auth-code exchange below) — same user record, same session shape either way.
async function finishGoogleLogin({ email, name, picture, googleId }, res) {
  if (!email) return res.status(400).json({ error: 'Kein E-Mail von Google' });
  email = normalizeEmail(email);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Ungültige E-Mail von Google' });

  // Find or create user
  let userResult = await db.query(
    'SELECT id, google_id, avatar_url FROM users WHERE LOWER(email) = $1 OR google_id = $2',
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
      `INSERT INTO users (email, name, avatar_url, google_id, is_verified, auth_provider)
       VALUES ($1, $2, $3, $4, TRUE, 'google') RETURNING id`,
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

  const fullUser = await db.query(`SELECT ${SAFE_USER_COLS} FROM users WHERE id = $1`, [userId]);
  const user = fullUser.rows[0];
  parseUserJSONFields(user);

  const token = generateToken(user.id);
  setAuthCookie(res, token);
  res.json({ user, token });
}

// ==========================================
// GOOGLE OAUTH LOGIN — auth-code redirect flow
// ==========================================
// The popup-based implicit flow (googleLogin above) can't complete inside the
// Android Play-Store TWA / an installed PWA: the popup can't post the token
// back to the WebView, so the button silently dead-ended (Tina's uncle + Karl
// on Samsung, 2026-07-20). This is a full-page redirect flow instead — no
// popup, works everywhere a WebView can navigate. Frontend sends Google's the
// one-time `code` + the exact `redirectUri` it was issued for (OAuth2 requires
// the token-exchange redirect_uri to match the authorize-request one byte for
// byte); we exchange it server-side (needs GOOGLE_CLIENT_SECRET — a "Web
// application" OAuth client has one, unlike the client id alone used above)
// and reuse the same verified-ID-token → find-or-create-user path.
export const googleLoginCode = async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'Google-Code fehlt' });
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(503).json({ error: 'Google-Login ist nicht konfiguriert' });
    }

    const oauthClient = new OAuth2Client(clientId, clientSecret, redirectUri);
    let tokens;
    try {
      ({ tokens } = await oauthClient.getToken(code));
    } catch {
      // Expired/already-used code, redirect_uri mismatch, revoked consent, etc.
      return res.status(401).json({ error: 'Google-Anmeldung fehlgeschlagen oder abgelaufen' });
    }
    if (!tokens?.id_token) return res.status(401).json({ error: 'Google Token ungültig' });

    let payload;
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Google Token ungültig' });
    }
    // Only link a proven email (see the finishGoogleLogin account-hijack note).
    if (payload.email_verified === false) {
      return res.status(401).json({ error: 'Google-E-Mail ist nicht verifiziert' });
    }

    await finishGoogleLogin(
      { email: payload.email, name: payload.name, picture: payload.picture, googleId: payload.sub },
      res
    );
  } catch (err) {
    console.error('Google code login error:', err);
    res.status(500).json({ error: 'Google Login fehlgeschlagen' });
  }
};

// ==========================================
// APPLE SIGN-IN
// ==========================================
// Apple Review 4.8 mandates "Sign in with Apple" whenever any third-party
// social login is offered. The iOS Capacitor build sends the native
// authorization payload (identityToken + givenName/familyName); the web
// fallback path can use the same JWT-based verification.
//
// The identityToken is a JWS signed by Apple. We verify the signature
// against Apple's published JWKS, then trust the contained claims.
//
// Apple intentionally hides the user's real e-mail behind a relay address
// for "Hide my email" users. We accept those as-is — they're valid SMTP.
let _appleJwksClient = null;
async function getAppleJwks() {
  if (_appleJwksClient) return _appleJwksClient;
  const jwksLib = await import('jwks-rsa');
  _appleJwksClient = jwksLib.default({
    jwksUri: 'https://appleid.apple.com/auth/keys',
    cache: true, cacheMaxAge: 24 * 60 * 60 * 1000,    // 24h — Apple rotates rarely
    rateLimit: true, jwksRequestsPerMinute: 10,
  });
  return _appleJwksClient;
}

export const appleLogin = async (req, res) => {
  try {
    const { identity_token, user: appleUser } = req.body || {};
    if (!identity_token) return res.status(400).json({ error: 'Apple identity_token fehlt' });

    // Decode + verify with Apple's JWKS.
    const jwt = (await import('jsonwebtoken')).default;
    const decodedHeader = jwt.decode(identity_token, { complete: true });
    if (!decodedHeader?.header?.kid) return res.status(401).json({ error: 'Apple Token ungültig' });

    const jwks = await getAppleJwks();
    const key = await new Promise((resolve, reject) => {
      jwks.getSigningKey(decodedHeader.header.kid, (err, k) => err ? reject(err) : resolve(k));
    });

    const expectedAud = process.env.APPLE_IAP_BUNDLE_ID || 'com.jamie-app.app';
    let payload;
    try {
      payload = jwt.verify(identity_token, key.getPublicKey(), {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: expectedAud,
      });
    } catch {
      return res.status(401).json({ error: 'Apple Token ungültig' });
    }

    let email = payload.email;
    const appleId = payload.sub;
    if (!appleId) return res.status(400).json({ error: 'Kein Apple-Subject' });
    // Apple emails are normally verified, but guard defensively before linking
    // this address onto any existing local account (email_verified is a string).
    if (email && (payload.email_verified === false || payload.email_verified === 'false')) {
      return res.status(401).json({ error: 'Apple-E-Mail ist nicht verifiziert' });
    }

    // On a first sign-in Apple returns the user's name in the request body
    // (NOT the token). After that, the name is gone forever — we have to
    // persist it the first time we see it.
    const fullName = appleUser?.givenName || appleUser?.familyName
      ? [appleUser?.givenName, appleUser?.familyName].filter(Boolean).join(' ')
      : null;

    if (email) {
      email = normalizeEmail(email);
      if (!isValidEmail(email)) email = null;   // fall back to apple_id lookup
    }

    // Find by apple_id first (stable), then by email if linked.
    let userResult = await db.query(
      `SELECT id, apple_id, email, name, avatar_url
         FROM users
        WHERE apple_id = $1
           OR ($2::text IS NOT NULL AND LOWER(email) = $2)`,
      [appleId, email],
    );

    let userId;
    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
      if (!userResult.rows[0].apple_id) {
        await db.query('UPDATE users SET apple_id = $1, updated_at = NOW() WHERE id = $2', [appleId, userId]);
      }
    } else {
      // New account. Apple-only users have no password; their identity is
      // proved by Apple's signed token on every login. Email may be a
      // private relay address ("@privaterelay.appleid.com") — that's fine.
      if (!email) {
        // Truly anonymous Apple users (rejected sharing email) — synthesize
        // a placeholder so DB email-NOT-NULL holds. The user can update it
        // during onboarding.
        email = `apple_${appleId.replace(/[^a-zA-Z0-9]/g, '')}@apple.local`;
      }
      const displayName = fullName || (email.split('@')[0]);
      const insert = await db.query(
        `INSERT INTO users (email, name, apple_id, is_verified, auth_provider)
         VALUES ($1, $2, $3, TRUE, 'apple') RETURNING id`,
        [email, displayName, appleId],
      );
      userId = insert.rows[0].id;

      await db.query('INSERT INTO boost_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
      const refCode = 'JAMIE-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      await db.query(
        'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, refCode],
      );
    }

    const fullUser = await db.query(`SELECT ${SAFE_USER_COLS} FROM users WHERE id = $1`, [userId]);
    const user = fullUser.rows[0];
    parseUserJSONFields(user);

    const token = generateToken(user.id);
    setAuthCookie(res, token);
    res.json({ user, token });
  } catch (err) {
    console.error('Apple login error:', err);
    res.status(500).json({ error: 'Apple Login fehlgeschlagen' });
  }
};

// ==========================================
// LOGOUT — clears the httpOnly auth cookie
// ==========================================
export const logout = (_req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
};
