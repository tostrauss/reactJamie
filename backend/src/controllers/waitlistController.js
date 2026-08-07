import db from '../config/database.js';
import { getClientIp } from '../utils/clientIp.js';

// POST /api/waitlist  — { email, country }
export const joinWaitlist = async (req, res) => {
  const { email, country } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  }

  // Whitelist country format — 2-3 char ISO codes (or null).
  if (country !== undefined && country !== null) {
    if (typeof country !== 'string' || !/^[A-Z]{2,3}$/i.test(country)) {
      return res.status(400).json({ error: 'Ungültiger Ländercode' });
    }
  }

  if (email.length > 254) {
    return res.status(400).json({ error: 'E-Mail zu lang' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCountry = country ? country.toUpperCase() : null;
  const ip = getClientIp(req);

  try {
    // Upsert email — if they re-submit, update their country choice
    await db.query(
      `INSERT INTO waitlist (email, country, ip)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET country = EXCLUDED.country,
             ip      = EXCLUDED.ip`,
      [normalizedEmail, normalizedCountry, ip]
    );

    // Increment country vote tally — but only on the FIRST (email, country)
    // pairing. Without the ledger, every re-submission inflates the count.
    if (normalizedCountry) {
      const claim = await db.query(
        `INSERT INTO waitlist_votes (email, country)
         VALUES ($1, $2)
         ON CONFLICT (email, country) DO NOTHING
         RETURNING 1`,
        [normalizedEmail, normalizedCountry]
      );
      if (claim.rowCount > 0) {
        await db.query(
          `INSERT INTO country_votes (country, votes) VALUES ($1, 1)
           ON CONFLICT (country) DO UPDATE
             SET votes = country_votes.votes + 1`,
          [normalizedCountry]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[waitlist] error:', err.message);
    res.status(500).json({ error: 'Fehler beim Speichern. Bitte versuche es erneut.' });
  }
};

// GET /api/waitlist/votes  — public vote leaderboard
export const getCountryVotes = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT country, votes FROM country_votes ORDER BY votes DESC LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[waitlist] votes error:', err.message);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
};
