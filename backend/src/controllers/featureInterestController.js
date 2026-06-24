import db from '../config/database.js';

// Coming-soon "Benachrichtige mich" interest signals. A user taps the bell on a
// not-yet-launched feature (Pro subscription / buyable Boosts); we persist
// (user, feature) so we can notify — and optionally give a launch discount to —
// exactly those users when the feature ships. The actual launch notification is
// a later admin/cron step; this just collects the interested users.
const VALID_FEATURES = ['pro', 'boosts'];

export const registerInterest = async (req, res) => {
  const { feature } = req.body;
  if (!VALID_FEATURES.includes(feature)) {
    return res.status(400).json({ error: 'Unbekanntes Feature' });
  }
  try {
    await db.query(
      `INSERT INTO feature_interest (user_id, feature)
       VALUES ($1, $2)
       ON CONFLICT (user_id, feature) DO NOTHING`,
      [req.userId, feature]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('registerInterest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getInterest = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT feature FROM feature_interest WHERE user_id = $1',
      [req.userId]
    );
    res.json({ features: result.rows.map(r => r.feature) });
  } catch (err) {
    console.error('getInterest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
