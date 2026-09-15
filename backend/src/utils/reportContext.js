/**
 * Report context resolution.
 *
 * `reports` stores only (reported_type, reported_id) — a polymorphic pointer
 * with no FK and no denormalised copy of what was reported. Every consumer of
 * a report (the admin email, the admin push, the admin list) therefore has to
 * resolve that pointer itself, or it can only say "user #984", which is what
 * the notification did until 2026-09-15 and which is unactionable: it names
 * neither who reported, nor whom, nor why.
 *
 * This module is the single resolver so those three surfaces can never drift.
 *
 * DELIBERATE: the reported CONTENT is snapshotted into the resolved context
 * (message body, group name) rather than only linked. A reported message is
 * very often deleted — by the author, or by the moderation action itself —
 * before an admin opens the mail, and a link to a deleted message shows
 * nothing. `is_deleted`/`missing` is surfaced alongside so the admin can tell
 * "already gone" apart from "never existed".
 */
import db from '../config/database.js';

/** Human-readable German labels — the raw enum values are what admins see today. */
export const REASON_LABELS = {
  spam: 'Spam',
  inappropriate: 'Unangemessener Inhalt',
  harassment: 'Belästigung / Mobbing',
  fake: 'Fake-Profil',
  other: 'Sonstiges',
};

export const TYPE_LABELS = {
  user: 'Nutzer',
  group: 'Gruppe',
  message: 'Nachricht',
};

/** Trim reported content to something that fits an email and a push. */
const clip = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

const MESSAGE_CLIP = 500;

/**
 * Resolve the targets of many reports in a FIXED number of queries.
 *
 * Called from the admin list, which pages up to 200 reports — a per-row lookup
 * there would be a 200x N+1 on an admin route that is already the slowest page
 * in the app. One query per reported_type, each an `= ANY($1)`, regardless of
 * page size.
 *
 * @param {Array<{reported_type: string, reported_id: number}>} rows
 * @returns {Promise<Map<string, object>>} keyed `${type}:${id}`
 */
export const resolveReportTargets = async (rows) => {
  const out = new Map();
  if (!rows?.length) return out;

  const idsOf = (type) => [
    ...new Set(
      rows.filter((r) => r.reported_type === type).map((r) => Number(r.reported_id)),
    ),
  ].filter((n) => Number.isInteger(n));

  const userIds = idsOf('user');
  const groupIds = idsOf('group');
  const messageIds = idsOf('message');

  const queries = [];

  if (userIds.length) {
    queries.push(
      db.query(
        `SELECT u.id, u.name, u.email, u.avatar_url, u.created_at, u.is_admin,
                u.bio, u.location, u.is_active,
                (SELECT COUNT(*) FROM reports r2
                  WHERE r2.reported_type = 'user' AND r2.reported_id = u.id)::int
                  AS report_count
           FROM users u WHERE u.id = ANY($1)`,
        [userIds],
      ).then(({ rows: found }) => {
        for (const u of found) {
          out.set(`user:${u.id}`, {
            kind: 'user',
            id: u.id,
            missing: false,
            name: u.name,
            email: u.email,
            avatar_url: u.avatar_url,
            joined_at: u.created_at,
            is_admin: u.is_admin,
            // So the moderation card's freeze button shows the real current
            // state on load, instead of only after the admin flips it.
            frozen: u.is_active === false,
            bio: clip(u.bio, 300),
            location: u.location,
            report_count: u.report_count,
            path: `/user/${u.id}`,
          });
        }
      }),
    );
  }

  if (groupIds.length) {
    queries.push(
      db.query(
        `SELECT g.id, g.name, g.type, g.category, g.location, g.date,
                g.description, g.is_private, g.is_active, g.deleted_at,
                g.owner_id, o.name AS owner_name,
                (SELECT COUNT(*) FROM reports r2
                  WHERE r2.reported_type = 'group' AND r2.reported_id = g.id)::int
                  AS report_count
           FROM groups g
           LEFT JOIN users o ON o.id = g.owner_id
          WHERE g.id = ANY($1)`,
        [groupIds],
      ).then(({ rows: found }) => {
        for (const g of found) {
          out.set(`group:${g.id}`, {
            kind: 'group',
            id: g.id,
            missing: false,
            name: g.name,
            // 'group' | 'club' | 'event' — an admin needs to know which, the
            // moderation action differs (a club has an approval flow).
            entity_type: g.type,
            category: g.category,
            location: g.location,
            date: g.date,
            description: clip(g.description, 300),
            is_private: g.is_private,
            deleted: !g.is_active || !!g.deleted_at,
            owner: g.owner_id ? { id: g.owner_id, name: g.owner_name } : null,
            report_count: g.report_count,
            path: g.type === 'club' ? `/club/${g.id}` : `/group/${g.id}`,
          });
        }
      }),
    );
  }

  if (messageIds.length) {
    queries.push(
      db.query(
        `SELECT m.id, m.content, m.created_at, m.is_deleted, m.message_type,
                m.user_id, a.name AS author_name,
                m.group_id, gr.name AS group_name, gr.type AS group_type,
                (SELECT COUNT(*) FROM reports r2
                  WHERE r2.reported_type = 'message' AND r2.reported_id = m.id)::int
                  AS report_count
           FROM messages m
           LEFT JOIN users a  ON a.id = m.user_id
           LEFT JOIN groups gr ON gr.id = m.group_id
          WHERE m.id = ANY($1)`,
        [messageIds],
      ).then(({ rows: found }) => {
        for (const m of found) {
          out.set(`message:${m.id}`, {
            kind: 'message',
            id: m.id,
            missing: false,
            // Snapshotted, not linked: see the module header. A soft-deleted
            // message still has its content row, which is exactly what an
            // admin needs to judge a report filed before the deletion.
            content: clip(m.content, MESSAGE_CLIP),
            message_type: m.message_type,
            created_at: m.created_at,
            deleted: !!m.is_deleted,
            author: m.user_id ? { id: m.user_id, name: m.author_name } : null,
            group: m.group_id
              ? { id: m.group_id, name: m.group_name, type: m.group_type }
              : null,
            report_count: m.report_count,
            // Deep link into the chat, not the message — the app has no
            // single-message route. The group id is what an admin can act on.
            path: m.group_id ? `/chat/${m.group_id}` : null,
          });
        }
      }),
    );
  }

  await Promise.all(queries);

  // Anything that did not resolve was hard-deleted (or never existed). Fill a
  // placeholder rather than leaving a hole: "gelöscht" IS moderation-relevant
  // information, and the UI must not have to distinguish undefined from a row.
  for (const r of rows) {
    const key = `${r.reported_type}:${r.reported_id}`;
    if (!out.has(key)) {
      out.set(key, {
        kind: r.reported_type,
        id: Number(r.reported_id),
        missing: true,
        deleted: true,
        path: null,
      });
    }
  }

  return out;
};

