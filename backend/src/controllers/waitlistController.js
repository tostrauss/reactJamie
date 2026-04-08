import db from '../config/database.js';

// POST /api/waitlist  — { email, country }
export const joinWaitlist = async (req, res) => {
  const { email, country } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

  try {
    // Upsert email — if they re-submit, update their country choice
    await db.query(
      `INSERT INTO waitlist (email, country, ip)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET country = EXCLUDED.country,
             ip      = EXCLUDED.ip`,
      [email.toLowerCase().trim(), country || null, ip]
    );

    // Increment country vote tally (only when country is provided)
    if (country) {
      await db.query(
        `INSERT INTO country_votes (country, votes) VALUES ($1, 1)
         ON CONFLICT (country) DO UPDATE
           SET votes = country_votes.votes + 1`,
        [country]
      );
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
