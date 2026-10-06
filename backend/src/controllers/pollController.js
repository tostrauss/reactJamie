import db from '../config/database.js';
import { checkTextSafety } from '../config/moderation.js';
import { normalizeLocale } from '../utils/pushLocale.js';
import { postSystemMessage } from '../utils/systemMessage.js';
import { deliverGroupMessage, withReply } from './messageController.js';
import {
  POLL_SQL, parsePollInput, viennaToday, formatPollDateLabel, buildPollContent, buildResultLine,
  normalizeChoices, initialPollSummary, roomPoll, isPollSchemaMissing, readPollSummaries,
  castVote, closePollRow,
} from '../utils/polls.js';

// Abstimmungen im Gruppen-/Club-Chat (B1, tester 06.10.2026). See
// utils/polls.js for the data model and why votes are anonymous; this file is
// the HTTP side: create (POST /api/messages/:groupId/polls), vote
// (PUT /api/messages/:messageId/poll/vote) and close
// (POST /api/messages/:messageId/poll/close).
//
// POST /api/messages keeps rejecting message_type 'poll': a poll row only
// ever comes from here, together with its data, so no client can forge a poll
// bubble without a poll behind it.

const UNAVAILABLE = {
  error: 'Umfragen sind gleich wieder verfügbar. Bitte versuche es in einer Minute erneut.',
  code: 'POLLS_UNAVAILABLE',
};

const parseId = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(v).trim() ? n : null;
};

const localeOf = (req) => normalizeLocale(req.headers?.['x-app-locale']);

// Best-effort live delivery AFTER the committed write. The room gets the same
// summary for everyone (no my_votes); the actor's own sockets — other tabs and
// devices — get it with their selection, so they stay in sync too.
const emitPollUpdate = (req, groupId, messageId, summary) => {
  try {
    const io = req.app?.get('io');
    if (!io || !summary) return;
    io.to(String(groupId)).emit('poll_update', { messageId, groupId, poll: roomPoll(summary) });
    io.to(`user_${req.userId}`).emit('poll_update', { messageId, groupId, poll: summary });
  } catch { /* delivery is best-effort; the write is what counts */ }
};

