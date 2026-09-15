/**
 * Lesebestätigungen — „zugestellt" und „gelesen" (Tobi 2026-09-15).
 *
 * THE CONSTRAINT THAT SHAPED THIS WHOLE DESIGN: the iOS app bundles the web
 * build inside its binary, and the App Store build is 1.4.1. So roughly 70% of
 * the user base runs a renderer that will never send a new socket event or call
 * a new endpoint, no matter what we ship to the web. Any "delivered" signal
 * that needs new CLIENT code would therefore be dead for exactly those users —
 * their senders would sit on a single tick forever, while "read" DID work
 * (1.4.1 already calls markAsRead). That asymmetry reads as a broken feature,
 * not as a missing one.
 *
 * So delivery is derived ONLY from signals every existing client already
 * produces: opening a socket (which auto-joins `user_<id>`) and the ordinary
 * HTTP polls for the chat list. No acks, no heartbeat, no presence table.
 *
 * Storage is two watermarks per membership and one timestamp per DM — never a
 * row per (message × recipient), which in a 30-person club chat would be 30
 * rows for every message sent. A watermark answers the same question:
 * "read by X" is simply `X.receipt_read_at >= message.created_at`, the very
 * comparison the unread badge has always used.
 */
import db from '../config/database.js';

/**
 * Per-process throttle for the delivery stamp.
 *
 * The stamp runs on socket connect and on the chat-list polls, i.e. often. The
 * UPDATEs below are already no-ops once everything is stamped (the DM one is
 * gated on `delivered_at IS NULL`), but the group one would still touch every
 * membership row of that user on every call, so it is worth not asking.
 *
 * Replica-local and deliberately so: worst case across replicas is one extra
 * no-op UPDATE, which is cheaper than coordinating.
 */
const STAMP_COOLDOWN_MS = 30_000;
const _lastStamp = new Map(); // userId → epoch ms
setInterval(() => {
  const cutoff = Date.now() - STAMP_COOLDOWN_MS;
  for (const [k, t] of _lastStamp) if (t < cutoff) _lastStamp.delete(k);
}, 60_000).unref();

/** Test hook. */
export const _resetStampCooldown = () => _lastStamp.clear();

/**
 * "This user's client is reachable right now" → everything already sent to them
 * counts as delivered.
 *
 * NOT gated on the read-receipts setting. Delivered is not opt-outable, exactly
 * as in WhatsApp: hiding it would leave the sender on a permanent single tick,
 * which reads as the app being broken rather than as the recipient's privacy
 * choice. The setting covers "gelesen", which is the part that actually says
 * something about the person.
 *
 * Best-effort by contract — every caller is a side path (a socket connect, a
 * list refresh) whose real job must never fail because a receipt did not stamp.
 */
export const stampDelivered = async (userId, { force = false } = {}) => {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return;

  const now = Date.now();
  if (!force) {
    const last = _lastStamp.get(uid);
    if (last != null && now - last < STAMP_COOLDOWN_MS) return;
  }
  _lastStamp.set(uid, now);

  try {
    await Promise.all([
      db.query(
        `UPDATE direct_messages SET delivered_at = NOW()
          WHERE receiver_id = $1 AND delivered_at IS NULL`,
        [uid],
      ),
      // Every membership, not just the open chat: "delivered" means the message
      // reached their client, and a group message reaches it through the
      // personal `user_<id>` room (the nav-badge nudge) even when they are not
      // in that chat. That is the same thing WhatsApp calls delivered.
      db.query(
        `UPDATE group_members SET last_delivered_at = NOW() WHERE user_id = $1`,
        [uid],
      ),
    ]);
  } catch (err) {
    // A database that has not run the migration yet (42703) must not take the
    // socket handshake or the chat list down with it.
    console.error('[receipts] stampDelivered failed:', err?.message);
  }
};

/**
 * Group-chat watermarks for one chat, as two timestamps.
 *
 * The bubble tick is derived client-side by comparing a message's created_at
 * against these, so one small payload re-derives every bubble — which matters
 * because both chat pages merge refetches by APPENDING unknown ids and never
 * rewrite a row already on screen. A per-message boolean would go stale on the
 * first reconnect and never recover.
 *
 * MIN over members, excluding the viewer: a group message is "read" only once
 * the LAST person has read it, which is what WhatsApp's group ticks mean too —
 * and only once EVERY opted-in member has read something at all (see below).
 *
 * `delivered` is NOT filtered by the setting; `read` is, in BOTH directions:
 * members who turned receipts off are left out of the watermark, and a viewer
 * who turned them off is not given one.
 */
