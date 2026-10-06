import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Record every statement the controller fires + its params. Tests then
// inspect the recorded INSERT to prove non-members were filtered out.
const txnStatements = [];

const memberSet = new Set(); // user_ids that ARE in the group
// What the reviewer-membership query says about the event (B2 write gate):
// undefined = an old row shape without the column (today's behaviour).
const scenario = { countable: undefined, dayOver: undefined, tierFail: false };
const outerQueries = [];

vi.mock('../../src/config/database.js', () => {
  const fakeClient = {
    query: vi.fn(async (text, params) => {
      txnStatements.push({ text, params });
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) return {};
      // Sentinel insert — always succeeds with ON CONFLICT DO NOTHING shape
      if (text.includes('INSERT INTO event_reviews') && text.includes("$2, FALSE")) {
        return { rowCount: 1, rows: [] };
      }
      // Membership lookup — return only the user_ids that are in memberSet
      if (text.includes('SELECT gm.user_id FROM group_members gm')) {
        const candidates = params[1]; // int[]
        const rows = candidates.filter(id => memberSet.has(id)).map(id => ({ user_id: id }));
        return { rowCount: rows.length, rows };
      }
      // Bulk insert of reviews
      if (text.includes('INSERT INTO event_reviews') && text.includes('VALUES ($1, $2, $3, $4)')) {
        return { rowCount: 1, rows: [] };
      }
      // Bulk insert with multiple rows
      if (text.includes('INSERT INTO event_reviews') && text.includes('VALUES ')) {
        return { rowCount: params.length / 4, rows: [] };
      }
      // trusted_count UPDATE
      if (text.includes('UPDATE users u')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(async (text, params) => {
        outerQueries.push({ text, params });
        if (text.includes('attendance-tiers')) {
          if (scenario.tierFail) throw new Error('connection reset');
          return { rows: [] };
        }
        // Reviewer membership + event date (joins groups). Return a date 24h in
        // the past so submitReview's "event must have ended" guard passes.
        if (text.includes('FROM group_members gm') && text.includes('JOIN groups g')) {
          return { rows: [{ date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            countable: scenario.countable, day_over: scenario.dayOver }] };
        }
        // group_members membership check for the REVIEWER (outside the txn)
        if (text.includes('SELECT 1 FROM group_members')) return { rows: [{ '?column?': 1 }] };
        // Duplicate-submission check
        if (text.includes('SELECT 1 FROM event_reviews')) return { rows: [] };
        return { rows: [] };
      }),
      pool: { connect: vi.fn(async () => fakeClient) },
    },
  };
});

vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const reviewMod = await import('../../src/controllers/reviewController.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  txnStatements.length = 0;
  outerQueries.length = 0;
  memberSet.clear();
  scenario.countable = undefined;
  scenario.dayOver = undefined;
  scenario.tierFail = false;
});

