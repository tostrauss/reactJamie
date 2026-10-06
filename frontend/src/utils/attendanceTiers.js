/**
 * Abzeichen-Stufen — display helpers (B2, tester 06.10.2026).
 *
 * The server decides every level (backend/src/utils/attendanceTiers.js): the
 * client only RENDERS the level it receives for another person and never
 * computes one. The thresholds below are a MIRROR used for the person's own
 * ladder and progress bar; backend/tests/utils/attendanceTiers.test.js reads
 * both files and fails when they drift.
 *
 * Only confirmed attendance counts — other participants ticking "war dabei"
 * after the event, ✓ strictly outnumbering ✗ — never a sign-up.
 */
export const TIER_MIN_EVENTS = [5, 10, 100];
export const TIER_MIN_CONFIRMERS = [2, 3, 10];
export const TIER_EMOJI = ['🏅', '🏆', '🎆'];

/** 1–3 pass through; anything else (0, '2', 4, null, NaN, undefined) is 0. */
export const normalizeTier = (v) => (Number.isInteger(v) && v >= 1 && v <= 3 ? v : 0);

export const tierEmoji = (t) => TIER_EMOJI[normalizeTier(t) - 1] || '';
export const tierMinEvents = (t) => TIER_MIN_EVENTS[normalizeTier(t) - 1] || 0;

/**
 * The own progress card's numbers, from GET /reviews/attendance:
 * { confirmed_events, confirmers, tier, next } → null at the top step, else
 *   { level, emoji, min, prevMin, remaining, needsPeople, minPeople, pct }.
 * `needsPeople`: enough meetups for the next step, but not enough DIFFERENT
 * people have confirmed them yet (the anti-farming floor).
 */
export const progressOf = (a) => {
  if (!a || !a.next) return null;
  const level = normalizeTier(a.next.tier);
  if (!level) return null;
  const events = Number(a.confirmed_events) || 0;
  const min = TIER_MIN_EVENTS[level - 1];
  const prevMin = level > 1 ? TIER_MIN_EVENTS[level - 2] : 0;
  const remaining = Math.max(0, Number(a.next.events_missing) || 0);
  const needsPeople = remaining === 0 && (Number(a.next.confirmers_missing) || 0) > 0;
  const pct = Math.min(100, Math.max(0, Math.round(((events - prevMin) / (min - prevMin)) * 100)));
  return {
    level,
    emoji: TIER_EMOJI[level - 1],
    min,
    prevMin,
    remaining,
    needsPeople,
    minPeople: TIER_MIN_CONFIRMERS[level - 1],
    pct,
  };
};
