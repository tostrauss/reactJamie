/**
 * Seed initial groups + clubs for the JAMIE launch so cofounders + early
 * testers don't land in an empty app.
 *
 * - Owner is the admin user (looked up by ADMIN_EMAIL or first is_admin row).
 * - Clubs created by an admin are auto-approved (matches createClub logic).
 * - Idempotent: re-running skips entries that already exist
 *   (matched by owner_id + name + type).
 *
 * Usage:
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:DB_SSL_REJECT_UNAUTHORIZED = "false"
 *   # optionally:  $env:SEED_OWNER_EMAIL = "tobias.p.strauss@gmail.com"
 *   node scripts/seed-launch-content.js
 */
import 'dotenv/config';
import pg from 'pg';
import { postSystemMessage } from '../src/utils/systemMessage.js';

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false'
    ? { rejectUnauthorized: false }
    : undefined,
});

// Compute the next occurrence of a given weekday (0=Sun..6=Sat) at H:MM
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function nextWeekdayAt(weekday, hour, minute = 0) {
  const target = WEEKDAYS[weekday];
  const now = new Date();
  const result = new Date(now);
  const delta = (target - now.getDay() + 7) % 7 || 7; // always at least 1 day in the future
  result.setDate(now.getDate() + delta);
  result.setHours(hour, minute, 0, 0);
  return result;
}

const GROUPS = [
  {
    name: 'Morgenlauf Praterallee',
    category: 'Running',
    description: 'Gemütlicher Lauf, 6:30er Pace, den Prater entlang vor Uni oder Arbeit. Open für alle Levels — wir warten aufeinander!',
    location: 'Praterstern, Wien',
    lat: 48.2189, lng: 16.3917,
    when: () => nextWeekdayAt('mon', 7, 0),
    max_members: 20,
  },
  {
    name: 'Volleyball Schönbornpark',
    category: 'Volleyball',
    description: 'Mixed Volleyball für alle Level. Bringt Wasser + Sonnencreme — wir spielen bis es dunkel wird.',
    location: 'Schönbornpark, Wien',
    lat: 48.2117, lng: 16.3473,
    when: () => nextWeekdayAt('sat', 14, 0),
    max_members: 16,
  },
  {
    name: 'Bouldering Boulderbar Hannovermarkt',
    category: 'Klettern',
    description: 'Indoor-Bouldern für Anfänger + Fortgeschrittene. Eintritt zahlt jeder selbst, danach Bier in der Lounge.',
    location: 'Boulderbar Hannovermarkt, Wien',
    lat: 48.2293, lng: 16.3856,
    when: () => nextWeekdayAt('wed', 19, 0),
    max_members: 12,
  },
  {
    name: 'Sunday Brunch Café Phil',
    category: 'Food',
    description: 'Slow Sunday — Brunch + Kaffee + plaudern. Reservierung läuft über mich, einfach beitreten und vorbeikommen.',
    location: 'Café Phil, Gumpendorfer Straße, Wien',
    lat: 48.1957, lng: 16.3537,
    when: () => nextWeekdayAt('sun', 11, 0),
    max_members: 10,
  },
  {
    name: 'Wandern Kahlenberg → Leopoldsberg',
    category: 'Wandern',
    description: 'Klassische Wiener Stadtwanderung mit Aussicht. ~3h gemütlich, danach Einkehr beim Heurigen. Wetterfest!',
    location: 'Kahlenberg, Wien',
    lat: 48.2728, lng: 16.3358,
    when: () => nextWeekdayAt('sat', 9, 0),
    max_members: 20,
  },
  {
    name: 'Bar-Hopping Naschmarkt',
    category: 'Bar-Hopping',
    description: 'Drei Bars rund um den Naschmarkt, eine Runde pro Location, dann weiter. Treffpunkt vor Café Drechsler.',
    location: 'Naschmarkt, Wien',
    lat: 48.1985, lng: 16.3645,
    when: () => nextWeekdayAt('fri', 20, 0),
    max_members: 15,
  },
];

