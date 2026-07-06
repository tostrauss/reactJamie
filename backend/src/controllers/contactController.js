import db from '../config/database.js';
import { sendContactEmail } from '../utils/email.js';

// POST /api/contact — public contact form on the marketing site
// (jamie-app.com footer). Stores the message in contact_messages (source of
// truth) and forwards it via email best-effort. The hidden "website" field is
// a honeypot: bots fill it, humans never see it — we answer success without
// storing anything so bots don't learn they were caught.
export const submitContact = async (req, res) => {
  const { first_name, last_name, email, message, website } = req.body || {};

  if (website) return res.json({ success: true }); // honeypot tripped

  const nameOk = (v) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100;
  const emailOk = typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const msgOk = typeof message === 'string'
    && message.trim().length >= 5
    && message.trim().length <= 5000;

  if (!nameOk(first_name) || !nameOk(last_name)) {
    return res.status(400).json({ error: 'Bitte Vor- und Nachnamen angeben.' });
  }
  if (!emailOk) {
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
  }
  if (!msgOk) {
    return res.status(400).json({ error: 'Die Nachricht muss zwischen 5 und 5000 Zeichen lang sein.' });
  }

  try {
    await db.query(
      `INSERT INTO contact_messages (first_name, last_name, email, message)
       VALUES ($1, $2, $3, $4)`,
      [first_name.trim(), last_name.trim(), email.toLowerCase().trim(), message.trim()]
    );

    // Best-effort forward — the DB row is the source of truth; a Resend
    // hiccup must not turn a stored message into a user-facing error.
    sendContactEmail({
      firstName: first_name.trim(),
      lastName: last_name.trim(),
      email: email.trim(),
      message: message.trim(),
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[contact] error:', err.message);
    res.status(500).json({ error: 'Fehler beim Senden. Bitte versuche es später erneut.' });
  }
};
