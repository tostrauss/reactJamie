import db from '../config/database.js';

// ==========================================
// TRACK EVENT  (called from frontend, fire-and-forget)
// ==========================================
export const trackEvent = async (req, res) => {
  const { event_type, screen_name, duration_ms, metadata } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  try {
    await db.query(
      `INSERT INTO analytics_events (user_id, event_type, screen_name, duration_ms, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.userId || null, event_type, screen_name || null, duration_ms || null,
       metadata ? JSON.stringify(metadata) : null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Analytics track error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SAVE CATEGORY SUGGESTION  (Epic 1)
// ==========================================
export const suggestCategory = async (req, res) => {
  const { suggestion } = req.body;
  if (!suggestion?.trim()) return res.status(400).json({ error: 'suggestion required' });

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
