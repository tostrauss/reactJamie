// ==========================================
// "Was trifft zu?" — the first onboarding step (Tina's checklist, 10.10.2026)
// ==========================================
// Multi-select, minimum one: why someone is on JAMIE. Stored as a JSONB array
// of KEYS in users.motivations — never the German sentence, so the five
// locales can word it differently and the admin dashboard can count it.
//
// ⚠️ MIRRORED in frontend/src/utils/motivations.js. tests/utils/motivations.test.js
// reads that file and fails the build on any divergence.
//
// NEVER DELETE A KEY. iOS bundles stay in the field for weeks and keep sending
// the keys they shipped with; retire an option in the UI only. Unknown keys are
// DROPPED rather than rejected for the same reason — a renamed key must never
// be able to block an old bundle's onboarding (that one answer is lost, the
// user is not).
export const MOTIVATION_KEYS = Object.freeze([
  'new_in_town',
  'new_friends',
  'activity_partners',
  'discover_places',
  'more_active',
]);

// Generous cap: the UI can send at most five. It only exists so a crafted
// body cannot make the server trim and hash an unbounded list.
const MAX_RAW_ITEMS = 20;

/**
 * Normalise a client value.
 *   undefined / null → { provided: false }              keep what is stored
 *   valid array      → { provided: true, value: keys }  allowlist order, deduped
 *   anything else    → { provided: true, error: true }  400 MOTIVATIONS_INVALID
 * `[]` is a valid value and clears the answer.
 */
export function parseMotivations(raw) {
  if (raw === undefined || raw === null) return { provided: false };
  if (!Array.isArray(raw) || raw.length > MAX_RAW_ITEMS || raw.some((k) => typeof k !== 'string')) {
    return { provided: true, error: true };
  }
  const picked = new Set(raw.map((k) => k.trim()));
  // Allowlist ORDER, not the tap order: the stored value is then canonical,
  // so the same answer never looks like a change and the stats need no sort.
  return { provided: true, value: MOTIVATION_KEYS.filter((k) => picked.has(k)) };
}

/** Error body for a malformed value (codes → frontend errors.<CODE>). */
export const MOTIVATIONS_INVALID = Object.freeze({
  error: 'Ungültige Auswahl',
  code: 'MOTIVATIONS_INVALID',
});

/**
 * Write the answer in its OWN statement, never inside a controller's main
 * UPDATE: the server takes traffic before startup migrations finish (listen →
 * migrate), and a column the database does not have yet would turn every
 * onboarding/profile save of the first deploy into a 500. Here a missing
 * column (42703) costs only this one answer — logged, not stored.
 *
 * JSON.stringify is required: node-pg serialises a JS array as a Postgres
 * array literal ({a,b}), which ::jsonb rejects.
 *
 * Returns true when stored, false when the column is missing; rethrows
 * anything else.
 */
export async function saveMotivations(db, userId, keys) {
  try {
    await db.query(
      'UPDATE users SET motivations = $2::jsonb WHERE id = $1',
      [userId, JSON.stringify(keys)]
    );
    return true;
  } catch (err) {
    if (err?.code === '42703') {
      console.warn('[motivations] users.motivations missing (boot window) — answer not stored');
      return false;
    }
    throw err;
  }
}

/**
 * Read side for SELECT lists whose FROM is the UNALIASED `users` table
 * (authController's SAFE_USER_COLS, exportData).
 *
 * Why not the plain column: a users column in SAFE_USER_COLS 500s every
 * profile load for as long as the column is missing — the boot window of the
 * deploy that adds it, or for good if that migration step fails (see
 * utils/attendanceTiers.js). Looked up through the row's jsonb image instead,
 * a missing column is just an absent key: SQL NULL, no error. A present
 * column reads exactly as the stored jsonb (null when never answered).
 *
 * to_jsonb(users) serialises the whole row internally (password hash
 * included) but only this one key leaves the database — never select
 * to_jsonb(users) itself.
 */
export const MOTIVATIONS_SELECT = `(to_jsonb(users) -> 'motivations') AS motivations`;
