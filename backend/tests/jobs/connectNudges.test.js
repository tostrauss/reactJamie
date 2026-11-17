import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// The Connect push the day after an event (Tina 17.11.2026). The claim SQL is
// the contract — WHEN a push may go out and for WHICH events — and the
// recipient SQL says WHO; both are pinned here, the real-Postgres smoke test
// runs them with an injected clock. Pattern of engagementNudges.test.js.
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
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToUsers: vi.fn(async () => {}) }));

const { runConnectNudges, connectPushUrl, CONNECT_PUSH_MIN_PARTICIPANTS } =
  await import('../../src/jobs/connectNudges.js');
const { joinedInTimeSql, remainingParticipantsSql } = await import('../../src/utils/attendanceTiers.js');

const NOW = new Date('2027-02-10T09:15:00Z');   // 10:15 in Vienna
const CLAIM = 'UPDATE groups g SET connect_nudge_sent_for = g.date';
const claimOf = () => statements.find((s) => s.text.includes(CLAIM));
const recipientsOf = () => statements.find((s) => s.text.includes('FROM group_members gm'));

const program = ({ claimed = [], members = [], membersErr = null } = {}) => {
  dbQueryImpl = async (text) => {
    if (text.includes(CLAIM)) return { rows: claimed, rowCount: claimed.length };
    if (text.includes('FROM group_members gm')) {
      if (membersErr) throw membersErr;
      return { rows: members };
    }
    if (text.includes('SET connect_nudge_sent_for = NULL')) return { rows: [] };
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  };
};

const EV7 = { id: 7, name: 'Spieleabend', claimed_date: '2027-02-09 19:00:00' };
const EV8 = { id: 8, name: 'Lauftreff', claimed_date: '2027-02-09 00:00:00' };

beforeEach(() => {
  statements.length = 0;
  delete process.env.POST_EVENT_CONNECT;
});
afterEach(() => {
  delete process.env.POST_EVENT_CONNECT;
  vi.restoreAllMocks();
});

