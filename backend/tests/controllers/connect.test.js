import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// „Aus Fremden können Freundschaften werden!“ — the friends list after an
// event (Tina 17.11.2026). The SQL is the contract (WHO gets the list, WHO is
// on it) and is pinned here; the real-Postgres smoke test runs it for real.
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

const { getPendingConnect, dismissConnect, friendStatusOf, CONNECT_WINDOW_DAYS } =
  await import('../../src/controllers/connectController.js');
const { joinedInTimeSql, blockedWithSql, REVIEW_WINDOW_DAYS } = await import('../../src/utils/attendanceTiers.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const ME = 7;
const EVENT = { id: 12, name: 'Spieleabend', date: '2026-11-15T19:00:00.000Z', image_url: null, owner_id: 5 };
const person = (id, o = {}) => ({
  group_id: 12, id, name: `P${id}`, avatar_url: null, age: 27, is_owner: false,
  friendship_id: null, f_status: null, f_requester: null, ...o,
});

// Events query → `events`, people query → `people`.
const program = ({ events = [EVENT], people = [] } = {}) => {
  dbQueryImpl = async (text) => {
    if (text.includes('FROM group_members me')) return { rows: events };
    if (text.includes('FROM group_members gm')) return { rows: people };
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  };
};

const eventsSql = () => statements.find((s) => s.text.includes('FROM group_members me'));
const peopleSql = () => statements.find((s) => s.text.includes('FROM group_members gm'));

beforeEach(() => {
  statements.length = 0;
  delete process.env.POST_EVENT_CONNECT;
});
afterEach(() => {
  delete process.env.POST_EVENT_CONNECT;
  vi.restoreAllMocks();
});

describe('getPendingConnect — who gets the list', () => {
  it('every participant but the creator, for meetups and club events whose day is over', async () => {
    program({ people: [person(5, { is_owner: true })] });
    await getPendingConnect({ userId: ME }, makeRes());
    const { text, params } = eventsSql();
    expect(params).toEqual([ME]);
    expect(text).toContain('me.user_id = $1');
    expect(text).toContain('g.owner_id IS DISTINCT FROM $1');
    // A participant = a member by the end of the event day, never a late joiner.
    expect(text).toContain(joinedInTimeSql('me', 'g'));
    expect(text).toContain("g.type IN ('group', 'event')");
    expect(text).toContain('g.is_active IS NOT FALSE');
    expect(text).toContain('g.deleted_at IS NULL');
    expect(text).toContain('g.did_not_take_place IS NOT TRUE');
    expect(text).toContain('g.is_recurring_weekly IS NOT TRUE');
    // …and the parent club of a club event has to be alive.
    expect(text).toContain('g.parent_club_id IS NULL OR EXISTS');
    // Not the ones the caller closed.
    expect(text).toContain('event_connect_dismissals d WHERE d.group_id = g.id AND d.user_id = $1');
  });

  it('from the day after the event, for as long as „Wer war dabei?“ stays open — Vienna days', async () => {
    program({ people: [person(5)] });
    await getPendingConnect({ userId: ME }, makeRes());
    const { text } = eventsSql();
    expect(CONNECT_WINDOW_DAYS).toBe(REVIEW_WINDOW_DAYS);
    expect(text).toContain("g.date::date <  (NOW() AT TIME ZONE 'Europe/Vienna')::date");
    expect(text).toContain(`g.date::date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date - ${REVIEW_WINDOW_DAYS}`);
  });

  it('the list: the other participants in time, no frozen accounts, nobody in a block (either direction)', async () => {
    program({ people: [person(5)] });
    await getPendingConnect({ userId: ME }, makeRes());
    const { text, params } = peopleSql();
    expect(params).toEqual([ME, [12]]);
    expect(text).toContain('gm.user_id <> $1');
    expect(text).toContain(joinedInTimeSql('gm', 'g'));
    expect(text).toContain('u.is_active IS DISTINCT FROM FALSE');
    expect(text).toContain(`gm.user_id NOT IN ${blockedWithSql('$1')}`);
    // The creator leads the list.
    expect(text).toContain('ORDER BY gm.group_id, (u.id = g.owner_id) DESC');
  });

  it('no event → no second query', async () => {
    program({ events: [] });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(statements).toHaveLength(1);
  });
});

describe('getPendingConnect — the state per person', () => {
  it('friendStatusOf: accepted / pending_out / pending_in, everything else none', () => {
    expect(friendStatusOf({ f_status: 'accepted', f_requester: 3 }, ME)).toBe('accepted');
    expect(friendStatusOf({ f_status: 'pending', f_requester: ME }, ME)).toBe('pending_out');
    expect(friendStatusOf({ f_status: 'pending', f_requester: '7' }, ME)).toBe('pending_out');
    expect(friendStatusOf({ f_status: 'pending', f_requester: 3 }, ME)).toBe('pending_in');
    for (const s of ['rejected', 'expired', null, undefined]) {
      expect(friendStatusOf({ f_status: s, f_requester: 3 }, ME)).toBe('none');
    }
  });

  it('answers the event with its people, the friendship id only where there is something to act on or show', async () => {
    program({ people: [
      person(5, { is_owner: true }),
      person(8, { friendship_id: 31, f_status: 'accepted', f_requester: 8 }),
      person(9, { friendship_id: 32, f_status: 'pending', f_requester: ME }),
      person(10, { friendship_id: 33, f_status: 'pending', f_requester: 10 }),
      person(11, { friendship_id: 34, f_status: 'rejected', f_requester: ME }),
    ] });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([{
      group_id: 12, group_name: 'Spieleabend', event_date: EVENT.date, image_url: null,
      members: [
        { id: 5, name: 'P5', avatar_url: null, age: 27, is_owner: true, friend_status: 'none', friendship_id: null },
        { id: 8, name: 'P8', avatar_url: null, age: 27, is_owner: false, friend_status: 'accepted', friendship_id: 31 },
        { id: 9, name: 'P9', avatar_url: null, age: 27, is_owner: false, friend_status: 'pending_out', friendship_id: 32 },
        { id: 10, name: 'P10', avatar_url: null, age: 27, is_owner: false, friend_status: 'pending_in', friendship_id: 33 },
        // A rejected request reads as none — and carries no id.
        { id: 11, name: 'P11', avatar_url: null, age: 27, is_owner: false, friend_status: 'none', friendship_id: null },
      ],
    }]);
  });

  it('an event where nobody is left to ask (all friends or already asked) is not listed', async () => {
    const other = { ...EVENT, id: 13, name: 'Lauftreff' };
    program({ events: [EVENT, other], people: [
      person(8, { friendship_id: 31, f_status: 'accepted', f_requester: 8 }),
      person(9, { friendship_id: 32, f_status: 'pending', f_requester: ME }),
      person(20, { group_id: 13 }),
    ] });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.map((e) => e.group_id)).toEqual([13]);
  });

  it('an open request FROM somebody is something to do: the event stays listed', async () => {
    program({ people: [person(10, { friendship_id: 33, f_status: 'pending', f_requester: 10 })] });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.json.mock.calls[0][0]).toHaveLength(1);
  });

  it('at most five events', async () => {
    const events = Array.from({ length: 8 }, (_, i) => ({ ...EVENT, id: 100 + i }));
    program({ events, people: events.map((e) => person(5, { group_id: e.id })) });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.json.mock.calls[0][0].map((e) => e.group_id)).toEqual([100, 101, 102, 103, 104]);
  });
});

