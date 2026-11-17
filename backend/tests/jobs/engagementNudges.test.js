import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
// The photo pushes of jobs/engagementNudges.js (S2, Tina 16.11.2026): the
// claim SQL is the contract — WHEN a push may go out — so it is pinned here;
// the real-Postgres smoke test runs the same claims with an injected clock.
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
vi.mock('../../src/controllers/pushController.js', () => ({ sendPushToUsers: vi.fn(async () => {}) }));
vi.mock('../../src/utils/systemMessage.js', async (importOriginal) => ({
  SYSTEM_TEXTS: (await importOriginal()).SYSTEM_TEXTS,
  postSystemMessage: vi.fn(async () => {}),
}));

const {
  runLivePhotoPrompts, runMomentPrompts, pickLiveVariant, LIVE_PHOTO_VARIANTS, LIVE_PUSH_OPTS,
  LIVE_PUSH_FROM_MIN, LIVE_PUSH_UNTIL_MIN,
} = await import('../../src/jobs/engagementNudges.js');

const NOW = new Date('2027-03-10T19:00:00Z');
const claimOf = (col) => statements.find((s) => s.text.includes(`UPDATE groups g SET ${col}`));

// The claim hands back `claimed`, the recipient SELECT (FROM group_members gm)
// `members`, or throws `membersErr`; a re-arm UPDATE is answered empty.
const program = ({ claimed = [], members = [], membersErr = null } = {}) => {
  dbQueryImpl = async (text) => {
    if (text.includes('UPDATE groups g SET live_prompt_sent_for = g.date')) return { rows: claimed, rowCount: claimed.length };
    if (text.includes('UPDATE groups g SET moment_prompt_sent_at')) return { rows: claimed, rowCount: claimed.length };
    if (text.includes('FROM group_members gm')) {
      if (membersErr) throw membersErr;
      return { rows: members };
    }
    if (text.includes('SET live_prompt_sent_for = NULL') || text.includes('SET moment_prompt_sent_at = NULL')) return { rows: [] };
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  };
};

beforeEach(() => {
  statements.length = 0;
});

