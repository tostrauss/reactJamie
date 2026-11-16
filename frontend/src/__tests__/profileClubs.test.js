import { describe, it, expect } from 'vitest';
import { profileClubRows, withClubOrder } from '../utils/profileClubs';

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
