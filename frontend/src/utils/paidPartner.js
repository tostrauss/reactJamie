// What marks a CLUB, in ONE place, so the surfaces can never drift apart.
// Tina's clarification of 17.11.2026 (Tobi decided): „Stern hat jeder Club
// mit Pastellgelb umrandet, so wie beschrieben, aber wenn man auf die ganzen
// Clubs geht, diesen verified-Haken haben nur Paid Clubs.“
//
//   ☆  isPartnerClub      EVERY official club that is live: club_type
//                         'official', approved, not closed. The star on the
//                         profile bubble (ProfileClubBubbles).
//   ✓  isPaidPartnerClub  such a club that also PAYS — the admin's
//                         is_paid_partner flag. The verified tick beside the
//                         name in the Clubs list (ClubCard).
//
// The tick is built on the star's rule, so a club with a tick always has the
// star's standing. The flag alone is never enough:
//   - it stays in the database when an admin turns a paying club into a
//     community (club_type NULL) — that community is no partner;
//   - an owner sees their own club while it is still in review
//     (approval_status 'pending') — not a partner yet;
//   - a closed club (is_active false) is none any more.
// Fail-closed: a server that does not send one of the fields means „no“.
// Events have their own flag from the server (is_partner) — not this.

/** ☆ — a live, approved official club, paying or not. */
export const isPartnerClub = (club) => !!club
  && club.club_type === 'official'
  && club.approval_status === 'approved'
  && club.is_active !== false;

/** ✓ — a partner club that pays. */
export const isPaidPartnerClub = (club) => isPartnerClub(club) && club.is_paid_partner === true;