/**
 * Everything needed to describe ONE report in a notification: who reported,
 * what was reported, and the reported content itself.
 *
 * Best-effort by contract: the caller (createReport) has already committed the
 * report row, so a failure here must degrade the notification, never the
 * report. Returns nulls instead of throwing.
 */
export const loadReportContext = async (reporterId, type, targetId) => {
  const [reporterRes, targets] = await Promise.all([
    db.query(
      `SELECT u.id, u.name, u.email,
              (SELECT COUNT(*) FROM reports r2 WHERE r2.reporter_id = u.id)::int
                AS reports_filed
         FROM users u WHERE u.id = $1`,
      [reporterId],
    ).catch(() => ({ rows: [] })),
    resolveReportTargets([{ reported_type: type, reported_id: targetId }]).catch(
      () => new Map(),
    ),
  ]);

  return {
    reporter: reporterRes.rows[0]
      ? {
          id: reporterRes.rows[0].id,
          name: reporterRes.rows[0].name,
          email: reporterRes.rows[0].email,
          // A reporter on their 30th report is a different signal than one on
          // their first — surfaced so report-flooding is visible at a glance.
          reports_filed: reporterRes.rows[0].reports_filed,
        }
      : { id: reporterId, name: null, email: null, reports_filed: null },
    target: targets.get(`${type}:${targetId}`) || {
      kind: type,
      id: targetId,
      missing: true,
      deleted: true,
      path: null,
    },
  };
};

/**
 * One-line summary of a target, shared by the push body, the email subject and
 * any log line — so all three name the same thing the same way.
 */
export const describeTarget = (target) => {
  if (!target || target.missing) return `#${target?.id ?? '?'} (gelöscht)`;
  if (target.kind === 'user') return `„${target.name}“ (#${target.id})`;
  if (target.kind === 'group') {
    return `„${target.name}“ (#${target.id}${target.deleted ? ', gelöscht' : ''})`;
  }
  if (target.kind === 'message') {
    const who = target.author?.name ? ` von ${target.author.name}` : '';
    return `„${clip(target.content, 60)}“${who}`;
  }
  return `#${target.id}`;
};
