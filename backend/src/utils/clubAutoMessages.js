// „Automatisierte Nachrichten“ of a club event (Tina's document of
// 17.11.2026, the bar under „Deal anlegen“ in the event form): „Erinnerungen
// und Infos zum Event gehen automatisch in euren Namen an die Gruppe“.
//
// One row per event in club_event_auto_messages (migrations.js, BAU1 block):
// the switch (enabled, who set it) and the markers of what already went out.
// This file holds the switch; the job that sends is jobs/clubEventMessages.js.
//
// Who may switch it on: the people who run an OFFICIAL club — its owner, a
// co-manager, an app admin. The callers check that; here is only the write.
//
// The table arrives with a migration, and the server takes requests before
// its migrations are through (boot window). Nothing in here may turn that
// into a 500 on a path that existed before: a missing table (42P01) or column
// (42703) reads as „off“ and is logged — the event is created or saved all
// the same.
import db from '../config/database.js';

// Kill switch for the SENDING (Railway env, no deploy): CLUB_AUTO_MESSAGES=false
// stops the job. The switch on the event keeps being stored, so nothing is
// lost while it is off.
export const clubAutoMessagesEnabled = () => process.env.CLUB_AUTO_MESSAGES !== 'false';

const isMissingRelation = (err) => err?.code === '42P01' || err?.code === '42703';

// ── The four messages ────────────────────────────────────────────────────
// Tina's wording, character for character (document of 17.11.2026, lines
// 81–85). German server constants like SYSTEM_TEXTS: a chat message is stored
// as ONE string that every reader sees as it is.
//   [Betrieb] = the club's name
//   [Adresse] = the event's location
//   [Deal]    = the label of the deal the event shows
// „Einen Tag davor“ (decided 17.11.2026, F-3): without a deal only the deal
// sentence is left out, without a location the address sentence too.
// What is filled in loses a trailing full stop (and spaces), so a label
// „1 Punsch gratis.“ does not end the sentence with „..“.
const tidy = (v) => String(v ?? '').trim().replace(/[.\s]+$/, '');

export const CLUB_AUTO_TEXTS = Object.freeze({
  // 2 days after the event was created
  welcome: (betrieb) => `Hey, freut mich, dass ihr dabei seid! 😊 Wir sind ${tidy(betrieb)} und freuen uns schon riesig auf euch. Fragen? Schreibt einfach hier rein!`,
  // the day before
  eve: ({ address, deal } = {}) => [
    'Morgen ist es so weit! 🎉',
    tidy(address) ? `Wir sehen uns in der ${tidy(address)}.` : null,
    tidy(deal) ? `Vergesst nicht euren Deal: ${tidy(deal)}.` : null,
  ].filter(Boolean).join(' '),
  // 2 hours before
  soon: () => 'Wir sind bereit für euch! Bis gleich 👋',
  // the day after
  thanks: () => 'Danke, dass ihr da wart! 💛 Hat es euch gefallen?',
});

/**
 * Switch it on for a NEW event, inside createClubEvent's transaction.
 * Behind a savepoint: if the table is not there yet, only this insert is
 * rolled back — the event (and its deal) still commit. Any other error is
 * thrown and aborts the transaction like every other write in it.
 * @returns {Promise<boolean>} whether the switch is on now
 */
export async function enableAutoMessages(client, eventId, userId) {
  await client.query('SAVEPOINT auto_msg');
  try {
    await client.query(
      `INSERT INTO club_event_auto_messages (group_id, enabled, enabled_by) VALUES ($1, TRUE, $2)`,
      [eventId, userId]
    );
    await client.query('RELEASE SAVEPOINT auto_msg');
    return true;
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    await client.query('ROLLBACK TO SAVEPOINT auto_msg');
    console.warn(`[auto-messages] table not ready, event ${eventId} created without the switch:`, err.message);
    return false;
  }
}

/**
 * Switch it on or off for an EXISTING event (the event's edit page).
 * On: only under an official club (checked in the statement itself); the row
 * is created if there is none, its markers stay — what already went out is
 * not sent again. Off: only an existing row is touched, so a later „on“
 * starts its 48 hours then and not at the moment somebody switched it off.
 * Never throws: the event edit it belongs to is already saved.
 * @returns {Promise<boolean>} whether the switch is on now
 */
export async function setAutoMessages({ clubId, eventId, userId, enabled }) {
  try {
    if (!enabled) {
      await db.query(
        `UPDATE club_event_auto_messages SET enabled = FALSE, enabled_by = $2 WHERE group_id = $1`,
        [eventId, userId]
      );
      return false;
    }
    const { rows } = await db.query(
      `INSERT INTO club_event_auto_messages (group_id, enabled, enabled_by)
       SELECT $1, TRUE, $2
        WHERE EXISTS (SELECT 1 FROM groups c
                       WHERE c.id = $3 AND c.type = 'club' AND c.club_type = 'official')
       ON CONFLICT (group_id) DO UPDATE SET enabled = TRUE, enabled_by = EXCLUDED.enabled_by
       RETURNING enabled`,
      [eventId, userId, clubId]
    );
    return rows[0]?.enabled === true;
  } catch (err) {
    if (isMissingRelation(err)) console.warn(`[auto-messages] table not ready, switch of event ${eventId} not saved:`, err.message);
    else console.error(`[auto-messages] switch of event ${eventId} not saved:`, err.message);
    return autoMessagesOn(eventId);
  }
}

/** Whether the switch of this event is on. Never throws; unknown reads as off. */
export async function autoMessagesOn(eventId) {
  try {
    const { rows } = await db.query(
      `SELECT enabled FROM club_event_auto_messages WHERE group_id = $1`, [eventId]);
    return rows[0]?.enabled === true;
  } catch (err) {
    if (!isMissingRelation(err)) console.error(`[auto-messages] switch of event ${eventId} not readable:`, err.message);
    return false;
  }
}
