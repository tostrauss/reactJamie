import { describe, it, expect } from 'vitest';
import {
  normalizeLocale,
  pushTexts,
  categoryPushText,
  categoryDigestText,
  joinRequestText,
} from '../../src/utils/pushLocale.js';

describe('normalizeLocale', () => {
  it('maps language tags to de/it/en/fr/es with German fallback', () => {
    expect(normalizeLocale('de')).toBe('de');
    expect(normalizeLocale('de-AT')).toBe('de');
    expect(normalizeLocale('it-IT')).toBe('it');
    expect(normalizeLocale('EN-us')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('fr'); // France rollout 2026-08-04
    expect(normalizeLocale('es-ES')).toBe('es'); // Spain rollout 2026-08-04
    expect(normalizeLocale('pt')).toBe('de');   // unsupported → primary market
    expect(normalizeLocale(null)).toBe('de');
    expect(normalizeLocale('')).toBe('de');
  });
});

describe('categoryPushText', () => {
  const group = { name: 'Fußball im Prater', category: 'Fußball', location: 'Wien' };

  it('renders each locale with name, category and location', () => {
    expect(categoryPushText('de', group)).toEqual({
      title: 'Neue Gruppe: Fußball im Prater',
      body: 'Fußball in Wien – bist du dabei?',
    });
    expect(categoryPushText('it', group).body).toBe('Fußball in Wien – ci stai?');
    expect(categoryPushText('en', group).body).toBe('Fußball in Wien – are you in?');
    expect(categoryPushText('fr', group).body).toBe('Fußball à Wien – tu en es ?');
    expect(categoryPushText('es', group).body).toBe('Fußball en Wien – ¿te apuntas?');
  });

  it('omits the location clause when the group has none', () => {
    expect(categoryPushText('de', { name: 'X', category: 'Yoga' }).body)
      .toBe('Yoga – bist du dabei?');
  });
});

describe('categoryDigestText', () => {
  it('singular vs plural per locale', () => {
    expect(categoryDigestText('de', 1).title).toBe('Eine weitere neue Gruppe für dich');
    expect(categoryDigestText('de', 3).title).toBe('3 weitere neue Gruppen für dich');
    expect(categoryDigestText('it', 2).title).toBe('2 altri nuovi gruppi per te');
    expect(categoryDigestText('en', 1).title).toBe('One more new group for you');
  });
});

describe('joinRequestText', () => {
  it('celebrates with the requester name and group name', () => {
    const { title, body } = joinRequestText('de', { requesterName: 'Alexander', groupName: 'Spieleabend' });
    expect(title).toBe('🎉 Alexander will dabei sein!');
    expect(body).toContain('"Spieleabend"');
  });

  it('falls back gracefully without names', () => {
    const { title } = joinRequestText('en', {});
    expect(title).toBe('🎉 Someone wants to join!');
    expect(joinRequestText('it', {}).title).toBe('🎉 Qualcuno vuole unirsi!');
    expect(joinRequestText('fr', {}).title).toBe('🎉 Quelqu’un veut participer !');
    expect(joinRequestText('es', {}).title).toBe('🎉 ¡Alguien quiere unirse!');
  });
});

// pushTexts returns a BUILDER (locale) → { title, body }; pushController resolves
// the recipient's users.locale and calls it. Pinned here because the DM entry
// gained a preview branch (2026-09-06) and the whole catalog had no test before.
describe('pushTexts', () => {
  it('throws on an unknown key instead of sending an empty push', () => {
    expect(() => pushTexts('nope')).toThrow(/unknown key nope/);
  });

  describe('newDm', () => {
    it('with a preview reads like a messenger: sender as title, text as body, in every locale', () => {
      const build = pushTexts('newDm', { name: 'Tobi', preview: 'kommst heute?' });
      for (const l of ['de', 'en', 'it', 'fr', 'es']) {
        expect(build(l)).toEqual({ title: 'Tobi', body: 'kommst heute?' });
      }
    });

    it('without a preview keeps the generic per-locale line', () => {
      const build = pushTexts('newDm', { name: 'Tobi' });
      expect(build('de')).toEqual({ title: 'Neue Nachricht', body: 'Tobi hat dir eine Nachricht geschickt' });
      expect(build('en')).toEqual({ title: 'New message', body: 'Tobi sent you a message' });
      expect(build('it').title).toBe('Nuovo messaggio');
      expect(build('fr').title).toBe('Nouveau message');
      expect(build('es').title).toBe('Nuevo mensaje');
    });

    it('treats an empty preview as none (content is validated non-empty upstream — defensive)', () => {
      expect(pushTexts('newDm', { name: 'Tobi', preview: '' })('de').title).toBe('Neue Nachricht');
    });

    it('falls back to German for unsupported locales like the rest of the file', () => {
      expect(pushTexts('newDm', { name: 'Tobi' })('pt').title).toBe('Neue Nachricht');
    });
  });

  describe('groupMessage (the DM preview mirrors this contract)', () => {
    it('uses the group name as title and the "Sender: text" line as body', () => {
      const build = pushTexts('groupMessage', { groupName: 'Fußball im Prater', line: 'Tobi: bin da' });
      expect(build('it')).toEqual({ title: 'Fußball im Prater', body: 'Tobi: bin da' });
    });

    it('only the no-name title fallback is localised', () => {
      const build = pushTexts('groupMessage', { line: 'Tobi: bin da' });
      expect(build('de').title).toBe('Neue Nachricht');
      expect(build('en').title).toBe('New message');
      expect(build('es').title).toBe('Nuevo mensaje');
    });
  });

  // ── Batch 1 (2026-09-06): reminders, owner nudge, friend feed ─────────────
  describe('eventReminderDay', () => {
    it('joins time · count · location with middle dots, per locale', () => {
      const build = pushTexts('eventReminderDay', { groupName: 'Bar Abend', time: '19:00', count: 6, location: 'Prater' });
      expect(build('de')).toEqual({ title: 'Morgen: Bar Abend', body: '19:00 · 6 dabei · Prater' });
      expect(build('en').body).toBe('19:00 · 6 going · Prater');
      expect(build('fr').title).toBe('Demain : Bar Abend');
    });

    it('all-day event without location collapses to just the count (singular)', () => {
      const build = pushTexts('eventReminderDay', { groupName: 'Picknick', time: null, count: 1, location: null });
      expect(build('de').body).toBe('1 dabei');
      expect(build('it').body).toBe('1 partecipante');
      expect(build('es').body).toBe('1 apuntado');
    });

    it('pluralises the count where the language needs it', () => {
      const build = pushTexts('eventReminderDay', { groupName: 'Picknick', time: null, count: 2, location: null });
      expect(build('it').body).toBe('2 partecipanti');
      expect(build('fr').body).toBe('2 participants');
      expect(build('es').body).toBe('2 apuntados');
    });

    it('falls back to German for unsupported locales', () => {
      const build = pushTexts('eventReminderDay', { groupName: 'Bar Abend', time: '19:00', count: 6, location: 'Prater' });
      expect(build('pt').title).toBe('Morgen: Bar Abend');
    });
  });

  describe('eventReminderHour', () => {
    it('puts the wall-clock time in the title and a see-you-soon line in the body', () => {
      const build = pushTexts('eventReminderHour', { groupName: 'Tennis', time: '19:00' });
      // Middle dot, not a colon: "19:00: Tennis" read like a seconds separator
      // on the lock screen (review 2026-09-06).
      expect(build('de')).toEqual({ title: 'Heute 19:00 · Tennis', body: 'Bis gleich! 👋' });
      expect(build('en').title).toBe('Today 19:00 · Tennis');
    });

    it('prefixes the location to the body when present', () => {
      const build = pushTexts('eventReminderHour', { groupName: 'Tennis', time: '19:00', location: 'Prater' });
      expect(build('de').body).toBe('Prater · Bis gleich! 👋');
    });

    it('without a time the title says "Gleich" / "Soon"', () => {
      const build = pushTexts('eventReminderHour', { groupName: 'Tennis', time: null });
      expect(build('de').title).toBe('Gleich: Tennis');
      expect(build('en').title).toBe('Soon: Tennis');
    });
  });

  describe('ownerNudge', () => {
    it('names the count of others when there are some', () => {
      const build = pushTexts('ownerNudge', { groupName: 'Bar Abend', others: 1 });
      expect(build('de')).toEqual({
        title: 'Noch 2 Tage bis "Bar Abend"',
        // "Außer dir": the day-before push says "2 dabei" (incl. owner) for the
        // same event — the nudge must make its owner-excluded basis explicit.
        body: "Außer dir erst 1 dabei – teile dein Event, damit's voll wird 🚀",
      });
      expect(pushTexts('ownerNudge', { groupName: 'Bar Abend', others: 3 })('en').body).toMatch(/^Besides you, only 3 so far/);
    });

    it('switches to a "nobody yet" line at zero', () => {
      const build = pushTexts('ownerNudge', { groupName: 'Bar Abend', others: 0 });
      expect(build('de').body).toMatch(/^Noch niemand dabei/);
      expect(build('en').body).toMatch(/^Nobody's in yet/);
    });
  });

  describe('friendJoined', () => {
    it('leads with the friend name in title and body', () => {
      const build = pushTexts('friendJoined', { name: 'Lisa', groupName: 'Bar Abend' });
      expect(build('de')).toEqual({ title: 'Lisa ist dabei', body: 'Lisa ist "Bar Abend" beigetreten – auch dabei?' });
      expect(build('en').title).toBe('Lisa is in');
    });

    it('falls back to a localised "Someone" when the name is empty', () => {
      const build = pushTexts('friendJoined', { name: '', groupName: 'Bar Abend' });
      expect(build('de').title).toBe('Jemand ist dabei');
      expect(build('en').title).toBe('Someone is in');
      expect(build('it').title).toBe('Qualcuno partecipa');
      expect(build('es').title).toBe('Alguien se apunta');
    });
  });

  describe('friendCreated', () => {
    it('announces the new event by its creator', () => {
      const build = pushTexts('friendCreated', { name: 'Lisa', groupName: 'Bar Abend' });
      expect(build('de')).toEqual({ title: 'Neu von Lisa', body: 'Lisa hat "Bar Abend" erstellt – bist du dabei?' });
      expect(build('fr').body).toContain('« Bar Abend »');
    });

    it('falls back to "Someone" when the name is missing entirely', () => {
      expect(pushTexts('friendCreated', { groupName: 'Bar Abend' })('en').title).toBe('New from Someone');
    });
  });

  // ── Batch 2 (2026-09-07): lifecycle keys ──────────────────────────────────
  describe('eventEdited', () => {
    it('names ONLY the fields that changed, joined with a middle dot', () => {
      const both = pushTexts('eventEdited', { groupName: 'Yoga', when: '12.09. 19:00', location: 'Prater' });
      expect(both('de')).toEqual({ title: 'Änderung: Yoga', body: 'Neuer Termin: 12.09. 19:00 · Neuer Ort: Prater' });
      expect(both('en')).toEqual({ title: 'Change: Yoga', body: 'New time: 12.09. 19:00 · New place: Prater' });
    });
    it('a location-only change omits the time clause', () => {
      expect(pushTexts('eventEdited', { groupName: 'Yoga', location: 'Prater' })('de').body).toBe('Neuer Ort: Prater');
    });
    it('falls back to a generic line when neither field is passed, per locale', () => {
      expect(pushTexts('eventEdited', { groupName: 'Yoga' })('de').body).toBe('Details wurden aktualisiert');
      expect(pushTexts('eventEdited', { groupName: 'Yoga' })('fr').body).toBe('Les détails ont été mis à jour');
    });
  });

  describe('eventCancelled / clubClosed', () => {
    // The de() output MUST equal the German strings cancelGroup/cancelClub
    // shipped before Batch 2 — the in-app row reuses it and must not change.
    it('eventCancelled de matches the legacy in-app string; reason overrides the default; localises', () => {
      expect(pushTexts('eventCancelled', { groupName: 'Yoga' })('de'))
        .toEqual({ title: 'Yoga wurde abgesagt', body: 'Das Event wurde vom Ersteller abgesagt.' });
      expect(pushTexts('eventCancelled', { groupName: 'Yoga', reason: 'Regen' })('de').body).toBe('Regen');
      expect(pushTexts('eventCancelled', { groupName: 'Yoga' })('es').title).toBe('Yoga se ha cancelado');
    });
    it('clubClosed de matches the legacy in-app string; localises', () => {
      expect(pushTexts('clubClosed', { groupName: 'Club X' })('de'))
        .toEqual({ title: 'Club X wurde geschlossen', body: 'Der Club wurde vom Ersteller geschlossen.' });
      expect(pushTexts('clubClosed', { groupName: 'Club X' })('it').title).toBe('Club X è stato chiuso');
    });
  });

  // ── Batch 3 (2026-09-07): Tier 2/3 keys ───────────────────────────────────
  describe('Batch 3 lifecycle/ops keys', () => {
    it('groupInvite names the group, per locale', () => {
      expect(pushTexts('groupInvite', { groupName: 'Yoga' })('de')).toEqual({ title: 'Neue Einladung', body: 'Du wurdest zu "Yoga" hinzugefügt 🎉' });
      expect(pushTexts('groupInvite', { groupName: 'Yoga' })('fr').title).toBe('Nouvelle invitation');
    });
    it('clubApproved / clubRejected localise', () => {
      expect(pushTexts('clubApproved', { groupName: 'Club X' })('de').title).toBe('Club freigeschaltet 🎉');
      expect(pushTexts('clubApproved', { groupName: 'Club X' })('en').body).toBe('"Club X" is now public');
      expect(pushTexts('clubRejected', { groupName: 'Club X' })('de').title).toBe('Club nicht freigegeben');
    });
    it('clubPendingAdmin is the admin ops text', () => {
      expect(pushTexts('clubPendingAdmin', { groupName: 'Club X' })('de').title).toBe('Neuer Club wartet auf Freigabe');
    });

    // Tina 16.11.2026: the admin sees whether a club or a community waits
    // (a community only queues from an old bundle that sends no type).
    it('clubPendingAdmin names a community as one, per locale — the body unchanged', () => {
      const club = pushTexts('clubPendingAdmin', { groupName: 'Lauftreff', isCommunity: false });
      const community = pushTexts('clubPendingAdmin', { groupName: 'Lauftreff', isCommunity: true });
      expect(club('de')).toEqual({ title: 'Neuer Club wartet auf Freigabe', body: '"Lauftreff" möchte freigeschaltet werden' });
      expect(community('de')).toEqual({ title: 'Neue Community wartet auf Freigabe', body: '"Lauftreff" möchte freigeschaltet werden' });
      expect(community('en').title).toBe('New community awaiting approval');
      expect(community('it').title).toBe('Nuova community in attesa');
      expect(community('fr').title).toBe('Nouvelle communauté à valider');
      expect(community('es').title).toBe('Nueva comunidad pendiente');
      for (const l of ['de', 'en', 'it', 'fr', 'es']) {
        expect(community(l).title, l).not.toBe(club(l).title);
        expect(community(l).body, l).toBe(club(l).body);
      }
    });

    // Tina 17.11.2026: a club sent the „JAMIE Anfrage“ form from the partner
    // message — the admins hear which club, in their language, and no price.
    it('partnerLeadAdmin names the club that asks, per locale', () => {
      const b = pushTexts('partnerLeadAdmin', { groupName: 'Café Soleá' });
      expect(b('de')).toEqual({ title: 'Neue Partner-Anfrage 🤝', body: '"Café Soleá" möchte JAMIE Partner werden' });
      expect(b('en')).toEqual({ title: 'New partner request 🤝', body: '"Café Soleá" wants to become a JAMIE partner' });
      expect(b('it')).toEqual({ title: 'Nuova richiesta partner 🤝', body: '"Café Soleá" vuole diventare partner di JAMIE' });
      expect(b('fr')).toEqual({ title: 'Nouvelle demande de partenariat 🤝', body: '« Café Soleá » veut devenir partenaire JAMIE' });
      expect(b('es')).toEqual({ title: 'Nueva solicitud de partner 🤝', body: '"Café Soleá" quiere ser partner de JAMIE' });
      for (const l of ['de', 'en', 'it', 'fr', 'es']) {
        expect(`${b(l).title} ${b(l).body}`, l).not.toMatch(/€|\d/);
      }
    });

    // reportAdmin used to be a constant ("Eine neue Meldung ist eingegangen"),
    // which told an admin that something happened but never what. It now names
    // the reason and the reported target.
    it('reportAdmin names the reason and the target, per locale', () => {
      const b = pushTexts('reportAdmin', { reason: 'harassment', type: 'user', target: '„Anna K.“ (#984)' });
      expect(b('de')).toEqual({ title: 'Meldung: Belästigung', body: 'Nutzer „Anna K.“ (#984)' });
      expect(b('en')).toEqual({ title: 'Report: Harassment', body: 'User „Anna K.“ (#984)' });
      expect(b('es').title).toBe('Denuncia: Acoso');
      // French puts a space before the colon and carries it in the lead itself
      // — the builder must not then append a second one.
      expect(b('fr').title).toBe('Signalement : Harcèlement');
    });

    it('reportAdmin falls back to the generic text when context is missing', () => {
      // The context lookup is best-effort and runs AFTER the report row is
      // committed, so it can legitimately fail. A vague push is still
      // actionable; "Meldung: undefined" is not.
      expect(pushTexts('reportAdmin', {})('de')).toEqual({ title: 'Neue Meldung', body: 'Eine neue Meldung ist eingegangen' });
      expect(pushTexts('reportAdmin', {})('es').title).toBe('Nueva denuncia');
      expect(pushTexts('reportAdmin', { reason: 'spam' })('de').title).toBe('Neue Meldung');
      expect(pushTexts('reportAdmin', { target: 'x' })('de').title).toBe('Neue Meldung');
    });
    it('managerAdded is positive, per locale', () => {
      expect(pushTexts('managerAdded', { groupName: 'Club X' })('de').title).toBe('Du bist jetzt Manager 🎉');
      expect(pushTexts('managerAdded', { groupName: 'Club X' })('it').title).toBe('Ora sei manager 🎉');
    });
    it('reviewNudge asks how the event was, per locale', () => {
      expect(pushTexts('reviewNudge', { groupName: 'Bar Abend' })('de')).toEqual({ title: 'Wie war "Bar Abend"?', body: 'Bewerte, wer dabei war 🌟' });
      expect(pushTexts('reviewNudge', { groupName: 'Bar Abend' })('en').title).toBe('How was "Bar Abend"?');
    });
  });

  // S2 (Tina, 16.11.2026): the memory push moved to the day after the event,
  // two hours behind the review push „Wie war "X"?“ — so it no longer asks
  // „Wie war X?“ itself. The body stays.
  describe('momentPrompt', () => {
    it('names the memory, never „Wie war“, in all five languages', () => {
      const b = pushTexts('momentPrompt', { groupName: 'Punsch Night' });
      expect(b('de')).toEqual({ title: '📷 Deine Memory von Punsch Night', body: 'Lade ein Foto hoch und halte den Moment fest!' });
      expect(b('en')).toEqual({ title: '📷 Your Memory of Punsch Night', body: 'Upload a photo and keep the moment!' });
      expect(b('it')).toEqual({ title: '📷 La tua Memory di Punsch Night', body: 'Carica una foto e conserva il momento!' });
      expect(b('fr')).toEqual({ title: '📷 Ta Memory de Punsch Night', body: 'Ajoute une photo et garde ce moment !' });
      expect(b('es')).toEqual({ title: '📷 Tu Memory de Punsch Night', body: '¡Sube una foto y guarda el momento!' });
      expect(b('pt').title).toBe('📷 Deine Memory von Punsch Night');
      expect(b('de').title).not.toBe(pushTexts('reviewNudge', { groupName: 'Punsch Night' })('de').title);
    });
  });

  // S2 (Tina, 16.11.2026): ONE push while the event runs — her three lines,
  // the variant picked per event by the job (pickLiveVariant).
  describe('livePhotoPrompt', () => {
    const line = (variant, l) => pushTexts('livePhotoPrompt', { groupName: 'Bowling', variant })(l);

    it('Tina\'s three German lines, the event name in every title', () => {
      expect(line(0, 'de')).toEqual({ title: "Wie gefällt's dir bei Bowling?", body: 'Schnapp dir ein Foto für deine Memories! 📸' });
      expect(line(1, 'de')).toEqual({ title: "Na, wie läuft's bei Bowling? 📸", body: 'Halt den Moment fest!' });
      expect(line(2, 'de')).toEqual({ title: 'Gute Stimmung bei Bowling?', body: "Mach schnell ein Foto, morgen wird's deine Memory ✨" });
    });

    it('three different lines in every language, each naming the event', () => {
      for (const l of ['de', 'en', 'it', 'fr', 'es']) {
        const titles = [0, 1, 2].map((v) => line(v, l).title);
        expect(new Set(titles).size, l).toBe(3);
        for (const t of titles) expect(t, l).toContain('Bowling');
        for (const v of [0, 1, 2]) expect(line(v, l).body, `${l} ${v}`).toBeTruthy();
      }
      expect(line(0, 'en')).toEqual({ title: 'Enjoying Bowling?', body: 'Grab a photo for your Memories! 📸' });
      expect(line(1, 'it').title).toBe('Allora, come va a Bowling? 📸');
      expect(line(2, 'fr').body).toBe('Prends vite une photo, demain ce sera ta Memory ✨');
      expect(line(2, 'es').title).toBe('¿Buen ambiente en Bowling?');
    });

    it('falls back to German and wraps a variant it does not know instead of sending nothing', () => {
      expect(line(1, 'pt')).toEqual(line(1, 'de'));
      expect(line(3, 'de')).toEqual(line(0, 'de'));
      expect(line(undefined, 'de')).toEqual(line(0, 'de'));
      expect(pushTexts('livePhotoPrompt', { variant: 0 })('de').title).not.toContain('undefined');
    });
  });

  // Ziel 4 (Tina, 16.11.2026): being let into a private event is the moment
  // „anfragen“ pays off — as celebratory as the host's „🎉 X will dabei sein!“.
  describe('joinAccepted', () => {
    it('celebrates and names the group or event, in all five languages', () => {
      const b = pushTexts('joinAccepted', { name: 'Punsch Night' });
      expect(b('de')).toEqual({ title: '🎉 Du bist dabei!', body: 'Deine Anfrage für „Punsch Night“ wurde angenommen' });
      expect(b('en')).toEqual({ title: "🎉 You're in!", body: 'Your request for "Punsch Night" was accepted' });
      expect(b('it')).toEqual({ title: '🎉 Sei dentro!', body: 'La tua richiesta per "Punsch Night" è stata accettata' });
      expect(b('fr')).toEqual({ title: '🎉 Tu en es !', body: 'Ta demande pour « Punsch Night » a été acceptée' });
      expect(b('es')).toEqual({ title: '🎉 ¡Estás dentro!', body: 'Tu solicitud para "Punsch Night" ha sido aceptada' });
      expect(b('pt').title).toBe('🎉 Du bist dabei!');
    });
  });
});

// Voice messages store a URL in `content`, so every push surface shows a label
// instead — and it has to be the RECIPIENT's language. The first version put a
// German label into the params at the call site, which is resolved long before
// sendPushToUser knows who it is sending to (2026-09-15).
describe('voice-message pushes are labelled per recipient locale', () => {
  it('newDm labels a voice note in each language', () => {
    const b = pushTexts('newDm', { name: 'Anna', isVoice: true });
    expect(b('de')).toEqual({ title: 'Anna', body: '🎤 Sprachnachricht' });
    expect(b('en')).toEqual({ title: 'Anna', body: '🎤 Voice message' });
    expect(b('fr').body).toBe('🎤 Message vocal');
    expect(b('es').body).toBe('🎤 Mensaje de voz');
    expect(b('it').body).toBe('🎤 Messaggio vocale');
  });

  it('groupMessage prefixes the sender and labels per language', () => {
    const b = pushTexts('groupMessage', { groupName: 'Tennis', sender: 'Anna', isVoice: true });
    expect(b('de')).toEqual({ title: 'Tennis', body: 'Anna: 🎤 Sprachnachricht' });
    expect(b('en').body).toBe('Anna: 🎤 Voice message');
  });

  it('a text message is untouched by the voice branch', () => {
    const b = pushTexts('groupMessage', { groupName: 'Tennis', line: 'Anna: hallo' });
    expect(b('de')).toEqual({ title: 'Tennis', body: 'Anna: hallo' });
    const d = pushTexts('newDm', { name: 'Anna', preview: 'hallo' });
    expect(d('de')).toEqual({ title: 'Anna', body: 'hallo' });
  });
});

// Chat polls (B1): a new poll pushes like a message — the line names the kind,
// in the RECIPIENT's language; the title stays the group name.
describe('poll pushes', () => {
  const date = pushTexts('groupMessage', { groupName: 'Wandern', sender: 'Tina', isPoll: true, pollKind: 'date', question: 'Wann passt es euch?' });
  const choice = pushTexts('groupMessage', { groupName: 'Wandern', sender: 'Tina', isPoll: true, pollKind: 'choice', question: 'Was machen wir?' });

  it('date polls, all five languages', () => {
    expect(date('de')).toEqual({ title: 'Wandern', body: '📅 Tina sucht einen Termin: Wann passt es euch?' });
    expect(date('en').body).toBe('📅 Tina is looking for a date: Wann passt es euch?');
    expect(date('it').body).toBe('📅 Tina cerca una data: Wann passt es euch?');
    expect(date('fr').body).toBe('📅 Tina cherche une date : Wann passt es euch?');
    expect(date('es').body).toBe('📅 Tina busca una fecha: Wann passt es euch?');
  });

  it('choice polls, all five languages', () => {
    expect(choice('de')).toEqual({ title: 'Wandern', body: '📊 Tina hat eine Abstimmung gestartet: Was machen wir?' });
    expect(choice('en').body).toBe('📊 Tina started a poll: Was machen wir?');
    expect(choice('it').body).toBe('📊 Tina ha avviato un sondaggio: Was machen wir?');
    expect(choice('fr').body).toBe('📊 Tina a lancé un sondage : Was machen wir?');
    expect(choice('es').body).toBe('📊 Tina ha creado una encuesta: Was machen wir?');
  });

  it('the media and text branches are untouched', () => {
    expect(pushTexts('groupMessage', { groupName: 'X', sender: 'A', isImage: true })('de').body).toBe('A: 📷 Foto');
    expect(pushTexts('groupMessage', { groupName: 'X', line: 'A: hi' })('de').body).toBe('A: hi');
  });
});

// ── Bau 2 (Tina-Update 17.11.2026) ───────────────────────────────────────
// The pushes after an event and for a community without a meetup.
describe('Bau 2 pushes (Tina 17.11.2026)', () => {
  it('connectNudge: Tina\'s sentence, split into title and body — character for character in German', () => {
    const b = pushTexts('connectNudge');
    // The space before the „!“ is hers (REGELN: zeichengenau).
    expect(b('de')).toEqual({
      title: 'Aus Fremden können Freundschaften werden!',
      body: 'Mach den ersten Schritt und schicke eine Freundschaftsanfrage !',
    });
    expect(b('en')).toEqual({ title: 'Strangers can become friends!', body: 'Take the first step and send a friend request!' });
    expect(b('it')).toEqual({ title: 'Da sconosciuti si può diventare amici!', body: 'Fai il primo passo e invia una richiesta di amicizia!' });
    expect(b('fr')).toEqual({ title: 'Des inconnus peuvent devenir des amis !', body: 'Fais le premier pas et envoie une demande d’amitié !' });
    expect(b('es')).toEqual({ title: '¡De desconocidos pueden nacer amistades!', body: '¡Da el primer paso y envía una solicitud de amistad!' });
    // No event name in it, and an unknown language falls back to German.
    expect(b('pt')).toEqual(b('de'));
  });

  it('communityFirstEvent: Tina\'s text with the community\'s name, split into title and body', () => {
    const b = pushTexts('communityFirstEvent', { groupName: 'Punsch & Rave 2' });
    // ✨ is U+2728, as in her document.
    expect(b('de')).toEqual({ title: 'Hey, Punsch & Rave 2 hat Potenzial! ✨', body: 'Jetzt fehlt nur noch das erste Treffen. Leg los!' });
    expect(b('en')).toEqual({ title: 'Hey, Punsch & Rave 2 has potential! ✨', body: 'All it needs now is the first meetup. Get started!' });
    expect(b('it')).toEqual({ title: 'Ehi, Punsch & Rave 2 ha del potenziale! ✨', body: 'Ora manca solo il primo incontro. Inizia!' });
    expect(b('fr')).toEqual({ title: 'Hey, Punsch & Rave 2 a du potentiel ! ✨', body: 'Il ne manque plus que la première sortie. Lance-toi !' });
    expect(b('es')).toEqual({ title: '¡Hey, Punsch & Rave 2 tiene potencial! ✨', body: 'Solo falta el primer plan. ¡Empieza!' });
  });
});