describe('getPendingConnect — never a 5xx, and the emergency switch', () => {
  it('a database error is 200 [] (api.js retries GETs on 5xx)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbQueryImpl = async () => { throw new Error('connection reset'); };
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([]);
    expect(log).toHaveBeenCalled();
  });

  it('the side table missing in the boot window (42P01) is 200 [] too — quietly', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbQueryImpl = async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); };
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('POST_EVENT_CONNECT=false: 200 [] without a single query', async () => {
    process.env.POST_EVENT_CONNECT = 'false';
    program({ people: [person(5)] });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(statements).toHaveLength(0);
  });

  it('…and any other value leaves it on', async () => {
    process.env.POST_EVENT_CONNECT = 'true';
    program({ people: [person(5)] });
    const res = makeRes();
    await getPendingConnect({ userId: ME }, res);
    expect(res.json.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('dismissConnect', () => {
  it.each([undefined, null, 'abc', '12', 1.5, 0, -3])('group_id %p → 400 before any SQL', async (gid) => {
    const res = makeRes();
    await dismissConnect({ userId: ME, body: { group_id: gid } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(statements).toHaveLength(0);
  });

  it('a participant closes the list: one row, written only for a member of the event', async () => {
    dbQueryImpl = async () => ({ rows: [{ '?column?': 1 }] });
    const res = makeRes();
    await dismissConnect({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(statements).toHaveLength(1);
    expect(statements[0].params).toEqual([12, ME]);
    expect(statements[0].text).toContain('INSERT INTO event_connect_dismissals');
    expect(statements[0].text).toContain('WHERE EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)');
    expect(statements[0].text).toContain('ON CONFLICT DO NOTHING');
  });

  it('closing it a second time answers the same (nothing written, still a member)', async () => {
    dbQueryImpl = async (text) => (text.includes('INSERT INTO') ? { rows: [] } : { rows: [{ '?column?': 1 }] });
    const res = makeRes();
    await dismissConnect({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('somebody who is not in the event → 403', async () => {
    dbQueryImpl = async () => ({ rows: [] });
    const res = makeRes();
    await dismissConnect({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('the table missing in the boot window → 503 with a code and a sentence old bundles can show', async () => {
    dbQueryImpl = async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); };
    const res = makeRes();
    await dismissConnect({ userId: ME, body: { group_id: 12 } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'CONNECT_UNAVAILABLE', error: expect.any(String) });
  });
});
