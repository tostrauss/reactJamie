import { describe, it, expect, vi, beforeEach } from 'vitest';

// Abstimmungen im Chat (B1, tester 06.10.2026) — the HTTP side. db.query is
// routed on the /* poll:… */ tags; delivery (deliverGroupMessage) is real,
// with a recording io mock and a sendPushToUsers spy.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

const s = {
  ctxCreate: null, createRow: null, createFails: null,
  ctxVote: null, open: 1, ctxClose: null, closeChanged: true,
  summary: null, members: [],
};
const calls = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      calls.push({ text, params });
      if (text.includes('/* poll:ctx-create */')) return { rows: s.ctxCreate ? [s.ctxCreate] : [] };
      if (text.includes('/* poll:create */')) {
        if (s.createFails) throw s.createFails;
        return { rows: s.createRow ? [s.createRow] : [] };
      }
      if (text.includes('/* poll:ctx-vote */')) return { rows: s.ctxVote ? [s.ctxVote] : [] };
      if (text.includes('/* poll:vote */') || text.includes('/* poll:retract */')) return { rows: [{ open: s.open }] };
      if (text.includes('/* poll:ctx-close */')) return { rows: s.ctxClose ? [s.ctxClose] : [] };
      if (text.includes('/* poll:close */')) return { rowCount: s.closeChanged ? 1 : 0, rows: s.closeChanged ? [{ version: 5 }] : [] };
      if (text.includes('/* poll:summary */')) return { rows: s.summary ? [s.summary] : [] };
      if (text.includes('SELECT user_id, notifications_muted FROM group_members')) return { rows: s.members };
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));
const checkTextSafety = vi.fn(async () => ({ safe: true }));
vi.mock('../../src/config/moderation.js', () => ({ checkTextSafety: (...a) => checkTextSafety(...a) }));
const sendPushToUsers = vi.fn(async () => []);
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUsers: (...a) => sendPushToUsers(...a),
  PUSH_CONVERSATION: Object.freeze({ urgency: 'high', ttl: 86400 }),
}));
const postSystemMessage = vi.fn(async () => ({ id: 900 }));
vi.mock('../../src/utils/systemMessage.js', () => ({ postSystemMessage: (...a) => postSystemMessage(...a) }));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { createPoll, votePoll, closePoll } = await import('../../src/controllers/pollController.js');

const emits = [];
const io = (() => {
  const chain = (room, except = null) => ({
    except: (ex) => chain(room, ex),
    emit: (ev, payload) => { emits.push({ room, except, ev, payload }); },
  });
  return { to: (room) => chain(room), in: () => ({ fetchSockets: async () => [] }) };
})();
const makeRes = () => {
  const res = { headersSent: false };
  res.status = vi.fn((c) => { res.code = c; return res; });
  res.json = vi.fn((b) => { res.body = b; res.headersSent = true; return res; });
  return res;
};
const req = (over) => ({ userId: 7, params: {}, body: {}, headers: {}, app: { get: (k) => (k === 'io' ? io : undefined) }, ...over });
const choiceBody = { kind: 'choice', question: 'Was machen wir?', options: [{ label: 'Bowling' }, { label: 'Kino' }] };
const summary = (over = {}) => ({
  message_id: 501, kind: 'choice', question: 'Was machen wir?', multi: false, closed: false, version: 1, voter_count: 1,
  options: [{ pos: 0, label: 'Bowling', date: null, time: null, votes: 0 }, { pos: 1, label: 'Kino', date: null, time: null, votes: 1 }],
  my_votes: [1], ...over,
});

let gid = 3000;
beforeEach(() => {
  calls.length = 0;
  emits.length = 0;
  checkTextSafety.mockClear();
  sendPushToUsers.mockClear();
  postSystemMessage.mockClear();
  gid += 1; // the push cooldown is module-level: one group per test
  s.ctxCreate = { type: 'group', group_name: 'Yoga', owner_id: 1, chat_only_owner: false, deleted_at: null, member_user_id: 7 };
  s.createRow = { id: 501, group_id: gid, user_id: 7, content: '📊 Was machen wir? — Bowling · Kino', message_type: 'poll',
    reply_to_id: null, duration_ms: null, media_url: null, created_at: '2026-10-06T10:00:00Z', user_name: 'Anna', avatar_url: null, option_count: 2 };
  s.createFails = null;
  s.ctxVote = { group_id: gid, multi: false, closed_at: null, option_count: 2, is_member: true };
  s.open = 1;
  s.ctxClose = { author_id: 7, group_id: gid, owner_id: 1, closed_at: null, member_user_id: 7, member_role: 'member', caller_is_admin: false };
  s.closeChanged = true;
  s.summary = summary();
  s.members = [{ user_id: 8, notifications_muted: false }];
});

