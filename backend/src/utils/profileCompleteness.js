// One definition of a "complete" profile — the one that unlocks joining and
// creating groups, clubs and events (middleware/auth.js requireCompleteProfile).
//
// Until 10.10.2026 only the onboarding wizard (authController.completeOnboarding)
// ever set users.onboarding_completed. Someone who skipped it and filled in
// everything under Profil → Bearbeiten stayed blocked from every group while
// the home banner kept asking for a complete profile (user report via
// Instagram, 09./10.10.2026). Now the rule itself counts, wherever the data
// came from: what the wizard makes everyone provide before it lets them
// finish — an 18+ date of birth, a gender and at least three interests.
// Avatar presence has its own gate on every join path (requiresAvatar);
// photos, bio, location and song stay optional, as in the wizard.
//
// No imports from controllers: middleware/auth.js uses this module, and
// authController imports middleware/auth.js.

export const GENDER_VALUES = new Set(['male', 'female', 'diverse', 'prefer_not_to_say']);
export const MIN_INTERESTS = 3;

// Returns an error body to send, or null when the value is acceptable.
// (Moved here from authController, which re-exports it.)
export const checkAdultDob = (value) => {
  if (!value) return { error: 'Geburtsdatum ist erforderlich', code: 'DOB_REQUIRED' };
  const dob = new Date(value);
  if (isNaN(dob.getTime())) return { error: 'Ungültiges Geburtsdatum', code: 'DOB_INVALID' };
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  if (dob > cutoff) {
    return {
      error: 'Du musst mindestens 18 Jahre alt sein, um JAMIE zu nutzen.',
      code: 'DOB_UNDERAGE',
    };
  }
  return null;
};

const interestCount = (raw) => {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  return Array.isArray(list) ? list.filter((s) => s != null && String(s).trim() !== '').length : 0;
};

/** What a profile still lacks: a subset of ['date_of_birth', 'gender', 'interests']. */
export function profileMissing(user) {
  const missing = [];
  if (!user || checkAdultDob(user.date_of_birth)) missing.push('date_of_birth');
  if (!GENDER_VALUES.has(user?.gender)) missing.push('gender');
  if (interestCount(user?.interests) < MIN_INTERESTS) missing.push('interests');
  return missing;
}

export const isProfileComplete = (user) => profileMissing(user).length === 0;

const MISSING_LABELS = {
  date_of_birth: 'dein Geburtsdatum',
  gender: 'dein Geschlecht',
  interests: `mindestens ${MIN_INTERESTS} Interessen`,
};

// German like every server message; every client — the bundled iOS ones
// included — shows data.error as it comes, so naming what is missing and
// where to add it reaches all of them.
export const incompleteMessage = (missing = []) =>
  'Bitte vervollständige dein Profil, bevor du Gruppen beitrittst.'
  + (missing.length
    ? ` Es fehlt noch: ${missing.map((k) => MISSING_LABELS[k] || k).join(', ')} (Profil → Bearbeiten).`
    : '');

// The same rule for set-based SQL (the one-time backfill). users.interests is
// JSONB, users.date_of_birth DATE.
export const PROFILE_COMPLETE_SQL = `(
  date_of_birth IS NOT NULL
  AND date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
  AND gender IN ('male', 'female', 'diverse', 'prefer_not_to_say')
  AND (CASE WHEN jsonb_typeof(interests) = 'array'
            THEN (SELECT COUNT(*) FROM jsonb_array_elements_text(interests) AS t(v) WHERE btrim(t.v) <> '')
            ELSE 0 END) >= ${MIN_INTERESTS}
)`;

/**
 * Sets onboarding_completed when the profile meets the rule but the flag is
 * still off — on save, on every app start (GET /api/auth/profile), on login
 * and at the join gate, so nobody has to redo the wizard. One-way: it never
 * clears the flag. Mutates `user.onboarding_completed` so the response the
 * caller sends already carries it. Never throws.
 */
export async function healOnboardingFlag(db, user) {
  if (!user?.id || user.onboarding_completed === true || !isProfileComplete(user)) return false;
  try {
    await db.query(
      'UPDATE users SET onboarding_completed = TRUE WHERE id = $1 AND onboarding_completed IS NOT TRUE',
      [user.id]
    );
    user.onboarding_completed = true;
    return true;
  } catch (err) {
    console.error('[onboarding-heal]', err?.message || err);
    return false;
  }
}
