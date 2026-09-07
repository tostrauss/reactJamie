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
    it('clubPendingAdmin / reportAdmin are the admin ops texts (reportAdmin ignores params)', () => {
      expect(pushTexts('clubPendingAdmin', { groupName: 'Club X' })('de').title).toBe('Neuer Club wartet auf Freigabe');
      expect(pushTexts('reportAdmin', {})('de')).toEqual({ title: 'Neue Meldung', body: 'Eine neue Meldung ist eingegangen' });
      expect(pushTexts('reportAdmin', {})('es').title).toBe('Nueva denuncia');
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
});
