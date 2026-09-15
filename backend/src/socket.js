import jwt from 'jsonwebtoken';
import db from './config/database.js';
import { JWT_VERIFY_OPTS, sessionAccepted, invalidateSessionCache } from './middleware/auth.js';

// io reference captured at boot (socketHandler) so revocation works from ANY
// context — HTTP handlers, crons, scripts — not only where a `req` exists.
let _io = null;

// Kill every live socket of one user — cluster-wide under the Redis adapter.
export const disconnectUserSockets = (io, userId) => {
  if (!io || !userId) return;
  try {
    io.in(`user_${userId}`).disconnectSockets(true);
  } catch { /* best-effort */ }
};

// THE revocation call: evict the 30s-cached session state AND kill live
// sockets, as one operation (audit 2026-09-02, risk #12). Callers were
// pairing the two calls by hand — the exact convention whose forgotten
// second half this fix removed; one entry point means the next revocation
// path can't ship with half the pair again.
export const revokeUserSessions = (userId) => {
  invalidateSessionCache(userId);
  disconnectUserSockets(_io, userId);
};

// 10-second in-process membership cache for join_room.
// At 1 000 concurrent users each joining 3-5 group rooms, this prevents
// thousands of identical SELECT 1 queries hitting the DB on every app open.
// Short TTL keeps kicked-member latency low (max ~10s in stale state).
const _memberCache = new Map();
const MEMBER_CACHE_TTL = 10_000;

// Single sweep covers every TTL Map below (all share the 10s TTL semantics).
// _groupCtxCache + _friendCache were previously never swept → unbounded growth.
const _sweepCaches = [_memberCache];
setInterval(() => {
  const now = Date.now();
  for (const cache of _sweepCaches) {
    for (const [k, v] of cache) {
      if (now > v.exp) cache.delete(k);
    }
  }
}, 60_000).unref();

async function checkMembership(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const cached = _memberCache.get(key);
  if (cached !== undefined && Date.now() < cached.exp) return cached.result;
  const { rows } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [groupId, userId]
  );
  const result = rows.length > 0;
  _memberCache.set(key, { result, exp: Date.now() + MEMBER_CACHE_TTL });
  return result;
}

