import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// „Hey, [Community] hat Potenzial! ✨“ — a community without a meetup about a
// week after it was founded (Tina 17.11.2026). The claim SQL is the contract
// (WHICH communities, WHEN, once) and is pinned here; the real-Postgres smoke
// test runs it with an injected clock. Pattern of engagementNudges.test.js.
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

const {
  runCommunityEventNudges, communityNudgeLink,
  COMMUNITY_NUDGE_AFTER_DAYS, COMMUNITY_NUDGE_MAX_AGE_DAYS, COMMUNITY_NUDGE_TYPE,
} = await import('../../src/jobs/communityNudges.js');

const NOW = new Date('2027-06-15T10:00:00Z');   // 12:00 in Vienna
const claimOf = () => statements.find((s) => s.text.includes('INSERT INTO community_event_nudges'));
const bellRows = () => statements.filter((s) => s.text.includes('INSERT INTO notifications'));

const C9 = { id: 9, name: 'Punsch & Rave 2', owner_id: 4, locale: 'de', push_reminders: true };

const program = ({ claimed = [], bellErr = null } = {}) => {
  dbQueryImpl = async (text) => {
    if (text.includes('INSERT INTO community_event_nudges')) return { rows: claimed, rowCount: claimed.length };
    if (text.includes('INSERT INTO notifications')) {
      if (bellErr && text.includes('link')) throw bellErr;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected SQL in test: ${text.slice(0, 80)}`);
  };
};

beforeEach(() => {
  statements.length = 0;
  delete process.env.COMMUNITY_NUDGES;
});
afterEach(() => {
  delete process.env.COMMUNITY_NUDGES;
  vi.restoreAllMocks();
});

describe('runCommunityEventNudges — the claim', () => {
  it('communities only — approved, alive, not deleted; never an official club', async () => {
    program();
    await runCommunityEventNudges({ now: NOW });
    const { text, params } = claimOf();
    expect(params).toEqual([NOW, 100]);
    expect(text).toContain("x.type = 'club'");
    expect(text).toContain("COALESCE(x.club_type, 'community') = 'community'");
    expect(text).toContain("x.approval_status = 'approved'");
    expect(text).toContain('x.is_active = TRUE');
    expect(text).toContain('x.deleted_at IS NULL');
  });

  it('about a week after founding and never an old one: 7 to 30 days, and only 09:00–22:59 Vienna', async () => {
    program();
    await runCommunityEventNudges({ now: NOW });
    const { text } = claimOf();
    expect([COMMUNITY_NUDGE_AFTER_DAYS, COMMUNITY_NUDGE_MAX_AGE_DAYS]).toEqual([7, 30]);
    expect(text).toContain("x.created_at <= $1::timestamptz - INTERVAL '7 days'");
    expect(text).toContain("x.created_at >  $1::timestamptz - INTERVAL '30 days'");
    expect(text).toContain("EXTRACT(HOUR FROM ($1::timestamptz AT TIME ZONE 'Europe/Vienna')) BETWEEN 9 AND 22");
  });

  it('only while it never had an event (a deleted one counts), once per community, never a frozen creator', async () => {
    program();
    await runCommunityEventNudges({ now: NOW });
    const { text } = claimOf();
    // No deleted_at / is_active on the event: one that was deleted still means „had a meetup“.
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM groups e WHERE e.parent_club_id = x.id AND e.type = 'event')");
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM community_event_nudges n WHERE n.club_id = x.id)');
    expect(text).toContain('ON CONFLICT (club_id) DO NOTHING');
    expect(text).toContain('ou.id = x.owner_id AND ou.is_active IS DISTINCT FROM FALSE');
  });

  it('nothing due → nothing written, nothing sent', async () => {
    program();
    const send = vi.fn(async () => {});
    expect(await runCommunityEventNudges({ now: NOW, send })).toEqual({ nudged: 0, pushes: 0 });
    expect(statements).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('runCommunityEventNudges — bell entry and push', () => {
  it('the creator gets a bell entry and a push, both leading to the community with the event form open', async () => {
    program({ claimed: [C9] });
    const send = vi.fn(async () => {});
    expect(await runCommunityEventNudges({ now: NOW, send })).toEqual({ nudged: 1, pushes: 1 });

    expect(COMMUNITY_NUDGE_TYPE).toBe('community_first_event');
    expect(communityNudgeLink(9)).toBe('/club/9?newEvent=1');
    const [bell] = bellRows();
    expect(bell.text).toContain('(user_id, type, title, message, reference_type, reference_id, link)');
    // Tina's text, split into title and body.
    expect(bell.params).toEqual([
      4, 'community_first_event', 'Hey, Punsch & Rave 2 hat Potenzial! ✨',
      'Jetzt fehlt nur noch das erste Treffen. Leg los!', 'club', 9, '/club/9?newEvent=1',
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([4], expect.any(Function), null, '/club/9?newEvent=1');
    expect(send.mock.calls[0][1]('de')).toEqual({
      title: 'Hey, Punsch & Rave 2 hat Potenzial! ✨', body: 'Jetzt fehlt nur noch das erste Treffen. Leg los!',
    });
  });

  it('the bell entry is in the creator\'s own language', async () => {
    program({ claimed: [{ ...C9, locale: 'fr' }] });
    await runCommunityEventNudges({ now: NOW, send: vi.fn(async () => {}) });
    expect(bellRows()[0].params[2]).toBe('Hey, Punsch & Rave 2 a du potentiel ! ✨');
  });

  it('reminders switched off: the bell entry stays, no push', async () => {
    program({ claimed: [{ ...C9, push_reminders: false }, { ...C9, id: 10, owner_id: 5 }] });
    const send = vi.fn(async () => {});
    expect(await runCommunityEventNudges({ now: NOW, send })).toEqual({ nudged: 2, pushes: 1 });
    expect(bellRows()).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual([5]);
  });

  it('notifications.link missing in the boot window (42703): the row goes out without its link', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    program({ claimed: [C9], bellErr: Object.assign(new Error('column "link" does not exist'), { code: '42703' }) });
    const send = vi.fn(async () => {});
    expect(await runCommunityEventNudges({ now: NOW, send })).toEqual({ nudged: 1, pushes: 1 });
    const rows = bellRows();
    expect(rows).toHaveLength(2);
    expect(rows[1].text).not.toContain('link');
    expect(rows[1].params).toEqual([
      4, 'community_first_event', 'Hey, Punsch & Rave 2 hat Potenzial! ✨',
      'Jetzt fehlt nur noch das erste Treffen. Leg los!', 'club', 9,
    ]);
  });

  it('a failing bell row or push for one community does not stop the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    program({ claimed: [C9, { ...C9, id: 10, owner_id: 5 }], bellErr: new Error('deadlock detected') });
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('apns down'))
      .mockResolvedValueOnce(undefined);
    expect(await runCommunityEventNudges({ now: NOW, send })).toEqual({ nudged: 2, pushes: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('runCommunityEventNudges — the emergency switch', () => {
  it('COMMUNITY_NUDGES=false: no query at all, nothing sent', async () => {
    process.env.COMMUNITY_NUDGES = 'false';
    program({ claimed: [C9] });
    const send = vi.fn(async () => {});
    expect(await runCommunityEventNudges({ now: NOW, send })).toEqual({ nudged: 0, pushes: 0 });
    expect(statements).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});
