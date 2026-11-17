// The card „Hey, [Community] hat Potenzial! ✨“ on the home screen (Tina
// 17.11.2026) — the in-app side of jobs/communityNudges.js, which decides
// WHEN a community is due and writes the marker row these endpoints read.
//
// The card shows for CARD_VISIBLE_DAYS after the nudge fell due, to the
// creator only, until one of three things happens: the X (dismissed_at), a
// first event (the card's own point — also when it was created elsewhere), or
// the community is gone (closed, deleted, turned into a club).
//
// Emergency switch COMMUNITY_NUDGES=false: no card (backend/.env.example).
// Before the migration ran (42P01) the list answers 200 [].

import db from '../config/database.js';

export const CARD_VISIBLE_DAYS = 14;
const MAX_CARDS = 3;

const nudgesEnabled = () => process.env.COMMUNITY_NUDGES !== 'false';

// ==========================================
// GET /api/users/me/community-nudges
// ==========================================
// → [{ id, name, image_url, due_at }], newest first.
//
// Never a 5xx: api.js retries GETs on any 5xx and counts them toward its
// circuit breaker. Any failure is logged and answered 200 [].
export const getMyCommunityNudges = async (req, res) => {
  if (!nudgesEnabled()) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.image_url, n.due_at
         FROM community_event_nudges n
         JOIN groups g ON g.id = n.club_id
        WHERE g.owner_id = $1
          AND n.dismissed_at IS NULL
          AND n.due_at > NOW() - INTERVAL '${CARD_VISIBLE_DAYS} days'
          AND g.type = 'club'
          AND COALESCE(g.club_type, 'community') = 'community'
          AND g.approval_status = 'approved'
          AND g.is_active = TRUE
          AND g.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM groups e WHERE e.parent_club_id = g.id AND e.type = 'event')
        ORDER BY n.due_at DESC
        LIMIT ${MAX_CARDS}`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') console.error('getMyCommunityNudges error:', err?.message);
    res.json([]);
  }
};

// ==========================================
// POST /api/users/me/community-nudges/:clubId/dismiss
// ==========================================
// The card's X. Only the creator's own row is touched; anything else — a
// foreign community, no row, closed before — changes nothing and answers the
// same 200, so the card can close without waiting for the answer.
export const dismissCommunityNudge = async (req, res) => {
  const raw = req.params?.clubId;
  const clubId = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  // Postgres INTEGER bound: a larger id would fail the cast as a 500.
  if (!Number.isInteger(clubId) || clubId <= 0 || clubId > 2147483647) {
    return res.status(400).json({ error: 'Ungültige Community-ID' });
  }
  try {
    await db.query(
      `UPDATE community_event_nudges n SET dismissed_at = NOW()
         FROM groups g
        WHERE n.club_id = $1 AND g.id = n.club_id AND g.owner_id = $2 AND n.dismissed_at IS NULL`,
      [clubId, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    if (err?.code === '42P01') {
      return res.status(503).json({
        error: 'Das geht gerade nicht – bitte versuch es gleich noch einmal.', code: 'COMMUNITY_NUDGE_UNAVAILABLE' });
    }
    console.error('dismissCommunityNudge error:', err?.message);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};
