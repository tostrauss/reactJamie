// "Zum Kalender" — build a Google Calendar "add event" URL for a group/club
// event. Single source of truth (previously duplicated verbatim in
// GroupDetail.jsx and ClubDetail.jsx) so the +2h fix below only needs to live
// in one place.
import { nextOccurrence } from './recurrence';

// Event start times are stored as a naive wall-clock ("${date}T${time}", e.g.
// 10:00) in a TIMESTAMP (no tz) column. On the UTC Railway server that value
// round-trips to the client tagged UTC (pg treats the naive stored value as
// server-local time = UTC; the API then serializes the Date with a trailing
// Z) — so the Date object's UTC-getters hold exactly what the organizer
// typed. `toISOString()` (used by the old toCalDate) keeps that Z, telling
// Google Calendar "this is a real UTC instant" — which it then converts to
// each viewer's local zone, shifting a 10:00 Vienna event to 12:00 CEST.
// Since JAMIE is DACH-only, every viewer's Calendar timezone already matches
// the organizer's — so export a FLOATING date-time (UTC-extracted fields, NO
// trailing Z) instead. Google interprets a floating value as "the viewer's
// own Calendar timezone", which reproduces the typed time exactly.
const pad2 = (n) => String(n).padStart(2, '0');
const floatingCalDate = (d) =>
  `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;

/** Google Calendar template URL for a group/club event, or null if it has no valid date. */
export function buildGoogleCalendarUrl(event) {
  // Recurring weekly events export their FIRST occurrence + an RRULE so the
  // calendar engine itself drives the repeat; one-offs export the next
  // occurrence.
  const start = event.is_recurring_weekly
    ? new Date(event.date)
    : (nextOccurrence(event) || new Date(event.date));
  if (isNaN(start)) return null;

  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // default duration: 2h
  const title = encodeURIComponent(event.name || event.category || 'JAMIE Event');
  const details = encodeURIComponent(event.description || '');
  const loc = encodeURIComponent(event.location || '');
  const startStr = floatingCalDate(start);
  const endStr = floatingCalDate(end);

  // ALL platforms → Google Calendar template URL. The old native-iOS branch
  // built an .ics blob + <a download> click — Capacitor's WKWebView has no
  // download handler, so the tap silently did NOTHING (dead button = App
  // Review 2.1 risk; 2026-07-03 audit). window.open exits to the system
  // browser and always works; restore the Apple-Calendar .ics flow only via
  // a real native plugin (e.g. capacitor-calendar). `recur` takes a
  // URL-encoded RRULE value; the `=` in `FREQ=WEEKLY` MUST become %3D or
  // Calendar ignores it.
  const recurParam = event.is_recurring_weekly ? `&recur=RRULE:FREQ%3DWEEKLY` : '';
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${loc}${recurParam}`;
}

/** Open the system browser on the Google Calendar "add event" page. No-op if the event has no valid date. */
export function openCalendar(event) {
  const url = buildGoogleCalendarUrl(event);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}
