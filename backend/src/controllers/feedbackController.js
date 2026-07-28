import db from '../config/database.js';
import { sendFeedbackEmail } from '../utils/email.js';

// In-app feedback ("Feedback & Wünsche"). Replaces the old mailto: dead-end:
// submissions are stored in app_feedback (source of truth, surfaced in the
// admin dashboard) and forwarded to the feedback inbox best-effort — so the
// old email workflow keeps working, but nothing is lost when nobody reads
// the mailbox. Built 2026-07-28 after a testing round where all feedback
// arrived via WhatsApp because the in-app path went nowhere.
const VALID_CATEGORIES = ['bug', 'idea', 'other'];
const VALID_PLATFORMS = ['web', 'ios', 'android'];

export const submitFeedback = async (req, res) => {
  const { category, message, platform } = req.body || {};

  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Ungültige Kategorie' });
  }
  const msg = typeof message === 'string' ? message.trim() : '';
  if (msg.length < 5 || msg.length > 5000) {
    return res.status(400).json({ error: 'Die Nachricht muss zwischen 5 und 5000 Zeichen lang sein.' });
  }
  // Client-supplied triage metadata (which build to look at) — not trusted for
  // anything security-relevant, hence the soft fallback instead of a 400.
  const plat = VALID_PLATFORMS.includes(platform) ? platform : 'web';

  try {
    // Guests carry userId 0, which has no users row — store as anonymous.
    const userId = req.isGuest ? null : req.userId;
    const inserted = await db.query(
      `INSERT INTO app_feedback (user_id, category, platform, message)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, category, plat, msg]
    );

    // Best-effort inbox copy — the DB row above is the source of truth.
    if (userId) {
      db.query('SELECT name, email FROM users WHERE id = $1', [userId])
        .then(({ rows }) => sendFeedbackEmail({
          userName: rows[0]?.name,
          userEmail: rows[0]?.email,
          category, platform: plat, message: msg,
        }))
        .catch(() => {});
    } else {
      sendFeedbackEmail({ userName: 'Gast', userEmail: null, category, platform: plat, message: msg }).catch(() => {});
    }

    res.status(201).json({ success: true, id: inserted.rows[0].id });
  } catch (err) {
    console.error('[feedback] submit error:', err);
    res.status(500).json({ error: 'Feedback konnte nicht gesendet werden.' });
  }
};

// Admin list — newest first, with submitter info for follow-ups. Same
// { rows, total, limit, offset } paging shape as the admin users list.
export const getFeedbackAdmin = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const [totalRes, pageRes] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS total FROM app_feedback'),
      db.query(
        `SELECT f.id, f.category, f.platform, f.message, f.created_at,
                u.id AS user_id, u.name AS user_name, u.email AS user_email
         FROM app_feedback f
         LEFT JOIN users u ON u.id = f.user_id
         ORDER BY f.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
    ]);

    res.json({
      feedback: pageRes.rows,
      total: totalRes.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[feedback] admin list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
