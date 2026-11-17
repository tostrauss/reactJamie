import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// „Automatisierte Nachrichten“ of a club event (Tina's document of
// 17.11.2026): the switch. Its table arrives with a migration and the server
// takes requests before its migrations are through — so what is pinned here
// is that a missing table never breaks creating or saving an event.
const statements = [];
let dbQueryImpl;
vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      statements.push({ text, params });
      return dbQueryImpl(text, params);
    }),
  },
}));

const {
  enableAutoMessages, setAutoMessages, autoMessagesOn, clubAutoMessagesEnabled, CLUB_AUTO_TEXTS,
} = await import('../../src/utils/clubAutoMessages.js');

const missingTable = () => Object.assign(new Error('relation "club_event_auto_messages" does not exist'), { code: '42P01' });
const missingColumn = () => Object.assign(new Error('column "enabled_by" does not exist'), { code: '42703' });

// A transaction client that records what it was asked, in order.
const makeClient = (onInsert = async () => ({ rows: [] })) => {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (text, params) => {
      calls.push(text.trim());
      if (text.includes('INSERT INTO club_event_auto_messages')) return onInsert(text, params);
      return { rows: [] };
    }),
  };
};

let warn;
let error;
beforeEach(() => {
  statements.length = 0;
  dbQueryImpl = async () => ({ rows: [] });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
  delete process.env.CLUB_AUTO_MESSAGES;
});

