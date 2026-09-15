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

  // Compare wall-clock against WALL-CLOCK. `start` is a Vienna wall-clock
  // value tagged UTC (see the contract note below), so measuring it against a
  // real instant compared 18:00-Vienna-as-18:00-UTC with the actual moment —
  // two hours out in CEST, which rolled a meetup whose slot had genuinely
  // passed to next week two hours late, and vice versa.
  const nowMs = viennaNowUTC(now);
  if (start.getTime() > nowMs) return start;

  // Whole 7-day steps keep the time-of-day fixed across DST, because both
  // sides live in the same tagged-wall-clock space.
  const weeks = Math.ceil((nowMs - start.getTime()) / WEEK_MS);
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

// ── The UTC-tagged wall-clock contract ────────────────────────────────────
// Event start times are a naive wall-clock in `groups.date` (TIMESTAMP, no
// tz). On the UTC Railway server they round-trip to the client tagged `Z`, so
// ONLY the getUTC* accessors hold what the organizer actually typed — the rule
// EventCard.jsx:31 and calendarExport.js:7 already spell out.
//
// Reading such a date with the LOCAL getters shifts it by the device offset
// (+2h in CEST), which for an evening event flips the calendar DAY: an event at
// 22:00 Vienna was read as the next day, so its card said "Morgen", the "Heute"
// filter dropped it, and — since 2026-09-15 — it would have landed in the wrong
// half of the Gruppen feed's Heute/Morgen split. The server's own bucket
// (groupController IS_IMMINENT_SQL) compares Vienna calendar dates and was
// right all along; this is what makes the client agree with it.
//
// "Today" is therefore Vienna's calendar day expressed as a UTC day-start, so
// it compares directly against those UTC-tagged values.
export const utcDayStart = (d) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** "Now" in Vienna wall-clock, tagged UTC — directly comparable to event dates. */
export function viennaNowUTC(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t) => Number(parts.find((x) => x.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
}

export function viennaTodayUTC(now = new Date()) {
  return utcDayStart(new Date(viennaNowUTC(now)));
}

/**
 * Parse a date into a locale-agnostic descriptor. Returns one of:
 *   { kind: 'today'|'tomorrow'|'yesterday', time }
 *   { kind: 'date', date, time }
 * Locale-specific text composition happens in the component using t().
 *
 * Lives here rather than in GroupCard so the feed's "Heute & Morgen" section
 * and the card's own date badge read the SAME rule — a card under that header
 * can then never carry a badge that contradicts it.
 */
export function parseDateDescriptor(dateInput, locale) {
  if (!dateInput) return null;
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    // UTC on both sides — see the contract note above.
    const diff = Math.round((utcDayStart(d) - viennaTodayUTC()) / 86400000);
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    if (diff === 0)  return { kind: 'today',     time };
    if (diff === 1)  return { kind: 'tomorrow',  time };
    if (diff === -1) return { kind: 'yesterday', time };
    return {
      kind: 'date',
      date: d.toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }),
      time,
    };
  } catch {
    return null;
  }
}

/**
 * Is this group happening today or tomorrow?
 *
 * The client half of one rule the server also applies in SQL (groupController
 * IS_IMMINENT_SQL) to decide which rows make the LIMIT-ed feed page at all and
 * in what order. Recurring groups roll forward first, so a weekly Tuesday
 * meetup counts as "today" on Tuesday.
 */
export function isHappeningSoon(group) {
  const d = parseDateDescriptor(nextOccurrence(group));
  return d?.kind === 'today' || d?.kind === 'tomorrow';
}
