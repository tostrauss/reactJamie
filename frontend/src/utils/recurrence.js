// Recurrence helpers for weekly events.
//
// Groups can be flagged `is_recurring_weekly`. The DB still stores the *first*
// occurrence in `date`; this module rolls that forward to the next future
// occurrence whenever the start is in the past. Single source of truth for
// the card, the detail page, and the calendar exporters so they never disagree.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns the next future occurrence Date for a group.
 * - Non-recurring (or no date): returns the original Date or null
 * - Recurring + start in the future: returns the start as-is
 * - Recurring + start in the past: rolls forward by N*7 days to land just after now
 */
export function nextOccurrence(group, now = new Date()) {
  if (!group?.date) return null;
  const start = new Date(group.date);
  if (isNaN(start.getTime())) return null;
  if (!group.is_recurring_weekly) return start;

  if (start.getTime() > now.getTime()) return start;

  const weeks = Math.ceil((now.getTime() - start.getTime()) / WEEK_MS);
  return new Date(start.getTime() + weeks * WEEK_MS);
}

/**
 * Localised weekday name from the original start date — used to label
 * recurring events as "Jeden Dienstag" / "Every Tuesday".
 */
export function weeklyWeekday(group, locale = 'de-DE') {
  if (!group?.date) return '';
  const d = new Date(group.date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { weekday: 'long' });
}
