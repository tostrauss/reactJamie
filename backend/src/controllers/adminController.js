import db from '../config/database.js';

// ==========================================
// OVERVIEW STATS
// ==========================================
export const getStats = async (_req, res) => {
  try {
    const [users, groups, events, reviews, suggestions, topScreens, churn] = await Promise.all([
      // User counts
      db.query(`
        SELECT
          COUNT(*)                                                            AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')    AS today,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS week,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS month,
          COUNT(*) FILTER (WHERE is_trusted_user = TRUE)                     AS trusted
        FROM users
      `),
      // Group/club counts
      db.query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE type = 'group')            AS groups,
          COUNT(*) FILTER (WHERE type = 'club')             AS clubs,
          COUNT(*) FILTER (WHERE is_active = TRUE)          AS active
        FROM groups
      `),
      // Event counts (groups with a date)
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE date > NOW())              AS upcoming,
          COUNT(*) FILTER (WHERE date <= NOW())             AS past
        FROM groups WHERE type = 'group' AND date IS NOT NULL
      `),
      // Review counts
      db.query(`SELECT COUNT(*) AS total FROM event_reviews`),
      // Category suggestions
      db.query(`SELECT suggestion, COUNT(*) AS votes FROM category_suggestions GROUP BY suggestion ORDER BY votes DESC LIMIT 20`),
      // Top screens by view count (last 30 days)
      db.query(`
        SELECT screen_name,
               COUNT(*)                    AS views,
               AVG(duration_ms)::INT       AS avg_duration_ms
        FROM analytics_events
        WHERE event_type = 'screen_view'
          AND screen_name IS NOT NULL
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY screen_name
        ORDER BY views DESC
        LIMIT 20
      `),
      // Churn: last screen before account delete events
      db.query(`
        SELECT ae.screen_name, COUNT(*) AS count
        FROM analytics_events ae
        WHERE ae.event_type = 'account_delete'
          AND ae.screen_name IS NOT NULL
        GROUP BY ae.screen_name
        ORDER BY count DESC
        LIMIT 10
      `),
    ]);

    res.json({
      users: users.rows[0],
      groups: groups.rows[0],
      events: events.rows[0],
      reviews: reviews.rows[0],
      top_screens: topScreens.rows,
      churn_screens: churn.rows,
      category_suggestions: suggestions.rows,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// RECENT USERS
// ==========================================
export const getRecentUsers = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const result = await db.query(`
      SELECT id, name, email, location, created_at, is_trusted_user, trusted_count,
             onboarding_completed
      FROM users
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin recent users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SCREEN TIME DETAIL
// ==========================================
export const getScreenTime = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  try {
    const result = await db.query(`
      SELECT
        screen_name,
        COUNT(*)              AS views,
        COUNT(DISTINCT user_id) AS unique_users,
        AVG(duration_ms)::INT   AS avg_duration_ms,
        SUM(duration_ms)::BIGINT AS total_duration_ms
      FROM analytics_events
      WHERE event_type = 'screen_view'
        AND screen_name IS NOT NULL
        AND created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY screen_name
      ORDER BY views DESC
    `, [days]);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin screen time error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// EXPORT: raw users list (CSV-ready JSON)
// ==========================================
export const exportUsers = async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, email, location, created_at, is_trusted_user, trusted_count,
             onboarding_completed
      FROM users ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// EXPORT: screen analytics (CSV-ready JSON)
// ==========================================
export const exportScreens = async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT screen_name,
             COUNT(*)                AS views,
             COUNT(DISTINCT user_id) AS unique_users,
             AVG(duration_ms)::INT   AS avg_duration_ms
      FROM analytics_events
      WHERE event_type = 'screen_view' AND screen_name IS NOT NULL
      GROUP BY screen_name ORDER BY views DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// EXPORT: category suggestions
// ==========================================
export const exportSuggestions = async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT cs.suggestion, COUNT(*) AS votes,
             MIN(cs.created_at) AS first_seen
      FROM category_suggestions cs
      GROUP BY cs.suggestion ORDER BY votes DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
