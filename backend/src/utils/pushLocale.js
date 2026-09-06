/**
 * Server-side push i18n (de / it / en / fr / es).
 *
 * The frontend stamps every API request with X-App-Locale (the i18n resolved
 * language); login/refresh persist it to users.locale. Pushes fall back to
 * German — the primary market — when no locale is stored yet.
 * French + Spanish added 2026-08-04 for the France & Spain market rollout.
 */

export function normalizeLocale(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  if (v.startsWith('it')) return 'it';
  if (v.startsWith('en')) return 'en';
  if (v.startsWith('fr')) return 'fr';
  if (v.startsWith('es')) return 'es';
  return 'de';
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic catalog for every remaining push type (audit 2026-08-10): DM,
// friends, joins, waitlist, likes, club events, deals previously went out as
// hardcoded German string literals to ALL six markets. One entry per type,
// one function per locale; unknown locales fall back to German like
// everything else in this file.
//
// Usage at call sites: sendPushToUser(uid, pushTexts('newDm', { name }), null, url)
// — pushController resolves the recipient's users.locale and calls the
// builder (see resolveTexts there).
// ─────────────────────────────────────────────────────────────────────────────
// Shared bits for the batch-1 texts (reminders, owner nudge, friend feed).
const SOMEONE = { de: 'Jemand', en: 'Someone', it: 'Qualcuno', fr: 'Quelqu’un', es: 'Alguien' };
const GOING = {
  de: (n) => `${n} dabei`,
  en: (n) => `${n} going`,
  it: (n) => (n === 1 ? '1 partecipante' : `${n} partecipanti`),
  fr: (n) => (n === 1 ? '1 participant' : `${n} participants`),
  es: (n) => (n === 1 ? '1 apuntado' : `${n} apuntados`),
};
const dots = (...parts) => parts.filter(Boolean).join(' · ');
// "19:00 · 6 dabei · Prater" — time and location only when present.
const reminderBody = (p, l) => dots(p.time, GOING[l](p.count), p.location);

const PUSH_TEXTS = {
  slotFreed: {
    de: (p) => ({ title: 'Platz frei!', body: `Ein Platz in "${p.groupName}" ist frei geworden` }),
    en: (p) => ({ title: 'Spot available!', body: `A spot opened up in "${p.groupName}"` }),
    it: (p) => ({ title: 'Posto libero!', body: `Si è liberato un posto in "${p.groupName}"` }),
    fr: (p) => ({ title: 'Place libre !', body: `Une place s'est libérée dans "${p.groupName}"` }),
    es: (p) => ({ title: '¡Plaza libre!', body: `Se ha liberado una plaza en "${p.groupName}"` }),
  },
  joinAccepted: {
    de: (p) => ({ title: 'Beitrittsanfrage akzeptiert', body: `Du bist jetzt Mitglied von "${p.name}"` }),
    en: (p) => ({ title: 'Request accepted', body: `You are now a member of "${p.name}"` }),
    it: (p) => ({ title: 'Richiesta accettata', body: `Ora sei membro di "${p.name}"` }),
    fr: (p) => ({ title: 'Demande acceptée', body: `Tu es maintenant membre de "${p.name}"` }),
    es: (p) => ({ title: 'Solicitud aceptada', body: `Ya eres miembro de "${p.name}"` }),
  },
  clubEvent: {
    de: (p) => ({ title: p.clubName, body: `Neues Event: ${p.eventName}` }),
    en: (p) => ({ title: p.clubName, body: `New event: ${p.eventName}` }),
    it: (p) => ({ title: p.clubName, body: `Nuovo evento: ${p.eventName}` }),
    fr: (p) => ({ title: p.clubName, body: `Nouvel événement : ${p.eventName}` }),
    es: (p) => ({ title: p.clubName, body: `Nuevo evento: ${p.eventName}` }),
  },
  newDeal: {
    de: (p) => ({ title: `Neues Angebot in ${p.city}`, body: p.dealText }),
    en: (p) => ({ title: `New deal in ${p.city}`, body: p.dealText }),
    it: (p) => ({ title: `Nuova offerta a ${p.city}`, body: p.dealText }),
    fr: (p) => ({ title: `Nouvelle offre à ${p.city}`, body: p.dealText }),
    es: (p) => ({ title: `Nueva oferta en ${p.city}`, body: p.dealText }),
  },
  friendRequest: {
    de: (p) => ({ title: 'Neue Freundschaftsanfrage', body: `${p.name} möchte dein Freund sein` }),
    en: (p) => ({ title: 'New friend request', body: `${p.name} wants to be your friend` }),
    it: (p) => ({ title: 'Nuova richiesta di amicizia', body: `${p.name} vuole essere tuo amico` }),
    fr: (p) => ({ title: "Nouvelle demande d'ami", body: `${p.name} souhaite devenir ton ami(e)` }),
    es: (p) => ({ title: 'Nueva solicitud de amistad', body: `${p.name} quiere ser tu amigo` }),
  },
  friendAccepted: {
    de: (p) => ({ title: 'Freundschaft bestätigt', body: `${p.name} hat deine Anfrage angenommen` }),
    en: (p) => ({ title: 'Friend request accepted', body: `${p.name} accepted your request` }),
    it: (p) => ({ title: 'Amicizia confermata', body: `${p.name} ha accettato la tua richiesta` }),
    fr: (p) => ({ title: 'Demande acceptée', body: `${p.name} a accepté ta demande` }),
    es: (p) => ({ title: 'Amistad confirmada', body: `${p.name} ha aceptado tu solicitud` }),
  },
  newLike: {
    de: (p) => ({ title: 'Neuer Like ❤️', body: p.groupName ? `${p.name} hat „${p.groupName}" geliked` : `${p.name} hat deinen Moment geliked` }),
    en: (p) => ({ title: 'New like ❤️', body: p.groupName ? `${p.name} liked "${p.groupName}"` : `${p.name} liked your moment` }),
    it: (p) => ({ title: 'Nuovo like ❤️', body: p.groupName ? `A ${p.name} piace "${p.groupName}"` : `A ${p.name} piace il tuo momento` }),
    fr: (p) => ({ title: 'Nouveau like ❤️', body: p.groupName ? `${p.name} a aimé "${p.groupName}"` : `${p.name} a aimé ton moment` }),
    es: (p) => ({ title: '¡Nuevo like! ❤️', body: p.groupName ? `A ${p.name} le gusta "${p.groupName}"` : `A ${p.name} le gusta tu momento` }),
  },
  newMember: {
    de: (p) => ({ title: 'Neues Mitglied', body: `${p.name} ist "${p.groupName}" beigetreten` }),
    en: (p) => ({ title: 'New member', body: `${p.name} joined "${p.groupName}"` }),
    it: (p) => ({ title: 'Nuovo membro', body: `${p.name} è entrato in "${p.groupName}"` }),
    fr: (p) => ({ title: 'Nouveau membre', body: `${p.name} a rejoint "${p.groupName}"` }),
    es: (p) => ({ title: 'Nuevo miembro', body: `${p.name} se ha unido a "${p.groupName}"` }),
  },
  // DM: with a preview the push reads like any messenger — sender as title,
  // text as body (Stefan 2026-09-06: "warum gibts keine vorschau der
  // nachrichten?"). Group chat has shipped previews since day one (groupMessage
  // below); the DM call site simply never passed the text. Recipients who don't
  // want text on the lock screen use iOS/Android "Show Previews", exactly as
  // for every other messenger. Without a preview the old generic line stays.
  newDm: {
    de: (p) => p.preview ? { title: p.name, body: p.preview } : { title: 'Neue Nachricht', body: `${p.name} hat dir eine Nachricht geschickt` },
    en: (p) => p.preview ? { title: p.name, body: p.preview } : { title: 'New message', body: `${p.name} sent you a message` },
    it: (p) => p.preview ? { title: p.name, body: p.preview } : { title: 'Nuovo messaggio', body: `${p.name} ti ha inviato un messaggio` },
    fr: (p) => p.preview ? { title: p.name, body: p.preview } : { title: 'Nouveau message', body: `${p.name} t'a envoyé un message` },
    es: (p) => p.preview ? { title: p.name, body: p.preview } : { title: 'Nuevo mensaje', body: `${p.name} te ha enviado un mensaje` },
  },
  // Group chat: title = group name (data), only the no-name fallback needs i18n.
  groupMessage: {
    de: (p) => ({ title: p.groupName || 'Neue Nachricht', body: p.line }),
    en: (p) => ({ title: p.groupName || 'New message', body: p.line }),
    it: (p) => ({ title: p.groupName || 'Nuovo messaggio', body: p.line }),
    fr: (p) => ({ title: p.groupName || 'Nouveau message', body: p.line }),
    es: (p) => ({ title: p.groupName || 'Nuevo mensaje', body: p.line }),
  },

  // ── Batch 1 (2026-09-06): event reminders, owner nudge, friend feed ──────
  // `time` is the organiser's typed wall-clock (formatted in SQL, may be null
  // for all-day), `count` includes the owner, `others` does not.
  // jobs/eventReminders.js · utils/friendActivity.js
  eventReminderDay: {
    de: (p) => ({ title: `Morgen: ${p.groupName}`, body: reminderBody(p, 'de') }),
    en: (p) => ({ title: `Tomorrow: ${p.groupName}`, body: reminderBody(p, 'en') }),
    it: (p) => ({ title: `Domani: ${p.groupName}`, body: reminderBody(p, 'it') }),
    fr: (p) => ({ title: `Demain : ${p.groupName}`, body: reminderBody(p, 'fr') }),
    es: (p) => ({ title: `Mañana: ${p.groupName}`, body: reminderBody(p, 'es') }),
  },
  // Sent 30–60 min before a TIMED event; "Heute 19:00" stays true at any lead.
  eventReminderHour: {
    de: (p) => ({ title: p.time ? `Heute ${p.time} · ${p.groupName}` : `Gleich: ${p.groupName}`, body: dots(p.location, 'Bis gleich! 👋') }),
    en: (p) => ({ title: p.time ? `Today ${p.time} · ${p.groupName}` : `Soon: ${p.groupName}`, body: dots(p.location, 'See you soon! 👋') }),
    it: (p) => ({ title: p.time ? `Oggi ${p.time} · ${p.groupName}` : `A breve: ${p.groupName}`, body: dots(p.location, 'A tra poco! 👋') }),
    fr: (p) => ({ title: p.time ? `Aujourd’hui ${p.time} · ${p.groupName}` : `Bientôt : ${p.groupName}`, body: dots(p.location, 'À tout à l’heure ! 👋') }),
    es: (p) => ({ title: p.time ? `Hoy ${p.time} · ${p.groupName}` : `Pronto: ${p.groupName}`, body: dots(p.location, '¡Hasta ahora! 👋') }),
  },
  // Owner, two days out, few sign-ups → the share nudge that drives the loop.
  ownerNudge: {
    de: (p) => ({ title: `Noch 2 Tage bis "${p.groupName}"`, body: p.others ? `Außer dir erst ${p.others} dabei – teile dein Event, damit's voll wird 🚀` : `Noch niemand dabei – teile dein Event, damit's voll wird 🚀` }),
    en: (p) => ({ title: `2 days until "${p.groupName}"`, body: p.others ? `Besides you, only ${p.others} so far – share it to fill the spots 🚀` : `Nobody's in yet – share it to fill the spots 🚀` }),
    it: (p) => ({ title: `Mancano 2 giorni a "${p.groupName}"`, body: p.others ? `Oltre a te solo ${p.others} finora – condividilo per riempire i posti 🚀` : `Ancora nessuno – condividilo per riempire i posti 🚀` }),
    fr: (p) => ({ title: `Plus que 2 jours avant « ${p.groupName} »`, body: p.others ? `À part toi, seulement ${p.others} pour l’instant – partage-le pour remplir les places 🚀` : `Personne pour l’instant – partage-le pour remplir les places 🚀` }),
    es: (p) => ({ title: `Faltan 2 días para "${p.groupName}"`, body: p.others ? `Aparte de ti, solo ${p.others} por ahora – compártelo para llenar las plazas 🚀` : `Aún nadie – compártelo para llenar las plazas 🚀` }),
  },
  friendJoined: {
    de: (p) => ({ title: `${p.name || SOMEONE.de} ist dabei`, body: `${p.name || SOMEONE.de} ist "${p.groupName}" beigetreten – auch dabei?` }),
    en: (p) => ({ title: `${p.name || SOMEONE.en} is in`, body: `${p.name || SOMEONE.en} joined "${p.groupName}" – you in too?` }),
    it: (p) => ({ title: `${p.name || SOMEONE.it} partecipa`, body: `${p.name || SOMEONE.it} partecipa a "${p.groupName}" – ci stai anche tu?` }),
    fr: (p) => ({ title: `${p.name || SOMEONE.fr} est de la partie`, body: `${p.name || SOMEONE.fr} a rejoint « ${p.groupName} » – tu en es aussi ?` }),
    es: (p) => ({ title: `${p.name || SOMEONE.es} se apunta`, body: `${p.name || SOMEONE.es} se ha unido a "${p.groupName}" – ¿te apuntas también?` }),
  },
  friendCreated: {
    de: (p) => ({ title: `Neu von ${p.name || SOMEONE.de}`, body: `${p.name || SOMEONE.de} hat "${p.groupName}" erstellt – bist du dabei?` }),
    en: (p) => ({ title: `New from ${p.name || SOMEONE.en}`, body: `${p.name || SOMEONE.en} created "${p.groupName}" – are you in?` }),
    it: (p) => ({ title: `Novità da ${p.name || SOMEONE.it}`, body: `${p.name || SOMEONE.it} ha creato "${p.groupName}" – ci stai?` }),
    fr: (p) => ({ title: `Du nouveau de ${p.name || SOMEONE.fr}`, body: `${p.name || SOMEONE.fr} a créé « ${p.groupName} » – tu en es ?` }),
    es: (p) => ({ title: `Novedad de ${p.name || SOMEONE.es}`, body: `${p.name || SOMEONE.es} ha creado "${p.groupName}" – ¿te apuntas?` }),
  },
};

/** Returns a BUILDER (locale) → { title, body } for pushController. */
export function pushTexts(key, params = {}) {
  const entry = PUSH_TEXTS[key];
  if (!entry) throw new Error(`pushTexts: unknown key ${key}`);
  return (locale) => (entry[normalizeLocale(locale)] || entry.de)(params);
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
  if (l === 'fr') return {
    title: `Nouveau groupe : ${name}`,
    body: `${category || 'Nouvelle activité'}${location ? ` à ${location}` : ''} – tu en es ?`,
  };
  if (l === 'es') return {
    title: `Nuevo grupo: ${name}`,
    body: `${category || 'Nueva actividad'}${location ? ` en ${location}` : ''} – ¿te apuntas?`,
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
  if (l === 'fr') return {
    title: n === 1 ? 'Un nouveau groupe de plus pour toi' : `${n} nouveaux groupes pour toi`,
    body: 'De nouveaux groupes dans tes catégories préférées aujourd’hui – jette un œil !',
  };
  if (l === 'es') return {
    title: n === 1 ? 'Un nuevo grupo más para ti' : `${n} nuevos grupos para ti`,
    body: 'Hoy han surgido grupos en tus categorías favoritas – ¡échales un vistazo!',
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
  const who = requesterName
    || (l === 'it' ? 'Qualcuno' : l === 'en' ? 'Someone' : l === 'fr' ? 'Quelqu’un' : l === 'es' ? 'Alguien' : 'Jemand');
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
  if (l === 'fr') return {
    title: `🎉 ${who} veut participer !`,
    body: groupName
      ? `${who} veut rejoindre « ${groupName} » – appuie pour répondre`
      : `${who} veut rejoindre ton groupe – appuie pour répondre`,
  };
  if (l === 'es') return {
    title: `🎉 ¡${who} quiere unirse!`,
    body: groupName
      ? `${who} quiere unirse a "${groupName}" – toca para responder`
      : `${who} quiere unirse a tu grupo – toca para responder`,
  };
  return {
    title: `🎉 ${who} will dabei sein!`,
    body: groupName
      ? `${who} möchte "${groupName}" beitreten – tippe, um zu antworten`
      : `${who} möchte deiner Gruppe beitreten – tippe, um zu antworten`,
  };
}
