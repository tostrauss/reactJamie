// Age label of a group („🎂 Alter: 23-33").
//
// The owner's target range (target_age_min/max) is what the event is FOR, so
// it leads; the members' actual span (age_min/max, computed by the server from
// their birthdays) only stands in when no range was set. The detail page used
// to show the span alone, so an edited range looked ignored — Marie,
// 11.10.2026: „bei Alter 23 bis 33 angegeben, jedoch steht in der Anzeige bis
// 27. Wenn ich es ändere tut sich leider auch nichts". Home's age filter
// already read target first (Home.jsx matchesAlter).

// JAMIE is 18+, and anything from 60 up reads as „60+".
export function formatAgeRange(min, max) {
  if (min == null || max == null) return null;
  const capped = max >= 60 ? '60+' : String(max);
  return min === max ? String(min) : `${Math.max(18, min)}-${capped}`;
}

// Either side of a target range may be open: „ab 25" → "25+", „bis 30" →
// "18-30".
export function formatTargetAgeRange(min, max) {
  if (min == null && max == null) return null;
  if (max == null) return min >= 60 ? '60+' : `${Math.max(18, min)}+`;
  return formatAgeRange(min ?? 18, max);
}

export function groupAgeLabel(group) {
  if (!group) return null;
  return formatTargetAgeRange(group.target_age_min, group.target_age_max)
    ?? formatAgeRange(group.age_min, group.age_max);
}