describe('pickLiveVariant', () => {
  it('cycles through the three lines by event id — stable per event', () => {
    expect(LIVE_PHOTO_VARIANTS).toBe(3);
    expect([0, 1, 2, 3, 4, 5].map(pickLiveVariant)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(pickLiveVariant(527)).toBe(pickLiveVariant(527));
    expect(pickLiveVariant('8')).toBe(2);
  });
});

describe('runLivePhotoPrompts (push WHILE the event runs)', () => {
  it('claims timed events only, from start+120 to start+180 min, with someone besides the creator, by day, re-armed by a move', async () => {
    // Tina 16.11.2026: „lieber nach 2h" — the first build said start+60.
    expect([LIVE_PUSH_FROM_MIN, LIVE_PUSH_UNTIL_MIN]).toEqual([120, 180]);
    program();
    await runLivePhotoPrompts({ now: NOW, send: vi.fn() });
    const claim = claimOf('live_prompt_sent_for');
    expect(claim.params).toEqual([NOW, 200]);
    const sql = claim.text;
    // the marker copies the date it was sent for, like the reminder markers
    expect(sql).toContain('SET live_prompt_sent_for = g.date');
    expect(sql).toContain('(x.live_prompt_sent_for IS NULL OR x.live_prompt_sent_for <> x.date)');
    expect(sql).toContain("x.date::time <> '00:00'");
    expect(sql).toContain('x.members_count > 1');
    expect(sql).toMatch(/AT TIME ZONE 'Europe\/Vienna'\) \+ INTERVAL '120 minutes'\s+<= \$1::timestamptz/);
    expect(sql).toMatch(/AT TIME ZONE 'Europe\/Vienna'\) \+ INTERVAL '180 minutes' >\s+\$1::timestamptz/);
    expect(sql).not.toContain("INTERVAL '60 minutes'");
    expect(sql).toContain('BETWEEN 9 AND 22');
    expect(sql).toContain('x.is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain('FOR UPDATE OF x SKIP LOCKED');
    // nothing claimed → no recipient lookup at all
    expect(statements).toHaveLength(1);
  });

  it('one line per event, to its recipients, urgent and gone after an hour', async () => {
    const send = vi.fn(async () => {});
    program({
      claimed: [
        { id: 7, name: 'Bowling', claimed_date: '2027-03-10 19:00:00' },
        { id: 9, name: 'Quiz', claimed_date: '2027-03-10 18:30:00' },
      ],
      members: [{ group_id: 7, user_id: 1 }, { group_id: 7, user_id: 2 }, { group_id: 9, user_id: 3 }],
    });
    expect(await runLivePhotoPrompts({ now: NOW, send })).toEqual({ events: 2, pushes: 3 });

    const recipients = statements.find((s) => s.text.includes('FROM group_members gm'));
    expect(recipients.params).toEqual([[7, 9]]);
    expect(recipients.text).toContain('u.push_reminders = TRUE');
    expect(recipients.text).toContain('gm.notifications_muted = FALSE');
    expect(recipients.text).toContain('FROM event_photos ep');

    expect(send).toHaveBeenCalledTimes(2);
    const [ids, builder, body, url, opts] = send.mock.calls.find((c) => c[0].includes(1));
    expect(ids).toEqual([1, 2]);
    expect(body).toBeNull();
    expect(url).toBe('/explore?share=1');
    expect(opts).toEqual({ urgency: 'high', ttl: 3600 });
    expect(opts).toBe(LIVE_PUSH_OPTS);
    // 7 % 3 = 1 → Tina's second line; 9 % 3 = 0 → her first
    expect(builder('de').title).toBe('Na, wie läuft’s bei Bowling? 📸');
    expect(send.mock.calls.find((c) => c[0].includes(3))[1]('de').title).toBe('Wie ist’s bei Quiz?');
  });

  it('a failed recipient lookup re-arms exactly its own stamp and sends nothing', async () => {
    const send = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    program({ claimed: [{ id: 7, name: 'Bowling', claimed_date: '2027-03-10 19:00:00' }], membersErr: new Error('boom') });
    expect(await runLivePhotoPrompts({ now: NOW, send })).toEqual({ events: 0, pushes: 0 });
    const rearm = statements.find((s) => s.text.includes('SET live_prompt_sent_for = NULL'));
    expect(rearm.text).toContain('g.live_prompt_sent_for = c.d');
    expect(rearm.params).toEqual([[7], ['2027-03-10 19:00:00']]);
    expect(send).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('runMomentPrompts (the memory push the day after)', () => {
  it('claims D+1 from 12:00 until midnight — timed and date-only alike, never the same day', async () => {
    program();
    await runMomentPrompts({ now: NOW, send: vi.fn() });
    const sql = claimOf('moment_prompt_sent_at').text;
    expect(sql).toContain("((x.date::date + 1)::timestamp + TIME '12:00') AT TIME ZONE 'Europe/Vienna' <= $1::timestamptz");
    expect(sql).toContain("((x.date::date + 2)::timestamp) AT TIME ZONE 'Europe/Vienna' > $1::timestamptz");
    expect(sql).toContain('x.moment_prompt_sent_at IS NULL');
    expect(sql).toContain('BETWEEN 9 AND 22');
    expect(sql).not.toContain("INTERVAL '3 hours'");
    expect(sql).not.toContain("TIME '21:00'");
  });

  it('sends the memory title to the same recipients as the live push, without the urgent options', async () => {
    const send = vi.fn(async () => {});
    program({
      claimed: [{ id: 4, name: 'Picknick', owner_id: 1, has_moment: false }],
      members: [{ group_id: 4, user_id: 1 }, { group_id: 4, user_id: 5 }],
    });
    expect(await runMomentPrompts({ now: NOW, send })).toEqual({ events: 1, pushes: 2 });
    const [ids, builder, , url, opts] = send.mock.calls[0];
    expect(ids).toEqual([1, 5]);
    expect(builder('de').title).toBe('📷 Deine Memory von Picknick');
    expect(url).toBe('/explore?share=1');
    expect(opts).toBeUndefined();
  });
});
