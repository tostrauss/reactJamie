import db from '../config/database.js';
import { sendAdminReportEmail } from '../utils/email.js';
import { sendPushToAdmins } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';
import { resolveReportTargets, loadReportContext, describeTarget } from '../utils/reportContext.js';

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
    // Dedupe against OPEN reports only (audit 2026-09-15, finding 12). The old
    // `DO NOTHING` against a status-independent UNIQUE meant that once a report
    // had been resolved or dismissed, that reporter could never report that
    // target again — silently, while being told it was sent. A second incident
    // months later simply vanished.
    //
    // The WHERE clause must be restated here: Postgres cannot infer a PARTIAL
    // index from the conflict target alone, and without it this raises 42P10
    // ("no unique or exclusion constraint matching the ON CONFLICT
    // specification") — a 500 on every single report. Covered by the
    // real-Postgres smoke suite, because a mocked db.query cannot see it (the
    // same lesson as the 42P08 in updateReportStatus below).
    // The DO UPDATE carries its own WHERE so a resubmit with IDENTICAL content
    // updates nothing and RETURNING yields no row at all. That is what keeps a
    // double-tap — or someone reopening the modal and sending the same text —
    // from mailing and pushing the admins a second time. (Comparing the old and
    // new values in RETURNING would not work: RETURNING sees the row AFTER the
    // update, so the "old" value is already gone.)
    const cleanDetails = details?.trim() || null;
    const result = await db.query(
      `INSERT INTO reports (reporter_id, reported_type, reported_id, reason, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reporter_id, reported_type, reported_id) WHERE status = 'pending'
       DO UPDATE SET reason     = EXCLUDED.reason,
                     details    = EXCLUDED.details,
                     created_at = NOW()
             WHERE reports.reason  IS DISTINCT FROM EXCLUDED.reason
                OR reports.details IS DISTINCT FROM EXCLUDED.details
       RETURNING id, (xmax = 0) AS inserted`,
      [reporterId, reported_type, targetId, reason, cleanDetails]
    );

    if (result.rowCount === 0) {
      // An identical report is already open. Idempotent, and the client now
      // knows to say "läuft bereits" instead of claiming a fresh submission.
      return res.json({ success: true, alreadyOpen: true, message: 'Bereits gemeldet' });
    }

    // Either a genuinely new report (xmax = 0) or an existing open one whose
    // reason/details the reporter just changed — both worth telling admins
    // about, the second because it is new evidence on a live case.
    const isNew = result.rows[0].inserted;

    // Best-effort admin notification — email (existing) AND a device push
    // (Batch 3): a report shouldn't wait for someone to check the inbox. The
    // reporter is NOT pushed (they just tapped "melden" and see the toast).
    //
    // NOT awaited, and every failure is swallowed: the report row is already
    // committed, so a dead Resend or a slow lookup must never turn a
    // successful report into a 500 for the reporting user. The whole
    // enrichment hangs off this same detached promise for that reason.
    //
    // The push deep-links to /admin#reports (the moderation queue) rather than
    // /admin — tapping it now lands on the report itself instead of the top of
    // a long dashboard the admin then has to scroll.
    loadReportContext(reporterId, reported_type, targetId)
      .then((ctx) => {
        sendAdminReportEmail({
          reportId: result.rows[0].id,
          type: reported_type,
          reason,
          details: cleanDetails,
          isUpdate: !isNew,
          ctx,
        }).catch((err) => console.error('Report email failed:', err.message));

        sendPushToAdmins(
          pushTexts('reportAdmin', {
            reason,
            type: reported_type,
            target: describeTarget(ctx.target),
          }),
          null,
          '/admin#reports',
        );
      })
      .catch((err) => console.error('Report notification failed:', err.message));

    res.json({ success: true, message: 'Meldung erfolgreich gesendet. Danke!' });
  } catch (error) {
    console.error('Report creation error:', error);
    res.status(500).json({ error: 'Meldung konnte nicht gespeichert werden' });
  }
};

// GET /api/reports — admin moderation queue.
const VALID_STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'];