// Used by DM socket events to gate room-join + typing on friendship.
// Without this, any authenticated user can join_dm_room with a guessed
// userId and eavesdrop on real-time DMs.
// Cached like _memberCache (10s TTL): dm_typing/dm_stop_typing/send_dm all
// gate on this, so two people actively chatting otherwise fire one identical
// friendship SELECT per keystroke. 10s stale window on unfriend/block matches
// the accepted staleness of the membership cache.
const _friendCache = new Map();
_sweepCaches.push(_friendCache);
async function areFriends(a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  const cached = _friendCache.get(key);
  if (cached !== undefined && Date.now() < cached.exp) return cached.result;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM friendships WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2)
         OR (requester_id = $2 AND addressee_id = $1)) LIMIT 1`,
      [a, b]
    );
    const result = rows.length > 0;
    _friendCache.set(key, { result, exp: Date.now() + MEMBER_CACHE_TTL });
    return result;
  } catch {
    return false; // fail closed (not cached — retry next event)
  }
}

// NB: the DM send rate limit now lives ONLY on the HTTP path (dmRoutes.js
// dmSendLimiter, 10/min per user) since real-time delivery moved there. The
// former socket-side counter was removed with the send_dm broadcast.

const socketHandler = (io) => {
  _io = io; // registers the instance for revokeUserSessions()

  // Verify JWT on every connection attempt
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    // Guest token only allowed when explicitly enabled
    if (token === 'guest_token') {
      if (process.env.ALLOW_GUEST_TOKEN === 'true') {
        socket.userId = 0;
        socket.isGuest = true;
        return next();
      }
      return next(new Error('Guest access is disabled'));
    }
    try {
      // Shared verifier options (JWT_VERIFY_OPTS) — a token valid for HTTP
      // must be exactly as valid here, and vice versa. Pinned iss/aud blocks
      // cross-service token replay.
      const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTS);
      // Same revocation check as the HTTP path (30s-cached): a banned/deleted
      // user or a pre-password-change token gets no socket, not just no REST.
      if (!(await sessionAccepted(decoded))) {
        return next(new Error('Invalid or expired token'));
      }
      socket.userId = decoded.id;
      // Mirror into socket.data: fetchSockets() across replicas serializes
      // ONLY socket.data, and the chat push suppression reads userId from it.
      socket.data.userId = decoded.id;
      socket.isGuest = false;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    // Auto-join the authenticated user's personal notification room
    if (socket.userId) {
      socket.join(`user_${socket.userId}`);
    }

    // ── Per-socket budget for the DB-touching events ────────────────────
    // Every HTTP route is throttled (generalLimiter 2000/15min, messageLimiter
    // 60/min, dmSendLimiter 10/min) — the socket path had NOTHING, while four
    // of its handlers hit Postgres on every emit. One authenticated client
    // emitting join_room in a loop (~40-byte frames) could hold every slot of
    // the 50-connection pool indefinitely, queueing login and every other API
    // call behind it until connectionTimeoutMillis, while the id-keyed caches
    // grew unbounded between their 60 s sweeps. Full API outage from one
    // socket, with no counter anywhere to show what happened.
    // Audit 2026-09-15, finding 6.
    //
    // TWO buckets, split by cost — one shared counter was wrong.
    //
    // `dm_typing` fires on EVERY KEYSTROKE (DirectMessagePage's textarea
    // onChange), so ~3 characters per second already exceeds 30 events per
    // 10 s. With a single bucket and a disconnect on three over-budget
    // windows, typing a normal DM at 40 WPM for half a minute force-closed
    // the socket of a perfectly legitimate user, mid-conversation, every
    // ~30 seconds. The original comment assumed the areFriends cache absorbed
    // typing — it does not, because the budget is charged BEFORE the await.
    //
    // join_room / join_dm_room are the handlers finding 6 was actually about:
    // uncached, pool-consuming, and the ones a flood can turn into an outage.
    // They keep the strike-and-disconnect path.
    const mkBucket = () => ({ n: 0, windowStart: Date.now(), strikes: 0 });
    const roll = (bucket, limit) => {
      const now = Date.now();
      if (now - bucket.windowStart > 10_000) {
        if (bucket.n <= limit) bucket.strikes = 0;
        bucket.n = 0;
        bucket.windowStart = now;
      }
      return ++bucket.n <= limit;
    };

    // DB-touching room joins: 30 / 10 s, then strikes, then disconnect.
    const joinBucket = mkBucket();
    const withinBudget = () => {
      if (roll(joinBucket, 30)) return true;
      // Three consecutive over-budget windows is not a buggy client.
      if (joinBucket.n === 31 && ++joinBucket.strikes >= 3) {
        console.warn(`[socket] disconnecting user ${socket.userId} — sustained event flood`);
        socket.disconnect(true);
      }
      return false;
    };

    // Typing indicators: generous, and DROP-ONLY. Past the 10 s areFriends
    // cache these are pure in-memory room emits, so shedding one costs
    // nothing — and disconnecting somebody for typing can never be correct.
    const typingBucket = mkBucket();
    const withinTypingBudget = () => roll(typingBucket, 120);

    // join_user is kept for compatibility but enforces the authenticated userId
    socket.on('join_user', () => {
      if (socket.userId) socket.join(`user_${socket.userId}`);
    });

    // Join a specific chat room — verify membership (cached for 1 min)
    socket.on('join_room', async (groupId) => {
      // Parse first: checkMembership only caches on SUCCESS, so a non-numeric
      // id made Postgres raise 22P02, the catch below swallowed it, and nothing
      // was cached — meaning emit('join_room','x') cost a full pool round trip
      // EVERY time, forever. The DM handlers already guard this way.
      const gid = Number.parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return;
      // Budget consumed BEFORE the await, or thousands of emits are already in
      // flight against the pool before the first one returns.
      if (!withinBudget()) return;
      try {
        if (await checkMembership(gid, socket.userId)) {
          // String(gid) deliberately: the `typing` handler gates on
          // socket.rooms.has(String(data.groupId)), so the room name has to
          // stay the string form or the typing gate silently stops matching.
          socket.join(String(gid));
        }
      } catch {
        // Non-critical — don't crash the socket on a DB error
      }
    });

    // Leave a room. Normalised the same way join_room now is, so the two
    // always name the same room — and so a client that sends a number can
    // still leave the string-named room the server puts it in. No budget
    // here: it touches no database and refusing it would strand a socket
    // in a room it asked to leave.
    socket.on('leave_room', (groupId) => {
      const gid = Number.parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return;
      socket.leave(String(gid));
    });

    // send_message is retained as a NO-OP for older clients still emitting it.
    // Live delivery + moderation now happen entirely server-side on the HTTP
    // POST /api/messages path (messageController.sendMessage), which broadcasts
    // the already-moderated, server-authoritative row to the room. The old
    // re-broadcast here ran NO text moderation and trusted client-supplied
    // content/identity — a member could emit unmoderated, name-spoofed text live
    // to the room (and there was no rate limit on this path). Do NOT restore a
    // broadcast here without server-side checkTextSafety.
    socket.on('send_message', () => { /* delivery moved to HTTP path */ });

    // Handle typing indicator
    socket.on('typing', (data) => {
      if (!data?.groupId || !socket.rooms.has(String(data.groupId))) return;
      socket.to(String(data.groupId)).emit('user_typing', {
        userId: socket.userId,
        userName: typeof data.userName === 'string' ? data.userName.slice(0, 100) : undefined,
      });
    });

    socket.on('stop_typing', (data) => {
      if (!data?.groupId || !socket.rooms.has(String(data.groupId))) return;
      socket.to(String(data.groupId)).emit('user_stop_typing', {
        userId: socket.userId
      });
    });

    // Direct Message Handlers
    // ─────────────────────────────────────────────────────────────────────
    // SECURITY: DM room names are deterministic (`dm_${min(a,b)}_${max(a,b)}`)
    // so any authenticated user can guess another user's room id. Without
    // a friendship check at join time, an attacker could join_dm_room with
    // arbitrary userIds and silently receive every receive_dm broadcast.
    // Same applies to typing — without the gate, a stranger can impersonate
    // typing indicators inside a victim's DM thread.
    // NEVER destructure the payload in a socket handler: `({ otherUserId })`
    // throws a TypeError on `emit('join_dm_room')` with no/null/string data.
    // In the sync handler below that TypeError escaped socket.io as an
    // uncaughtException → gracefulShutdown → process.exit — i.e. any logged-in
    // user could kill the API with one packet (release audit 2026-09-04).
    socket.on('join_dm_room', async (data) => {
      const other = parseInt(data?.otherUserId, 10);
      if (!other || other <= 0 || other === socket.userId) return;
      if (!withinBudget()) return;
      if (!(await areFriends(socket.userId, other))) return;
      const roomName = `dm_${Math.min(socket.userId, other)}_${Math.max(socket.userId, other)}`;
      socket.join(roomName);
    });

    socket.on('leave_dm_room', (data) => {
      const other = parseInt(data?.otherUserId, 10);
      if (!other || other <= 0) return;
      const roomName = `dm_${Math.min(socket.userId, other)}_${Math.max(socket.userId, other)}`;
      socket.leave(roomName);
    });

    // send_dm is retained as a NO-OP for older clients still emitting it. Live
    // delivery + moderation + the DM rate limit now happen server-side on the
    // HTTP POST /api/dm path (dmController.sendDM), which broadcasts the
    // already-moderated, server-authoritative row to the DM room and the
    // receiver's personal room. The old re-broadcast here ran NO text moderation
    // and trusted client identity. Do NOT restore a broadcast here without
    // server-side checkTextSafety.
    socket.on('send_dm', () => { /* delivery moved to HTTP path */ });

    socket.on('dm_typing', async (data) => {
      const recv = parseInt(data?.receiverId, 10);
      if (!recv || recv <= 0 || recv === socket.userId) return;
      if (!withinTypingBudget()) return;
      if (!(await areFriends(socket.userId, recv))) return;
      const roomName = `dm_${Math.min(socket.userId, recv)}_${Math.max(socket.userId, recv)}`;
      socket.to(roomName).emit('dm_user_typing', { userId: socket.userId });
    });

    socket.on('dm_stop_typing', async (data) => {
      const recv = parseInt(data?.receiverId, 10);
      if (!recv || recv <= 0 || recv === socket.userId) return;
      if (!withinTypingBudget()) return;
      if (!(await areFriends(socket.userId, recv))) return;
      const roomName = `dm_${Math.min(socket.userId, recv)}_${Math.max(socket.userId, recv)}`;
      socket.to(roomName).emit('dm_user_stop_typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {});
  });

  return io;
};

export default socketHandler;