/**
 * Chat day-separator helpers (WhatsApp-style). Group messages by calendar day
 * and label the separator "Heute" / "Gestern" / a full date, so it's clear
 * whether a message is from today, yesterday or longer ago.
 */
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Stable per-calendar-day key for deciding where a separator goes. */
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
};

/** Human label for a day separator. `t` provides Heute/Gestern. */
export const daySeparatorLabel = (d, locale, t) => {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return t('chat.day.today');
  if (sameDay(date, yesterday)) return t('chat.day.yesterday');
  // Within the last week: weekday name; older: full date.
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);
  if (date >= weekAgo) return date.toLocaleDateString(locale, { weekday: 'long' });
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
