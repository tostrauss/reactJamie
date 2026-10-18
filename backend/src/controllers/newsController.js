// ==========================================
// "NEWS AN ALLE" — JAMIE's one-way channel into the app (18.10.2026)
// ==========================================
// Lea: neue Features und Deals gehen unter, es fehlt ein Kanal von JAMIE in
// der App. Robert wanted notifications top right on Home. Tobi's decision: a
// bell with notifications, fed by the admins from the dashboard.
//
// One send = one in-app row of type 'news' for EVERY active account (the bell
// reaches everyone, no consent needed for an in-app message) + a device push
// ONLY for users who opted in (users.push_news, default OFF — App Store Review
// Guideline 4.5.4 requires an explicit in-app opt-in for promotional pushes).
//
// Everything new here may be missing in the boot window (the server serves
// before its migrations finish): no news_posts table → the send answers 503
// and the list is empty; no push_news column → nobody counts as opted in and
// nobody gets a push (fail closed: a missing column is never consent); no
// notifications.link column → rows go out without their link.
import db from '../config/database.js';
import { sendPushToUsers } from './pushController.js';

export const NEWS_TITLE_MAX = 80;
export const NEWS_MESSAGE_MAX = 500;
export const NEWS_LINK_MAX = 500;
// Same title again within this window is refused as an accidental double send
// (a double tap, two admins on two phones, a retry after a client timeout —
// the fan-out keeps running server-side when the browser gives up).
export const NEWS_DUPLICATE_WINDOW_MINUTES = 10;
// 4 binds per row would allow far more, but the rows come straight from an
// INSERT … SELECT (no per-user binds at all); 1000 keeps every statement and
// its RETURNING payload as small as entityLifecycle's fan-out chunks.
export const NEWS_CHUNK = 1000;
// Serialises the guard's check-then-insert across replicas. Arbitrary but
// stable, distinct from the job locks (backup 81507260x, purge 927150915).
export const NEWS_SEND_LOCK_ID = 181_020_261;
// A news push is not a conversation: normal urgency (Android Doze may batch
// it), but a day of TTL — the APNs default of 1 h dropped it for every phone
// that was offline for an hour, and the web default of four weeks would
// deliver last month's deal.
export const NEWS_PUSH_OPTS = Object.freeze({ ttl: 24 * 60 * 60 });

const RECENT_LIMIT = 10;

const isSchemaMissing = (err) => err?.code === '42P01' || err?.code === '42703';

// Codes map to admin.news.errors.* in the dashboard; the German sentence is
// the fallback for anything that renders `error` verbatim.
const UNAVAILABLE = {
  error: 'News sind gleich wieder verfügbar. Bitte versuche es in einer Minute erneut.',
  code: 'NEWS_UNAVAILABLE',
};

// Accounts that get a news row: everything that can still log in. Deleted
// accounts are hard-deleted (no row left); a frozen account has
// is_active = FALSE (middleware/auth.js treats NULL on old rows as active).
const ACTIVE_USERS_SQL = 'is_active IS DISTINCT FROM FALSE';

/**
 * An internal app path the client can hand to navigate(): starts with ONE
 * slash ("//host" and "/\host" are protocol-relative and would leave the app),
 * no whitespace or backslashes, at most NEWS_LINK_MAX characters.
 */
export function isInternalLink(value) {
  return typeof value === 'string'
    && value.length <= NEWS_LINK_MAX
    && /^\/(?![/\\])[^\s\\]*$/.test(value);
}

/**
 * Validate the admin's form. Returns { value: { title, message, link, push } }
 * or { error, code, field } for a 400. Strings arrive already HTML-stripped
 * and trimmed by middleware/sanitize.js; trimming again keeps this callable
 * on its own (tests, future callers).
 */
export function parseNewsInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const rawLink = typeof body?.link === 'string' ? body.link.trim() : '';
  if (!title) return { error: 'Titel fehlt', code: 'NEWS_TITLE_REQUIRED', field: 'title' };
  if (title.length > NEWS_TITLE_MAX) {
    return { error: `Titel ist zu lang (max. ${NEWS_TITLE_MAX} Zeichen)`, code: 'NEWS_TITLE_TOO_LONG', field: 'title' };
  }
  if (!message) return { error: 'Nachricht fehlt', code: 'NEWS_MESSAGE_REQUIRED', field: 'message' };
  if (message.length > NEWS_MESSAGE_MAX) {
    return { error: `Nachricht ist zu lang (max. ${NEWS_MESSAGE_MAX} Zeichen)`, code: 'NEWS_MESSAGE_TOO_LONG', field: 'message' };
  }
  if (rawLink && !isInternalLink(rawLink)) {
    return { error: 'Der Link muss ein App-Pfad sein und mit „/" beginnen', code: 'NEWS_LINK_INVALID', field: 'link' };
  }
  // Only a REAL boolean switches the push on — a stray "false" string must
  // never reach hundreds of phones.
  return { value: { title, message, link: rawLink || null, push: body?.push === true } };
}

