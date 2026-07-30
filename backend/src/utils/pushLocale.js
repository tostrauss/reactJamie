/**
 * Server-side push i18n (de / it / en).
 *
 * The frontend stamps every API request with X-App-Locale (the i18n resolved
 * language); login/refresh persist it to users.locale. Pushes fall back to
 * German — the primary market — when no locale is stored yet.
 */

export function normalizeLocale(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  if (v.startsWith('it')) return 'it';
  if (v.startsWith('en')) return 'en';
  return 'de';
}

// "Neue Gruppe: {name}" — immediate interest-match push on group creation.
export function categoryPushText(locale, { name, category, location }) {
  const l = normalizeLocale(locale);
  const where = location ? ` in ${location}` : '';
  if (l === 'it') return {
    title: `Nuovo gruppo: ${name}`,
    body: `${category || 'Nuova attività'}${where} – ci stai?`,
  };
  if (l === 'en') return {
    title: `New group: ${name}`,
    body: `${category || 'New activity'}${where} – are you in?`,
  };
  return {
    title: `Neue Gruppe: ${name}`,
    body: `${category || 'Neue Aktivität'}${where} – bist du dabei?`,
  };
}

// Daily digest: "{n} weitere neue Gruppen für dich".
export function categoryDigestText(locale, n) {
  const l = normalizeLocale(locale);
  if (l === 'it') return {
    title: n === 1 ? 'Un altro nuovo gruppo per te' : `${n} altri nuovi gruppi per te`,
    body: 'Oggi sono nati gruppi nelle tue categorie preferite – dai un’occhiata!',
  };
  if (l === 'en') return {
    title: n === 1 ? 'One more new group for you' : `${n} more new groups for you`,
    body: 'New groups in your favorite categories today – take a look!',
  };
  return {
    title: n === 1 ? 'Eine weitere neue Gruppe für dich' : `${n} weitere neue Gruppen für dich`,
    body: 'Heute sind Gruppen in deinen Lieblings-Kategorien entstanden – schau rein!',
  };
}

// Join request → group owner. Deliberately celebratory: getting a request
// should feel like a win (Tobi, 2026-07-30).
export function joinRequestText(locale, { requesterName, groupName }) {
  const l = normalizeLocale(locale);
  const who = requesterName || (l === 'it' ? 'Qualcuno' : l === 'en' ? 'Someone' : 'Jemand');
  if (l === 'it') return {
    title: `🎉 ${who} vuole unirsi!`,
    body: groupName
      ? `${who} vuole entrare in "${groupName}" – tocca per rispondere`
      : `${who} vuole entrare nel tuo gruppo – tocca per rispondere`,
  };
  if (l === 'en') return {
    title: `🎉 ${who} wants to join!`,
    body: groupName
      ? `${who} wants to join "${groupName}" – tap to respond`
      : `${who} wants to join your group – tap to respond`,
  };
  return {
    title: `🎉 ${who} will dabei sein!`,
    body: groupName
      ? `${who} möchte "${groupName}" beitreten – tippe, um zu antworten`
      : `${who} möchte deiner Gruppe beitreten – tippe, um zu antworten`,
  };
}
