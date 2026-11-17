import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// The automated messages of club events (Tina's document of 17.11.2026,
// jobs/clubEventMessages.js). The claim SQL is the contract — WHEN a message
// may go out, and that it goes out once — so it is pinned here; the
// real-Postgres smoke test runs the same claims with an injected clock.
// Every query is recorded and dispatched to the per-test `dbQueryImpl`.
const statements = [];
let dbQueryImpl;

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      statements.push({ text, params });
      return dbQueryImpl(text, params);
    }),
  },
}));
vi.mock('../../src/controllers/dealController.js', () => ({ getDealsForEvents: vi.fn(async () => new Map()) }));
vi.mock('../../src/controllers/messageController.js', () => ({
  deliverGroupMessage: vi.fn(async () => {}),
  withReply: (row) => (row ? { ...row, reply_to: null } : row),
}));

const { getDealsForEvents } = await import('../../src/controllers/dealController.js');
const { deliverGroupMessage } = await import('../../src/controllers/messageController.js');
const {
  runClubEventMessages, postClubMessage, resolveClubMessageSender, CLUB_MESSAGE_CLAIMS, CLUB_MESSAGE_KINDS,
} = await import('../../src/jobs/clubEventMessages.js');

const NOW = new Date('2027-03-10T18:10:00Z');
const EVENT = {
  group_id: 90, event_name: 'Punsch Night', location: 'Kaiserstraße 60, 1070 Wien',
  creator_id: 7, club_name: 'Café Soleá', club_owner_id: 3,
};
const kindOf = (text) => (text.includes('SET welcome_sent_at') ? 'welcome'
  : text.includes('SET eve_sent_for') ? 'eve'
    : text.includes('SET soon_sent_for') ? 'soon'
      : text.includes('SET thanks_sent_for') ? 'thanks' : null);

// Each claim hands back what `claimed[kind]` says; the sender lookup answers
// with `inChat` (user ids that are members of the event's chat).
const program = ({ claimed = {}, inChat = [7, 3], fail = {} } = {}) => {
  dbQueryImpl = async (text) => {
    const kind = kindOf(text);
    if (kind) {
      if (fail[kind]) throw fail[kind];
      return { rows: claimed[kind] || [] };
    }
    if (text.includes('FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])')) {
      return { rows: inChat.map((user_id) => ({ user_id })) };
    }
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  };
};

let log;
let error;
beforeEach(() => {
  statements.length = 0;
  vi.mocked(getDealsForEvents).mockClear().mockResolvedValue(new Map());
  vi.mocked(deliverGroupMessage).mockClear();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  error.mockRestore();
  delete process.env.CLUB_AUTO_MESSAGES;
});

