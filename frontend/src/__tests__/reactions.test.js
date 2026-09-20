import { describe, it, expect } from 'vitest';
import {
  REACTION_EMOJI,
  QUICK_REACTIONS,
  MORE_REACTIONS,
  myReaction,
  applyReactionLocally,
} from '../utils/reactions';

describe('reaction sets', () => {
  it('splits the list into the quick bar and the rest without losing any', () => {
    expect([...QUICK_REACTIONS, ...MORE_REACTIONS]).toEqual(REACTION_EMOJI);
    expect(QUICK_REACTIONS).toHaveLength(6);
  });
});

describe('myReaction', () => {
  const rx = [
    { emoji: '👍', count: 2, user_ids: [1, 7] },
    { emoji: '🔥', count: 1, user_ids: [3] },
  ];

  it('finds the viewer’s own emoji', () => {
    expect(myReaction(rx, 7)).toBe('👍');
    expect(myReaction(rx, 3)).toBe('🔥');
  });

  it('returns null for someone who has not reacted', () => {
    expect(myReaction(rx, 99)).toBeNull();
  });

  it('compares ids numerically — the socket and the API disagree on the type', () => {
    // user_ids come back from Postgres as numbers, but a user id read out of a
    // JWT/localStorage round trip can be a string. A strict === here would make
    // your own chip stop highlighting, which reads as "my reaction vanished".
    expect(myReaction([{ emoji: '🎉', count: 1, user_ids: ['7'] }], 7)).toBe('🎉');
    expect(myReaction(rx, '7')).toBe('👍');
  });

  it('survives the shapes an older or offline client can hand it', () => {
    expect(myReaction(undefined, 1)).toBeNull();
    expect(myReaction([], 1)).toBeNull();
    expect(myReaction(rx, null)).toBeNull();
    expect(myReaction([{ emoji: '👍', count: 1 }], 1)).toBeNull(); // no user_ids
  });
});

describe('applyReactionLocally', () => {
  it('adds a reaction to a message that had none', () => {
    expect(applyReactionLocally([], 5, '👍'))
      .toEqual([{ emoji: '👍', count: 1, user_ids: [5] }]);
  });

  it('joins an existing chip rather than creating a second one', () => {
    const out = applyReactionLocally([{ emoji: '👍', count: 1, user_ids: [1] }], 5, '👍');
    expect(out).toEqual([{ emoji: '👍', count: 2, user_ids: [1, 5] }]);
  });

  it('MOVES my reaction instead of stacking — one per person, like the server', () => {
    // The server's primary key (message_id, user_id) enforces this; if the
    // optimistic path stacked instead, the chip would jump back on the response.
    const before = [
      { emoji: '👍', count: 2, user_ids: [1, 5] },
      { emoji: '🔥', count: 1, user_ids: [2] },
    ];
    const after = applyReactionLocally(before, 5, '🔥');
    expect(after).toEqual([
      { emoji: '🔥', count: 2, user_ids: [2, 5] },
      { emoji: '👍', count: 1, user_ids: [1] },
    ]);
  });

  it('removes my reaction when the emoji is null', () => {
    const before = [{ emoji: '👍', count: 2, user_ids: [1, 5] }];
    expect(applyReactionLocally(before, 5, null))
      .toEqual([{ emoji: '👍', count: 1, user_ids: [1] }]);
  });

  it('drops a chip whose last reactor left', () => {
    expect(applyReactionLocally([{ emoji: '👍', count: 1, user_ids: [5] }], 5, null))
      .toEqual([]);
  });

  it('never mutates the array it was given — rollback depends on it', () => {
    // handleReact keeps the pre-tap array to restore on failure. If this
    // mutated in place, the rollback would restore the already-changed value.
    const before = [{ emoji: '👍', count: 1, user_ids: [1] }];
    const snapshot = JSON.parse(JSON.stringify(before));
    applyReactionLocally(before, 5, '👍');
    expect(before).toEqual(snapshot);
  });

  it('orders chips by count, so the dominant reaction leads', () => {
    const before = [
      { emoji: '👍', count: 1, user_ids: [1] },
      { emoji: '🔥', count: 3, user_ids: [2, 3, 4] },
    ];
    expect(applyReactionLocally(before, 5, '👍').map(r => r.emoji)).toEqual(['🔥', '👍']);
  });

  it('handles a message whose reactions field is missing entirely', () => {
    expect(applyReactionLocally(undefined, 5, '🎉'))
      .toEqual([{ emoji: '🎉', count: 1, user_ids: [5] }]);
  });
});