describe('enableAutoMessages (inside the transaction of createClubEvent)', () => {
  it('writes the switch behind a savepoint and releases it', async () => {
    const client = makeClient();
    expect(await enableAutoMessages(client, 90, 7)).toBe(true);
    expect(client.calls[0]).toBe('SAVEPOINT auto_msg');
    expect(client.calls[1]).toContain('INSERT INTO club_event_auto_messages (group_id, enabled, enabled_by) VALUES ($1, TRUE, $2)');
    expect(client.query.mock.calls[1][1]).toEqual([90, 7]);
    expect(client.calls[2]).toBe('RELEASE SAVEPOINT auto_msg');
    expect(client.calls).toHaveLength(3);
  });

  it.each([['the table', missingTable], ['a column', missingColumn]])(
    '%s is not there yet: only the insert is rolled back — the transaction of the event lives on',
    async (_what, make) => {
      const client = makeClient(async () => { throw make(); });
      expect(await enableAutoMessages(client, 90, 7)).toBe(false);
      expect(client.calls).toContain('ROLLBACK TO SAVEPOINT auto_msg');
      // never the transaction itself, and nothing released that was rolled back
      expect(client.calls).not.toContain('ROLLBACK');
      expect(client.calls).not.toContain('RELEASE SAVEPOINT auto_msg');
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it('any other error is thrown: the transaction aborts like for every other write in it', async () => {
    const boom = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const client = makeClient(async () => { throw boom; });
    await expect(enableAutoMessages(client, 90, 7)).rejects.toBe(boom);
    expect(client.calls).not.toContain('ROLLBACK TO SAVEPOINT auto_msg');
  });
});

describe('setAutoMessages (the edit page of an event)', () => {
  it('on: one upsert that asks for an OFFICIAL club in the statement itself and keeps the markers', async () => {
    dbQueryImpl = async () => ({ rows: [{ enabled: true }] });
    expect(await setAutoMessages({ clubId: 7, eventId: 90, userId: 3, enabled: true })).toBe(true);
    expect(statements).toHaveLength(1);
    const { text, params } = statements[0];
    expect(params).toEqual([90, 3, 7]);
    expect(text).toContain(`c.type = 'club' AND c.club_type = 'official'`);
    expect(text).toContain('ON CONFLICT (group_id) DO UPDATE SET enabled = TRUE, enabled_by = EXCLUDED.enabled_by');
    // what already went out is not sent again: no marker is reset
    expect(text).not.toMatch(/sent_(at|for)/);
    expect(text).not.toContain('created_at');
  });

  it('on, but the club is a community: nothing is written, the answer is „off“', async () => {
    dbQueryImpl = async () => ({ rows: [] });
    expect(await setAutoMessages({ clubId: 7, eventId: 90, userId: 3, enabled: true })).toBe(false);
  });

  it('off: touches an existing row only — never creates one', async () => {
    expect(await setAutoMessages({ clubId: 7, eventId: 90, userId: 3, enabled: false })).toBe(false);
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toContain('UPDATE club_event_auto_messages SET enabled = FALSE, enabled_by = $2 WHERE group_id = $1');
    expect(statements[0].text).not.toContain('INSERT');
    expect(statements[0].params).toEqual([90, 3]);
  });

  it('the table is not there yet: never throws, reads as „off“', async () => {
    dbQueryImpl = async () => { throw missingTable(); };
    expect(await setAutoMessages({ clubId: 7, eventId: 90, userId: 3, enabled: true })).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('any other failure: logged, never thrown — and the answer is what is stored', async () => {
    let n = 0;
    dbQueryImpl = async (text) => {
      n += 1;
      if (n === 1) throw new Error('connection reset');
      expect(text).toContain('SELECT enabled FROM club_event_auto_messages');
      return { rows: [{ enabled: true }] };
    };
    expect(await setAutoMessages({ clubId: 7, eventId: 90, userId: 3, enabled: false })).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('autoMessagesOn', () => {
  it('reads the switch: on, off, no row', async () => {
    dbQueryImpl = async () => ({ rows: [{ enabled: true }] });
    expect(await autoMessagesOn(90)).toBe(true);
    dbQueryImpl = async () => ({ rows: [{ enabled: false }] });
    expect(await autoMessagesOn(90)).toBe(false);
    dbQueryImpl = async () => ({ rows: [] });
    expect(await autoMessagesOn(90)).toBe(false);
  });

  it('a missing table reads as off without a log line; another error as off with one', async () => {
    dbQueryImpl = async () => { throw missingTable(); };
    expect(await autoMessagesOn(90)).toBe(false);
    expect(error).not.toHaveBeenCalled();
    dbQueryImpl = async () => { throw new Error('boom'); };
    expect(await autoMessagesOn(90)).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('the kill switch CLUB_AUTO_MESSAGES', () => {
  it('is on unless the env says exactly „false“', () => {
    expect(clubAutoMessagesEnabled()).toBe(true);
    process.env.CLUB_AUTO_MESSAGES = 'true';
    expect(clubAutoMessagesEnabled()).toBe(true);
    process.env.CLUB_AUTO_MESSAGES = 'false';
    expect(clubAutoMessagesEnabled()).toBe(false);
  });
});

// Tina's four messages (document of 17.11.2026, lines 81–85), character for
// character. The emojis by code point: a look-alike (☺ for 😊) would pass
// the eye and not this.
describe('CLUB_AUTO_TEXTS', () => {
  const points = (s) => [...s].map((c) => c.codePointAt(0));

  it('welcome — 2 days after the event was created', () => {
    const text = CLUB_AUTO_TEXTS.welcome('Café Soleá');
    expect(text).toBe('Hey, freut mich, dass ihr dabei seid! 😊 Wir sind Café Soleá und freuen uns schon riesig auf euch. Fragen? Schreibt einfach hier rein!');
    expect(points(text)).toContain(0x1F60A);
  });

  it('eve — the day before, with address and deal', () => {
    const text = CLUB_AUTO_TEXTS.eve({ address: 'Kaiserstraße 60, 1070 Wien', deal: '1 Punsch gratis' });
    expect(text).toBe('Morgen ist es so weit! 🎉 Wir sehen uns in der Kaiserstraße 60, 1070 Wien. Vergesst nicht euren Deal: 1 Punsch gratis.');
    expect(points(text)).toContain(0x1F389);
  });

  it('eve — without a deal only the deal sentence is left out; without a location the address sentence too', () => {
    expect(CLUB_AUTO_TEXTS.eve({ address: 'Kaiserstraße 60, 1070 Wien', deal: null }))
      .toBe('Morgen ist es so weit! 🎉 Wir sehen uns in der Kaiserstraße 60, 1070 Wien.');
    expect(CLUB_AUTO_TEXTS.eve({ address: '', deal: '1 Punsch gratis' }))
      .toBe('Morgen ist es so weit! 🎉 Vergesst nicht euren Deal: 1 Punsch gratis.');
    expect(CLUB_AUTO_TEXTS.eve({ address: null, deal: undefined })).toBe('Morgen ist es so weit! 🎉');
    expect(CLUB_AUTO_TEXTS.eve({ address: '   ', deal: ' . ' })).toBe('Morgen ist es so weit! 🎉');
    expect(CLUB_AUTO_TEXTS.eve()).toBe('Morgen ist es so weit! 🎉');
  });

  it('a label or an address that ends in a full stop does not end the sentence with „..“', () => {
    const text = CLUB_AUTO_TEXTS.eve({ address: 'Praterstern 1. ', deal: '2 für 1 auf alle Drinks.' });
    expect(text).toBe('Morgen ist es so weit! 🎉 Wir sehen uns in der Praterstern 1. Vergesst nicht euren Deal: 2 für 1 auf alle Drinks.');
    expect(text).not.toContain('..');
    // a full stop INSIDE stays
    expect(CLUB_AUTO_TEXTS.eve({ address: 'Kaiserstr. 60', deal: null })).toBe('Morgen ist es so weit! 🎉 Wir sehen uns in der Kaiserstr. 60.');
  });

  it('soon — 2 hours before; thanks — the day after', () => {
    expect(CLUB_AUTO_TEXTS.soon()).toBe('Wir sind bereit für euch! Bis gleich 👋');
    expect(points(CLUB_AUTO_TEXTS.soon())).toContain(0x1F44B);
    expect(CLUB_AUTO_TEXTS.thanks()).toBe('Danke, dass ihr da wart! 💛 Hat es euch gefallen?');
    expect(points(CLUB_AUTO_TEXTS.thanks())).toContain(0x1F49B);
  });

  it('plain spaces only, no price, nothing that reads like a template left over', () => {
    const all = [
      CLUB_AUTO_TEXTS.welcome('X'), CLUB_AUTO_TEXTS.eve({ address: 'A', deal: 'D' }),
      CLUB_AUTO_TEXTS.soon(), CLUB_AUTO_TEXTS.thanks(),
    ].join('|');
    expect(all).not.toMatch(/[\u00A0\u202F\u2009]/);
    expect(all).not.toMatch(/[\[\]{}€]|undefined|null/);
  });
});