describe('the four claims', () => {
  it('there are four, in the order they go out', () => {
    expect(CLUB_MESSAGE_KINDS).toEqual(['welcome', 'eve', 'soon', 'thanks']);
    expect(Object.keys(CLUB_MESSAGE_CLAIMS)).toEqual(['welcome', 'eve', 'soon', 'thanks']);
  });

  it.each(CLUB_MESSAGE_KINDS)('%s: claimed in one statement under a row lock, by day, only for a live official club with someone besides the creator', (kind) => {
    const sql = CLUB_MESSAGE_CLAIMS[kind];
    // one statement, two replicas never both
    expect(sql).toContain('FOR UPDATE OF am SKIP LOCKED');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toMatch(/UPDATE club_event_auto_messages m\s+SET /);
    // the switch, and an event that is really happening
    expect(sql).toContain('am.enabled = TRUE');
    expect(sql).toContain(`e.type = 'event'`);
    expect(sql).toContain('e.is_active = TRUE');
    expect(sql).toContain('e.deleted_at IS NULL');
    expect(sql).toContain('e.did_not_take_place IS NOT TRUE');
    expect(sql).toContain('e.date IS NOT NULL');
    expect(sql).toContain('e.members_count > 1');
    // its club: live (approved, active, not deleted) and official
    expect(sql).toContain(`c.type = 'club'`);
    expect(sql).toContain(`c.approval_status = 'approved'`);
    expect(sql).toContain('c.is_active = TRUE');
    expect(sql).toContain('c.deleted_at IS NULL');
    expect(sql).toContain(`c.club_type = 'official'`);
    // 09:00–22:59 Vienna
    expect(sql).toContain(`EXTRACT(HOUR FROM ($1::timestamptz AT TIME ZONE 'Europe/Vienna')) BETWEEN 9 AND 22`);
  });

  it('welcome: 48 hours after the switch was set, while the event is ahead — a series either way; once', () => {
    const sql = CLUB_MESSAGE_CLAIMS.welcome;
    expect(sql).toContain('SET welcome_sent_at = $1::timestamptz');
    expect(sql).toContain('am.welcome_sent_at IS NULL');
    expect(sql).toContain(`am.created_at + INTERVAL '48 hours' <= $1::timestamptz`);
    expect(sql).toContain(`(e.is_recurring_weekly IS TRUE OR (e.date AT TIME ZONE 'Europe/Vienna') > $1::timestamptz)`);
    // never after „Morgen ist es so weit!“ for the same date
    expect(sql).toContain('am.eve_sent_for IS DISTINCT FROM e.date');
    // a series gets it: no one-off condition here
    expect(sql).not.toContain('e.is_recurring_weekly IS NOT TRUE');
  });

  it('eve: the calendar day before, from the event\'s own time of day (09:00–22:00), re-armed by a move', () => {
    const sql = CLUB_MESSAGE_CLAIMS.eve;
    expect(sql).toContain('SET eve_sent_for = due.date');
    expect(sql).toContain('e.is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain('am.eve_sent_for IS DISTINCT FROM e.date');
    expect(sql).toContain(`(e.date::date - 1) = ($1::timestamptz AT TIME ZONE 'Europe/Vienna')::date`);
    expect(sql).toContain(`($1::timestamptz AT TIME ZONE 'Europe/Vienna')::time >= LEAST(GREATEST(e.date::time, TIME '09:00'), TIME '22:00')`);
  });

  it('soon: the last two hours before a TIMED event, re-armed by a move', () => {
    const sql = CLUB_MESSAGE_CLAIMS.soon;
    expect(sql).toContain('SET soon_sent_for = due.date');
    expect(sql).toContain('e.is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain(`e.date::time <> '00:00'`);
    expect(sql).toContain('am.soon_sent_for IS DISTINCT FROM e.date');
    expect(sql).toContain(`(e.date AT TIME ZONE 'Europe/Vienna') - INTERVAL '2 hours' <= $1::timestamptz`);
    expect(sql).toContain(`(e.date AT TIME ZONE 'Europe/Vienna') > $1::timestamptz`);
  });

  it('thanks: the calendar day after, from the event\'s own time of day, re-armed by a move', () => {
    const sql = CLUB_MESSAGE_CLAIMS.thanks;
    expect(sql).toContain('SET thanks_sent_for = due.date');
    expect(sql).toContain('e.is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain('am.thanks_sent_for IS DISTINCT FROM e.date');
    expect(sql).toContain(`(e.date::date + 1) = ($1::timestamptz AT TIME ZONE 'Europe/Vienna')::date`);
    expect(sql).toContain(`LEAST(GREATEST(e.date::time, TIME '09:00'), TIME '22:00')`);
  });
});

describe('runClubEventMessages', () => {
  it('nothing due: four claims with the clock and the limit, nothing posted', async () => {
    program();
    const post = vi.fn();
    const out = await runClubEventMessages({ now: NOW, post });
    expect(out).toEqual({ welcome: 0, eve: 0, soon: 0, thanks: 0 });
    expect(statements.map((s) => kindOf(s.text))).toEqual(['welcome', 'eve', 'soon', 'thanks']);
    for (const s of statements) expect(s.params).toEqual([NOW, 100]);
    expect(post).not.toHaveBeenCalled();
  });

  it('each kind posts Tina\'s text as the event\'s creator, into the event\'s chat', async () => {
    program({ claimed: { welcome: [EVENT], eve: [EVENT], soon: [EVENT], thanks: [EVENT] } });
    vi.mocked(getDealsForEvents).mockResolvedValue(new Map([[90, { id: 5, deal_label: '1 Punsch gratis.' }]]));
    const post = vi.fn(async () => ({ id: 1 }));
    const io = { marker: true };
    const out = await runClubEventMessages({ now: NOW, io, post });
    expect(out).toEqual({ welcome: 1, eve: 1, soon: 1, thanks: 1 });
    expect(post.mock.calls.map(([a]) => a)).toEqual([
      { groupId: 90, senderId: 7, groupName: 'Punsch Night', io,
        text: 'Hey, freut mich, dass ihr dabei seid! 😊 Wir sind Café Soleá und freuen uns schon riesig auf euch. Fragen? Schreibt einfach hier rein!' },
      { groupId: 90, senderId: 7, groupName: 'Punsch Night', io,
        text: 'Morgen ist es so weit! 🎉 Wir sehen uns in der Kaiserstraße 60, 1070 Wien. Vergesst nicht euren Deal: 1 Punsch gratis.' },
      { groupId: 90, senderId: 7, groupName: 'Punsch Night', io, text: 'Wir sind bereit für euch! Bis gleich 👋' },
      { groupId: 90, senderId: 7, groupName: 'Punsch Night', io, text: 'Danke, dass ihr da wart! 💛 Hat es euch gefallen?' },
    ]);
    // only „the day before“ asks for the deal
    expect(getDealsForEvents).toHaveBeenCalledTimes(1);
    expect(getDealsForEvents).toHaveBeenCalledWith([90]);
  });

  it('eve without a deal and without a location: the sentences are left out', async () => {
    program({ claimed: { eve: [{ ...EVENT, location: null }] } });
    const post = vi.fn(async () => ({ id: 1 }));
    await runClubEventMessages({ now: NOW, post });
    expect(post.mock.calls[0][0].text).toBe('Morgen ist es so weit! 🎉');
  });

  it('the creator is no longer in the chat: the club\'s owner writes', async () => {
    program({ claimed: { soon: [EVENT] }, inChat: [3] });
    const post = vi.fn(async () => ({ id: 1 }));
    await runClubEventMessages({ now: NOW, post });
    expect(post.mock.calls[0][0].senderId).toBe(3);
  });

  it('neither of them is in the chat: nothing is posted — and the next event still goes out', async () => {
    let lookups = 0;
    program({ claimed: { soon: [EVENT, { ...EVENT, group_id: 91 }] } });
    const base = dbQueryImpl;
    dbQueryImpl = async (text, params) => {
      if (text.includes('FROM group_members')) {
        lookups += 1;
        return { rows: lookups === 1 ? [] : [{ user_id: 7 }] };
      }
      return base(text, params);
    };
    const post = vi.fn(async () => ({ id: 1 }));
    const out = await runClubEventMessages({ now: NOW, post });
    expect(out.soon).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].groupId).toBe(91);
  });

  it('a post that fails loses that one message only', async () => {
    program({ claimed: { thanks: [EVENT, { ...EVENT, group_id: 91 }] } });
    const post = vi.fn()
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce({ id: 2 });
    const out = await runClubEventMessages({ now: NOW, post });
    expect(out.thanks).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('one kind failing does not stop the others', async () => {
    program({ claimed: { thanks: [EVENT] }, fail: { eve: new Error('deadlock detected') } });
    const post = vi.fn(async () => ({ id: 1 }));
    const out = await runClubEventMessages({ now: NOW, post });
    expect(out).toEqual({ welcome: 0, eve: 0, soon: 0, thanks: 1 });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('the table is not there yet (boot window): the tick ends quietly', async () => {
    program({ fail: { welcome: Object.assign(new Error('relation does not exist'), { code: '42P01' }) } });
    const post = vi.fn();
    const out = await runClubEventMessages({ now: NOW, post });
    expect(out).toEqual({ welcome: 0, eve: 0, soon: 0, thanks: 0 });
    expect(statements).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('kill switch CLUB_AUTO_MESSAGES=false: not one query', async () => {
    process.env.CLUB_AUTO_MESSAGES = 'false';
    program({ claimed: { welcome: [EVENT] } });
    const post = vi.fn();
    const out = await runClubEventMessages({ now: NOW, post });
    expect(out).toEqual({ welcome: 0, eve: 0, soon: 0, thanks: 0 });
    expect(statements).toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('resolveClubMessageSender', () => {
  it('prefers the creator, falls back to the club owner, else nobody', async () => {
    program({ inChat: [3, 7] });
    expect(await resolveClubMessageSender(EVENT)).toBe(7);
    expect(statements[0].params).toEqual([90, [7, 3]]);
    program({ inChat: [3] });
    expect(await resolveClubMessageSender(EVENT)).toBe(3);
    program({ inChat: [] });
    expect(await resolveClubMessageSender(EVENT)).toBeNull();
  });

  it('an event without a creator (account deleted) and without a club owner asks nothing', async () => {
    program();
    statements.length = 0;
    expect(await resolveClubMessageSender({ ...EVENT, creator_id: null, club_owner_id: null })).toBeNull();
    expect(statements).toHaveLength(0);
  });
});

describe('postClubMessage', () => {
  it('stores an ordinary text message of the sender FIRST, then delivers it like any chat message', async () => {
    const order = [];
    const row = { id: 501, group_id: 90, user_id: 7, content: 'Wir sind bereit für euch! Bis gleich 👋', message_type: 'text', user_name: 'Tina', avatar_url: '/a.webp' };
    dbQueryImpl = async () => { order.push('insert'); return { rows: [row] }; };
    vi.mocked(deliverGroupMessage).mockImplementation(async () => { order.push('deliver'); });
    const io = { marker: true };
    const created = await postClubMessage({ groupId: 90, senderId: 7, text: row.content, groupName: 'Punsch Night', io });

    expect(order).toEqual(['insert', 'deliver']);
    const { text, params } = statements[0];
    expect(text).toContain('INSERT INTO messages (group_id, user_id, content, message_type)');
    expect(text).toContain(`VALUES ($1, $2, $3, 'text')`);
    expect(text).toContain('JOIN users u ON u.id = i.user_id');
    expect(params).toEqual([90, 7, row.content]);
    expect(created).toEqual({ ...row, reply_to: null });

    const [req, payload] = vi.mocked(deliverGroupMessage).mock.calls[0];
    expect(req.userId).toBe(7);
    expect(req.app.get('io')).toBe(io);
    expect(req.app.get('anything-else')).toBeUndefined();
    expect(payload).toEqual({
      groupId: 90, groupType: 'event', groupName: 'Punsch Night', created,
      nudge: { message_type: 'text', content: row.content },
      push: { sender: 'Tina', isVoice: false, isImage: false, line: `Tina: ${row.content}` },
    });
  });

  it('no row back (the sender\'s account is gone): nothing is delivered', async () => {
    dbQueryImpl = async () => ({ rows: [] });
    expect(await postClubMessage({ groupId: 90, senderId: 7, text: 'x', groupName: 'y' })).toBeNull();
    expect(deliverGroupMessage).not.toHaveBeenCalled();
  });

  it('a long message is clipped for the chat-list nudge and the push, never in the chat', async () => {
    const long = `Morgen ist es so weit! 🎉 ${'Sehr lange Adresse '.repeat(20)}`;
    dbQueryImpl = async () => ({ rows: [{ id: 1, group_id: 90, user_id: 7, content: long, message_type: 'text', user_name: 'Tina' }] });
    await postClubMessage({ groupId: 90, senderId: 7, text: long, groupName: 'y' });
    expect(statements[0].params[2]).toBe(long);
    const [, payload] = vi.mocked(deliverGroupMessage).mock.calls[0];
    expect(payload.nudge.content).toBe(long.slice(0, 200));
    expect(payload.push.line).toBe(`Tina: ${long.slice(0, 120)}`);
  });
});
