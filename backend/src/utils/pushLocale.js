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

// Voice-message label, per locale. A voice message stores a URL in `content`,
// so every surface that would show the text shows this instead.
const VOICE_LABEL = {
  de: '🎤 Sprachnachricht', en: '🎤 Voice message', it: '🎤 Messaggio vocale',
  fr: '🎤 Message vocal',   es: '🎤 Mensaje de voz',
};
const IMAGE_LABEL = {
  de: '📷 Foto', en: '📷 Photo', it: '📷 Foto', fr: '📷 Photo', es: '📷 Foto',
};
const mediaLabel = (p, l) => (p.isVoice ? VOICE_LABEL[l] : p.isImage ? IMAGE_LABEL[l] : null);
const groupLine = (p, l) => {
  const media = mediaLabel(p, l);
  return media ? `${p.sender}: ${media}` : (p.line || p.sender || '');
};

// DM push. A voice note shows its label; otherwise the pre-existing two shapes
// are untouched — preview present → sender as title, preview as body; preview
// withheld → generic title naming the sender in the body.
const DM_GENERIC = {
  de: (n) => ({ title: 'Neue Nachricht', body: `${n} hat dir eine Nachricht geschickt` }),
  en: (n) => ({ title: 'New message', body: `${n} sent you a message` }),
  it: (n) => ({ title: 'Nuovo messaggio', body: `${n} ti ha inviato un messaggio` }),
  fr: (n) => ({ title: 'Nouveau message', body: `${n} t'a envoyé un message` }),
  es: (n) => ({ title: 'Nuevo mensaje', body: `${n} te ha enviado un mensaje` }),
};
const dmTexts = (p, l) => {
  const media = mediaLabel(p, l);
  if (media) return { title: p.name, body: media };
  if (p.preview) return { title: p.name, body: p.preview };
  return DM_GENERIC[l](p.name);
};

// Report reason / entity labels for the admin moderation push. The German
// copies of these also exist in utils/reportContext.js, which is the source
// for the e-mail and the admin list; both render from the same DB enums
// (reports.reason, reports.reported_type) so they cannot describe different
// things — only the translation lives here, where every other push text does.
const REPORT_REASON = {
  de: { spam: 'Spam', inappropriate: 'Unangemessener Inhalt', harassment: 'Belästigung', fake: 'Fake-Profil', other: 'Sonstiges' },
  en: { spam: 'Spam', inappropriate: 'Inappropriate content', harassment: 'Harassment', fake: 'Fake profile', other: 'Other' },
  it: { spam: 'Spam', inappropriate: 'Contenuto inappropriato', harassment: 'Molestie', fake: 'Profilo falso', other: 'Altro' },
  fr: { spam: 'Spam', inappropriate: 'Contenu inapproprié', harassment: 'Harcèlement', fake: 'Faux profil', other: 'Autre' },
  es: { spam: 'Spam', inappropriate: 'Contenido inapropiado', harassment: 'Acoso', fake: 'Perfil falso', other: 'Otro' },
};
const REPORT_TYPE = {
  de: { user: 'Nutzer', group: 'Gruppe', message: 'Nachricht' },
  en: { user: 'User', group: 'Group', message: 'Message' },
  it: { user: 'Utente', group: 'Gruppo', message: 'Messaggio' },
  fr: { user: 'Utilisateur', group: 'Groupe', message: 'Message' },
  es: { user: 'Usuario', group: 'Grupo', message: 'Mensaje' },
};
// Headline + the pre-2026-09-15 generic fallback, per locale.
const REPORT_HEAD = {
  de: { lead: 'Meldung', fallbackTitle: 'Neue Meldung', fallbackBody: 'Eine neue Meldung ist eingegangen' },
  en: { lead: 'Report', fallbackTitle: 'New report', fallbackBody: 'A new report came in' },
  it: { lead: 'Segnalazione', fallbackTitle: 'Nuova segnalazione', fallbackBody: 'È arrivata una nuova segnalazione' },
  fr: { lead: 'Signalement :', fallbackTitle: 'Nouveau signalement', fallbackBody: 'Un nouveau signalement est arrivé' },
  es: { lead: 'Denuncia', fallbackTitle: 'Nueva denuncia', fallbackBody: 'Ha llegado una nueva denuncia' },
};
// One builder shape for all five locales — the only thing that varies is the
// label table, so spelling the body out five times would just be five chances
// to let them drift.
const reportAdminTexts = () => Object.fromEntries(
  Object.keys(REPORT_HEAD).map((l) => [l, (p = {}) => {
    const reason = REPORT_REASON[l][p.reason];
    if (!reason || !p.target) {
      return { title: REPORT_HEAD[l].fallbackTitle, body: REPORT_HEAD[l].fallbackBody };
    }
    const lead = REPORT_HEAD[l].lead;
    return {
      title: `${lead}${lead.endsWith(':') ? '' : ':'} ${reason}`,
      body: `${REPORT_TYPE[l][p.type] || ''} ${p.target}`.trim(),
    };
  }]),
);
// "19:00 · 6 dabei · Prater" — time and location only when present.
const reminderBody = (p, l) => dots(p.time, GOING[l](p.count), p.location);

