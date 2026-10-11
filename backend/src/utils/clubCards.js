// The SELECT list behind every club CARD — what the Clubs tab (getClubs) and
// the onboarding club page (featuredClubController) render: the club row, its
// owner, the first eight members as avatar previews and the live boost flag.
//
// One definition, so the two lists can never disagree about what a card
// carries. A plain module (no controller imports) so the featured controller
// does not pull clubController's whole graph in with it.
//
// Requires the FROM clause to bind `g` (groups) and `u` (the owner, LEFT JOIN
// users u ON u.id = g.owner_id). Callers append their own FROM / WHERE, and
// may append further columns after a comma.
export const CLUB_CARD_SELECT = `
      SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
             EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age,
             (
               SELECT COALESCE(json_agg(sub), '[]'::json)
               FROM (
                 SELECT u2.id, u2.name, u2.avatar_url,
                        EXTRACT(YEAR FROM AGE(u2.date_of_birth))::int AS age
                 FROM group_members gm
                 JOIN users u2 ON gm.user_id = u2.id
                 WHERE gm.group_id = g.id
                 ORDER BY gm.joined_at ASC
                 LIMIT 8
               ) sub
             ) AS member_previews,
             EXISTS (
               SELECT 1 FROM boosts b
               WHERE b.target_id = g.id AND b.target_type = g.type
                 AND b.boosted_until > NOW()
             ) AS is_boosted`;
