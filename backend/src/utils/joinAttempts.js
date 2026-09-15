/**
 * How often somebody may ask to join the same private group or club.
 *
 * Arno, 2026-09-15: "Es gibt Leute die fragen das 4. mal schon an, obwohl ich
 * sie abgelehnt habe." The cause was structural, not a missing check:
 * `group_join_requests` keeps exactly ONE row per (group_id, user_id) — see the
 * UNIQUE in schema.sql — and both join paths upserted it straight back to
 * 'pending' on every re-request. A rejection therefore cost the applicant
 * nothing at all, while each re-ask cost the owner a device push, a cache bust
 * and a socket emit (and, on clubs, one of each PER co-manager).
 *
 * Tobi's rule: two attempts, then no more.
 *
 * Counting REJECTIONS rather than requests is deliberate. A request the owner
 * simply never answers stays 'pending' and is already refused by the
 * "Anfrage bereits ausstehend" check, so the two readings give the same budget
 * in practice — and counting rejections is the one that cannot punish someone
 * for the owner's inactivity.
 *
 * Just as deliberate: the gate keys on `rejected_count`, NEVER on the status.
 * Leaving a group and being kicked both leave the row at status='accepted'
 * forever (neither path writes this table), so a gate written as
 * `status !== 'pending'` would permanently bar every member who ever left —
 * a far bigger regression than the spam it set out to stop.
 *
 * The budget is REFUNDED by every act that means "I actually want this person
 * in": accept, undo of a mis-tap, and an owner invite all reset it to 0. That
 * matters because the only surface offering undo is a ~6 second toast.
 */
export const MAX_JOIN_ATTEMPTS = 2;

/** SQL fragment: the columns the gate needs from a join-request row. */
export const JOIN_ATTEMPT_COLS = 'status, rejected_count';

/**
 * True when this applicant has used up their attempts.
 * Tolerates a missing row and a missing column (a replica that has not run the
 * migration yet reads as 0 → open), because refusing a legitimate applicant is
 * worse than briefly allowing one extra re-ask.
 */
export const joinAttemptsExhausted = (row) =>
  Number(row?.rejected_count || 0) >= MAX_JOIN_ATTEMPTS;

/**
 * The single refusal body, so the group path, the club path and the waitlist
 * cannot describe the same rule in three different sentences.
 *
 * `code` drives the frontend's serverErrorMessage() → `errors.<CODE>` lookup,
 * which is what gets this translated in the four non-German markets; the
 * German `error` string stays as the fallback for clients that ignore it.
 */
export const joinBlockedBody = () => ({
  error: 'Du hast bereits zweimal angefragt und wurdest abgelehnt. Eine weitere Anfrage ist nicht möglich.',
  code: 'JOIN_REQUEST_BLOCKED',
});

/**
 * Read the applicant's attempt row for an entity. Used by the paths that do not
 * already have it in hand (the waitlist).
 */
export const loadJoinAttempt = async (db, groupId, userId) => {
  const r = await db.query(
    `SELECT ${JOIN_ATTEMPT_COLS} FROM group_join_requests
      WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  return r.rows[0] || null;
};

export default MAX_JOIN_ATTEMPTS;
