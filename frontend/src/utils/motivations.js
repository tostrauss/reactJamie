// ==========================================
// "Was trifft zu?" — client mirror of the server allowlist (onboarding step ①)
// ==========================================
// MIRROR of backend/src/utils/motivations.js — same keys, same order.
// backend/tests/utils/motivations.test.js reads this file and fails on drift.
// The server drops keys it does not know, so a key that exists only here
// would be a tick the user sets and then silently loses.
//
// Stored as KEYS in users.motivations (never the sentence): labels come from
// onboarding.goals.options.<key> in all five locales, and the admin
// dashboard counts by key.
//
// NEVER REMOVE OR RENAME A KEY. iOS bundles stay in the field for weeks and
// keep sending the keys they shipped with; retire an option by hiding it in
// the UI, not by deleting it here.
export const MOTIVATION_KEYS = Object.freeze(['new_in_town', 'new_friends', 'activity_partners', 'discover_places', 'more_active']);
