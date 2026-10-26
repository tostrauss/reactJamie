// Hall of Fame endpoints (Lea, 18.10.2026) — see utils/hallOfFame.js for the
// rules: whose history it is, which events count, and why.
import db from '../config/database.js';
import { isSafeImageUrl } from '../utils/safeUrl.js';
import {
  hallOfFameEventSql,
  participatedIdsSql,
  friendsParticipatedIdsSql,
  memoryPromptWindowSql,
  isMissingRelation,
  withCanAddPhoto,
  HOF_CARD_SELECT,
  HOF_WALL_WHERE,
  MAX_PHOTOS_PER_USER,
  MAX_PHOTOS_PER_EVENT,
} from '../utils/hallOfFame.js';
import { blockedWithSql } from '../utils/attendanceTiers.js';

const toId = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(v).trim() ? n : null;
};

// ==========================================
// GET /api/users/:id/hall-of-fame  (id = numeric or "me")
// ==========================================
// The own list shows every event; somebody else's only PUBLIC ones (a private
// group's or club's meetup is the members' business — Tobi decided the list
// becomes visible to others, 18.10.2026). Blocks hide it both ways, with the
// same 404 as the profile itself.
export const getUserHallOfFame = async (req, res) => {
  const targetId = req.params.id === 'me' ? Number(req.userId) : toId(req.params.id);
  if (!targetId) return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
  const isSelf = targetId === Number(req.userId);

  try {
    if (!isSelf) {
      const visible = await db.query(
        `SELECT 1 FROM users
          WHERE id = $1
            AND id NOT IN (
              SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
                FROM friendships
               WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2))`,
        [targetId, req.userId]
      );
      if (visible.rows.length === 0) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Cover: the person's own photo of that event, else the event's moment
    // photo, else its image — the upload prompt has always promised „wird zum
    // Cover in deiner Hall of Fame", and the old list never read it.
    const run = (legacy) => db.query(
      `/* hall-of-fame:user */
       SELECT g.id, g.name, g.type, g.category, g.date, g.location,
              (g.deleted_at IS NOT NULL) AS is_deleted,
              COALESCE(own.url, g.moment_photo_url, g.image_url) AS cover_url
         FROM groups g
         ${legacy
           ? 'LEFT JOIN LATERAL (SELECT NULL::text AS url) own ON TRUE'
           : `LEFT JOIN LATERAL (
                SELECT ep.url FROM event_photos ep
                 WHERE ep.group_id = g.id AND ep.user_id = $1
                 ORDER BY ep.created_at DESC LIMIT 1) own ON TRUE`}
        WHERE g.id IN ${participatedIdsSql('$1', { withEntries: !legacy })}
          AND ${hallOfFameEventSql('g')}
          ${isSelf ? '' : 'AND g.is_private IS NOT TRUE'}
        ORDER BY g.date DESC, g.id DESC
        LIMIT 200`,
      [targetId]
    );

    let result;
    try {
      result = await run(false);
    } catch (err) {
      // Boot window: the server answers before the startup migrations ran.
      if (!isMissingRelation(err)) throw err;
      result = await run(true);
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user hall of fame:', err);
    res.status(500).json({ error: 'Hall of Fame konnte nicht geladen werden' });
  }
};

// ==========================================
// GET /api/groups/hall-of-fame/prompts
// ==========================================
// „Warst du dabei..“ (Tina, 22.10.2026): the caller's own past events of the
// last MEMORY_PROMPT_DAYS that still lack THEIR photo — as owner or as a
// participant. For the owner a set moment counts as their photo (the client
// sends them to the moment upload); a participant is still asked after the
// owner set one, it is not theirs. The list is only a view — addEventPhoto
// and updateGroup check participation / ownership themselves. The profile's
// prompt reads the same endpoint, so the rule lives in one place.
export const getMemoryPrompts = async (req, res) => {
  const run = (legacy) => db.query(
    `/* hall-of-fame:prompts */
     SELECT g.id, g.name, g.type, g.category, g.date, g.location,
            g.owner_id, g.image_url, g.moment_photo_url
       FROM groups g
      WHERE g.id IN ${participatedIdsSql('$1', { withEntries: !legacy })}
        AND ${hallOfFameEventSql('g')}
        AND ${memoryPromptWindowSql('g')}
        ${legacy ? '' : 'AND NOT EXISTS (SELECT 1 FROM event_photos ep WHERE ep.group_id = g.id AND ep.user_id = $1)'}
        AND (g.owner_id IS DISTINCT FROM $1 OR g.moment_photo_url IS NULL)
      ORDER BY g.date DESC, g.id DESC
      LIMIT 100`,
    [req.userId]
  );

  try {
    let result;
    try {
      result = await run(false);
    } catch (err) {
      // Boot window: the server answers before the startup migrations ran.
      if (!isMissingRelation(err)) throw err;
      result = await run(true);
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching memory prompts:', err);
    res.status(500).json({ error: 'Treffen konnten nicht geladen werden' });
  }
};

// ==========================================
// GET /api/groups/hall-of-fame/friends?limit=&offset=
// ==========================================
// The Friends tab's feed (Tina, 22.10.2026): the wall's cards, narrowed to
// events an accepted friend took part in — the same four sources as the
// profile list. Only PUBLIC events (a friend's private group is not the
// caller's business — getUserHallOfFame's rule), none whose owner is on
// either side of a block, and only cards with a picture like the Memories
// tab. The friend set is capped like GET /friends (500), newest first so the
// cap is deterministic.
export const getHallOfFameFriends = async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 60);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    const result = await db.query(
      `/* hall-of-fame:friends */
       WITH my_friends AS (
         SELECT CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS fid
           FROM friendships f
          WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
          ORDER BY f.updated_at DESC, f.id DESC
          LIMIT 500
       ),
       friends_part AS ${friendsParticipatedIdsSql('my_friends')},
       mine AS ${participatedIdsSql('$1')}
       ${HOF_CARD_SELECT}
        WHERE ${HOF_WALL_WHERE}
          AND g.id IN (SELECT group_id FROM friends_part)
          AND g.is_private IS NOT TRUE
          AND (g.owner_id IS NULL OR g.owner_id NOT IN ${blockedWithSql('$1')})
          AND (g.moment_photo_url IS NOT NULL
            OR g.image_url IS NOT NULL
            OR EXISTS (SELECT 1 FROM event_photos ep WHERE ep.group_id = g.id))
        ORDER BY g.date DESC, g.id DESC
        LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );
    res.json(result.rows.map(withCanAddPhoto));
  } catch (err) {
    // Boot window: no participant photos yet — an empty tab, never a 500.
    if (isMissingRelation(err)) return res.json([]);
    console.error('Error fetching friends memories:', err);
    res.status(500).json({ error: 'Memories konnten nicht geladen werden' });
  }
};

// ==========================================
// GET /api/groups/:id/photos  (optional auth — the wall is public)
// ==========================================
// Every participant photo of one Hall-of-Fame event, newest first, for the
// gallery. can_delete: the uploader, the event's owner, or an app admin.
export const getEventPhotos = async (req, res) => {
  const groupId = toId(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'Ungültige Gruppen-ID' });
  const callerId = Number(req.userId) || 0;
  try {
    const result = await db.query(
      `/* hall-of-fame:photos */
       SELECT ep.id, ep.url, ep.user_id, ep.created_at,
              u.name AS user_name, u.avatar_url AS user_avatar,
              ($2::int > 0 AND (ep.user_id = $2::int OR g.owner_id = $2::int
                OR COALESCE((SELECT is_admin FROM users WHERE id = $2::int), FALSE))) AS can_delete
         FROM event_photos ep
         JOIN groups g ON g.id = ep.group_id
         LEFT JOIN users u ON u.id = ep.user_id
        WHERE ep.group_id = $1 AND ${hallOfFameEventSql('g')}
        ORDER BY ep.created_at DESC, ep.id DESC
        LIMIT ${MAX_PHOTOS_PER_EVENT}`,
      [groupId, callerId]
    );
    res.json(result.rows);
  } catch (err) {
    if (isMissingRelation(err)) return res.json([]);
    console.error('Error fetching event photos:', err);
    res.status(500).json({ error: 'Fotos konnten nicht geladen werden' });
  }
};

// ==========================================
// POST /api/groups/:id/photos  { url }
// ==========================================
// Participants add photos to a past event's Hall-of-Fame card — before, only
// the owner could, once („als Teilnehmer nicht"). The file itself went through
// POST /api/upload (and its moderation) first; this only attaches the URL.
// Participation is the same rule as the profile list, so whoever has the
// event in their Hall of Fame may add to it.
export const addEventPhoto = async (req, res) => {
  const groupId = toId(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'Ungültige Gruppen-ID' });
  const url = req.body?.url;
  if (!isSafeImageUrl(url)) return res.status(400).json({ error: 'Ungültige Foto-URL' });

  try {
    const check = await db.query(
      `/* hall-of-fame:photo-check */
       SELECT g.id,
              (g.id IN ${participatedIdsSql('$2')}) AS participant,
              (SELECT COUNT(*)::int FROM event_photos WHERE group_id = g.id) AS total,
              (SELECT COUNT(*)::int FROM event_photos WHERE group_id = g.id AND user_id = $2) AS mine
         FROM groups g
        WHERE g.id = $1 AND ${hallOfFameEventSql('g')}`,
      [groupId, req.userId]
    );
    const row = check.rows[0];
    if (!row) return res.status(404).json({ error: 'Event nicht gefunden' });
    if (!row.participant) {
      return res.status(403).json({ error: 'Nur wer dabei war, kann Fotos teilen', code: 'NOT_PARTICIPANT' });
    }
    if (row.mine >= MAX_PHOTOS_PER_USER) {
      return res.status(409).json({ error: `Du hast schon ${MAX_PHOTOS_PER_USER} Fotos geteilt`, code: 'USER_LIMIT' });
    }
    if (row.total >= MAX_PHOTOS_PER_EVENT) {
      return res.status(409).json({ error: 'Für dieses Event sind keine weiteren Fotos möglich', code: 'EVENT_LIMIT' });
    }

    const ins = await db.query(
      `INSERT INTO event_photos (group_id, user_id, url) VALUES ($1, $2, $3)
       RETURNING id, url, user_id, created_at`,
      [groupId, req.userId, url]
    );
    const who = await db.query('SELECT name, avatar_url FROM users WHERE id = $1', [req.userId]);
    res.status(201).json({
      ...ins.rows[0],
      user_name: who.rows[0]?.name ?? null,
      user_avatar: who.rows[0]?.avatar_url ?? null,
      can_delete: true,
    });
  } catch (err) {
    if (isMissingRelation(err)) {
      return res.status(503).json({ error: 'Fotos sind gleich wieder verfügbar – bitte versuch es gleich nochmal' });
    }
    console.error('Error adding event photo:', err);
    res.status(500).json({ error: 'Foto konnte nicht gespeichert werden' });
  }
};

// ==========================================
// DELETE /api/groups/:id/photos/:photoId
// ==========================================
// The uploader takes their own photo down; the event's owner and app admins
// can remove any — uploads are unmoderated whenever the Sightengine quota is
// exhausted, so somebody must be able to act on a bad one.
export const deleteEventPhoto = async (req, res) => {
  const groupId = toId(req.params.id);
  const photoId = toId(req.params.photoId);
  if (!groupId || !photoId) return res.status(400).json({ error: 'Ungültige ID' });
  try {
    const found = await db.query(
      `SELECT ep.user_id, g.owner_id,
              COALESCE((SELECT is_admin FROM users WHERE id = $3), FALSE) AS caller_is_admin
         FROM event_photos ep
         JOIN groups g ON g.id = ep.group_id
        WHERE ep.id = $2 AND ep.group_id = $1`,
      [groupId, photoId, req.userId]
    );
    const row = found.rows[0];
    if (!row) return res.status(404).json({ error: 'Foto nicht gefunden' });
    const me = Number(req.userId);
    const allowed = Number(row.user_id) === me || Number(row.owner_id) === me || row.caller_is_admin;
    if (!allowed) return res.status(403).json({ error: 'Keine Berechtigung' });
    if (row.caller_is_admin && Number(row.user_id) !== me && Number(row.owner_id) !== me) {
      console.log(`[admin] user ${me} deleted event photo ${photoId} of group ${groupId}`);
    }
    await db.query('DELETE FROM event_photos WHERE id = $1', [photoId]);
    res.json({ deleted: true });
  } catch (err) {
    if (isMissingRelation(err)) return res.status(404).json({ error: 'Foto nicht gefunden' });
    console.error('Error deleting event photo:', err);
    res.status(500).json({ error: 'Foto konnte nicht gelöscht werden' });
  }
};
