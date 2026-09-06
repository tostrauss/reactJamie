import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// Programmable fake db + query recorder (same shape as entityLifecycle.test.js):
// every query is recorded into `statements` and delegated to the per-test
// `dbQueryImpl`, which dispatches on SQL substrings.
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

// Sender is mocked through a wrapper arrow so the per-test spy survives the
// hoisted factory. pushLocale.js is deliberately NOT mocked — the builder the
// module hands to the sender is asserted against the real texts.
const pushUsersMock = vi.fn(async () => {});
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUsers: (...a) => pushUsersMock(...a),
  sendPushToUser: vi.fn(),
}));

const { notifyFriendsOfActivity, FRIEND_PUSH_DAILY_CAP } =
  await import('../../src/utils/friendActivity.js');

// ── Scenario ──────────────────────────────────────────────────────────────
const VISIBILITY_SQL = 'u.name AS actor_name';
const CLAIM_SQL = 'INSERT INTO friend_push_state';

let visibilityRows;
let claimedRows;

beforeEach(() => {
  statements.length = 0;
  pushUsersMock.mockClear();
  visibilityRows = [{ id: 42, name: 'Bar Abend', actor_name: 'Lisa' }];
  claimedRows = [{ user_id: 8 }, { user_id: 9 }];
  dbQueryImpl = async (text) => {
    if (text.includes(VISIBILITY_SQL)) return { rows: visibilityRows };
    if (text.includes(CLAIM_SQL)) return { rows: claimedRows };
    throw new Error(`unexpected SQL in friendActivity: ${text.slice(0, 80)}`);
  };
});

// groupId arrives as a STRING from req.params in the real call sites.
const call = (overrides = {}) =>
  notifyFriendsOfActivity({ actorId: 7, groupId: '42', kind: 'joined', ...overrides });

const lastBuilder = () => pushUsersMock.mock.calls[0][1];

// ── Tests ─────────────────────────────────────────────────────────────────
describe('notifyFriendsOfActivity — visibility gate', () => {
  it('returns 0, issues exactly ONE statement and sends nothing when the group is not public', async () => {
    visibilityRows = [];
    const n = await call();
    expect(n).toBe(0);
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toContain(VISIBILITY_SQL);
    expect(pushUsersMock).not.toHaveBeenCalled();
  });

  it('mirrors the public feed gate incl. the LIVE parent club; params [groupId, actorId] passed through as given', async () => {
    visibilityRows = [];
    await call();
    const { text, params } = statements[0];
    for (const fragment of [
      "g.type IN ('group', 'event')",
      'g.is_active = TRUE',
      'g.deleted_at IS NULL',
      'g.is_private IS NOT TRUE',
      'g.parent_club_id IS NULL OR EXISTS',
      'c.id = g.parent_club_id',
      "c.type = 'club'",
      'c.is_private IS NOT TRUE',
      "c.approval_status = 'approved'",
    ]) {
      expect(text).toContain(fragment);
    }
    // groupId stays the string from req.params — no coercion on the way to pg.
    expect(params).toEqual(['42', 7]);
  });
});

describe('notifyFriendsOfActivity — send path', () => {
  it('joined: pushes the claimed friends with a builder for friendJoined and the ?via=friend URL', async () => {
    const n = await call({ kind: 'joined' });
    expect(n).toBe(2);
    expect(pushUsersMock).toHaveBeenCalledTimes(1);
    expect(pushUsersMock).toHaveBeenCalledWith(
      [8, 9], expect.any(Function), null, '/group/42?via=friend'
    );
    const builder = lastBuilder();
    expect(builder('de')).toEqual({
      title: 'Lisa ist dabei',
      body: 'Lisa ist "Bar Abend" beigetreten – auch dabei?',
    });
    expect(builder('en').title).toBe('Lisa is in');
  });

  it('created: same rows, builder for friendCreated', async () => {
    const n = await call({ kind: 'created' });
    expect(n).toBe(2);
    expect(pushUsersMock).toHaveBeenCalledTimes(1);
    const builder = lastBuilder();
    expect(builder('de')).toEqual({
      title: 'Neu von Lisa',
      body: 'Lisa hat "Bar Abend" erstellt – bist du dabei?',
    });
    expect(builder('it').title).toBe('Novità da Lisa');
  });

  it('claims the daily cap in ONE statement: accepted friends, opted in, not yet members, budget left', async () => {
    await call();
    expect(statements).toHaveLength(2);
    const { text, params } = statements[1];
    for (const fragment of [
      "f.status = 'accepted'",
      'CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END',
      'u.push_friends = TRUE',
      'NOT EXISTS',
      'gm.group_id = $2',
      CLAIM_SQL,
      'ON CONFLICT (user_id) DO UPDATE',
      'friend_push_state.sent_count < $3',
      "AT TIME ZONE 'Europe/Vienna'",
      'RETURNING user_id',
    ]) {
      expect(text).toContain(fragment);
    }
    expect(params).toEqual([7, '42', FRIEND_PUSH_DAILY_CAP]);
    expect(params[2]).toBe(2);
  });

  it('stamps BEFORE sending — the claim statement is already recorded when the sender runs', async () => {
    let statementsAtSend = -1;
    pushUsersMock.mockImplementationOnce(async () => {
      statementsAtSend = statements.length;
    });
    await call();
    expect(statementsAtSend).toBe(2);
    expect(statements[1].text).toContain(CLAIM_SQL);
  });

  it('returns 0 and sends nothing when every friend is capped or nobody is eligible (two statements, no push)', async () => {
    claimedRows = [];
    const n = await call();
    expect(n).toBe(0);
    expect(statements).toHaveLength(2);
    expect(pushUsersMock).not.toHaveBeenCalled();
  });

  it('falls back to the localized "Someone" when the actor has no name', async () => {
    visibilityRows = [{ id: 42, name: 'Bar Abend', actor_name: null }];
    await call();
    const builder = lastBuilder();
    expect(builder('de').title).toBe('Jemand ist dabei');
    expect(builder('en').title).toBe('Someone is in');
    expect(builder('fr').body).toContain('Quelqu’un');
  });
});

describe('FRIEND_PUSH_DAILY_CAP', () => {
  it('is exported and equals 2 per recipient per local day', () => {
    expect(FRIEND_PUSH_DAILY_CAP).toBe(2);
  });
});
