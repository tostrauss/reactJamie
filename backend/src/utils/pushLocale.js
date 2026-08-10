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
  newDm: {
    de: (p) => ({ title: 'Neue Nachricht', body: `${p.name} hat dir eine Nachricht geschickt` }),
    en: (p) => ({ title: 'New message', body: `${p.name} sent you a message` }),
    it: (p) => ({ title: 'Nuovo messaggio', body: `${p.name} ti ha inviato un messaggio` }),
    fr: (p) => ({ title: 'Nouveau message', body: `${p.name} t'a envoyé un message` }),
    es: (p) => ({ title: 'Nuevo mensaje', body: `${p.name} te ha enviado un mensaje` }),
  },
  // Group chat: title = group name (data), only the no-name fallback needs i18n.
  groupMessage: {
    de: (p) => ({ title: p.groupName || 'Neue Nachricht', body: p.line }),
    en: (p) => ({ title: p.groupName || 'New message', body: p.line }),
    it: (p) => ({ title: p.groupName || 'Nuovo messaggio', body: p.line }),
    fr: (p) => ({ title: p.groupName || 'Nouveau message', body: p.line }),
    es: (p) => ({ title: p.groupName || 'Nuevo mensaje', body: p.line }),
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
