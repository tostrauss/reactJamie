import { describe, it, expect } from 'vitest';
import { isPaidPartnerClub, isPartnerClub } from '../utils/paidPartner';

// Tina's clarification, 17.11.2026 (Tobi decided): „Stern hat jeder Club …
// diesen verified-Haken haben nur Paid Clubs.“ Two rules in one file:
//   ☆ isPartnerClub      every live, approved, official club — the bubble
//   ✓ isPaidPartnerClub  such a club with the admin's is_paid_partner flag
const club = (over = {}) => ({
  id: 2, name: 'Café Krieau', club_type: 'official', approval_status: 'approved',
  is_active: true, is_paid_partner: true, ...over,
});

describe('isPartnerClub — the ☆ on the profile bubble', () => {
  it('every live, approved, official club — paying or not, with or without the field', () => {
    expect(isPartnerClub(club())).toBe(true);
    expect(isPartnerClub(club({ is_paid_partner: false }))).toBe(true);
    expect(isPartnerClub(club({ is_paid_partner: undefined }))).toBe(true);
    expect(isPartnerClub(club({ is_active: undefined }))).toBe(true);
  });

  it('a community never — also not one that kept the paid flag', () => {
    expect(isPartnerClub(club({ club_type: null }))).toBe(false);
    expect(isPartnerClub(club({ club_type: 'community' }))).toBe(false);
    expect(isPartnerClub(club({ club_type: undefined }))).toBe(false);
  });

  it('a club in review, a rejected one, a closed one: no', () => {
    expect(isPartnerClub(club({ approval_status: 'pending' }))).toBe(false);
    expect(isPartnerClub(club({ approval_status: 'rejected' }))).toBe(false);
    expect(isPartnerClub(club({ approval_status: undefined }))).toBe(false);
    expect(isPartnerClub(club({ is_active: false }))).toBe(false);
    expect(isPartnerClub(null)).toBe(false);
  });

  it('whoever has the ✓ has the ☆ — the tick is built on the star', () => {
    const rows = [club(), club({ is_paid_partner: false }), club({ club_type: null }),
      club({ approval_status: 'pending' }), club({ is_active: false })];
    for (const row of rows) {
      if (isPaidPartnerClub(row)) expect(isPartnerClub(row)).toBe(true);
    }
    expect(rows.map(isPaidPartnerClub)).toEqual([true, false, false, false, false]);
    expect(rows.map(isPartnerClub)).toEqual([true, true, false, false, false]);
  });
});

describe('isPaidPartnerClub — the ✓ in the Clubs list', () => {
  it('a paying, approved, official club: yes', () => {
    expect(isPaidPartnerClub(club())).toBe(true);
    // is_active missing reads as live (only an explicit false closes a club)
    expect(isPaidPartnerClub(club({ is_active: undefined }))).toBe(true);
  });

  it('an official club that does not pay: no', () => {
    expect(isPaidPartnerClub(club({ is_paid_partner: false }))).toBe(false);
  });

  // The flag stays in the database when an admin turns a paying club into a
  // community.
  it('a community that kept the flag: no', () => {
    expect(isPaidPartnerClub(club({ club_type: null }))).toBe(false);
    expect(isPaidPartnerClub(club({ club_type: 'community' }))).toBe(false);
    expect(isPaidPartnerClub(club({ club_type: undefined }))).toBe(false);
  });

  // An owner sees their own club in the list while it is still in review.
  it('a club in review or rejected, with the flag: no', () => {
    expect(isPaidPartnerClub(club({ approval_status: 'pending' }))).toBe(false);
    expect(isPaidPartnerClub(club({ approval_status: 'rejected' }))).toBe(false);
    expect(isPaidPartnerClub(club({ approval_status: undefined }))).toBe(false);
  });

  it('a closed club: no', () => {
    expect(isPaidPartnerClub(club({ is_active: false }))).toBe(false);
  });

  it('fail-closed: the field missing, or anything but true, means no', () => {
    for (const value of [undefined, null, 'true', 1, 't']) {
      expect(isPaidPartnerClub(club({ is_paid_partner: value }))).toBe(false);
    }
    expect(isPaidPartnerClub(null)).toBe(false);
    expect(isPaidPartnerClub(undefined)).toBe(false);
  });
});