// ── Abzeichen-Stufen (B2, 06.10.2026) ────────────────────────────────────
// Prompts, writes and the badge count share ONE definition of "an event whose
// answers can count", so the app never asks about — or records ticks for — an
// event that can never count (cancelled, deleted, „nicht stattgefunden“,
// weekly series, club events).
describe('submitReview write gate (non-countable events)', () => {
  it('records ONLY the sentinel and answers 2xx {counted:false} — no ticks, no seal recompute', async () => {
    scenario.countable = false;
    memberSet.add(2);
    const res = makeRes();
    await reviewMod.submitReview({ userId: 1, body: { group_id: 10, attendances: [{ user_id: 2, was_present: true }] } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, counted: false });
    const texts = txnStatements.map((x) => x.text);
    expect(texts.some((t) => t.includes('INSERT INTO event_reviews') && t.includes('$2, FALSE'))).toBe(true);
    expect(texts.some((t) => t.includes('DELETE FROM event_review_dismissals'))).toBe(true);
    expect(texts.some((t) => t.includes('VALUES ($1, $2, $3, $4)'))).toBe(false);
    expect(texts.some((t) => t.includes('UPDATE users u'))).toBe(false);
  });

  it('a countable event still records ticks and says so', async () => {
    scenario.countable = true;
    memberSet.add(2);
    const res = makeRes();
    await reviewMod.submitReview({ userId: 1, body: { group_id: 10, attendances: [{ user_id: 2, was_present: true }] } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, counted: true });
    expect(txnStatements.some((x) => x.text.includes('VALUES ($1, $2, $3, $4)'))).toBe(true);
  });

  it('the reviewer gate: a member by the end of the event day, round still open', async () => {
    scenario.countable = true;
    await reviewMod.submitReview({ userId: 1, body: { group_id: 10, attendances: [] } }, makeRes());
    const gate = outerQueries.find((q) => q.text.includes('AS countable')).text;
    expect(gate).toContain('gm.joined_at');
    expect(gate).toContain('rr.created_at');
    expect(gate).toContain('AS day_over');
  });

  it('day-based like the prompts: not before the event day is over (no 06:00 vote ON the day)', async () => {
    scenario.countable = true;
    scenario.dayOver = false;
    memberSet.add(2);
    const res = makeRes();
    await reviewMod.submitReview({ userId: 1, body: { group_id: 10, attendances: [{ user_id: 2, was_present: true }] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(txnStatements).toHaveLength(0);
  });

  it('the people reviewed: in time, and never across a block (either direction)', async () => {
    scenario.countable = true;
    memberSet.add(2);
    await reviewMod.submitReview({ userId: 1, body: { group_id: 10, attendances: [{ user_id: 2, was_present: false }] } }, makeRes());
    const check = txnStatements.find((x) => x.text.includes('SELECT gm.user_id FROM group_members gm'));
    expect(check.text).toContain('gm.joined_at');
    expect(check.text).toContain("status = 'blocked'");
    expect(check.text).toMatch(/requester_id = \$3 OR addressee_id = \$3/);
    expect(check.params).toEqual([10, [2], 1]);
  });

  it.each(['abc', 1.5, -1, 0])('group_id %p → 400 before any SQL (was 22P02 → 500)', async (gid) => {
    const res = makeRes();
    await reviewMod.submitReview({ userId: 1, body: { group_id: gid, attendances: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(outerQueries).toHaveLength(0);
  });
});

describe('review prompts only ask about events that can count', () => {
  it('getPendingReviews excludes cancelled and deleted events (and keeps the rest)', async () => {
    await reviewMod.getPendingReviews({ userId: 1 }, makeRes());
    const sql = outerQueries[0].text;
    expect(sql).toContain('is_active IS NOT FALSE');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('did_not_take_place IS NOT TRUE');
    expect(sql).toContain('is_recurring_weekly IS NOT TRUE');
    expect(sql).toContain("INTERVAL '14 days'");
  });

  it('getPendingReviews: only members by the end of the event day, nobody across a block, round still open', async () => {
    await reviewMod.getPendingReviews({ userId: 1 }, makeRes());
    const sql = outerQueries[0].text;
    expect(sql).toContain('gm.joined_at');
    expect(sql).toContain('all_gm.joined_at');
    expect(sql).toMatch(/all_gm\.user_id NOT IN \(SELECT CASE WHEN requester_id = \$1/);
    expect(sql).toContain('rr.created_at');
  });

  it('getReviewForGroup applies the same rule to the manual re-open', async () => {
    await reviewMod.getReviewForGroup({ userId: 1, params: { groupId: '10' } }, makeRes());
    const sql = outerQueries[0].text;
    expect(sql).toContain('did_not_take_place IS NOT TRUE');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('all_gm.joined_at');
    expect(sql).toContain("status = 'blocked'");
    expect(sql).toContain('rr.created_at'); // a closed round is final — no re-open
  });
});

describe('getMyAttendance (own Abzeichen numbers)', () => {
  it('answers zeros + the first step when nothing is confirmed yet', async () => {
    const res = makeRes();
    await reviewMod.getMyAttendance({ userId: 1 }, res);
    expect(res.json).toHaveBeenCalledWith({
      available: true, tier: 0, confirmed_events: 0, confirmers: 0,
      next: { tier: 1, events_missing: 5, confirmers_missing: 2 },
      window_days: 14,
    });
  });

  it('a failed lookup is 200 {available:false} — never a 5xx (api.js retries those)', async () => {
    scenario.tierFail = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await reviewMod.getMyAttendance({ userId: 1 }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ available: false });
    err.mockRestore();
  });
});

describe('submitReview IDOR mitigation', () => {
  it('drops attendance entries for users who were not in the group', async () => {
    // The group has members 2, 3 — reviewer 1 tries to credit user 9
    // (a non-member) with "was_present". The server must filter 9 out.
    memberSet.add(2);
    memberSet.add(3);
    // user 9 is NOT in memberSet

    const req = {
      userId: 1,
      body: {
        group_id: 100,
        attendances: [
          { user_id: 2, was_present: true },
          { user_id: 3, was_present: true },
          { user_id: 9, was_present: true }, // fake member — must be dropped
        ],
      },
    };
    const res = makeRes();
    await reviewMod.submitReview(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // The bulk INSERT params should reference users 2 and 3 ONLY.
    // Each row produces 4 params: [group_id, reviewer_id, reviewed_user_id, was_present]
    const bulkInsert = txnStatements.find(s =>
      s.text.includes('INSERT INTO event_reviews') &&
      s.text.includes('VALUES ') &&
      !s.text.includes("$2, FALSE")
    );
    expect(bulkInsert).toBeDefined();
    const reviewedIds = [];
    for (let i = 0; i < bulkInsert.params.length; i += 4) {
      reviewedIds.push(bulkInsert.params[i + 2]);
    }
    expect(reviewedIds).toEqual(expect.arrayContaining([2, 3]));
    expect(reviewedIds).not.toContain(9);
  });

  it('drops the attempt entirely when ALL attendances are non-members', async () => {
    // No real members — reviewer claims 5, 6, 7 attended. All must drop.
    const req = {
      userId: 1,
      body: {
        group_id: 100,
        attendances: [
          { user_id: 5, was_present: true },
          { user_id: 6, was_present: true },
          { user_id: 7, was_present: true },
        ],
      },
    };
    const res = makeRes();
    await reviewMod.submitReview(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // Only the sentinel row should have been inserted, no bulk insert
    const bulkInsert = txnStatements.find(s =>
      s.text.includes('INSERT INTO event_reviews') &&
      s.text.includes('VALUES ') &&
      !s.text.includes("$2, FALSE")
    );
    expect(bulkInsert).toBeUndefined();
  });

  it('ignores attendances with non-integer or non-boolean fields (defense in depth)', async () => {
    memberSet.add(2);
    const req = {
      userId: 1,
      body: {
        group_id: 100,
        attendances: [
          { user_id: 2, was_present: true },
          { user_id: 'evil', was_present: true },
          { user_id: 2.5, was_present: true },
          { user_id: 3, was_present: 'maybe' },
          null,
          { },
        ],
      },
    };
    const res = makeRes();
    await reviewMod.submitReview(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const bulkInsert = txnStatements.find(s =>
      s.text.includes('INSERT INTO event_reviews') &&
      s.text.includes('VALUES ') &&
      !s.text.includes("$2, FALSE")
    );
    expect(bulkInsert).toBeDefined();
    // Only user 2 with the boolean true survives the type-filter + member-filter
    const reviewedIds = [];
    for (let i = 0; i < bulkInsert.params.length; i += 4) {
      reviewedIds.push(bulkInsert.params[i + 2]);
    }
    expect(reviewedIds).toEqual([2]);
  });
});