describe('runConnectNudges — the claim', () => {
  it('one push per event: the marker is a copy of the date, so a moved event is claimed again', async () => {
    program();
    await runConnectNudges({ now: NOW });
    const { text, params } = claimOf();
    expect(params).toEqual([NOW, 200]);
    expect(text).toContain('(x.connect_nudge_sent_for IS NULL OR x.connect_nudge_sent_for <> x.date)');
    expect(text).toContain('FOR UPDATE OF x SKIP LOCKED');
    expect(text).toContain("to_char(g.date, 'YYYY-MM-DD HH24:MI:SS') AS claimed_date");
  });

  it('the day after the event from 10:00 until midnight, and only 09:00–22:59 — all in Vienna time', async () => {
    program();
    await runConnectNudges({ now: NOW });
    const { text } = claimOf();
    expect(text).toContain("((x.date::date + 1)::timestamp + TIME '10:00') AT TIME ZONE 'Europe/Vienna' <= $1::timestamptz");
    expect(text).toContain("((x.date::date + 2)::timestamp) AT TIME ZONE 'Europe/Vienna' >  $1::timestamptz");
    expect(text).toContain("EXTRACT(HOUR FROM ($1::timestamptz AT TIME ZONE 'Europe/Vienna')) BETWEEN 9 AND 22");
  });

  it('meetups and club events that stand, of ANY size — as long as two people are still in it', async () => {
    program();
    await runConnectNudges({ now: NOW });
    const { text } = claimOf();
    expect(text).toContain("x.type IN ('group', 'event')");
    expect(text).toContain('x.is_active = TRUE');
    expect(text).toContain('x.deleted_at IS NULL');
    expect(text).toContain('x.did_not_take_place IS NOT TRUE');
    expect(text).toContain('x.is_recurring_weekly IS NOT TRUE');
    expect(text).toContain('x.parent_club_id IS NULL OR EXISTS');
    expect(CONNECT_PUSH_MIN_PARTICIPANTS).toBe(2);
    expect(text).toContain(`${remainingParticipantsSql('x')} >= 2`);
    // No upper bound: „bei egal wie vielen Leuten“.
    expect(text).not.toContain('<= 8');
    expect(text).not.toContain('hall_of_fame_entries');
  });

  it('nothing claimed → no recipient query, nothing sent', async () => {
    program();
    const send = vi.fn(async () => {});
    expect(await runConnectNudges({ now: NOW, send })).toEqual({ events: 0, pushes: 0 });
    expect(statements).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('runConnectNudges — the recipients', () => {
  it('everybody but the creator, in time, reminders on, chat not muted, never a frozen account, list not closed', async () => {
    program({ claimed: [EV7], members: [{ group_id: 7, user_id: 21 }] });
    await runConnectNudges({ now: NOW, send: vi.fn(async () => {}) });
    const { text, params } = recipientsOf();
    expect(params).toEqual([[7]]);
    expect(text).toContain('gm.user_id <> g.owner_id');
    expect(text).toContain('gm.notifications_muted = FALSE');
    expect(text).toContain('u.push_reminders = TRUE');
    expect(text).toContain('u.is_active IS DISTINCT FROM FALSE');
    expect(text).toContain(joinedInTimeSql('gm', 'g'));
    expect(text).toContain('event_connect_dismissals d');
    expect(text).toContain('d.user_id = gm.user_id');
  });

  it('only with somebody left to ask: another participant who is no friend, not in a block, not asked yet', async () => {
    program({ claimed: [EV7], members: [] });
    await runConnectNudges({ now: NOW, send: vi.fn(async () => {}) });
    const { text } = recipientsOf();
    expect(text).toContain('SELECT 1 FROM group_members o');
    expect(text).toContain('o.user_id <> gm.user_id');
    expect(text).toContain(joinedInTimeSql('o', 'g'));
    expect(text).toContain('ou.is_active IS DISTINCT FROM FALSE');
    expect(text).toContain("f.status IN ('accepted', 'blocked')");
    // An open request the recipient SENT is nothing to do; one they RECEIVED is.
    expect(text).toContain("(f.status = 'pending' AND f.requester_id = gm.user_id)");
  });

  it('one send per event, to its recipients, opening the event with ?connect=1', async () => {
    program({ claimed: [EV7, EV8], members: [
      { group_id: 7, user_id: 21 }, { group_id: 7, user_id: 22 }, { group_id: 8, user_id: 23 },
    ] });
    const send = vi.fn(async () => {});
    const out = await runConnectNudges({ now: NOW, send });
    expect(out).toEqual({ events: 2, pushes: 3 });
    expect(connectPushUrl(7)).toBe('/group/7?connect=1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, [21, 22], expect.any(Function), null, '/group/7?connect=1');
    expect(send).toHaveBeenNthCalledWith(2, [23], expect.any(Function), null, '/group/8?connect=1');
    // Tina's sentence, character for character (the space before „!“ is hers).
    expect(send.mock.calls[0][1]('de')).toEqual({
      title: 'Aus Fremden können Freundschaften werden!',
      body: 'Mach den ersten Schritt und schicke eine Freundschaftsanfrage !',
    });
  });

  it('an event nobody has anything to do in is claimed but not sent', async () => {
    program({ claimed: [EV7, EV8], members: [{ group_id: 8, user_id: 23 }] });
    const send = vi.fn(async () => {});
    expect(await runConnectNudges({ now: NOW, send })).toEqual({ events: 2, pushes: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a failing send for one event does not stop the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    program({ claimed: [EV7, EV8], members: [{ group_id: 7, user_id: 21 }, { group_id: 8, user_id: 23 }] });
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('apns down'))
      .mockResolvedValueOnce(undefined);
    expect(await runConnectNudges({ now: NOW, send })).toEqual({ events: 2, pushes: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('re-arms only its OWN stamp when the recipient lookup fails after the claim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    program({ claimed: [EV7, EV8], membersErr: new Error('pool exhausted') });
    const send = vi.fn(async () => {});
    expect(await runConnectNudges({ now: NOW, send })).toEqual({ events: 0, pushes: 0 });
    expect(send).not.toHaveBeenCalled();
    const rearm = statements.find((s) => s.text.includes('SET connect_nudge_sent_for = NULL'));
    expect(rearm.text).toContain('unnest($1::int[], $2::timestamp[]) AS c(id, d)');
    expect(rearm.text).toContain('g.connect_nudge_sent_for = c.d');
    expect(rearm.params).toEqual([[7, 8], ['2027-02-09 19:00:00', '2027-02-09 00:00:00']]);
  });
});

describe('runConnectNudges — the emergency switch', () => {
  it('POST_EVENT_CONNECT=false: no query at all, nothing sent', async () => {
    process.env.POST_EVENT_CONNECT = 'false';
    program({ claimed: [EV7], members: [{ group_id: 7, user_id: 21 }] });
    const send = vi.fn(async () => {});
    expect(await runConnectNudges({ now: NOW, send })).toEqual({ events: 0, pushes: 0 });
    expect(statements).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});
