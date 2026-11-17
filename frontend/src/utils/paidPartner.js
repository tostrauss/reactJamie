// Is this CLUB a paying partner? ONE rule for every place that marks a club
// as one — the ✓ beside the name in the Clubs list (ClubCard) and the ☆ on the
// profile bubble (ProfileClubBubbles) — so the two can never drift apart
// (Tobi 17.11.2026: „Gelb, ☆ Partner und der ✓-Haken nur für ZAHLENDE
// Partner … Nicht zahlende Clubs: kein Gelb, kein ☆, kein ✓.“).
//
// It mirrors partnerSql (backend utils/clubGate.js): a live, approved,
// OFFICIAL club that carries the admin's is_paid_partner flag. The flag alone
// is not enough:
//   - it stays in the database when an admin turns a paying club into a
//     community (club_type NULL) — that community is no partner;
//   - an owner sees their own club while it is still in review
//     (approval_status 'pending') — not a partner yet;
//   - a closed club (is_active false) is none any more.
// Fail-closed: a server that does not send one of the fields means „no“.
// Events have their own flag from the server (is_partner) — not this.
export const isPaidPartnerClub = (club) => !!club
  && club.club_type === 'official'
  && club.approval_status === 'approved'
  && club.is_active !== false
  && club.is_paid_partner === true;
