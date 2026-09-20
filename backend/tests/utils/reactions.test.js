import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REACTION_EMOJI,
  QUICK_REACTION_COUNT,
  isAllowedReaction,
  getReactionsFor,
  attachReactions,
  getReactionSummary,
  setReaction,
} from '../../src/utils/reactions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_MIRROR = path.resolve(here, '../../../frontend/src/utils/reactions.js');

// ── The contract that keeps client and server from drifting ───────────────
// The picker offers what the frontend list contains; the server writes only
// what its own list contains. Any divergence is a button that returns 400 —
// invisible in review, obvious to the user. So the two files are compared
// directly rather than trusted to be kept in sync by hand.
describe('client/server emoji allowlist mirror', () => {
  const parseList = (src) => {
    const body = src.match(/export const REACTION_EMOJI = \[([\s\S]*?)\n\];/)?.[1];
    if (!body) throw new Error('REACTION_EMOJI literal not found');
    return [...body.matchAll(/'([^']+)'/g)].map(m => m[1]);
  };

  it('frontend/src/utils/reactions.js lists exactly the same emoji, in the same order', () => {
    const mirror = parseList(fs.readFileSync(FRONTEND_MIRROR, 'utf8'));
    // Order matters: the first QUICK_REACTION_COUNT entries ARE the quick bar.
    expect(mirror).toEqual(REACTION_EMOJI);
  });

  it('agrees on the size of the quick bar', () => {
    const src = fs.readFileSync(FRONTEND_MIRROR, 'utf8');
    const n = Number(src.match(/export const QUICK_REACTION_COUNT = (\d+);/)?.[1]);
    expect(n).toBe(QUICK_REACTION_COUNT);
  });

  it('has no duplicates and enough emoji to fill the quick bar', () => {
    expect(new Set(REACTION_EMOJI).size).toBe(REACTION_EMOJI.length);
    expect(REACTION_EMOJI.length).toBeGreaterThan(QUICK_REACTION_COUNT);
  });
});

// ── The allowlist is the entire moderation story for reactions ────────────
describe('isAllowedReaction', () => {
  it('accepts every emoji the picker can offer', () => {
    for (const e of REACTION_EMOJI) expect(isAllowedReaction(e)).toBe(true);
  });

  it('rejects free text, which is the whole point of having a list', () => {
    for (const bad of ['hallo', '<script>', 'https://evil.example', '🍆🍆🍆', '👍👍', '']) {
      expect(isAllowedReaction(bad)).toBe(false);
    }
  });

  it('rejects non-strings rather than coercing them', () => {
    for (const bad of [null, undefined, 42, {}, ['👍'], true]) {
      expect(isAllowedReaction(bad)).toBe(false);
    }
  });

  it('rejects an emoji that is merely similar to an allowed one', () => {
    // ❤ (U+2764) without the variation selector is a DIFFERENT string than the
    // ❤️ in the list. If this ever starts passing, the two files have been
    // normalised by an editor and the mirror test above is the real alarm.
    expect(REACTION_EMOJI).toContain('❤️');
    expect(isAllowedReaction('❤')).toBe(false);
  });
});

