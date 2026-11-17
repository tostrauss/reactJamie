import { describe, it, expect, vi } from 'vitest';
import { attachJoinRequestState } from '../../src/utils/clubEventJoinState.js';
import { JOIN_ATTEMPT_COLS } from '../../src/utils/joinAttempts.js';

// The join button of a club's event list (audit ziel-d-privat-events, V-14):
// per event whether joining goes by request, the caller's own request and
// whether they used up their attempts. db is injected.
const dbWith = (rows) => ({ query: vi.fn(async () => ({ rows })) });
const ev = (id, over = {}) => ({ id, name: `E${id}`, is_private: false, ...over });

describe('attachJoinRequestState', () => {
  it('a PUBLIC club with a private event: joining goes by request — one batched query for the list', async () => {
    const db = dbWith([{ group_id: 2, status: 'pending', rejected_count: 0 }]);
    const events = [ev(1), ev(2, { is_private: true }), ev(3, { is_private: true })];
    const out = await attachJoinRequestState(db, { userId: 7, clubIsPrivate: false, events });
    expect(out).toBe(events);                               // in place, the same array
    expect(db.query).toHaveBeenCalledTimes(1);
    const [text, params] = db.query.mock.calls[0];
    expect(params).toEqual([7, [1, 2, 3]]);
    expect(text).toContain(`SELECT group_id, ${JOIN_ATTEMPT_COLS} FROM group_join_requests`);
    expect(text).toContain('user_id = $1 AND group_id = ANY($2::int[])');
    expect(events.map((e) => [e.id, e.joins_by_request, e.join_request_status, e.join_request_blocked])).toEqual([
      [1, false, null, false],            // an open event: straight in
      [2, true, 'pending', false],        // asked, waiting
      [3, true, null, false],             // not asked yet
    ]);
  });

  it('a PRIVATE club: its events inherit is_private, members join directly — never by request, never blocked', async () => {
    const db = dbWith([{ group_id: 2, status: 'rejected', rejected_count: 2 }]);
    const events = [ev(2, { is_private: true })];
    await attachJoinRequestState(db, { userId: 7, clubIsPrivate: true, events });
    expect(events[0]).toMatchObject({ joins_by_request: false, join_request_status: 'rejected', join_request_blocked: false });
  });

  it('two rejections: blocked — one rejection is not', async () => {
    const db = dbWith([
      { group_id: 2, status: 'rejected', rejected_count: 2 },
      { group_id: 3, status: 'rejected', rejected_count: 1 },
    ]);
    const events = [ev(2, { is_private: true }), ev(3, { is_private: true })];
    await attachJoinRequestState(db, { userId: 7, clubIsPrivate: false, events });
    expect(events.map((e) => e.join_request_blocked)).toEqual([true, false]);
    expect(events.map((e) => e.join_request_status)).toEqual(['rejected', 'rejected']);
  });

  it('no row: status null, nothing blocked', async () => {
    const events = [ev(2, { is_private: true })];
    await attachJoinRequestState(dbWith([]), { userId: 7, clubIsPrivate: false, events });
    expect(events[0]).toMatchObject({ joins_by_request: true, join_request_status: null, join_request_blocked: false });
  });

  it('an unknown club privacy (undefined / null) never claims „by request“', async () => {
    for (const clubIsPrivate of [undefined, null]) {
      const events = [ev(2, { is_private: true })];
      await attachJoinRequestState(dbWith([]), { userId: 7, clubIsPrivate, events });
      expect(events[0].joins_by_request).toBe(false);
      expect(events[0].join_request_blocked).toBe(false);
    }
  });

  it('no caller, or no events: no query, the list comes back untouched', async () => {
    const db = dbWith([]);
    const events = [ev(1, { is_private: true })];
    expect(await attachJoinRequestState(db, { userId: undefined, clubIsPrivate: false, events })).toBe(events);
    expect(await attachJoinRequestState(db, { userId: 7, clubIsPrivate: false, events: [] })).toEqual([]);
    expect(await attachJoinRequestState(db, { userId: 7, clubIsPrivate: false, events: null })).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(events[0]).toEqual(ev(1, { is_private: true }));
  });

  it('a database error is thrown — the caller serves the list without the fields', async () => {
    const db = { query: vi.fn(async () => { throw new Error('boom'); }) };
    const events = [ev(1)];
    await expect(attachJoinRequestState(db, { userId: 7, clubIsPrivate: false, events })).rejects.toThrow('boom');
    expect(events[0]).toEqual(ev(1));
  });
});
