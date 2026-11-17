import { describe, it, expect } from 'vitest';
import { isPaidPartnerClub } from '../utils/paidPartner';

// ONE rule for the ✓ in the Clubs list and the ☆ on the profile bubble
// (Tobi 17.11.2026: only PAYING partners) — partnerSql's: a live, approved,
// official club with the admin's is_paid_partner flag.
const club = (over = {}) => ({
  id: 2, name: 'Café Krieau', club_type: 'official', approval_status: 'approved',
  is_active: true, is_paid_partner: true, ...over,
});

describe('isPaidPartnerClub', () => {
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
