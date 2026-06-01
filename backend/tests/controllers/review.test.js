import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Record every statement the controller fires + its params. Tests then
// inspect the recorded INSERT to prove non-members were filtered out.
const txnStatements = [];

const memberSet = new Set(); // user_ids that ARE in the group

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
      if (text.includes('SELECT user_id FROM group_members WHERE group_id')) {
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
      query: vi.fn(async (text /*, params */) => {
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
  memberSet.clear();
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