export const getReports = async (req, res) => {
  try {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const result = await db.query(
      `SELECT
         r.id, r.reported_type, r.reported_id, r.reason, r.details, r.status,
         r.created_at, r.reviewed_at, r.reporter_id,
         u.name AS reporter_name, u.email AS reporter_email, u.avatar_url AS reporter_avatar,
         rev.name AS reviewed_by_name,
         COUNT(*) OVER() AS total_count
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN users rev ON rev.id = r.reviewed_by
       WHERE r.status = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, safeLimit, safeOffset]
    );

    // Resolve the polymorphic (reported_type, reported_id) pointer into the
    // actual reported user / group / message. Batched — one query per type for
    // the whole page, never one per row (see utils/reportContext.js).
    //
    // Without this the admin list could only ever render "user #984", which is
    // exactly the problem this endpoint had while no UI consumed it at all.
    const targets = await resolveReportTargets(result.rows);
    const reports = result.rows.map((r) => ({
      ...r,
      target: targets.get(`${r.reported_type}:${r.reported_id}`) || null,
    }));

    const total = parseInt(result.rows[0]?.total_count ?? 0, 10);
    // Queue sizes per status, so the admin UI can label its filter tabs
    // without four extra round trips.
    const countsRes = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM reports GROUP BY status`
    );
    const counts = Object.fromEntries(VALID_STATUSES.map((s) => [s, 0]));
    for (const row of countsRes.rows) counts[row.status] = row.n;

    res.json({ reports, total, counts });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Meldungen konnten nicht geladen werden' });
  }
};

// PATCH /api/reports/:id — move a report through the moderation queue.
//
// New 2026-09-15. Until now `reports.status` was written exactly once (the
// 'pending' DEFAULT) and never again: there was no route, and no UI, to mark a
// report handled. Every report an admin dealt with stayed in the pending list
// forever, so the queue only ever grew and "have we looked at this?" was
// unanswerable. reviewed_by / reviewed_at have existed in the schema since the
// table was created and were likewise never written.
export const updateReportStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }
  const reportId = parseInt(id, 10);
  if (!Number.isInteger(reportId)) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }

  try {
    // Re-opening to 'pending' deliberately CLEARS the reviewer stamp: leaving
    // the old name on a report that is pending again would read as "Robert
    // already handled this" on something nobody has handled.
    //
    // `clearing` is decided in JS and passed as its own boolean parameter
    // rather than re-testing $1 inside the CASEs. Reusing one placeholder both
    // as the value for a VARCHAR(20) column AND against an untyped 'pending'
    // literal made Postgres deduce two types for it and reject the whole
    // statement with 42P08 ("text versus character varying") — the exact
    // failure that 500'd every profile save for two days in August. Caught
    // here by the real-Postgres smoke suite; a mocked db.query cannot see it.
    const clearing = status === 'pending';
    const result = await db.query(
      `UPDATE reports
          SET status      = $1,
              reviewed_by = CASE WHEN $2 THEN NULL ELSE $3::int END,
              reviewed_at = CASE WHEN $2 THEN NULL ELSE NOW() END
        WHERE id = $4
        RETURNING id, status, reviewed_at`,
      [status, clearing, req.userId, reportId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Meldung nicht gefunden' });
    }

    res.json({ success: true, report: result.rows[0] });
  } catch (error) {
    // The partial unique index added with the open-only dedupe allows exactly
    // ONE pending report per (reporter, type, target). Re-opening an old
    // resolved report therefore collides when that reporter has since filed a
    // NEW one against the same target — and the admin got an opaque 500 with
    // no way to act. Nothing is actually lost in that case: the newer pending
    // report IS the live case, so say so and point at it.
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Von dieser Person liegt bereits eine offene Meldung zu diesem Ziel vor. Bearbeite diese stattdessen.',
        code: 'REPORT_ALREADY_OPEN',
      });
    }
    console.error('Update report status error:', error);
    res.status(500).json({ error: 'Status konnte nicht geändert werden' });
  }
};

