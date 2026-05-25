import db from '../config/database.js';
import { sendAdminReportEmail } from '../utils/email.js';

const VALID_TYPES   = ['user', 'group', 'message'];
const VALID_REASONS = ['spam', 'inappropriate', 'harassment', 'fake', 'other'];

// POST /api/reports
export const createReport = async (req, res) => {
  const { reported_type, reported_id, reason, details } = req.body;
  const reporterId = req.userId;

  if (!VALID_TYPES.includes(reported_type)) {
    return res.status(400).json({ error: 'Ungültiger Meldetyp' });
  }
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Ungültiger Grund' });
  }
  if (!reported_id || isNaN(parseInt(reported_id))) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }
  if (details && details.length > 5000) {
    return res.status(400).json({ error: 'Beschreibung darf maximal 5.000 Zeichen lang sein' });
  }

  const targetId = parseInt(reported_id);

  // Cannot report yourself
  if (reported_type === 'user' && targetId === reporterId) {
    return res.status(400).json({ error: 'Du kannst dich nicht selbst melden' });
  }

  try {
    const result = await db.query(
      `INSERT INTO reports (reporter_id, reported_type, reported_id, reason, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reporter_id, reported_type, reported_id) DO NOTHING
       RETURNING id`,
      [reporterId, reported_type, targetId, reason, details?.trim() || null]
    );

    if (result.rowCount === 0) {
      // Already reported — still return success (idempotent UX)
      return res.json({ success: true, message: 'Bereits gemeldet' });
    }

    // Best-effort admin email notification (non-blocking)
    sendAdminReportEmail(reporterId, reported_type, targetId, reason).catch(
      (err) => console.error('Report email failed:', err)
    );

    res.json({ success: true, message: 'Meldung erfolgreich gesendet. Danke!' });
  } catch (error) {
    console.error('Report creation error:', error);
    res.status(500).json({ error: 'Meldung konnte nicht gespeichert werden' });
  }
};

// GET /api/reports  (simple admin view — no admin role system yet)
export const getReports = async (req, res) => {
  try {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    const result = await db.query(
      `SELECT
         r.id, r.reported_type, r.reported_id, r.reason, r.details, r.status,
         r.created_at,
         u.name AS reporter_name, u.email AS reporter_email
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       WHERE r.status = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, parseInt(limit), parseInt(offset)]
    );

    res.json({ reports: result.rows, total: result.rowCount });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Meldungen konnten nicht geladen werden' });
  }
};