// ── Audience ────────────────────────────────────────────────────────────────
// Two statements on purpose: a missing push_news column only zeroes the
// opt-in count instead of failing the whole answer.
async function countAudience() {
  const [total, optIn] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS n FROM users WHERE ${ACTIVE_USERS_SQL}`),
    db.query(`SELECT COUNT(*)::int AS n FROM users WHERE ${ACTIVE_USERS_SQL} AND push_news = TRUE`)
      .catch((err) => {
        if (err?.code === '42703') return { rows: [{ n: 0 }] };
        throw err;
      }),
  ]);
  return { total: total.rows[0]?.n ?? 0, pushOptIn: optIn.rows[0]?.n ?? 0 };
}

// GET /api/admin/news/audience → { total, pushOptIn }
export const getNewsAudience = async (_req, res) => {
  try {
    res.json(await countAudience());
  } catch (err) {
    console.error('getNewsAudience error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/admin/news → { news: [...] } — the last sends, newest first.
export const listNews = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.title, p.message, p.link, p.with_push, p.status,
              p.recipients, p.push_recipients, p.created_at, u.name AS created_by_name
         FROM news_posts p
         LEFT JOIN users u ON u.id = p.created_by
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${RECENT_LIMIT}`
    );
    res.json({ news: rows });
  } catch (err) {
    if (isSchemaMissing(err)) return res.json({ news: [] });
    console.error('listNews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Fan-out ─────────────────────────────────────────────────────────────────
// Keyset-paged INSERT … SELECT: each statement inserts the next NEWS_CHUNK
// active users by id, so no id list is ever loaded or bound, every statement
// is its own short transaction, and an account created mid-send is simply
// picked up by a later page. Each inserted row is emitted live to its owner
// (same payload shape as services/entityLifecycle.js — the bell counts it).
//
// `onChunk(total)` reports progress so a failure can still say how many
// people already have the row. Returns the number of rows inserted.
async function insertNewsRows({ title, message, link }, io, onChunk) {
  let withLink = link != null;
  let lastId = 0;
  let total = 0;
  for (;;) {
    const params = withLink ? [title, message, link, lastId] : [title, message, lastId];
    const sql = withLink
      ? `INSERT INTO notifications (user_id, type, title, message, link)
         SELECT id, 'news', $1::text, $2::text, $3::text FROM users
          WHERE ${ACTIVE_USERS_SQL} AND id > $4
          ORDER BY id
          LIMIT ${NEWS_CHUNK}
         RETURNING *`
      : `INSERT INTO notifications (user_id, type, title, message)
         SELECT id, 'news', $1::text, $2::text FROM users
          WHERE ${ACTIVE_USERS_SQL} AND id > $3
          ORDER BY id
          LIMIT ${NEWS_CHUNK}
         RETURNING *`;
    let rows;
    try {
      ({ rows } = await db.query(sql, params));
    } catch (err) {
      // notifications.link not migrated yet: losing the link beats losing the
      // news. Only on the first page — later pages already know.
      if (withLink && err?.code === '42703' && total === 0) {
        console.warn('[news] notifications.link missing (boot window) — sending without the link');
        withLink = false;
        continue;
      }
      throw err;
    }
    if (!rows.length) break;
    total += rows.length;
    onChunk?.(total);
    if (io) {
      for (const notif of rows) io.to(`user_${notif.user_id}`).emit('new_notification', notif);
    }
    lastId = rows.reduce((max, r) => (r.user_id > max ? r.user_id : max), lastId);
    if (rows.length < NEWS_CHUNK) break;
  }
  return total;
}

// Opted-in recipients of the device push. Fail CLOSED on a missing column.
async function pushOptInIds() {
  try {
    const { rows } = await db.query(
      `SELECT id FROM users WHERE ${ACTIVE_USERS_SQL} AND push_news = TRUE ORDER BY id`
    );
    return rows.map((r) => r.id);
  } catch (err) {
    if (err?.code === '42703') {
      console.warn('[news] users.push_news missing (boot window) — no news push sent');
      return [];
    }
    throw err;
  }
}

// The guard: one short transaction under an advisory lock, so two sends of the
// same title can never both pass the check (READ COMMITTED alone would let a
// double tap through). The fan-out itself runs outside it. A send that failed
// before reaching anyone does not block a retry; a partial one does — sending
// again would hand the first recipients a duplicate.
async function claimNewsPost({ title, message, link, push }, adminId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [NEWS_SEND_LOCK_ID]);
    const dup = await client.query(
      `SELECT id FROM news_posts
        WHERE lower(title) = lower($1)
          AND created_at > NOW() - INTERVAL '${NEWS_DUPLICATE_WINDOW_MINUTES} minutes'
          AND NOT (status = 'failed' AND recipients = 0)
        LIMIT 1`,
      [title]
    );
    if (dup.rows.length) {
      await client.query('ROLLBACK');
      return { duplicateOf: dup.rows[0].id };
    }
    const ins = await client.query(
      `INSERT INTO news_posts (title, message, link, with_push, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [title, message, link, push, adminId]
    );
    await client.query('COMMIT');
    return { post: ins.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/admin/news { title, message, link?, push? }
//   201 { id, recipients, pushRecipients, push }
//   400 validation (code NEWS_*) · 409 NEWS_DUPLICATE · 503 NEWS_UNAVAILABLE
export const sendNews = async (req, res) => {
  const parsed = parseNewsInput(req.body);
  if (parsed.error) return res.status(400).json(parsed);
  const news = parsed.value;

  let post;
  try {
    const claim = await claimNewsPost(news, req.userId);
    if (claim.duplicateOf) {
      return res.status(409).json({
        error: `Diese News wurde gerade erst gesendet. Gleicher Titel ist erst nach ${NEWS_DUPLICATE_WINDOW_MINUTES} Minuten wieder möglich.`,
        code: 'NEWS_DUPLICATE',
        minutes: NEWS_DUPLICATE_WINDOW_MINUTES,
      });
    }
    post = claim.post;
  } catch (err) {
    if (isSchemaMissing(err)) return res.status(503).json(UNAVAILABLE);
    console.error('sendNews claim error:', err);
    return res.status(500).json({ error: 'News konnte nicht gesendet werden' });
  }

  let recipients = 0;
  try {
    recipients = await insertNewsRows(news, req.app?.get('io'), (n) => { recipients = n; });
  } catch (err) {
    console.error(`[news] fan-out of news ${post.id} failed after ${recipients} rows:`, err);
    await db.query(
      `UPDATE news_posts SET status = 'failed', recipients = $2 WHERE id = $1`,
      [post.id, recipients]
    ).catch(() => {});
    return res.status(500).json({
      error: recipients
        ? `Senden abgebrochen — ${recipients} Nutzer haben die News schon erhalten.`
        : 'News konnte nicht gesendet werden',
      code: 'NEWS_SEND_FAILED',
      recipients,
    });
  }

  // Device push only to the opted-in, and only AFTER the in-app rows exist —
  // a push opening a bell with nothing in it would read as broken.
  // sendPushToUsers is one subscriptions SELECT for all ids, runs in the bulk
  // lane (never delays a 1:1 push) and swallows its own errors.
  let pushRecipients = 0;
  if (news.push && recipients > 0) {
    try {
      const ids = await pushOptInIds();
      pushRecipients = ids.length;
      if (ids.length) {
        sendPushToUsers(ids, news.title, news.message, news.link || '/notifications', NEWS_PUSH_OPTS)
          .catch((err) => console.error(`[news] push of news ${post.id} failed:`, err.message));
      }
    } catch (err) {
      // The in-app news is out; a failed recipient SELECT costs only the push.
      console.error(`[news] push recipients of news ${post.id} failed:`, err.message);
    }
  }

  await db.query(
    `UPDATE news_posts SET status = 'sent', recipients = $2, push_recipients = $3 WHERE id = $1`,
    [post.id, recipients, pushRecipients]
  ).catch((err) => console.error(`[news] could not record news ${post.id}:`, err.message));

  console.log(`[admin] news ${post.id} sent by admin ${req.userId}: ${recipients} in-app, ${pushRecipients} push opt-ins`);
  res.status(201).json({ id: post.id, recipients, pushRecipients, push: news.push });
};
