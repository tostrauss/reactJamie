// The partner model of clubs (Tina's document of 17.11.2026, decided by Tobi):
// what a club's event form needs to know and send around the free tier.
//
//   GET /api/clubs/:id/event-quota   where the club stands (getEventQuota)
//
// The rules live in utils/clubEventQuota.js; createClubEvent enforces them.
// This only tells the app in advance, so it can show Tina's partner message
// instead of a form that will be refused.
import db from '../config/database.js';
import { FREE_CLUB_EVENTS, loadClubForQuota, quotaOf } from '../utils/clubEventQuota.js';

// A route id → a positive integer, or null (never a cast error from Postgres).
const toId = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

// What a quota reads as when nothing is limited — and the answer when the
// lookup itself fails.
const openQuota = (clubId, clubName = '') => ({
  club_id: clubId,
  club_name: clubName,
  limited: false,
  free_events: FREE_CLUB_EVENTS,
  used: 0,
  upcoming: 0,
  block: null,
  ticket_allowed: true,
  is_manager: false,
});

// ==========================================
// GET /api/clubs/:id/event-quota
// ==========================================
// → { club_id, club_name, limited, free_events, used, upcoming,
//     block: null | 'concurrent' | 'third', ticket_allowed, is_manager }
//
// For the people who may put up events there: members, the owner, an app
// admin. `block` is what createClubEvent would answer right now; a community,
// a paying partner and the JAMIE team read limited:false. ticket_allowed is
// false exactly where a ticket link would be refused as „only as a partner“
// (where JAMIE Pro decides, the server says so when the event is saved).
//
// Never a 5xx: the app retries a GET on 5xx and counts it against its circuit
// breaker. Anything unexpected is logged and answered as „not limited“ — the
// form opens, and createClubEvent still decides.
export const getEventQuota = async (req, res) => {
  const clubId = toId(req.params.id);
  if (!clubId) return res.status(404).json({ error: 'Club nicht gefunden' });
  if (!req.userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  try {
    const club = await loadClubForQuota(db, clubId, req.userId);
    if (!club) return res.status(404).json({ error: 'Club nicht gefunden' });

    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [clubId, req.userId]);
    const isOwner = Number(club.owner_id) === Number(req.userId);
    if (!membership.rows.length && !isOwner && !club.caller_is_admin) {
      return res.status(403).json({ error: 'Nur für Clubmitglieder sichtbar', code: 'NOT_MEMBER' });
    }

    const quota = await quotaOf(db, club);
    res.json({
      ...openQuota(club.id, club.name || ''),
      limited: quota.limited,
      used: quota.used,
      upcoming: quota.upcoming,
      block: quota.block,
      ticket_allowed: !quota.limited,
      is_manager: isOwner || membership.rows[0]?.role === 'admin',
    });
  } catch (err) {
    console.error('getEventQuota error:', err.message);
    res.json({ ...openQuota(clubId), unavailable: true });
  }
};
