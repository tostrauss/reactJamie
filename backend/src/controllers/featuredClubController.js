// ==========================================
// FEATURED CLUBS — the onboarding club page (Tina's checklist, 2026-10)
// ==========================================
// "Clubs anzeigen, extra Seite (Jamie Groups Official der erste Club, dann
// noch …) — wir sortieren Clubs im Admin-Dashboard." New users see this list
// right after onboarding (/onboarding/clubs), in exactly the order the admins
// saved. Storage: the featured_clubs side table (config/migrations.js explains
// why it is not a groups column).
//
// Everything here tolerates the table not existing yet — the server takes
// traffic before startup migrations finish, and a failed step stays failed
// until the next boot: the public list is then empty (the frontend skips the
// page) and the admin endpoints answer 503.
import db from '../config/database.js';
import { clubAliveSql } from '../utils/clubGate.js';
import { CLUB_CARD_SELECT } from '../utils/clubCards.js';
import { JOIN_ATTEMPT_COLS, joinAttemptsExhausted } from '../utils/joinAttempts.js';
import { getCached, setCached, deleteCached } from '../utils/cache.js';

export const MAX_FEATURED_CLUBS = 20;

// Inside the 'clubs:' namespace on purpose: every club write that already
// calls invalidatePrefix('clubs:') — edit, delete, approve, reject, boost —
// clears this list too, so a taken-down club leaves it at once. getClubs keys
// always carry more segments (…:adm0|1), so the two can never collide.
export const FEATURED_CLUBS_KEY = 'clubs:featured';
const FEATURED_TTL = 30_000; // 30 s, like getClubs

const UNAVAILABLE = {
  error: 'Die Club-Auswahl ist gleich wieder verfügbar. Bitte versuche es in einer Minute erneut.',
  code: 'FEATURED_UNAVAILABLE',
};

const isSchemaMissing = (err) => err?.code === '42P01' || err?.code === '42703';

// Postgres INTEGER bound: a larger id would fail the int[] cast as a 500.
const PG_INT_MAX = 2147483647;

const toClubId = (v) => {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= PG_INT_MAX ? n : null;
};

/**
 * Validates the admin's list: an array of at most MAX_FEATURED_CLUBS positive
 * integer ids (numbers or digit strings), no duplicates. Returns the ids as
 * numbers in the order sent, or null when anything is off — the whole save is
 * refused rather than silently "fixed", since the order is the point.
 */