// ── Read path must never be able to break the chat ────────────────────────
describe('getReactionsFor', () => {
  const okDb = (rows) => ({ query: vi.fn().mockResolvedValue({ rows }) });

  it('maps rows to Map<messageId, summary>', async () => {
    const db = okDb([
      { message_id: 7, reactions: [{ emoji: '👍', count: 2, user_ids: [1, 2] }] },
    ]);
    const out = await getReactionsFor(db, 'group', [7, 8]);
    expect(out.get(7)).toEqual([{ emoji: '👍', count: 2, user_ids: [1, 2] }]);
    expect(out.get(8)).toBeUndefined();
  });

  it('does not hit the database at all for an empty page', async () => {
    const db = okDb([]);
    expect((await getReactionsFor(db, 'group', [])).size).toBe(0);
    expect((await getReactionsFor(db, 'group', null)).size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('de-duplicates and drops non-numeric ids before they reach SQL', async () => {
    const db = okDb([]);
    await getReactionsFor(db, 'group', [3, 3, 'temp-abc', null, 4]);
    expect(db.query.mock.calls[0][1]).toEqual([[3, 4]]);
  });

  it('returns empty instead of throwing when the table does not exist yet', async () => {
    // The server accepts traffic BEFORE startup migrations finish, so on the
    // first deploy carrying this feature the table genuinely is absent for a
    // moment. A throw here would 500 the whole chat over a cosmetic feature.
    const err = Object.assign(new Error('relation "message_reactions" does not exist'), { code: '42P01' });
    const db = { query: vi.fn().mockRejectedValue(err) };
    await expect(getReactionsFor(db, 'dm', [1])).resolves.toBeInstanceOf(Map);
  });

  it('swallows any other database error too', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('connection reset')) };
    const out = await getReactionsFor(db, 'group', [1]);
    expect(out.size).toBe(0);
  });

  it('refuses an unknown reaction kind rather than interpolating it into SQL', async () => {
    const db = okDb([]);
    // Would be an injection point if the table name came from a request value.
    await expect(getReactionsFor(db, 'messages; DROP TABLE users--', [1]))
      .resolves.toBeInstanceOf(Map);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('attachReactions', () => {
  it('gives every row a reactions array, empty where there are none', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { message_id: 2, reactions: [{ emoji: '🔥', count: 1, user_ids: [9] }] },
    ] }) };
    const rows = [{ id: 1 }, { id: 2 }];
    await attachReactions(db, 'group', rows);
    expect(rows[0].reactions).toEqual([]);
    expect(rows[1].reactions).toEqual([{ emoji: '🔥', count: 1, user_ids: [9] }]);
  });
});

// ── Write path ────────────────────────────────────────────────────────────
describe('setReaction', () => {
  const db = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ reactions: [] }] }) });

  it('upserts so a second emoji REPLACES the first (one per person)', async () => {
    const d = db();
    await setReaction(d, 'group', 5, 42, '🎉');
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO message_reactions/);
    expect(sql).toMatch(/ON CONFLICT \(message_id, user_id\)/);
    expect(sql).toMatch(/DO UPDATE SET emoji = EXCLUDED\.emoji/);
    expect(params).toEqual([5, 42, '🎉']);
  });

  it('deletes when the emoji is null', async () => {
    const d = db();
    await setReaction(d, 'dm', 5, 42, null);
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM dm_reactions/);
    expect(params).toEqual([5, 42]);
  });

  it('writes to the dm table for the dm kind and never to the group one', async () => {
    const d = db();
    await setReaction(d, 'dm', 1, 2, '👍');
    expect(d.query.mock.calls[0][0]).toMatch(/INSERT INTO dm_reactions/);
    expect(d.query.mock.calls[0][0]).not.toMatch(/message_reactions/);
  });

  it('throws on an unknown kind instead of building SQL from it', async () => {
    await expect(setReaction(db(), 'nope', 1, 2, '👍')).rejects.toThrow(/unknown reaction kind/);
  });

  it('returns the fresh summary so the response and the broadcast agree', async () => {
    const summary = [{ emoji: '👍', count: 3, user_ids: [1, 2, 3] }];
    const d = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [] })                       // the upsert
      .mockResolvedValueOnce({ rows: [{ reactions: summary }] }) // the re-read
    };
    await expect(setReaction(d, 'group', 1, 2, '👍')).resolves.toEqual(summary);
  });
});

describe('getReactionSummary', () => {
  it('returns [] for a message nobody reacted to', async () => {
    const d = { query: vi.fn().mockResolvedValue({ rows: [{ reactions: [] }] }) };
    await expect(getReactionSummary(d, 'group', 1)).resolves.toEqual([]);
  });
});
