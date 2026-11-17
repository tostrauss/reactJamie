import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// The card „Hey, [Community] hat Potenzial! ✨“ (Tina 17.11.2026): which of
// the caller's communities show it, and the X. The SQL is pinned here; the
// real-Postgres smoke test runs it for real.
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

const { getMyCommunityNudges, dismissCommunityNudge, CARD_VISIBLE_DAYS } =
  await import('../../src/controllers/communityNudgeController.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const ME = 4;

beforeEach(() => {
  statements.length = 0;
  dbQueryImpl = async () => ({ rows: [], rowCount: 0 });
  delete process.env.COMMUNITY_NUDGES;
});
afterEach(() => {
  delete process.env.COMMUNITY_NUDGES;
  vi.restoreAllMocks();
});

describe('getMyCommunityNudges', () => {
  it('the creator\'s own communities that fell due, were not closed and still have no event — newest first', async () => {
    const rows = [{ id: 9, name: 'Punsch & Rave 2', image_url: 'https://x/cover.webp', due_at: '2026-11-16T10:00:00.000Z' }];
    dbQueryImpl = async () => ({ rows });
    const res = makeRes();
    await getMyCommunityNudges({ userId: ME }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(rows);
    const { text, params } = statements[0];
    expect(params).toEqual([ME]);
    expect(text).toContain('g.owner_id = $1');
    expect(text).toContain('n.dismissed_at IS NULL');
    expect(CARD_VISIBLE_DAYS).toBe(14);
    expect(text).toContain("n.due_at > NOW() - INTERVAL '14 days'");
    // Still a live community…
    expect(text).toContain("g.type = 'club'");
    expect(text).toContain("COALESCE(g.club_type, 'community') = 'community'");
    expect(text).toContain("g.approval_status = 'approved'");
    expect(text).toContain('g.is_active = TRUE');
    expect(text).toContain('g.deleted_at IS NULL');
    // …that still has no event (a first one, created anywhere, ends the card).
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM groups e WHERE e.parent_club_id = g.id AND e.type = 'event')");
    expect(text).toContain('ORDER BY n.due_at DESC');
    expect(text).toContain('LIMIT 3');
  });

  it('a database error is 200 [] — never a 5xx (api.js retries GETs)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbQueryImpl = async () => { throw new Error('connection reset'); };
    const res = makeRes();
    await getMyCommunityNudges({ userId: ME }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([]);
    expect(log).toHaveBeenCalled();
  });

  it('the table missing in the boot window (42P01) is 200 [] — quietly', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbQueryImpl = async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); };
    const res = makeRes();
    await getMyCommunityNudges({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('COMMUNITY_NUDGES=false: 200 [] without a single query', async () => {
    process.env.COMMUNITY_NUDGES = 'false';
    const res = makeRes();
    await getMyCommunityNudges({ userId: ME }, res);
    expect(res.json).toHaveBeenCalledWith([]);
    expect(statements).toHaveLength(0);
  });
});

describe('dismissCommunityNudge (the X)', () => {
  it.each([undefined, 'abc', '0', '-3', '1.5', '9x', '99999999999'])('clubId %p → 400 before any SQL', async (clubId) => {
    const res = makeRes();
    await dismissCommunityNudge({ userId: ME, params: { clubId } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(statements).toHaveLength(0);
  });

  it('closes the creator\'s own row only', async () => {
    const res = makeRes();
    await dismissCommunityNudge({ userId: ME, params: { clubId: '9' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    const { text, params } = statements[0];
    expect(params).toEqual([9, ME]);
    expect(text).toContain('UPDATE community_event_nudges n SET dismissed_at = NOW()');
    expect(text).toContain('n.club_id = $1 AND g.id = n.club_id AND g.owner_id = $2 AND n.dismissed_at IS NULL');
  });

  it('a foreign community, no row, closed before: nothing changes and the answer is the same 200', async () => {
    dbQueryImpl = async () => ({ rows: [], rowCount: 0 });
    const res = makeRes();
    await dismissCommunityNudge({ userId: ME, params: { clubId: '12' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('the table missing in the boot window → 503 with a code and a sentence old bundles can show', async () => {
    dbQueryImpl = async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); };
    const res = makeRes();
    await dismissCommunityNudge({ userId: ME, params: { clubId: '9' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'COMMUNITY_NUDGE_UNAVAILABLE', error: expect.any(String) });
  });
});