// ==========================================
// CREATE — POST /api/messages/:groupId/polls
// ==========================================
// Cheap checks first, OpenAI last: id → payload → membership → moderation.
export const createPoll = async (req, res) => {
  const groupId = parseId(req.params?.groupId);
  if (!groupId) return res.status(400).json({ error: 'Ungültige Gruppen-ID' });

  const today = viennaToday();
  const input = parsePollInput(req.body, { today });
  if (!input.ok) return res.status(400).json({ error: input.error, code: 'POLL_INVALID', field: input.field });

  try {
    const ctx = await db.query(POLL_SQL.ctxCreate, [groupId, req.userId]);
    const g = ctx.rows[0];
    if (!g || g.deleted_at) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (g.member_user_id == null) return res.status(403).json({ error: 'Keine Berechtigung' });
    // Same rule as sending a message: in a club with "nur der Gründer
    // schreibt", only the OWNER may start a poll (co-managers included in the
    // ban, like sendMessage). Voting stays open to every member.
    if (g.type === 'club' && g.chat_only_owner && Number(g.owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Nur der Club-Gründer kann Nachrichten senden', isOwnerOnly: true });
    }

    // ONE moderation call over everything a person typed. Date labels are
    // built by the server and never checked.
    const typed = [input.question, ...(input.kind === 'choice' ? input.options.map((o) => o.label) : [])];
    const { safe, reason } = await checkTextSafety(typed.join('\n'));
    if (!safe) return res.status(422).json({ error: reason });

    const locale = localeOf(req);
    const options = input.kind === 'date'
      ? input.options.map((o) => ({ ...o, label: formatPollDateLabel(o, locale, today.slice(0, 4)) }))
      : input.options;
    const labels = options.map((o) => o.label);
    const content = buildPollContent(input.kind, input.question, labels);

    let row;
    try {
      const result = await db.query(POLL_SQL.create, [
        groupId, req.userId, content, input.kind, input.question, input.multi,
        labels,
        options.map((o) => o.date ?? null),
        options.map((o) => o.time ?? null),
      ]);
      row = result.rows[0];
    } catch (err) {
      if (isPollSchemaMissing(err)) return res.status(503).json(UNAVAILABLE);
      throw err;
    }
    // Membership vanished between the check and the write (kicked mid-flight).
    if (!row) return res.status(403).json({ error: 'Keine Berechtigung' });

    const { option_count: _count, ...messageRow } = row;
    const poll = initialPollSummary({ kind: input.kind, question: input.question, multi: input.multi, options });
    const created = { ...withReply(messageRow), reactions: [], poll };
    res.status(201).json(created);

    // Exactly the delivery a message gets — receive_message to the room
    // (without the creator), the nudge for chat lists/badges, the push with
    // the usual mute/live-in-room/cooldown discipline.
    await deliverGroupMessage(req, {
      groupId,
      groupType: g.type,
      groupName: g.group_name,
      created: { ...created, poll: roomPoll(poll) },
      // Never '' (unlike photo/voice): iOS 1.4.1's chat list shows this text.
      nudge: { message_type: 'poll', content: content.slice(0, 200) },
      push: { sender: row.user_name || 'Jemand', isPoll: true, pollKind: input.kind, question: input.question.slice(0, 120) },
    });
  } catch (err) {
    console.error('createPoll error:', err?.message);
    if (!res.headersSent) res.status(500).json({ error: 'Umfrage konnte nicht gesendet werden' });
  }
};

// ==========================================
// VOTE — PUT /api/messages/:messageId/poll/vote   body { choices: [0, 2] }
// ==========================================
// `choices` is the COMPLETE desired selection ([] retracts). The group is read
// from the poll's own message row, never from the request.
export const votePoll = async (req, res) => {
  const messageId = parseId(req.params?.messageId);
  if (!messageId) return res.status(400).json({ error: 'Ungültige ID' });
  if (!Array.isArray(req.body?.choices)) return res.status(400).json({ error: 'Ungültige Auswahl', code: 'POLL_INVALID' });

  try {
    const ctx = (await db.query(POLL_SQL.ctxVote, [messageId, req.userId])).rows[0];
    if (!ctx) return res.status(404).json({ error: 'Umfrage nicht gefunden' });
    if (!ctx.is_member) return res.status(403).json({ error: 'Keine Berechtigung' });
    const groupId = Number(ctx.group_id);
    // The 409 must not depend on the summary read: un-awaited inside this try,
    // a failing read rejected past the catch and Express 4 never answered.
    const closed = async () => {
      let poll = null;
      try { poll = (await readPollSummaries(db, [messageId], req.userId)).get(messageId) ?? null; } catch { /* the 409 is the answer */ }
      return res.status(409).json({ error: 'Diese Umfrage ist beendet.', code: 'POLL_CLOSED', messageId, groupId, poll });
    };
    if (ctx.closed_at) return await closed();

    const choices = normalizeChoices(req.body.choices, { optionCount: Number(ctx.option_count) || 0, multi: !!ctx.multi });
    if (!choices) return res.status(400).json({ error: 'Ungültige Auswahl', code: 'POLL_INVALID' });

    const open = await castVote(db, messageId, req.userId, choices);
    if (!open) return await closed(); // closed between the check and the write — nothing was written

    const summary = (await readPollSummaries(db, [messageId], req.userId)).get(messageId) ?? null;
    emitPollUpdate(req, groupId, messageId, summary);
    // No push, no nudge, no messages row, no unread change — a vote is not a message.
    res.json({ messageId, groupId, poll: summary });
  } catch (err) {
    if (isPollSchemaMissing(err)) return res.status(503).json(UNAVAILABLE);
    console.error('votePoll error:', err?.message);
    res.status(500).json({ error: 'Stimme konnte nicht gespeichert werden' });
  }
};

// ==========================================
// CLOSE — POST /api/messages/:messageId/poll/close
// ==========================================
// The author (while still a member), the group owner, a co-manager of THIS
// group, or a platform admin. Irreversible and idempotent: a second close
// answers 200 with nothing emitted and no second result pill.
export const closePoll = async (req, res) => {
  const messageId = parseId(req.params?.messageId);
  if (!messageId) return res.status(400).json({ error: 'Ungültige ID' });

  try {
    const ctx = (await db.query(POLL_SQL.ctxClose, [messageId, req.userId])).rows[0];
    if (!ctx) return res.status(404).json({ error: 'Umfrage nicht gefunden' });
    const me = Number(req.userId);
    const isMember = ctx.member_user_id != null;
    const allowed = (Number(ctx.author_id) === me && isMember)
      || Number(ctx.owner_id) === me
      || (isMember && ctx.member_role === 'admin')
      || !!ctx.caller_is_admin;
    if (!allowed) return res.status(403).json({ error: 'Keine Berechtigung' });

    const groupId = Number(ctx.group_id);
    const changed = await closePollRow(db, messageId, req.userId);
    const summary = (await readPollSummaries(db, [messageId], req.userId)).get(messageId) ?? null;
    if (changed) {
      emitPollUpdate(req, groupId, messageId, summary);
      // The result as a system pill — every client renders those, iOS 1.4.1
      // included, so people without the poll UI learn the outcome too. No
      // unread count, no push (postSystemMessage never throws).
      const line = buildResultLine(summary, localeOf(req));
      const pill = line ? await postSystemMessage(groupId, line, req.app?.get('io')) : null;
      // Linked, so a takedown of the poll takes the pill (which repeats its
      // user-typed text) down too — nobody can report or delete a system row.
      if (pill?.id) {
        await db.query(POLL_SQL.linkResult, [messageId, pill.id])
          .catch((err) => console.error('[polls] result link failed:', err?.message));
      }
    }
    res.json({ messageId, groupId, poll: summary });
  } catch (err) {
    if (isPollSchemaMissing(err)) return res.status(503).json(UNAVAILABLE);
    console.error('closePoll error:', err?.message);
    res.status(500).json({ error: 'Umfrage konnte nicht beendet werden' });
  }
};
