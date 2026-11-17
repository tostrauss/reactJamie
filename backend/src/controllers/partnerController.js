// The partner model of clubs (Tina's document of 17.11.2026, decided by Tobi):
// what a club's event form needs to know and send around the free tier.
//
//   GET  /api/clubs/:id/event-quota     where the club stands (getEventQuota)
//   POST /api/clubs/:id/partner-request „Ja, meldet euch!“ → „JAMIE Anfrage“
//                                       (requestPartner)
//   GET  /api/admin/partner-leads       the admin's list „Partner-Anfragen“
//                                       (getPartnerLeadsAdmin)
//
// The rules live in utils/clubEventQuota.js; createClubEvent enforces them.
// The quota only tells the app in advance, so it can show Tina's partner
// message instead of a form that will be refused.
import db from '../config/database.js';
import { FREE_CLUB_EVENTS, loadClubForQuota, quotaOf } from '../utils/clubEventQuota.js';
import { sendPushToAdmins } from './pushController.js';
import { pushTexts } from '../utils/pushLocale.js';

// A route id → a positive integer, or null (never a cast error from Postgres).
const toId = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

// What a quota reads as when nothing is limited — and the answer when the
// lookup itself fails.
const openQuota = (clubId, clubName = '') => ({
  club_id: clubId,
  club_name: clubName,
  limited: false,
  free_events: FREE_CLUB_EVENTS,
  used: 0,
  upcoming: 0,
  block: null,
  ticket_allowed: true,
  is_manager: false,
});

// ==========================================
// GET /api/clubs/:id/event-quota
// ==========================================
// → { club_id, club_name, limited, free_events, used, upcoming,
//     block: null | 'concurrent' | 'third', ticket_allowed, is_manager }
//
// For the people who may put up events there: members, the owner, an app
// admin. `block` is what createClubEvent would answer right now; a community,
// a paying partner and the JAMIE team read limited:false. ticket_allowed is
// false exactly where a ticket link would be refused as „only as a partner“
// (where JAMIE Pro decides, the server says so when the event is saved).
//
// Never a 5xx: the app retries a GET on 5xx and counts it against its circuit
// breaker. Anything unexpected is logged and answered as „not limited“ — the
// form opens, and createClubEvent still decides.
export const getEventQuota = async (req, res) => {
  const clubId = toId(req.params.id);
  if (!clubId) return res.status(404).json({ error: 'Club nicht gefunden' });
  if (!req.userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  try {
    const club = await loadClubForQuota(db, clubId, req.userId);
    if (!club) return res.status(404).json({ error: 'Club nicht gefunden' });

    const membership = await db.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [clubId, req.userId]);
    const isOwner = Number(club.owner_id) === Number(req.userId);
    if (!membership.rows.length && !isOwner && !club.caller_is_admin) {
      return res.status(403).json({ error: 'Nur für Clubmitglieder sichtbar', code: 'NOT_MEMBER' });
    }

    const quota = await quotaOf(db, club);
    res.json({
      ...openQuota(club.id, club.name || ''),
      limited: quota.limited,
      used: quota.used,
      upcoming: quota.upcoming,
      block: quota.block,
      ticket_allowed: !quota.limited,
      is_manager: isOwner || membership.rows[0]?.role === 'admin',
    });
  } catch (err) {
    console.error('getEventQuota error:', err.message);
    res.json({ ...openQuota(clubId), unavailable: true });
  }
};

// ==========================================
// POST /api/clubs/:id/partner-request   („JAMIE Anfrage“)
// ==========================================
// Tina 17.11.2026: „Ja, meldet euch!“ on the partner message opens a form —
// „Name: Unternehmen: optional Email: Telefon:“, a switch preset to „ich
// möchte lieber per Mail kontaktiert werden“ that turns to „… per Anruf …“,
// and „Datenschutz zum Ankreuzen“. Decided by Tobi: the request is stored
// (partner_leads), shows in the admin dashboard as „Partner-Anfragen“, and
// goes out at once as an e-mail to office@jamie-app.com and a push to the
// admins.
//
//   body: { name, company?, email?, phone?, contact: 'mail'|'call',
//           privacy: true, reason: 'concurrent'|'third'|'ticket'|'deal' }
//   201 { ok: true } · 200 { ok: true, duplicate: true }
//   400 { error, code: 'LEAD_INVALID', field }
//
// Only the people who run the club may ask for it: its owner, a co-manager,
// or an app admin. Everything is checked here again — the form's own checks
// are a convenience: lengths, the e-mail and phone shapes, and the privacy
// tick, which must be a real `true`. The way they want to be reached decides
// which of the two is required (mail → e-mail, call → phone).
//
// One request per club and person in 24 hours: a second one answers like a
// success (the form closes with its thank-you) but writes, mails and pushes
// nothing. The route also sits behind partnerLeadLimiter (5 per hour).
const LEAD_SOURCES = ['concurrent', 'third', 'ticket', 'deal'];
const LEAD_CONTACTS = ['mail', 'call'];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE = /^[+0-9 ()/-]{6,40}$/;

const PARTNER_UNAVAILABLE = {
  error: 'Die Partner-Anfrage ist gleich wieder verfügbar. Bitte versuche es in einer Minute erneut.',
  code: 'PARTNER_UNAVAILABLE',
};

// Free text in one line: every run of whitespace (line breaks included) is
// one space. Not a string → ''.
const oneLine = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

const invalidLead = (field, error) => ({ invalid: { error, code: 'LEAD_INVALID', field } });

