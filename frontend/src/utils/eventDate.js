// Date tiles of event lists — one copy since 16.11.2026. ClubDetail and
// GroupDetail each carried their own formatEventDate; the profile's „Demnächst
// dabei“ (Tina, PR4) would have been the third.
//
// Event start times are stored as a naive wall-clock (`${date}T${time}`, e.g.
// 10:00). On a UTC server that value round-trips to the client tagged UTC, so
// formatting in the device's local zone shifted it +1/+2h (CEST) — "10 Uhr"
// showed as "12 Uhr" after saving. Format in UTC so the displayed time/day
// equals exactly what the creator typed (the contract note in recurrence.js).

/** { day, month, time } for a date tile, or null without a usable date. */
export const formatEventDate = (dateStr, locale) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return {
    day: d.getUTCDate(),
    month: d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  };
};

/** The locale those tiles are formatted in, from the i18n language. */
export const eventDateLocale = (language) => {
  const lang = language || 'de';
  if (lang.startsWith('en')) return 'en-US';
  if (lang.startsWith('it')) return 'it-IT';
  if (lang.startsWith('fr')) return 'fr-FR';
  if (lang.startsWith('es')) return 'es-ES';
  return 'de-AT';
};
