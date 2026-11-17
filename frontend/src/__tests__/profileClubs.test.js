import { describe, it, expect } from 'vitest';
import { dropIndexAt, profileClubRows, withClubOrder } from '../utils/profileClubs';

// „Clubs & Communities“ (Tina 16.11.2026, PR2/PR3) — which clubs become
// bubbles and in which order. The server answers newest-first (Home's order).
const club = (id, over = {}) => ({
  id, name: `Club ${id}`, club_type: 'community', approval_status: 'approved', is_active: true,
  is_own: false, profile_position: null, joined_at: '2026-11-01T10:00:00.000Z', ...over,
});

describe('profileClubRows', () => {
  it('own clubs first in the server order, never mixed into the sorted ones', () => {
    const { own, joined } = profileClubRows([
      club(1, { is_own: true }),
      club(2),
      club(3, { is_own: true, profile_position: 1 }),   // a stray position on an own club changes nothing
    ]);
    expect(own.map((c) => c.id)).toEqual([1, 3]);
    expect(joined.map((c) => c.id)).toEqual([2]);
  });

  it('joined: never-sorted first (newest first), then the saved order', () => {
    const { joined } = profileClubRows([
      club(10, { profile_position: 2, joined_at: '2026-11-12T10:00:00Z' }),
      club(11, { joined_at: '2026-10-01T10:00:00Z' }),
      club(12, { profile_position: 1, joined_at: '2026-09-01T10:00:00Z' }),
      club(13, { joined_at: '2026-11-15T10:00:00Z' }),
    ]);
    expect(joined.map((c) => c.id)).toEqual([13, 11, 12, 10]);
  });

  it('leaves out rejected and closed clubs — keeps the ones in review', () => {
    const { own, joined } = profileClubRows([
      club(1, { is_own: true, approval_status: 'rejected', is_active: false }),
      club(2, { is_active: false }),
      club(3, { is_own: true, club_type: 'official', approval_status: 'pending' }),
      club(4),
    ]);
    expect(own.map((c) => c.id)).toEqual([3]);
    expect(joined.map((c) => c.id)).toEqual([4]);
  });

  it('no list (still loading, or an error) → nothing', () => {
    expect(profileClubRows(null)).toEqual({ own: [], joined: [] });
    expect(profileClubRows(undefined)).toEqual({ own: [], joined: [] });
  });
});

describe('withClubOrder', () => {
  it('gives the ids positions 1…n and forgets every other position, like the server', () => {
    const rows = [club(1, { is_own: true }), club(2, { profile_position: 1 }), club(3), club(4, { profile_position: 2 })];
    const next = withClubOrder(rows, [3, 2]);
    expect(next.map((c) => [c.id, c.profile_position])).toEqual([[1, null], [2, 2], [3, 1], [4, null]]);
    expect(rows[1].profile_position).toBe(1);   // never mutates
    expect(profileClubRows(next).joined.map((c) => c.id)).toEqual([4, 3, 2]);
  });
});

// Dragging a bubble in „Sortieren“ (Tina 17.11.2026): the place the finger is
// over is the nearest one. Places as the grid lays them out: 64px tracks 10px
// apart → centres 74px apart, rows 94px apart.
describe('dropIndexAt', () => {
  const grid = (count, perRow = 4) => Array.from({ length: count }, (_, i) => ({
    x: (i % perRow) * 74 + 32, y: Math.floor(i / perRow) * 94 + 40,
  }));

  it('one row: the place whose centre is nearest', () => {
    const row = grid(4);
    expect(dropIndexAt(row, 32, 40)).toBe(0);
    expect(dropIndexAt(row, 100, 40)).toBe(1);
    expect(dropIndexAt(row, 254, 44)).toBe(3);
    // in the gap between place 1 and 2, a little closer to 2
    expect(dropIndexAt(row, 145, 40)).toBe(2);
  });

  it('a grid: the row counts too', () => {
    const places = grid(7);                       // 4 above, 3 below
    expect(dropIndexAt(places, 106, 40)).toBe(1);
    expect(dropIndexAt(places, 106, 134)).toBe(5);
    expect(dropIndexAt(places, 180, 90)).toBe(6);  // just past the middle between the rows
    // the empty cell bottom right: the last bubble's place is the nearest
    expect(dropIndexAt(places, 254, 134)).toBe(6);
  });

  it('outside the grid there is still a place — the closest edge', () => {
    const places = grid(7);
    expect(dropIndexAt(places, -200, -200)).toBe(0);
    expect(dropIndexAt(places, 900, 20)).toBe(3);
    expect(dropIndexAt(places, 40, 900)).toBe(4);
  });

  it('exactly between two places the earlier one wins', () => {
    expect(dropIndexAt(grid(2), 69, 40)).toBe(0);
  });

  it('no places, or no usable point: -1', () => {
    expect(dropIndexAt([], 10, 10)).toBe(-1);
    expect(dropIndexAt(null, 10, 10)).toBe(-1);
    expect(dropIndexAt(grid(3), NaN, 10)).toBe(-1);
    expect(dropIndexAt(grid(3), 10, undefined)).toBe(-1);
  });
});
