import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Memories (Tina, 22.10.2026): the „Warst du dabei..“ list (own past events
// still waiting for the caller's photo) and the Friends tab's feed. The SQL
// itself runs in the real-Postgres smoke; here: the rules it must carry, the
// paging clamp and the boot-window fallbacks.

const scenario = { promptRows: [], promptFailFirst: null, friendRows: [], friendFail: null };
const calls = [];

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('hall-of-fame:prompts')) {
        if (scenario.promptFailFirst) {
          const err = scenario.promptFailFirst;
          scenario.promptFailFirst = null;
          throw err;
        }
        return { rows: scenario.promptRows };
      }
      if (sql.includes('hall-of-fame:friends')) {
        if (scenario.friendFail) throw scenario.friendFail;
        return { rows: scenario.friendRows };
      }
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { getMemoryPrompts, getHallOfFameFriends } = await import('../../src/controllers/hallOfFameController.js');

const missing = (rel) => Object.assign(new Error(`relation "${rel}" does not exist`), { code: '42P01' });
const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const run = async (handler, req) => {
  const res = makeRes();
  await handler(req, res);
  return res;
};
const sqlOf = (marker) => calls.filter(c => c.sql.includes(marker));

beforeEach(() => {
  calls.length = 0;
  Object.assign(scenario, { promptRows: [], promptFailFirst: null, friendRows: [], friendFail: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getMemoryPrompts — „Warst du dabei..“', () => {
  it('lists the caller\'s own events of the last three weeks that still lack their photo', async () => {
    scenario.promptRows = [{ id: 4, name: 'Bar-Abend', owner_id: 9 }];
    const res = await run(getMemoryPrompts, { userId: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 4, name: 'Bar-Abend', owner_id: 9 }]);

    const [q] = sqlOf('hall-of-fame:prompts');
    expect(q.params).toEqual([9]);
    // Took part — all four sources, the caller only.
    expect(q.sql).toContain('WHERE gm.user_id = $1');
    expect(q.sql).toContain('FROM hall_of_fame_entries h WHERE h.user_id = $1');
    // A standing past event, within 21 days, Vienna wall-clock.
    expect(q.sql).toContain('g.is_recurring_weekly IS NOT TRUE');
    expect(q.sql).toContain("g.date > (NOW() AT TIME ZONE 'Europe/Vienna') - INTERVAL '21 days'");
    // Not yet shared: no own participant photo; for the owner the moment counts too.
    expect(q.sql).toContain('NOT EXISTS (SELECT 1 FROM event_photos ep WHERE ep.group_id = g.id AND ep.user_id = $1)');
    expect(q.sql).toContain('(g.owner_id IS DISTINCT FROM $1 OR g.moment_photo_url IS NULL)');
    expect(q.sql).toContain('LIMIT 100');
    expect(q.sql).not.toContain('is_private');
  });

  it('answers in the boot window without the tables that are not there yet', async () => {
    scenario.promptFailFirst = missing('event_photos');
    scenario.promptRows = [{ id: 4 }];
    const res = await run(getMemoryPrompts, { userId: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 4 }]);
    const [, retry] = sqlOf('hall-of-fame:prompts');
    expect(retry.sql).not.toContain('hall_of_fame_entries');
    expect(retry.sql).not.toContain('event_photos');
    expect(retry.sql).toContain('g.moment_photo_url IS NULL');
  });

  it('a real SQL error is a 500, not a silent empty list', async () => {
    scenario.promptFailFirst = Object.assign(new Error('boom'), { code: '42P08' });
    const res = await run(getMemoryPrompts, { userId: 9 });
    expect(res.statusCode).toBe(500);
  });
});

describe('getHallOfFameFriends — the Friends tab', () => {
  it('narrows the wall\'s cards to public events of accepted friends, never across a block', async () => {
    const res = await run(getHallOfFameFriends, { userId: 9, query: {} });
    expect(res.statusCode).toBe(200);
    const [q] = sqlOf('hall-of-fame:friends');
    expect(q.params).toEqual([9, 30, 0]);
    expect(q.sql).toContain("WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)");
    expect(q.sql).toContain('LIMIT 500');
    expect(q.sql).toContain('g.id IN (SELECT group_id FROM friends_part)');
    expect(q.sql).toContain('er.reviewer_id IN (SELECT fid FROM my_friends)');
    expect(q.sql).toContain('er.reviewed_user_id IN (SELECT fid FROM my_friends) AND er.was_present');
    expect(q.sql).toContain('g.is_private IS NOT TRUE');
    expect(q.sql).toContain("FROM friendships WHERE status = 'blocked' AND (requester_id = $1 OR addressee_id = $1)");
    // Same cards as the wall, pictures only — no upload entry points here.
    expect(q.sql).toContain('AS is_participant');
    expect(q.sql).toContain('g.did_not_take_place = FALSE');
    expect(q.sql).toContain('OR EXISTS (SELECT 1 FROM event_photos ep WHERE ep.group_id = g.id)');
    expect(q.sql).not.toContain('g.owner_id = $1::int)');
    expect(q.sql).not.toContain("INTERVAL '30 days'");
    expect(q.sql).toContain('ORDER BY g.date DESC, g.id DESC');
  });

  it('clamps paging like the wall', async () => {
    await run(getHallOfFameFriends, { userId: 9, query: { limit: '500', offset: '-4' } });
    expect(sqlOf('hall-of-fame:friends')[0].params).toEqual([9, 60, 0]);
  });

  it('says per card whether the caller may add a photo', async () => {
    scenario.friendRows = [
      { id: 1, is_participant: true, my_photo_count: 0, photo_count: 2 },
      { id: 2, is_participant: false, my_photo_count: 0, photo_count: 2 },
      { id: 3, is_participant: true, my_photo_count: 5, photo_count: 9 },
    ];
    const res = await run(getHallOfFameFriends, { userId: 9, query: {} });
    expect(res.body.map(r => [r.id, r.can_add_photo])).toEqual([[1, true], [2, false], [3, false]]);
  });

  it('is an empty tab in the boot window, a 500 on a real error', async () => {
    scenario.friendFail = missing('hall_of_fame_entries');
    const boot = await run(getHallOfFameFriends, { userId: 9, query: {} });
    expect(boot.statusCode).toBe(200);
    expect(boot.body).toEqual([]);

    scenario.friendFail = new Error('boom');
    const broken = await run(getHallOfFameFriends, { userId: 9, query: {} });
    expect(broken.statusCode).toBe(500);
  });
});
