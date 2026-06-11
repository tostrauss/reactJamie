import db from '../config/database.js';

// ==========================================
// OVERVIEW STATS
// ==========================================
export const getStats = async (_req, res) => {
  try {
    const [users, groups, events, reviews, suggestions, topScreens, churn, dealRedemptions] = await Promise.all([
      // User counts. Aliases match what AdminDashboard renders (`u.this_week`,
      // `u.this_month`) — earlier the SQL was using `week`/`month` and the
      // dashboard fell back to undefined → blank "-" cells.
      db.query(`
        SELECT
          COUNT(*)                                                            AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')    AS today,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS this_week,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS this_month,
          COUNT(*) FILTER (WHERE is_trusted_user = TRUE)                     AS trusted
        FROM users
      `),
      // Group/club counts. Frontend reads `g.total_groups` / `g.total_clubs`.
      db.query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE type = 'group')            AS total_groups,
          COUNT(*) FILTER (WHERE type = 'club')             AS total_clubs,
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
      // Deal redemption KPIs. distinct_deals_redeemed tells us how many
      // separate Kooperationen got at least one user — a 50-redemption total
      // spread over 1 deal vs. 25 deals is a very different story for sales.
      db.query(`
        SELECT
          COUNT(*)                                                          AS total,
          COUNT(*) FILTER (WHERE redeemed_at >= NOW() - INTERVAL '1 day')   AS today,
          COUNT(*) FILTER (WHERE redeemed_at >= NOW() - INTERVAL '7 days')  AS this_week,
          COUNT(*) FILTER (WHERE redeemed_at >= NOW() - INTERVAL '30 days') AS this_month,
          COUNT(DISTINCT deal_id)                                            AS distinct_deals_redeemed
        FROM deal_redemptions
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
      deal_redemptions: dealRedemptions.rows[0],
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
             onboarding_completed, is_admin,
             EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age
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
        AND created_at >= NOW() - make_interval(days => $1::int)
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
      FROM users ORDER BY created_at DESC LIMIT 10000
    `);
    const masked = result.rows.map(u => ({
      ...u,
      email: maskEmail(u.email),
    }));
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return local.slice(0, 2) + '***@' + domain;
}

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
// PENDING CLUBS (admin approval queue)
// ==========================================
export const getPendingClubs = async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT g.id, g.name, g.description, g.category, g.location,
             g.image_url, g.created_at,
             u.id AS owner_id, u.name AS owner_name, u.email AS owner_email
      FROM groups g
      LEFT JOIN users u ON g.owner_id = u.id
      WHERE g.type = 'club'
        AND g.approval_status = 'pending'
        AND g.deleted_at IS NULL
      ORDER BY g.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('getPendingClubs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const approveClub = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE groups
       SET approval_status = 'approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND type = 'club' AND approval_status = 'pending'
       RETURNING id, name`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pending club not found' });
    }
    // Bust caches so the club appears in public listings immediately.
    try {
      const { invalidatePrefix } = await import('../utils/cache.js');
      invalidatePrefix('clubs:');
      invalidatePrefix('map:');
    } catch { /* non-fatal */ }
    res.json({ success: true, club: result.rows[0] });
  } catch (err) {
    console.error('approveClub error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const rejectClub = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE groups
       SET approval_status = 'rejected', is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND type = 'club' AND approval_status = 'pending'
       RETURNING id, name`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pending club not found' });
    }
    res.json({ success: true, club: result.rows[0] });
  } catch (err) {
    console.error('rejectClub error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// DELETE USER (admin only)
// ==========================================
// Hard-deletes a user row; ON DELETE CASCADE FKs on group_members, messages,
// direct_messages, friendships, push_subscriptions, etc. clean up the rest.
// Admins cannot delete themselves (prevents accidental self-lockout) or
// other admins (a deliberate footgun safeguard — flip is_admin off via DB
// first if you really need to remove an admin).
export const deleteUser = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }
    if (targetId === req.userId) {
      return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
    }
    const target = await db.query(
      'SELECT id, email, name, is_admin FROM users WHERE id = $1',
      [targetId]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Nutzer nicht gefunden' });
    }
    if (target.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admins können hier nicht gelöscht werden' });
    }
    await db.query('DELETE FROM users WHERE id = $1', [targetId]);
    res.json({
      success: true,
      deleted: { id: target.rows[0].id, email: target.rows[0].email, name: target.rows[0].name },
    });
  } catch (err) {
    console.error('Admin deleteUser error:', err);
    res.status(500).json({ error: 'Nutzer konnte nicht gelöscht werden', detail: err.message });
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