describe('createPoll', () => {
  it('400 for a bad group id — no SQL', async () => {
    const res = makeRes();
    await createPoll(req({ params: { groupId: 'abc' }, body: choiceBody }), res);
    expect(res.code).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('400 POLL_INVALID with the field — no SQL', async () => {
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: { ...choiceBody, options: [{ label: 'A' }] } }), res);
    expect(res.code).toBe(400);
    expect(res.body).toMatchObject({ code: 'POLL_INVALID', field: 'options' });
    expect(calls).toHaveLength(0);
  });

  it('404 for a missing or soft-deleted group', async () => {
    for (const ctx of [null, { ...s.ctxCreate, deleted_at: '2026-10-01' }]) {
      s.ctxCreate = ctx;
      const res = makeRes();
      await createPoll(req({ params: { groupId: String(gid) }, body: choiceBody }), res);
      expect(res.code).toBe(404);
    }
  });

  it('403 for a non-member — and no OpenAI call for them', async () => {
    s.ctxCreate.member_user_id = null;
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: choiceBody }), res);
    expect(res.code).toBe(403);
    expect(checkTextSafety).not.toHaveBeenCalled();
  });

  it('owner-only clubs: a member gets 403 isOwnerOnly, the owner may create', async () => {
    s.ctxCreate = { ...s.ctxCreate, type: 'club', chat_only_owner: true, owner_id: 1 };
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: choiceBody }), res);
    expect(res.code).toBe(403);
    expect(res.body.isOwnerOnly).toBe(true);
    const ok = makeRes();
    await createPoll(req({ userId: 1, params: { groupId: String(gid) }, body: choiceBody }), ok);
    expect(ok.code).toBe(201);
  });

  it('ONE moderation call over question + labels; 422 writes nothing', async () => {
    checkTextSafety.mockResolvedValueOnce({ safe: false, reason: 'Unangemessener Inhalt' });
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: choiceBody }), res);
    expect(checkTextSafety).toHaveBeenCalledWith('Was machen wir?\nBowling\nKino');
    expect(res.code).toBe(422);
    expect(calls.some((c) => c.text.includes('/* poll:create */'))).toBe(false);
  });

  it('date labels are server-built and never sent to moderation', async () => {
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: {
      kind: 'date', question: 'Wann passt es euch?', options: [{ date: '2026-10-10', time: '18:00' }, { date: '2026-10-11' }],
    } }), res);
    expect(checkTextSafety).toHaveBeenCalledWith('Wann passt es euch?');
  });

  it('the creator language shapes date labels in the stored content (X-App-Locale)', async () => {
    const res = makeRes();
    await createPoll(req({ headers: { 'x-app-locale': 'en' }, params: { groupId: String(gid) }, body: {
      kind: 'date', question: 'When?', options: [{ date: '2026-10-10', time: '18:00' }, { date: '2026-10-11' }],
    } }), res);
    const create = calls.find((c) => c.text.includes('/* poll:create */'));
    expect(create.params[2]).toContain('Sat 10 Oct 18:00');
    expect(create.params[2].startsWith('📅 When? — ')).toBe(true);
  });

  it('missing poll tables (boot window) → 503 POLLS_UNAVAILABLE, nothing emitted', async () => {
    s.createFails = Object.assign(new Error('relation "message_polls" does not exist'), { code: '42P01' });
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: choiceBody }), res);
    expect(res.code).toBe(503);
    expect(res.body.code).toBe('POLLS_UNAVAILABLE');
    expect(emits).toHaveLength(0);
  });

  it('201 with the full row + poll; delivered like a message (room, nudge, push)', async () => {
    const res = makeRes();
    await createPoll(req({ params: { groupId: String(gid) }, body: choiceBody }), res);
    expect(res.code).toBe(201);
    expect(res.body).toMatchObject({
      id: 501, message_type: 'poll', content: '📊 Was machen wir? — Bowling · Kino', reactions: [],
      poll: { version: 0, voter_count: 0, closed: false, my_votes: [] },
    });
    expect(res.body).not.toHaveProperty('option_count');
    const live = emits.find((e) => e.ev === 'receive_message');
    expect(live).toMatchObject({ room: String(gid), except: 'user_7' });
    expect(live.payload.poll).not.toHaveProperty('my_votes');
    const nudge = emits.find((e) => e.ev === 'group_message_notification');
    expect(nudge.payload).toMatchObject({ message_type: 'poll' });
    expect(nudge.payload.content).toBeTruthy(); // iOS 1.4.1's chat list shows it
    const builder = sendPushToUsers.mock.calls[0][1];
    expect(builder('de').body).toBe('📊 Anna hat eine Abstimmung gestartet: Was machen wir?');
  });
});