// The request body → { lead } (ready to store) or { invalid } (the 400 body).
export function parsePartnerLead(body) {
  const b = body && typeof body === 'object' ? body : {};
  const name = oneLine(b.name);
  if (!name || name.length > 100) return invalidLead('name', 'Bitte gib deinen Namen an (höchstens 100 Zeichen).');
  const company = oneLine(b.company);
  if (company.length > 150) return invalidLead('company', 'Der Name des Unternehmens darf höchstens 150 Zeichen lang sein.');
  if (!LEAD_CONTACTS.includes(b.contact)) {
    return invalidLead('contact', 'Bitte wähle, ob wir uns per Mail oder per Anruf melden sollen.');
  }
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (email ? (email.length > 254 || !EMAIL_SHAPE.test(email)) : b.contact === 'mail') {
    return invalidLead('email', 'Bitte gib eine gültige E-Mail-Adresse an.');
  }
  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  if (phone ? !PHONE_SHAPE.test(phone) : b.contact === 'call') {
    return invalidLead('phone', 'Bitte gib eine gültige Telefonnummer an.');
  }
  if (b.privacy !== true) return invalidLead('privacy', 'Bitte stimme der Datenschutzerklärung zu.');
  if (!LEAD_SOURCES.includes(b.reason)) return invalidLead('reason', 'Ungültige Anfrage.');
  return {
    lead: { source: b.reason, name, company: company || null, email: email || null, phone: phone || null, contact: b.contact },
  };
}

export const requestPartner = async (req, res) => {
  const clubId = toId(req.params.id);
  if (!clubId) return res.status(404).json({ error: 'Club nicht gefunden' });
  if (!req.userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  try {
    const club = await loadClubForQuota(db, clubId, req.userId);
    if (!club) return res.status(404).json({ error: 'Club nicht gefunden' });
    let allowed = Number(club.owner_id) === Number(req.userId) || !!club.caller_is_admin;
    if (!allowed) {
      const mgr = await db.query(
        `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin'`, [clubId, req.userId]);
      allowed = mgr.rows.length > 0;
    }
    if (!allowed) return res.status(403).json({ error: 'Keine Berechtigung', code: 'NOT_CLUB_MANAGER' });

    const { lead, invalid } = parsePartnerLead(req.body);
    if (invalid) return res.status(400).json(invalid);

    // Check and write in ONE statement: a double tap finds the row of the
    // first. Every parameter is cast — two of them are compared as well as
    // inserted, and Postgres must not have to guess a type (the 42P08 lesson).
    const stored = await db.query(
      `INSERT INTO partner_leads (club_id, user_id, source, name, company, email, phone, contact, privacy_accepted_at)
       SELECT $1::int, $2::int, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::varchar, $8::varchar, NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM partner_leads
           WHERE club_id = $1::int AND user_id = $2::int AND created_at > NOW() - INTERVAL '24 hours')
       RETURNING id, created_at`,
      [clubId, req.userId, lead.source, lead.name, lead.company, lead.email, lead.phone, lead.contact]
    );
    if (!stored.rowCount) return res.json({ ok: true, duplicate: true });

    console.log(`[partner] club ${clubId}: user ${req.userId} sent a partner request (${lead.source}, ${lead.contact})`);
    res.status(201).json({ ok: true });

    // After the answer, never in its way: the mail to the office and the push
    // to the admins. PARTNER_LEADS_NOTIFY=false (emergency switch) keeps the
    // request — it is in the admin list — and sends neither. The mail module
    // is imported here, with a catch: a failed send, or a missing function,
    // must never surface as an unhandled rejection.
    if (process.env.PARTNER_LEADS_NOTIFY !== 'false') {
      const full = { ...lead, id: stored.rows[0].id, created_at: stored.rows[0].created_at, user_id: req.userId };
      import('../utils/email.js')
        .then((mail) => mail.sendPartnerLeadEmail?.(full, { id: club.id, name: club.name }))
        .catch((err) => console.error('[partner] request mail failed:', err?.message));
      Promise.resolve()
        .then(() => sendPushToAdmins(pushTexts('partnerLeadAdmin', { groupName: club.name || '' }), null, '/admin#partner-leads'))
        .catch((err) => console.error('[partner] request push failed:', err?.message));
    }
  } catch (err) {
    // Boot window: partner_leads is not there yet. A POST may answer 503 —
    // the app does not retry those.
    if (err?.code === '42P01') return res.status(503).json(PARTNER_UNAVAILABLE);
    console.error('requestPartner error:', err);
    res.status(500).json({ error: 'Die Anfrage konnte nicht gesendet werden. Bitte versuche es später erneut.' });
  }
};

// ==========================================
// GET /api/admin/partner-leads   („Partner-Anfragen“, admin only)
// ==========================================
// Newest first, at most 200. Always an ARRAY of
//   { id, created_at, source, name, company, email, phone, contact,
//     club: { id, name } | null, user: { id, name } | null }
// — club and user are null once they are deleted (ON DELETE SET NULL keeps
// the request). Never a 5xx (it is a GET): a missing table or any other
// error is logged and reads as an empty list.
export const getPartnerLeadsAdmin = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.created_at, l.source, l.name, l.company, l.email, l.phone, l.contact,
              l.club_id, g.name AS club_name, l.user_id, u.name AS user_name
         FROM partner_leads l
         LEFT JOIN groups g ON g.id = l.club_id
         LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 200`
    );
    res.json(rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      source: r.source,
      name: r.name,
      company: r.company,
      email: r.email,
      phone: r.phone,
      contact: r.contact,
      club: r.club_id ? { id: r.club_id, name: r.club_name } : null,
      user: r.user_id ? { id: r.user_id, name: r.user_name } : null,
    })));
  } catch (err) {
    if (err?.code !== '42P01') console.error('getPartnerLeadsAdmin error:', err.message);
    res.json([]);
  }
};