const CLUBS = [
  {
    name: 'Wiener Wandergruppe',
    category: 'Wandern',
    description: 'Community für alle, die regelmäßig in und um Wien wandern wollen. Jede Woche eine neue Tour.',
    location: 'Wien',
    lat: 48.2082, lng: 16.3738,
    max_members: 200,
  },
  {
    name: 'VIE Running Club',
    category: 'Running',
    description: 'Vienna\'s Running Club — alle Paces, alle Levels. Wöchentliche Trainings + monatliche Long Runs.',
    location: 'Wien',
    lat: 48.2082, lng: 16.3738,
    max_members: 200,
  },
  {
    name: 'Boardgame Café Wien',
    category: 'Brettspiele',
    description: 'Brettspiel-Community. Wir treffen uns regelmäßig in Boardgame Cafés und privat zum spielen.',
    location: 'Wien',
    lat: 48.2082, lng: 16.3738,
    max_members: 150,
  },
  {
    name: 'Foodie Crew Vienna',
    category: 'Kochen',
    description: 'Essen verbindet — von Streetfood bis Fine Dining, von Kochabenden zu Restaurant-Hopping. Hungrig sein!',
    location: 'Wien',
    lat: 48.2082, lng: 16.3738,
    max_members: 200,
  },
  {
    name: 'Tech Talks @ Vienna',
    category: 'Sonstiges',
    description: 'Monatliche Talks + Meetups zu Tech, Startups, AI, Design. Networking inklusive.',
    location: 'Wien',
    lat: 48.2082, lng: 16.3738,
    max_members: 250,
  },
];

async function findOwner() {
  const wanted = process.env.SEED_OWNER_EMAIL || 'tobias.p.strauss@gmail.com';
  let r = await client.query(
    'SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1) AND is_admin = TRUE LIMIT 1',
    [wanted]
  );
  if (r.rows.length === 0) {
    // Fall back to any admin user
    r = await client.query('SELECT id, name, email FROM users WHERE is_admin = TRUE ORDER BY id ASC LIMIT 1');
  }
  if (r.rows.length === 0) {
    throw new Error(`No admin user found. Run promote-admin.js first.`);
  }
  return r.rows[0];
}

async function alreadyExists(ownerId, name, type) {
  const r = await client.query(
    'SELECT id FROM groups WHERE owner_id = $1 AND name = $2 AND type = $3 LIMIT 1',
    [ownerId, name, type]
  );
  return r.rows[0] || null;
}

async function insertEntry(owner, entry, type) {
  const existing = await alreadyExists(owner.id, entry.name, type);
  if (existing) {
    console.log(`  · skip "${entry.name}" (already exists #${existing.id})`);
    return null;
  }

  const date = typeof entry.when === 'function' ? entry.when() : null;
  const result = await client.query(
    `INSERT INTO groups (
      name, description, type, category, date, location,
      max_members, is_private, owner_id, lat, lng, approval_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $10, 'approved')
    RETURNING id, name`,
    [
      entry.name,
      entry.description,
      type,
      entry.category,
      date,
      entry.location,
      entry.max_members,
      owner.id,
      entry.lat,
      entry.lng,
    ]
  );
  const row = result.rows[0];

  // Add owner as member
  await client.query(
    'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [row.id, owner.id, 'owner']
  );

  // Welcome system message — matches the live createGroup/createClub flow
  const welcomeText = type === 'club'
    ? `Willkommen bei ${row.name}! Stell euch kurz vor 👋`
    : `Willkommen bei ${row.name}! Stell dich kurz vor 👋`;
  // Use the helper but skip the io arg — nobody is in the room yet.
  await postSystemMessage(row.id, welcomeText);

  console.log(`  ✓ inserted ${type} #${row.id} — "${row.name}"`);
  return row;
}

async function main() {
  await client.connect();
  // Make postSystemMessage use our connected client transparently — the helper
  // uses the default pool, which is fine here; this script's writes go through
  // the same DATABASE_URL.
  const owner = await findOwner();
  console.log(`[seed] Owner: #${owner.id} ${owner.name} <${owner.email}>\n`);

  console.log(`[seed] Groups (events):`);
  for (const g of GROUPS) {
    try { await insertEntry(owner, g, 'group'); }
    catch (err) { console.error(`  ✗ "${g.name}" — ${err.message}`); }
  }

  console.log(`\n[seed] Clubs (persistent):`);
  for (const c of CLUBS) {
    try { await insertEntry(owner, c, 'club'); }
    catch (err) { console.error(`  ✗ "${c.name}" — ${err.message}`); }
  }

  console.log(`\n[seed] Done.`);
  await client.end();
}

main().catch(err => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