export const groupReceiptWatermarks = async (groupId, viewerId) => {
  const { rows } = await db.query(
    `SELECT MIN(COALESCE(gm.last_delivered_at, gm.joined_at)) AS delivered_through,
            MIN(gm.receipt_read_at) FILTER (WHERE u.read_receipts)   AS min_read,
            COUNT(*)                FILTER (WHERE u.read_receipts)   AS opted_in,
            COUNT(gm.receipt_read_at) FILTER (WHERE u.read_receipts) AS have_read,
            (SELECT read_receipts FROM users WHERE id = $2)          AS viewer_optin
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 AND gm.user_id <> $2`,
    [groupId, viewerId],
  );
  const r = rows[0] || {};

  // Reciprocity, the same rule the DM query enforces: someone who switched
  // receipts off does not get to see other people's. Enforced here rather than
  // only in the UI, because "the client just won't render it" is not a privacy
  // guarantee.
  if (r.viewer_optin === false) {
    return { delivered_through: r.delivered_through || null, read_through: null };
  }

  // A member who has NEVER opened the chat must hold the group watermark back.
  //
  // The obvious COALESCE(receipt_read_at, joined_at) is borrowed from the
  // unread badge and is WRONG here: the badge asks "what is new for me", where
  // pre-join history rightly counts as seen, but a receipt asks "did they read
  // YOUR message" — and for someone who has never opened the chat the honest
  // answer is never, not "the moment they joined". With the COALESCE, accepting
  // a join request instantly turned every older message blue while the
  // Nachrichteninfo sheet — which has no COALESCE — still said "Noch niemand".
  // The bubble and the detail view contradicted each other on the same message.
  const optedIn = Number(r.opted_in || 0);
  const haveRead = Number(r.have_read || 0);
  return {
    delivered_through: r.delivered_through || null,
    read_through: optedIn > 0 && haveRead === optedIn ? (r.min_read || null) : null,
  };
};

/**
 * Who has read / merely received a given group message — the „Nachrichteninfo"
 * sheet.
 *
 * Only the author may ask (enforced by the caller): it is a list of who has and
 * has not looked at your message, which is nobody else's business.
 *
 * Members who turned receipts off appear in NEITHER list. They are counted in
 * `opted_out` instead, so the sheet can say so honestly rather than implying
 * those people never opened it.
 */
export const messageReceiptDetail = async (groupId, createdAt, authorId) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.avatar_url, u.read_receipts,
            gm.receipt_read_at, gm.last_delivered_at,
            (SELECT read_receipts FROM users WHERE id = $2) AS author_optin
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 AND gm.user_id <> $2
        -- Same bidirectional block filter the roster endpoint uses. Without it
        -- this sheet hands out names and avatars of people the caller blocked,
        -- or who blocked them, on a surface with none of getGroupMembers' gates.
        AND u.id NOT IN (
          SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
            FROM friendships
           WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2))
      ORDER BY gm.receipt_read_at DESC NULLS LAST`,
    [groupId, authorId],
  );

  // Reciprocal, like everywhere else: an author who turned receipts off does
  // not get the richest read data in the app handed to them. Delivery still
  // shows — that half is not opt-outable.
  const authorOptedOut = rows[0]?.author_optin === false;

  const at = new Date(createdAt).getTime();
  const reached = (ts) => ts != null && new Date(ts).getTime() >= at;

  const read = [];
  const delivered = [];
  let optedOut = 0;

  for (const r of rows) {
    const person = { id: r.id, name: r.name, avatar_url: r.avatar_url };
    if (!r.read_receipts || authorOptedOut) {
      // Their delivery is still shown — only the read half is private.
      if (reached(r.last_delivered_at)) delivered.push(person);
      optedOut += 1;
      continue;
    }
    if (reached(r.receipt_read_at)) read.push({ ...person, at: r.receipt_read_at });
    else if (reached(r.last_delivered_at)) delivered.push(person);
  }

  return { read, delivered, opted_out: authorOptedOut ? 0 : optedOut, self_opted_out: authorOptedOut };
};

export default stampDelivered;