// ── Batch 2 (2026-09-07): lifecycle pushes — edit, cancel, close ──────────
// Only the fields that ACTUALLY changed are passed (when when the date/time
// moved, location when the place moved), so the body names exactly what the
// member has to re-check. `when` is preformatted wall-clock (groupController
// formatEventWhen) — locale-neutral numbers, one CET approximation like the
// reminder cron.
const WHEN_LABEL  = { de: 'Neuer Termin', en: 'New time', it: 'Nuovo orario', fr: 'Nouvel horaire', es: 'Nueva hora' };
const WHERE_LABEL = { de: 'Neuer Ort',    en: 'New place', it: 'Nuovo luogo', fr: 'Nouveau lieu',   es: 'Nuevo lugar' };
const EDIT_FALLBACK = { de: 'Details wurden aktualisiert', en: 'Details were updated', it: 'I dettagli sono stati aggiornati', fr: 'Les détails ont été mis à jour', es: 'Se han actualizado los detalles' };
const editBody = (p, l) => {
  const parts = [];
  if (p.when) parts.push(`${WHEN_LABEL[l]}: ${p.when}`);
  if (p.location) parts.push(`${WHERE_LABEL[l]}: ${p.location}`);
  return parts.length ? parts.join(' · ') : EDIT_FALLBACK[l];
};

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
  // `isVoice` instead of a pre-rendered preview string: the recipient's locale
  // is resolved per subscription, AFTER the caller built its params — so a
  // label chosen at the call site would be German for every market.
  //
  // The no-preview shape (title "Neue Nachricht", body naming the sender) is
  // deliberate and unchanged — it is what a push looks like when the preview
  // is withheld, and the tests pin it.
  newDm: {
    de: (p) => dmTexts(p, 'de'),
    en: (p) => dmTexts(p, 'en'),
    it: (p) => dmTexts(p, 'it'),
    fr: (p) => dmTexts(p, 'fr'),
    es: (p) => dmTexts(p, 'es'),
  },
  // Group chat: title = group name (data), only the no-name fallback needs i18n.
  // `sender` + isVoice rather than a pre-joined `line`, for the same reason as
  // newDm: only the per-recipient builder knows which language to label in.
  // `line` is still honoured so nothing breaks mid-migration.
  groupMessage: {
    de: (p) => ({ title: p.groupName || 'Neue Nachricht', body: groupLine(p, 'de') }),
    en: (p) => ({ title: p.groupName || 'New message', body: groupLine(p, 'en') }),
    it: (p) => ({ title: p.groupName || 'Nuovo messaggio', body: groupLine(p, 'it') }),
    fr: (p) => ({ title: p.groupName || 'Nouveau message', body: groupLine(p, 'fr') }),
    es: (p) => ({ title: p.groupName || 'Nuevo mensaje', body: groupLine(p, 'es') }),
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

  // ── Batch 2 (2026-09-07): lifecycle — event edit, cancel, club close ──────
  // The de() output is REUSED verbatim as the in-app notification row (so push
  // and the in-app entry read identically); the other locales localise the
  // push. `p.reason` is the owner's optional cancellation note.
  eventEdited: {
    de: (p) => ({ title: `Änderung: ${p.groupName}`, body: editBody(p, 'de') }),
    en: (p) => ({ title: `Change: ${p.groupName}`, body: editBody(p, 'en') }),
    it: (p) => ({ title: `Modifica: ${p.groupName}`, body: editBody(p, 'it') }),
    fr: (p) => ({ title: `Changement : ${p.groupName}`, body: editBody(p, 'fr') }),
    es: (p) => ({ title: `Cambio: ${p.groupName}`, body: editBody(p, 'es') }),
  },
  // Used by cancelGroup (is_active=FALSE) AND deleteGroup/deleteClubEvent
  // (deleted_at) — from the member's view an event that won't happen. The de
  // title/body match the strings cancelGroup shipped before, so the in-app row
  // is unchanged; only the push is now localised.
  eventCancelled: {
    de: (p) => ({ title: `${p.groupName} wurde abgesagt`, body: p.reason || 'Das Event wurde vom Ersteller abgesagt.' }),
    en: (p) => ({ title: `${p.groupName} was cancelled`, body: p.reason || 'The event was cancelled by the organiser.' }),
    it: (p) => ({ title: `${p.groupName} è stato annullato`, body: p.reason || "L'evento è stato annullato dall'organizzatore." }),
    fr: (p) => ({ title: `${p.groupName} a été annulé`, body: p.reason || "L'événement a été annulé par l'organisateur." }),
    es: (p) => ({ title: `${p.groupName} se ha cancelado`, body: p.reason || 'El organizador ha cancelado el evento.' }),
  },
  // Used by cancelClub + deleteClub. de matches the previous cancelClub strings.
  clubClosed: {
    de: (p) => ({ title: `${p.groupName} wurde geschlossen`, body: p.reason || 'Der Club wurde vom Ersteller geschlossen.' }),
    en: (p) => ({ title: `${p.groupName} was closed`, body: p.reason || 'The club was closed by the owner.' }),
    it: (p) => ({ title: `${p.groupName} è stato chiuso`, body: p.reason || 'Il club è stato chiuso dal proprietario.' }),
    fr: (p) => ({ title: `${p.groupName} a été fermé`, body: p.reason || 'Le club a été fermé par le propriétaire.' }),
    es: (p) => ({ title: `${p.groupName} se ha cerrado`, body: p.reason || 'El propietario ha cerrado el club.' }),
  },

  // ── Batch 3 (2026-09-07): Tier 2/3 engagement + ops ───────────────────────
  // Invitee added directly (inviteMember has no accept step) — they only learned
  // by opening the app before.
  groupInvite: {
    de: (p) => ({ title: 'Neue Einladung', body: `Du wurdest zu "${p.groupName}" hinzugefügt 🎉` }),
    en: (p) => ({ title: 'New invite', body: `You were added to "${p.groupName}" 🎉` }),
    it: (p) => ({ title: 'Nuovo invito', body: `Sei stato aggiunto a "${p.groupName}" 🎉` }),
    fr: (p) => ({ title: 'Nouvelle invitation', body: `Tu as été ajouté à « ${p.groupName} » 🎉` }),
    es: (p) => ({ title: 'Nueva invitación', body: `Te han añadido a "${p.groupName}" 🎉` }),
  },
  clubApproved: {
    de: (p) => ({ title: 'Club freigeschaltet 🎉', body: `"${p.groupName}" ist jetzt öffentlich sichtbar` }),
    en: (p) => ({ title: 'Club approved 🎉', body: `"${p.groupName}" is now public` }),
    it: (p) => ({ title: 'Club approvato 🎉', body: `"${p.groupName}" ora è pubblico` }),
    fr: (p) => ({ title: 'Club validé 🎉', body: `« ${p.groupName} » est maintenant public` }),
    es: (p) => ({ title: 'Club aprobado 🎉', body: `"${p.groupName}" ya es público` }),
  },
  clubRejected: {
    de: (p) => ({ title: 'Club nicht freigegeben', body: `"${p.groupName}" wurde leider nicht freigegeben.` }),
    en: (p) => ({ title: 'Club not approved', body: `"${p.groupName}" was not approved.` }),
    it: (p) => ({ title: 'Club non approvato', body: `"${p.groupName}" non è stato approvato.` }),
    fr: (p) => ({ title: 'Club non validé', body: `« ${p.groupName} » n'a pas été validé.` }),
    es: (p) => ({ title: 'Club no aprobado', body: `"${p.groupName}" no ha sido aprobado.` }),
  },
  // To ADMINS: a new club is waiting for review.
  clubPendingAdmin: {
    de: (p) => ({ title: 'Neuer Club wartet auf Freigabe', body: `"${p.groupName}" möchte freigeschaltet werden` }),
    en: (p) => ({ title: 'New club awaiting approval', body: `"${p.groupName}" is waiting for review` }),
    it: (p) => ({ title: 'Nuovo club in attesa', body: `"${p.groupName}" attende l'approvazione` }),
    fr: (p) => ({ title: 'Nouveau club à valider', body: `« ${p.groupName} » attend une validation` }),
    es: (p) => ({ title: 'Nuevo club pendiente', body: `"${p.groupName}" espera aprobación` }),
  },
  // To ADMINS: a new report came in.
  //
  // The body used to be the constant "Eine neue Meldung ist eingegangen" — it
  // told an admin that something happened but never what, so the push could
  // only ever mean "go open the database". It now names the reason and the
  // target, which is enough to decide whether this needs attention right now.
  //
  // `p.target` is pre-rendered by describeTarget() (utils/reportContext.js):
  // a target name is user content and is NOT translatable. The reason and the
  // entity type ARE, so they travel as the raw enum values and get their label
  // here — passing the server's German labels straight through would have
  // handed an en/fr/es admin a half-German push.
  //
  // Degrades to the old generic wording when a param is missing rather than
  // pushing "Meldung: undefined": the notification is best-effort (its context
  // lookup can fail after the report row is already committed), and a vague
  // alert is still actionable while a broken one is not.
  reportAdmin: reportAdminTexts(),
  // Positive only — a demotion is deliberately NOT pushed (see removeClubManager).
  managerAdded: {
    de: (p) => ({ title: 'Du bist jetzt Manager 🎉', body: `Du kannst "${p.groupName}" jetzt mitverwalten` }),
    en: (p) => ({ title: 'You are now a manager 🎉', body: `You can now help manage "${p.groupName}"` }),
    it: (p) => ({ title: 'Ora sei manager 🎉', body: `Ora puoi gestire "${p.groupName}"` }),
    fr: (p) => ({ title: 'Tu es maintenant manager 🎉', body: `Tu peux désormais gérer « ${p.groupName} »` }),
    es: (p) => ({ title: 'Ahora eres manager 🎉', body: `Ya puedes gestionar "${p.groupName}"` }),
  },
  // Post-event: nudge attendees to review (drives the trusted-badge funnel).
  reviewNudge: {
    de: (p) => ({ title: `Wie war "${p.groupName}"?`, body: 'Bewerte, wer dabei war 🌟' }),
    en: (p) => ({ title: `How was "${p.groupName}"?`, body: 'Rate who was there 🌟' }),
    it: (p) => ({ title: `Com'è andata "${p.groupName}"?`, body: 'Valuta chi c\'era 🌟' }),
    fr: (p) => ({ title: `Comment était « ${p.groupName} » ?`, body: 'Note les participants 🌟' }),
    es: (p) => ({ title: `¿Qué tal "${p.groupName}"?`, body: 'Valora a quienes asistieron 🌟' }),
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
