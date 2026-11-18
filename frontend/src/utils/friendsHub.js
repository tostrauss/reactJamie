// Small pure helpers of the new Friends page (Tina, 17.11.2026).
import { utcDayStart } from './recurrence';

/**
 * `n` random entries of `list` — „Es werden 3 zufällige Freunde angezeigt,
 * bei jedem Öffnen neu gemischt“. A partial Fisher–Yates on a copy; `random`
 * is injectable so a test can pin the draw.
 */
export const pickRandom = (list, n, random = Math.random) => {
  const pool = Array.isArray(list) ? [...list] : [];
  const count = Math.max(0, Math.min(n, pool.length));
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
};

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * „Do, 19:00“ on a card of „Wo gehen deine Freunde hin?“ — day and time of a
 * meetup's next date.
 *
 * `when` is the stored Vienna wall-clock tagged UTC (the contract in
 * utils/recurrence.js), so only the UTC accessors hold what the organiser
 * typed; `today` is Vienna's day as a UTC day start (viennaTodayUTC()).
 *
 *   today            „Heute, 19:00“   (`todayLabel`)
 *   the next 6 days  „Do, 19:00“      (the weekday says which day)
 *   later            „Do, 27.11., 19:00“ — a bare weekday would be read as
 *                    this week's
 *   no time          the day alone: a meetup without a time is stored at
 *                    midnight („Uhrzeit im Chat“)
 */
export const goingWhen = (when, { locale, today, todayLabel }) => {
  if (!when) return '';
  const d = new Date(when);
  if (isNaN(d)) return '';
  const days = Math.round((utcDayStart(d) - today) / 864e5);
  const weekday = capitalise(
    d.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }).replace(/\.$/, ''));
  let day;
  if (days === 0 && todayLabel) day = todayLabel;
  else if (days > 0 && days < 7) day = weekday;
  else day = `${weekday}, ${d.toLocaleDateString(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })}`;
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  if (!hasTime) return day;
  return `${day}, ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`;
};

/** The first name on a card: „Fynn“ of „Fynn Huber“ — the line is narrow. */
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
