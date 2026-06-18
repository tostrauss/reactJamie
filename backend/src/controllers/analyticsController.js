import db from '../config/database.js';

// ==========================================
// TRACK EVENT  (called from frontend, fire-and-forget)
// ==========================================
export const trackEvent = (req, res) => {
  const { event_type, screen_name, duration_ms, metadata, subject_id } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });
  if (typeof event_type !== 'string' || event_type.length > 100) return res.status(400).json({ error: 'event_type invalid' });
  if (screen_name && (typeof screen_name !== 'string' || screen_name.length > 200)) return res.status(400).json({ error: 'screen_name invalid' });

  // subject_id is optional: an INTEGER referencing the entity the screen is
  // "about" (typically the group/club id). Coerced + range-checked so a bad
  // client can't shove a string into an INTEGER column.
  const subjectId = Number.isFinite(Number(subject_id)) ? Math.trunc(Number(subject_id)) : null;
  const safeSubjectId = subjectId !== null && subjectId > 0 && subjectId < 2_147_483_647 ? subjectId : null;

  // Respond immediately — analytics must never slow down the user
  res.json({ ok: true });

  db.query(
    `INSERT INTO analytics_events (user_id, event_type, screen_name, duration_ms, metadata, subject_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.userId || null, event_type, screen_name || null, duration_ms || null,
     metadata ? JSON.stringify(metadata) : null, safeSubjectId]
  ).catch(err => console.error('[analytics]', err.message));
};

// ==========================================
// SAVE CATEGORY SUGGESTION  (Epic 1)
// ==========================================
export const suggestCategory = async (req, res) => {
  const { suggestion } = req.body;
  if (!suggestion?.trim()) return res.status(400).json({ error: 'suggestion required' });
  if (suggestion.length > 200) return res.status(400).json({ error: 'suggestion darf maximal 200 Zeichen lang sein' });

  try {
    await db.query(
      'INSERT INTO category_suggestions (user_id, suggestion) VALUES ($1, $2)',
      [req.userId || null, suggestion.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Category suggestion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
