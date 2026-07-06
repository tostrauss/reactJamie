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
      // Excludes soft-deleted rows (deleted_at IS NOT NULL) — otherwise owner
      // deletions would keep inflating the dashboard KPI forever.
      db.query(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE type = 'group')            AS total_groups,
          COUNT(*) FILTER (WHERE type = 'club')             AS total_clubs,
          COUNT(*) FILTER (WHERE is_active = TRUE)          AS active,
          COUNT(*) FILTER (WHERE is_active = FALSE)         AS cancelled
        FROM groups
        WHERE deleted_at IS NULL
      `),
      // Event counts (groups with a date). Same soft-delete filter; also
      // excludes cancelled events (is_active = FALSE) from upcoming/past
      // because they're no longer real on the timeline.
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE date > NOW())              AS upcoming,
          COUNT(*) FILTER (WHERE date <= NOW())             AS past
        FROM groups
        WHERE type = 'group' AND date IS NOT NULL
          AND deleted_at IS NULL AND is_active = TRUE
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
      // ::int casts matter: pg returns bare COUNT() as a STRING (int8), and
      // i18next skips plural resolution for string counts — the KPI subtitle
      // then renders the raw key (admin.kpis.redemptionsTotalSub, tester bug).
      db.query(`
        SELECT
          COUNT(*)::int                                                          AS total,
          COUNT(*) FILTER (WHERE redeemed_at >= NOW() - INTERVAL '1 day')::int   AS today,
          COUNT(*) FILTER (WHERE redeemed_at >= NOW() - INTERVAL '7 days')::int  AS this_week,
          COUNT(*) FILTER (WHERE redeemed_at >= NOW() - INTERVAL '30 days')::int AS this_month,
          COUNT(DISTINCT deal_id)::int                                           AS distinct_deals_redeemed
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
// USERS LIST (searchable + paginated)
// ==========================================
// Powers the admin "Alle Nutzer" panel. Returns a page of users plus the total
// row count so the frontend can render "X von Y" and a "Mehr laden" button.
// `search` matches name / email / location (ILIKE) and an exact id when the
// term is purely numeric. Response shape is { users, total, limit, offset } —
// not a bare array — so callers must read `.users` (the dashboard does).
export const getRecentUsers = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const search = (req.query.search || '').trim();

    // Build a shared WHERE clause + params for both the count and page queries
    // so totals always agree with the rows returned.
    const filters = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      const like = `$${params.length}`;
      let clause = `(name ILIKE ${like} OR email ILIKE ${like} OR location ILIKE ${like}`;
      if (/^\d+$/.test(search)) {
        params.push(parseInt(search, 10));
        clause += ` OR id = $${params.length}`;
      }
      clause += ')';
      filters.push(clause);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const totalRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM users ${where}`,
      params
    );

    const pageParams = [...params, limit, offset];
    const result = await db.query(`
      SELECT id, name, email, location, avatar_url, created_at, last_seen,
             is_trusted_user, trusted_count, onboarding_completed, is_admin,
             EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age
      FROM users
      ${where}
      ORDER BY created_at DESC
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
    `, pageParams);

    res.json({
      users: result.rows,
      total: totalRes.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('Admin users list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// SCREEN TIME DETAIL
// ==========================================
export const getScreenTime = async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  try {
    // Views come from 'screen_view' events; duration_ms is only recorded on
    // 'screen_leave' (the client can't know dwell time until the user leaves).
    // Averaging duration over screen_view rows was always NULL → the Ø-Dauer
    // column showed '—'. Pull duration from screen_leave and join.
    const result = await db.query(`
      SELECT
        v.screen_name,
        v.views,
        v.unique_users,
        d.avg_duration_ms,
        d.total_duration_ms
      FROM (
        SELECT screen_name, COUNT(*) AS views, COUNT(DISTINCT user_id) AS unique_users
        FROM analytics_events
        WHERE event_type = 'screen_view'
          AND screen_name IS NOT NULL
          AND created_at >= NOW() - make_interval(days => $1::int)
        GROUP BY screen_name
      ) v
      LEFT JOIN (
        SELECT screen_name, AVG(duration_ms)::INT AS avg_duration_ms,
               SUM(duration_ms)::BIGINT AS total_duration_ms
        FROM analytics_events
        WHERE event_type = 'screen_leave'
          AND screen_name IS NOT NULL
          AND duration_ms IS NOT NULL
          AND created_at >= NOW() - make_interval(days => $1::int)
        GROUP BY screen_name
      ) d ON d.screen_name = v.screen_name
      ORDER BY v.views DESC
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
// UPDATE USER ROLE (admin only)
// ==========================================
// Toggles is_admin and/or is_trusted_user for a target user. Only the booleans
// present in the body are written, so a caller can flip one flag without
// touching the other. Guards:
//  - An admin cannot revoke their OWN admin rights here (self-lockout footgun;
//    flip it via DB if you truly need to step down the last admin).
export const updateUserRole = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'Ungültige Nutzer-ID' });
    }

    const { is_admin, is_trusted_user } = req.body || {};
    const updates = [];
    const params = [];

    if (typeof is_admin === 'boolean') {
      if (targetId === req.userId && is_admin === false) {
        return res.status(400).json({ error: 'Du kannst dir nicht selbst die Admin-Rechte entziehen' });
      }
      params.push(is_admin);
      updates.push(`is_admin = $${params.length}`);
    }
    if (typeof is_trusted_user === 'boolean') {
      params.push(is_trusted_user);
      updates.push(`is_trusted_user = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine gültigen Felder zum Aktualisieren' });
    }

    params.push(targetId);
    const result = await db.query(
      `UPDATE users
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${params.length}
       RETURNING id, name, email, is_admin, is_trusted_user`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nutzer nicht gefunden' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('Admin updateUserRole error:', err);
    res.status(500).json({ error: 'Rolle konnte nicht aktualisiert werden' });
  }
};

// ==========================================
// TOP CLUBS / GROUPS BY VIEWS
// ==========================================
// Answers Tina's "wie oft wird ein einzelner Club aufgerufen?" — joins
// analytics_events to groups via subject_id so a row is one club/group with
// total views + unique viewers in the window. Deleted entities are kept
// (subject_id stays in analytics_events after group soft-delete) but the
// LEFT JOIN labels them so the admin can see post-mortem popularity too.
export const getTopClubs = async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  try {
    const result = await db.query(`
      SELECT
        ae.subject_id                                                AS id,
        ae.screen_name,
        COALESCE(g.name, '—')                                        AS name,
        g.type                                                       AS type,
        g.category                                                   AS category,
        (g.deleted_at IS NOT NULL)                                   AS is_deleted,
        COUNT(*)::int                                                AS views,
        COUNT(DISTINCT ae.user_id)::int                              AS unique_users
      FROM analytics_events ae
      LEFT JOIN groups g ON g.id = ae.subject_id
      WHERE ae.event_type = 'screen_view'
        AND ae.subject_id IS NOT NULL
        AND ae.screen_name IN ('ClubDetail', 'GroupDetail')
        AND ae.created_at >= NOW() - make_interval(days => $1::int)
      GROUP BY ae.subject_id, ae.screen_name, g.name, g.type, g.category, g.deleted_at
      ORDER BY views DESC
      LIMIT $2
    `, [days, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin top clubs error:', err);
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

// ==========================================
// ONLINE USERS (live Socket.IO presence)
// ==========================================
// "Online" = at least one authenticated socket connected RIGHT NOW. Derived
// directly from io.sockets.sockets — no parallel presence bookkeeping that
// could drift. Every socket carries userId from its JWT handshake (socket.js);
// guests (userId 0) and unauthenticated sockets are skipped. Single-instance
// deployment (one Railway service), so the local connection map is complete.
export const getOnlineUsers = async (req, res) => {
  try {
    const io = req.app.get('io');
    if (!io) return res.json({ count: 0, users: [] });

    // userId → { sockets, connectedAt: earliest handshake among their sockets }
    const online = new Map();
    for (const socket of io.sockets.sockets.values()) {
      const uid = socket.userId;
      if (!uid) continue;
      const issued = socket.handshake?.issued || Date.now();
      const prev = online.get(uid);
      if (prev) {
        prev.sockets += 1;
        prev.connectedAt = Math.min(prev.connectedAt, issued);
      } else {
        online.set(uid, { sockets: 1, connectedAt: issued });
      }
    }

    if (online.size === 0) return res.json({ count: 0, users: [] });

    const result = await db.query(
      `SELECT id, name, email, avatar_url, is_admin
         FROM users
        WHERE id = ANY($1::int[])`,
      [[...online.keys()]]
    );

    const users = result.rows
      .map(u => ({
        ...u,
        sockets: online.get(u.id)?.sockets ?? 1,
        connected_at: new Date(online.get(u.id)?.connectedAt ?? Date.now()).toISOString(),
      }))
      // Longest-online first — keeps the order stable between polls.
      .sort((a, b) => new Date(a.connected_at) - new Date(b.connected_at));

    res.json({ count: users.length, users });
  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