describe('votePoll', () => {
  const vote = async (choices, over = {}) => {
    const res = makeRes();
    await votePoll(req({ params: { messageId: '501' }, body: { choices }, ...over }), res);
    return res;
  };

  it('400 for a temp id or a non-array — no SQL', async () => {
    const r1 = makeRes();
    await votePoll(req({ params: { messageId: 'temp-1' }, body: { choices: [0] } }), r1);
    expect(r1.code).toBe(400);
    const r2 = await vote('0');
    expect(r2.code).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('404 / 403 from the poll row\'s OWN group (a decoy groupId in the body is ignored)', async () => {
    s.ctxVote = null;
    expect((await vote([0])).code).toBe(404);
    s.ctxVote = { group_id: gid, multi: false, closed_at: null, option_count: 2, is_member: false };
    expect((await vote([0], { body: { choices: [0], groupId: 1 } })).code).toBe(403);
  });

  it('a closed poll → 409 POLL_CLOSED with the current poll', async () => {
    s.ctxVote.closed_at = '2026-10-06T12:00:00Z';
    const res = await vote([0]);
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ code: 'POLL_CLOSED', poll: { question: 'Was machen wir?' } });
  });

  it('out-of-range or two choices on a single poll → 400 and nothing written', async () => {
    expect((await vote([5])).code).toBe(400);
    expect((await vote([0, 1])).code).toBe(400);
    expect(calls.some((c) => c.text.includes('/* poll:vote */'))).toBe(false);
  });

  it('closed between check and write (open = 0) → 409', async () => {
    s.open = 0;
    expect((await vote([1])).code).toBe(409);
  });

  it('a failing summary read never swallows the 409 (it used to escape the try → no response at all)', async () => {
    s.ctxVote.closed_at = '2026-10-06T12:00:00Z';
    const db = (await import('../../src/config/database.js')).default;
    const real = db.query.getMockImplementation();
    db.query.mockImplementation(async (text, params) => {
      if (text.includes('/* poll:summary */')) throw new Error('timeout exceeded when trying to connect');
      return real(text, params);
    });
    try {
      const res = await vote([0]);
      expect(res.code).toBe(409);
      expect(res.body).toMatchObject({ code: 'POLL_CLOSED', poll: null });
    } finally {
      db.query.mockImplementation(real);
    }
  });

  it('writes first, then emits: the room without my_votes, the actor\'s own sockets with them — never a push', async () => {
    const res = await vote([1]);
    const writeIdx = calls.findIndex((c) => c.text.includes('/* poll:vote */'));
    expect(writeIdx).toBeGreaterThan(-1);
    expect(res.body).toEqual({ messageId: 501, groupId: gid, poll: expect.objectContaining({ my_votes: [1], version: 1 }) });
    const room = emits.find((e) => e.ev === 'poll_update' && e.room === String(gid));
    const mine = emits.find((e) => e.ev === 'poll_update' && e.room === 'user_7');
    expect(room.payload.poll).not.toHaveProperty('my_votes');
    expect(mine.payload.poll.my_votes).toEqual([1]);
    expect(sendPushToUsers).not.toHaveBeenCalled();
    expect(emits.some((e) => e.ev === 'group_message_notification')).toBe(false);
  });

  it('[] retracts', async () => {
    await vote([]);
    expect(calls.some((c) => c.text.includes('/* poll:retract */'))).toBe(true);
  });

  it('missing tables → 503', async () => {
    const db = (await import('../../src/config/database.js')).default;
    db.query.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); });
    expect((await vote([0])).code).toBe(503);
  });
});

describe('closePoll', () => {
  const close = async (over = {}) => {
    const res = makeRes();
    await closePoll(req({ params: { messageId: '501' }, ...over }), res);
    return res;
  };

  it('403 for a plain member and for an author who was kicked', async () => {
    s.ctxClose = { ...s.ctxClose, author_id: 3 };
    expect((await close()).code).toBe(403);
    s.ctxClose = { ...s.ctxClose, author_id: 7, member_user_id: null };
    expect((await close()).code).toBe(403);
  });

  it('200 for the author (member), the owner, a co-manager and a platform admin who is not a member', async () => {
    for (const ctx of [
      { author_id: 7, member_user_id: 7 },
      { author_id: 3, owner_id: 7 },
      { author_id: 3, member_role: 'admin' },
      { author_id: 3, member_user_id: null, caller_is_admin: true },
    ]) {
      s.ctxClose = { ...s.ctxClose, ...ctx };
      const res = await close();
      expect(res.code ?? 200).toBe(200);
    }
  });

  it('first close with votes posts ONE result pill; an already closed poll emits nothing', async () => {
    s.summary = summary({ closed: true, version: 2 });
    await close();
    expect(postSystemMessage).toHaveBeenCalledTimes(1);
    expect(postSystemMessage.mock.calls[0][1].startsWith('📊 Ergebnis „Was machen wir?“: Kino (1 Stimme)')).toBe(true);
    emits.length = 0;
    s.closeChanged = false;
    await close();
    expect(postSystemMessage).toHaveBeenCalledTimes(1);
    expect(emits).toHaveLength(0);
  });

  it('the result pill is linked to its poll, so taking the poll down takes the pill down too', async () => {
    s.summary = summary({ closed: true, version: 2 });
    await close();
    const link = calls.find((c) => c.text.includes('/* poll:link-result */'));
    expect(link.params).toEqual([501, 900]);
  });

  it('no votes → no pill', async () => {
    s.summary = summary({ closed: true, voter_count: 0, options: summary().options.map((o) => ({ ...o, votes: 0 })), my_votes: [] });
    await close();
    expect(postSystemMessage).not.toHaveBeenCalled();
  });
});