export function parseClubIds(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_FEATURED_CLUBS) return null;
  const ids = raw.map(toClubId);
  if (ids.some((id) => id === null)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

// The shared, caller-independent rows. Liveness is judged on the LIVE club
// row (clubGate.js): a club soft-deleted, deactivated or rejected after it
// was curated simply drops out here until an admin re-saves the list.
const PUBLIC_SQL = `${CLUB_CARD_SELECT},
             f.position AS featured_position
        FROM featured_clubs f
        JOIN groups g ON g.id = f.club_id
        LEFT JOIN users u ON u.id = g.owner_id
       WHERE ${clubAliveSql('g')}
       ORDER BY f.position ASC
       LIMIT ${MAX_FEATURED_CLUBS}`;

// Everything curated, dead or alive, so the dashboard can show WHY a club no
// longer reaches new users (and drop it before the next save, which would
// otherwise be refused with FEATURED_INVALID_CLUBS).
const ADMIN_SQL = `
      SELECT f.position, g.id, g.name, g.image_url, g.location, g.members_count, g.is_private,
             g.approval_status, g.is_active, (g.deleted_at IS NOT NULL) AS is_deleted,
             COALESCE((${clubAliveSql('g')}), FALSE) AS alive
        FROM featured_clubs f
        JOIN groups g ON g.id = f.club_id
       ORDER BY f.position ASC`;

// `q` is the pool or a transaction's client (setFeaturedClubs reads its own
// uncommitted rows back).
const loadAdminList = async (q = db) => {
  const { rows } = await q.query(ADMIN_SQL);
  return { clubs: rows, max: MAX_FEATURED_CLUBS };
};

/**
 * The caller's own state per card — the same three flags getClubById sets,
 * so the onboarding page can start each button as Dabei / Angefragt / Nicht
 * möglich. Never cached (it differs per caller), and written onto CLONES:
 * the rows come from the shared cache, and mutating them would leak one
 * user's membership into everyone's list. If these lookups fail the plain
 * rows go out — the page still works, the buttons just start neutral.
 */
async function withCallerFlags(rows, userId) {
  const ids = rows.map((r) => r.id);
  try {
    const [members, requests] = await Promise.all([
      db.query(
        'SELECT group_id FROM group_members WHERE user_id = $1 AND group_id = ANY($2::int[])',
        [userId, ids]
      ),
      // One row per (group_id, user_id) — UNIQUE in schema.sql.
      db.query(
        `SELECT group_id, ${JOIN_ATTEMPT_COLS} FROM group_join_requests
          WHERE user_id = $1 AND group_id = ANY($2::int[])`,
        [userId, ids]
      ),
    ]);
    const memberOf = new Set(members.rows.map((r) => Number(r.group_id)));
    const requestOf = new Map(requests.rows.map((r) => [Number(r.group_id), r]));
    return rows.map((r) => {
      const jr = requestOf.get(Number(r.id));
      return {
        ...r,
        is_member: memberOf.has(Number(r.id)),
        join_request_status: jr?.status || null,
        // Same scope as the joinClub gate: only a PRIVATE club has an attempt
        // budget, so a club flipped public never shows a dead button.
        join_request_blocked: !!r.is_private && joinAttemptsExhausted(jr),
      };
    });
  } catch (err) {
    console.error('[featured-clubs] caller flags failed:', err.message);
    return rows;
  }
}

// ==========================================
// GET /api/clubs/featured  (public, optionalAuth)
// ==========================================
// A bare array, like GET /api/clubs.
export const getFeaturedClubs = async (req, res) => {
  let rows = getCached(FEATURED_CLUBS_KEY);
  if (!rows) {
    try {
      ({ rows } = await db.query(PUBLIC_SQL));
    } catch (err) {
      // Table not there yet: nothing is curated, and the frontend skips the
      // page on an empty list. Not cached — the next request asks again.
      if (isSchemaMissing(err)) return res.json([]);
      console.error('getFeaturedClubs failed:', err);
      return res.status(500).json({ error: 'Clubs konnten nicht geladen werden' });
    }
    setCached(FEATURED_CLUBS_KEY, rows, FEATURED_TTL);
  }
  if (!req.userId || !rows.length) return res.json(rows);
  res.json(await withCallerFlags(rows, req.userId));
};

// ==========================================
// GET /api/admin/clubs/featured  (admin)
// ==========================================
export const getFeaturedClubsAdmin = async (_req, res) => {
  try {
    res.json(await loadAdminList());
  } catch (err) {
    if (isSchemaMissing(err)) return res.status(503).json(UNAVAILABLE);
    console.error('getFeaturedClubsAdmin failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// One transaction: { invalidIds } when a club may not be curated (nothing
// written), otherwise { list } — the admin shape, read back BEFORE the commit,
// so the response is exactly what was committed and a failing read rolls the
// save back instead of reporting half a success. Throws after a ROLLBACK.
async function replaceFeatured(client, ids) {
  try {
    await client.query('BEGIN');
    // Serialises two admins saving at the same moment: without it, both
    // DELETEs see the old rows and the second INSERT dies on the UNIQUE
    // (position) with a 23505 instead of simply winning.
    await client.query('LOCK TABLE featured_clubs IN SHARE ROW EXCLUSIVE MODE');
    if (ids.length) {
      // Only live, approved clubs may be curated — a pending or rejected
      // club must never be pushed at every new user.
      const alive = await client.query(
        `SELECT g.id FROM groups g WHERE g.id = ANY($1::int[]) AND ${clubAliveSql('g')}`,
        [ids]
      );
      const ok = new Set(alive.rows.map((r) => Number(r.id)));
      const invalidIds = ids.filter((id) => !ok.has(id));
      if (invalidIds.length) {
        await client.query('ROLLBACK');
        return { invalidIds };
      }
    }
    await client.query('DELETE FROM featured_clubs');
    if (ids.length) {
      // position = 1-based index in the array (WITH ORDINALITY).
      await client.query(
        `INSERT INTO featured_clubs (club_id, position)
         SELECT v.id, v.ord FROM unnest($1::int[]) WITH ORDINALITY AS v(id, ord)`,
        [ids]
      );
    }
    const list = await loadAdminList(client);
    await client.query('COMMIT');
    return { list };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ==========================================
// PUT /api/admin/clubs/featured  (admin)  body: { clubIds: number[] }
// ==========================================
// Replaces the whole list; the array order IS the order new users see.
// [] clears it (the onboarding page is then skipped). Answers with the same
// shape as the admin GET.
export const setFeaturedClubs = async (req, res) => {
  const ids = parseClubIds(req.body?.clubIds);
  if (!ids) {
    return res.status(400).json({
      error: `Ungültige Club-Liste (höchstens ${MAX_FEATURED_CLUBS} verschiedene Clubs).`,
      code: 'FEATURED_INVALID',
    });
  }

  let outcome;
  try {
    const client = await db.pool.connect();
    try {
      outcome = await replaceFeatured(client, ids);
    } finally {
      client.release();
    }
  } catch (err) {
    if (isSchemaMissing(err)) return res.status(503).json(UNAVAILABLE);
    console.error('setFeaturedClubs failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (outcome.invalidIds) {
    return res.status(400).json({
      error: 'Diese Clubs sind nicht freigegeben oder nicht mehr aktiv.',
      code: 'FEATURED_INVALID_CLUBS',
      invalidIds: outcome.invalidIds,
    });
  }

  // This instance shows the new order at once; other replicas within the TTL.
  deleteCached(FEATURED_CLUBS_KEY);
  console.log(`[admin] user ${req.userId} set featured clubs [${ids.join(', ')}]`);
  res.json(outcome.list);
};
