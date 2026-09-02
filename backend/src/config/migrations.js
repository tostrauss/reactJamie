// Startup DB migrations — extracted from server.js so they can run in tests
// (integration smoke tests) without booting the HTTP server. Every step is
// idempotent (CREATE/ALTER ... IF NOT EXISTS) and failure-isolated via migrate().
import db from './database.js';
import { Sentry } from './sentry.js';

// Failure ledger (audit 2026-09-02, operability): steps stay log-and-continue
// (the fresh-DB bootstrap deliberately tolerates step errors — schema.sql runs
// first there), but failures are now RECORDED and surfaced via
// getMigrationHealth() + Sentry instead of vanishing into the boot log.
const _migrationFailures = []; // { label, message }
// null = healthy; a string = the post-migration schema assertion failed and
// /api/health reports this instance degraded (Railway pulls it from rotation).
let _schemaAssertionError = null;

// Helper: run a single migration step, log and continue on error
const migrate = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`⚠️ Migration "${label}" failed: ${err.message}`);
    _migrationFailures.push({ label, message: err.message });
    Sentry.captureException?.(err, { tags: { area: 'migrations' }, extra: { label } });
  }
};

// Invariants the app cannot serve correctly without — checked AFTER the
// steps. Distinct from per-step failures: a missing optional index is noise,
// a missing revocation column is an incident. Each probe throws on a missing
// table/column (42P01/42703).
const CRITICAL_SCHEMA_PROBES = [
  ['users.sessions_valid_after (session revocation)', 'SELECT sessions_valid_after FROM users LIMIT 1'],
  ['users.date_of_birth_changed (DOB lock)', 'SELECT date_of_birth_changed FROM users LIMIT 1'],
  ['groups.parent_club_id (club events)', 'SELECT parent_club_id FROM groups LIMIT 1'],
  ['group_members (membership core)', 'SELECT user_id FROM group_members LIMIT 1'],
  ['messages.message_type (system messages)', 'SELECT message_type FROM messages LIMIT 1'],
  ['direct_messages (DM core)', 'SELECT id FROM direct_messages LIMIT 1'],
  ['email_verification_codes (signup OTP)', 'SELECT code FROM email_verification_codes LIMIT 1'],
  ['push_subscriptions (push delivery)', 'SELECT id FROM push_subscriptions LIMIT 1'],
];

const runStartupMigrations = async () => {
  // Wait up to 90s for DB to be reachable before running migrations.
  // Railway Postgres can take 60-75s to accept connections on a cold start.
  for (let attempt = 1; attempt <= 18; attempt++) {
    try {
      await db.query('SELECT 1');
      break;
    } catch {
      if (attempt === 18) {
        console.error('⚠️ DB not reachable after 90s — startup migrations skipped');
        return;
      }
      console.log(`[migrations] Waiting for DB... (${attempt}/18)`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Each block runs independently — a failing index never skips a critical table.

  // ── Critical app tables ────────────────────────────────────────────────────
  await migrate('email_verification_codes', () => db.query(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) NOT NULL,
      code       VARCHAR(6)   NOT NULL,
      expires_at TIMESTAMPTZ  NOT NULL,
      used       BOOLEAN      DEFAULT FALSE,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )`));
  await migrate('idx_evc_email', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email)`));
  await migrate('email_verification_codes attempts col', () =>
    db.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`));
  // Binds a successful OTP verification to a subsequent /register call. Without this,
  // the OTP step lives only on the frontend and /api/auth/register can be called
  // directly with any email, enabling account-squatting against waitlisted users.
  await migrate('email_verification_codes verified_at col', () =>
    db.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`));

  // Case-insensitive email uniqueness. The base schema has UNIQUE(email)
  // which is case-sensitive — so "User@x.com" and "user@x.com" could
  // create separate accounts. This expression index enforces normalization
  // at the DB layer regardless of code path.
  await migrate('users LOWER(email) unique', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`));

  // Trigram indexes so the admin user search (name / email / location ILIKE
  // '%term%') uses an index instead of a full table scan as the user base
  // grows. One GIN index per column matches each ILIKE predicate; the planner
  // BitmapOrs them. pg_trgm is a trusted extension (installable without
  // superuser on PG13+). All wrapped in migrate() so a permissions failure on
  // a locked-down host degrades to a seq scan rather than blocking boot.
  await migrate('pg_trgm extension', () =>
    db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`));
  await migrate('idx_users_name_trgm', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_users_name_trgm ON users USING gin (name gin_trgm_ops)`));
  await migrate('idx_users_email_trgm', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops)`));
  await migrate('idx_users_location_trgm', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_users_location_trgm ON users USING gin (location gin_trgm_ops)`));

  // Public likes on Hall-of-Fame "moment" posts. One row per (group, user);
  // the poster (group owner) gets a push on each new like and the count shows
  // on the card. Kept separate from group_favorites (private bookmarks).
  await migrate('event_likes', () => db.query(`
    CREATE TABLE IF NOT EXISTS event_likes (
      group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    )`));
  await migrate('idx_event_likes_group', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_event_likes_group ON event_likes(group_id)`));

  // Pin name length at the DB layer too — the base schema declared
  // VARCHAR with no limit (unbounded), so a single user could push
  // a megabyte-long name through that bypassed app-layer validation.
  await migrate('users name length cap', () =>
    db.query(`ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(100)`).catch(() => null));

  // CHECK constraint on groups.type so the enum can't be bypassed.
  await migrate('chk_groups_type', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_type
        CHECK (type IN ('group','club','event'));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`));

  // Multi-category: a club/group can belong to several (sub)categories. The
  // singular `category` stays the PRIMARY (= categories[0]) so all existing
  // single-category display + filter code keeps working unchanged; `categories`
  // holds the full set for OR-match discovery.
  await migrate('groups.categories', () =>
    db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS categories text[]`));

  // Lat/lng must be within valid earth bounds. Without this, app-layer
  // validation can be bypassed by any insert path that forgets to call
  // the validator, and a row with lat=999 silently breaks Haversine.
  await migrate('chk_groups_lat_lng', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_lat_range
        CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`).then(() => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_lng_range
        CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`)));

  // max_members must be sane. A group of 0 or negative members is broken;
  // 10_000 is more than any real social meetup.
  await migrate('chk_groups_max_members', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_max_members
        CHECK (max_members IS NULL OR (max_members BETWEEN 1 AND 10000));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`));

  // Country votes ledger so we can deduplicate per (email, country).
  // Without this, joinWaitlist double-counts on every re-submission.
  await migrate('waitlist_votes ledger', async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS waitlist_votes (
      email   VARCHAR(255) NOT NULL,
      country VARCHAR(10)  NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (email, country)
    )`);
  });

  await migrate('analytics_events', () => db.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id          BIGSERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type  VARCHAR(50)  NOT NULL,
      screen_name VARCHAR(120),
      duration_ms INTEGER,
      metadata    JSONB,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_analytics_*', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_user    ON analytics_events(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_type    ON analytics_events(event_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_screen  ON analytics_events(screen_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC)`);
  });
  // subject_id: nullable FK-ish reference to whatever the screen is "about"
  // (e.g. the group/club id for ClubDetail/GroupDetail). Lets the admin
  // dashboard answer "which specific club is viewed most?" instead of just
  // "how many ClubDetail views total". Plain INTEGER (no FK) so analytics
  // survive group deletion.
  await migrate('analytics_subject_id', async () => {
    await db.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS subject_id INTEGER`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_analytics_subject ON analytics_events(screen_name, subject_id) WHERE subject_id IS NOT NULL`);
  });

  // Permanent daily growth rollup (investor metrics). One row per day, upserted
  // nightly + backfilled once — survives the 90-day analytics_events purge so
  // DAU/MAU curves and retention cohorts have real long-term history. See
  // jobs/analyticsRollup.js.
  await migrate('analytics_daily', () => db.query(`
    CREATE TABLE IF NOT EXISTS analytics_daily (
      day             DATE PRIMARY KEY,
      dau             INTEGER NOT NULL DEFAULT 0,
      wau             INTEGER NOT NULL DEFAULT 0,
      mau             INTEGER NOT NULL DEFAULT 0,
      new_users       INTEGER NOT NULL DEFAULT 0,
      cohort_size     INTEGER NOT NULL DEFAULT 0,
      retention_d1    REAL,
      retention_d7    REAL,
      retention_d30   REAL,
      groups_created  INTEGER NOT NULL DEFAULT 0,
      events_created  INTEGER NOT NULL DEFAULT 0,
      clubs_created   INTEGER NOT NULL DEFAULT 0,
      joins           INTEGER NOT NULL DEFAULT 0,
      messages        INTEGER NOT NULL DEFAULT 0,
      dms             INTEGER NOT NULL DEFAULT 0,
      friendships     INTEGER NOT NULL DEFAULT 0,
      photos          INTEGER NOT NULL DEFAULT 0,
      updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`));

  await migrate('category_suggestions', () => db.query(`
    CREATE TABLE IF NOT EXISTS category_suggestions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      suggestion  TEXT NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

  await migrate('event_reviews', () => db.query(`
    CREATE TABLE IF NOT EXISTS event_reviews (
      id               SERIAL PRIMARY KEY,
      group_id         INTEGER NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
      reviewer_id      INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      reviewed_user_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      was_present      BOOLEAN NOT NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, reviewer_id, reviewed_user_id)
    )`));
  await migrate('idx_event_reviews_*', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_event_reviews_group    ON event_reviews(group_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_event_reviews_reviewed ON event_reviews(reviewed_user_id)`);
  });

  // "Skip" on the post-event attendance modal records a dismissal here instead
  // of a permanent event_reviews sentinel, so the auto-popup stops nagging but
  // the member can still re-open the review manually later.
  await migrate('event_review_dismissals', () => db.query(`
    CREATE TABLE IF NOT EXISTS event_review_dismissals (
      group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id)
    )`));

  await migrate('users trusted cols', async () => {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_trusted_user BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_count   INTEGER NOT NULL DEFAULT 0`);
  });

  // ISO-3166-1 alpha-2 of the user's launch-market country, geocoded lazily from
  // their profile city and cached here (drives the same-country group feed
  // filter in groupController.getGroups). NULL = not resolved yet → sees all.
  await migrate('users country col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(2)`));

  // Session-revocation watermark: any JWT issued (iat) BEFORE this timestamp is
  // rejected by the auth middleware. Bumped to NOW() on password change/reset
  // and account deletion, so those actions evict every previously-issued token
  // (the 30-day stateless JWTs had no revocation path before). NULL = never
  // revoked (the common case), so existing sessions are unaffected on rollout.
  await migrate('users sessions_valid_after col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ`));

  // One-shot repair 2026-08-02: countries were resolved with the UNRESTRICTED
  // Nominatim lookup, whose global top hit for ambiguous Austrian town names
  // (Haag, Neumarkt, Gmünd, …) is often the German namesake — those users got
  // country='DE' persisted and their feed collapsed to the DE box ("sieht nur
  // 1 Gruppe", Arnos Vater). NULL every stored country ONCE; getGroups lazily
  // re-resolves each user via the now market-restricted geocode on their next
  // feed load (24h in-memory cache dedupes popular cities). The marker table
  // makes this run exactly once per database, not on every boot.
  await migrate('one-shot migration marker table', () =>
    db.query(`CREATE TABLE IF NOT EXISTS one_shot_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`));
  await migrate('users.country one-shot re-resolve (2026-08-02)', async () => {
    const claimed = await db.query(
      `INSERT INTO one_shot_migrations (name) VALUES ('2026-08-02_reset_users_country')
       ON CONFLICT (name) DO NOTHING RETURNING name`
    );
    if (claimed.rowCount > 0) {
      const r = await db.query(`UPDATE users SET country = NULL WHERE country IS NOT NULL`);
      console.log(`   [country-reset] cleared ${r.rowCount} stored countries for re-resolve`);
    }
  });
  // Per-member chat read marker — unread counts for group/club chats are
  // COUNT(non-system messages newer than COALESCE(last_read_at, joined_at)).
  // DEFAULT NOW() is load-bearing twice: (1) Postgres fills EXISTING rows with
  // the default at ALTER time, so the deploy moment counts as "all read" —
  // without it every long-standing group would flood members with their
  // entire message history as unread; (2) new members start stamped at join
  // time, matching the joined_at fallback.
  await migrate('group_members last_read_at', () =>
    db.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP DEFAULT NOW()`));
  // Per-user "hide chat" flag for group/club chats (mirrors dm_conversations.is_archived
  // for DMs). The chat list moves archived rows into the "Ausgeblendet" section.
  await migrate('group_members archived', () =>
    db.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`));
  // Per-(group,user) push-notification mute. The bell in the chat header flips
  // this; the message push fan-out skips muted members (Tina 2026-07-31: "Glocke
  // bei jeder Gruppe um Benachrichtigungen an/aus"). Default FALSE = notified.
  await migrate('group_members notifications_muted', () =>
    db.query(`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE`));
  // Persistent per-(group,user) join counter. Survives leaving (the
  // group_members row is deleted on leave) so we can cap repeated join/leave
  // churn — a user may join any given group/club at most MAX_JOINS times.
  await migrate('group_join_counts', () =>
    db.query(`
      CREATE TABLE IF NOT EXISTS group_join_counts (
        group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        join_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
      )`));
  await migrate('users google_id col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`));
  await migrate('users apple_id col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id TEXT UNIQUE`));
  await migrate('groups lat/lng cols', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_lat_lng ON groups(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL`);
  });

  // ── Geofencing & pioneer system ────────────────────────────────────────────
  await migrate('waitlist', () => db.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE,
      country VARCHAR(10), ip VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`));
  await migrate('idx_waitlist_country', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist(country)`));
  await migrate('country_votes', () =>
    db.query(`CREATE TABLE IF NOT EXISTS country_votes (country VARCHAR(10) PRIMARY KEY, votes INTEGER NOT NULL DEFAULT 0)`));
  await migrate('users pioneer/admin cols', async () => {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pioneer BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin   BOOLEAN NOT NULL DEFAULT FALSE`);
  });
  await migrate('pioneer_claims', () => db.query(`
    CREATE TABLE IF NOT EXISTS pioneer_claims (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      lat_cell NUMERIC(6,2) NOT NULL, lng_cell NUMERIC(6,2) NOT NULL,
      claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lat_cell, lng_cell))`));
  await migrate('idx_pioneer_claims_cell', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_pioneer_claims_cell ON pioneer_claims(lat_cell, lng_cell)`));

  // ── Schema additions ───────────────────────────────────────────────────────
  await migrate('users.last_seen col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`));
  // Pinnwand = separate Pinterest-style gallery, distinct from the profile
  // carousel `photos`. JSON array of image URLs.
  await migrate('users.pinnwand col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pinnwand JSONB NOT NULL DEFAULT '[]'::jsonb`));
  // Birthday is editable exactly once after onboarding — this flag records that
  // the single allowed change has been used. Existing users default to FALSE, so
  // everyone keeps their one correction; setting the birthday for the first time
  // (Google sign-ups start NULL) does NOT flip it. Enforced in updateProfile.
  await migrate('users.date_of_birth_changed col', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth_changed BOOLEAN NOT NULL DEFAULT FALSE`));
  await migrate('groups.deleted_at', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_deleted_at ON groups(deleted_at) WHERE deleted_at IS NULL`);
  });
  await migrate('groups.parent_club_id', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS parent_club_id INTEGER REFERENCES groups(id) ON DELETE CASCADE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_parent_club ON groups(parent_club_id) WHERE parent_club_id IS NOT NULL`);
  });
  // Approval workflow for user-created clubs.
  // Default 'approved' so existing rows + Admin/seed creates stay visible.
  // createClub flips to 'pending' for non-admin owners; admins can then
  // approve/reject via /api/admin/clubs/*.
  await migrate('groups.approval_status', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_approval_status ON groups(approval_status) WHERE type = 'club'`);
    await db.query(`DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_groups_approval_status
        CHECK (approval_status IN ('approved','pending','rejected'));
    EXCEPTION WHEN duplicate_object THEN NULL;
              WHEN check_violation THEN NULL;
    END $$`);
  });
  // An event that never happened: the post-event review prompt asks members
  // "who was there" — for a no-show event there's no honest answer, and forcing
  // it pollutes attendance data. The owner marking the event "did not take
  // place" flips this flag; getPendingReviews then stops prompting anyone for it.
  await migrate('groups.did_not_take_place', () =>
    db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS did_not_take_place BOOLEAN NOT NULL DEFAULT FALSE`));
  await migrate('friendships.expires_at', async () => {
    await db.query(`ALTER TABLE friendships ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_friendships_expires ON friendships(expires_at) WHERE status = 'pending'`);
  });

  // ── Deals table ────────────────────────────────────────────────────────────
  await migrate('deals', () => db.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      category     VARCHAR(100) NOT NULL DEFAULT 'Lokal',
      deal_label   VARCHAR(100) NOT NULL,
      description  TEXT,
      address      VARCHAR(255),
      lat          DOUBLE PRECISION,
      lng          DOUBLE PRECISION,
      photos       JSONB NOT NULL DEFAULT '[]',
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('deals indexes', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_deals_active ON deals(is_active) WHERE is_active = TRUE`);
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS booking_url TEXT`);
  });
  // Cooperation deals: admin sets "Sichtbar bis" so promos expire automatically.
  // NULL = no expiry. Filtered server-side; client never needs to check.
  await migrate('deals.visible_until', async () => {
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS visible_until TIMESTAMP`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_deals_visible_until ON deals(visible_until) WHERE is_active = TRUE`);
  });

  // Global redemption cap: once this many distinct users have redeemed a deal it
  // auto-goes-offline (dropped from the public feed + no further redemptions) —
  // Robert (2026-06-17): "nach 100 Leuten nehmen wir den deal offline". DEFAULT 100
  // applies the rule to all deals (incl. existing rows); admins can raise it or set
  // NULL for unlimited per deal. Per-user cap (1) is separate, see dealController.
  await migrate('deals.max_redemptions', async () => {
    await db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS max_redemptions INTEGER DEFAULT 100`);
  });

  // Recurring deals: a perk can be redeemable once per day / week instead of
  // once-ever — e.g. SOHO's "Welcome Shot jeden Donnerstag". redeem_interval
  // ('once' | 'daily' | 'weekly') drives a period_key on each redemption; the
  // UNIQUE(deal_id, user_id, period_key) then enforces "once per period"
  // atomically (replaces the old once-ever UNIQUE(deal_id, user_id)).
  await migrate('deals.redeem_interval', () =>
    db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS redeem_interval TEXT NOT NULL DEFAULT 'once'`));
  // Weekday-restricted deals: a bar can limit redemption to specific weekdays
  // (e.g. "nur donnerstags"). redeem_days holds ISO weekday numbers (1=Mon …
  // 7=Sun); NULL/empty = any day. Redemption is gated server-side; the client
  // disables the button + labels it on other days.
  await migrate('deals.redeem_days', () =>
    db.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS redeem_days INTEGER[]`));

  // ── Subscriptions table (Stripe Pro) ─────────────────────────────────────────
  await migrate('subscriptions', () => db.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                     SERIAL PRIMARY KEY,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT UNIQUE,
      status                 TEXT NOT NULL DEFAULT 'pending',
      current_period_end     TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
  await migrate('idx_subscriptions_user', () =>
    db.query(`CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id)`));
  // At most ONE active-ish subscription per user, enforced by the DB as a
  // backstop to the advisory lock in createSubscription. If a race ever slips
  // two rows toward active/trialing, the webhook flipping the second one fails
  // here and it stays 'pending' (safe) rather than double-billing the user.
  await migrate('subscriptions one-active-per-user', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user
              ON subscriptions (user_id)
              WHERE status IN ('active','trialing','canceling')`));

  // ── Boost & Referral system ────────────────────────────────────────────────
  // Folded from boost_migration.sql so fresh Railway deploys self-bootstrap
  // these tables. Without this, register() crashes on INSERT INTO boost_credits.
  await migrate('referral_codes', () => db.query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code       VARCHAR(20) NOT NULL UNIQUE,
      used_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_referral_codes', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code)`);
    // Each user owns exactly one referral code — a UNIQUE index so an
    // ON CONFLICT DO NOTHING path can't silently split a user's count across
    // rows. MUST run after the table above exists: it was previously ordered
    // ~330 lines earlier (before the CREATE TABLE) so it never applied on a
    // fresh DB. Idempotent, so it's a no-op on the live DB where it already holds.
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_user_unique ON referral_codes(user_id)`);
  });
  await migrate('boost_credits', () => db.query(`
    CREATE TABLE IF NOT EXISTS boost_credits (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      credits       INTEGER NOT NULL DEFAULT 0,
      total_earned  INTEGER NOT NULL DEFAULT 0
    )`));
  await migrate('boosts', () => db.query(`
    CREATE TABLE IF NOT EXISTS boosts (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type   VARCHAR(10) NOT NULL CHECK (target_type IN ('group', 'club')),
      target_id     INTEGER NOT NULL,
      credits_spent INTEGER NOT NULL DEFAULT 1,
      boosted_until TIMESTAMP NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_boosts_target', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_boosts_target ON boosts(target_type, target_id)`));
  await migrate('boost_transactions', () => db.query(`
    CREATE TABLE IF NOT EXISTS boost_transactions (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credits          INTEGER NOT NULL,
      amount_cents     INTEGER NOT NULL,
      currency         VARCHAR(3) NOT NULL DEFAULT 'EUR',
      payment_provider VARCHAR(20),
      payment_id       TEXT,
      status           VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));
  await migrate('idx_boost_txn_payment_id', () =>
    db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_boost_txn_payment_id ON boost_transactions(payment_id) WHERE payment_id IS NOT NULL`));

  // ── Push subscriptions (web-push VAPID + APNs) ────────────────────────────
  // Folded from push_subscriptions_migration.sql.
  await migrate('push_subscriptions', () => db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform     VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'apns')),
      endpoint     TEXT,
      p256dh       TEXT,
      auth_key     TEXT,
      device_token TEXT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, endpoint),
      UNIQUE(user_id, device_token)
    )`));
  await migrate('idx_push_subscriptions_user', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`));

  // ── Reports / Content Moderation ──────────────────────────────────────────
  // Folded from reports_migration.sql.
  await migrate('reports', () => db.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id              SERIAL PRIMARY KEY,
      reporter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_type   VARCHAR(20) NOT NULL CHECK (reported_type IN ('user', 'group', 'message')),
      reported_id     INTEGER NOT NULL,
      reason          VARCHAR(50) NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'harassment', 'fake', 'other')),
      details         TEXT,
      status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at     TIMESTAMP,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reporter_id, reported_type, reported_id)
    )`));
  await migrate('idx_reports', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status, created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_type, reported_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id)`);
  });

  // ── Password reset tokens table ───────────────────────────────────────────
  await migrate('password_reset_tokens', () => db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used       BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

  // ── Performance indexes ────────────────────────────────────────────────────
  await migrate('performance indexes', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_is_active     ON groups(is_active) WHERE is_active = TRUE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_members_user   ON group_members(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_group_members_group  ON group_members(group_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_messages_group       ON messages(group_id, created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prt_token            ON password_reset_tokens(token)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prt_expires          ON password_reset_tokens(expires_at) WHERE used = FALSE`);
  });
  // ── Index hygiene + preview-ordering index ─────────────────────────────────
  // schema.sql (the production bootstrap) and the 'performance indexes' block
  // above both create overlapping indexes on the hottest WRITE tables, so every
  // INSERT maintained 3 indexes where 1 suffices. Drop the duplicates/redundant
  // prefixes and add idx_gm_group_joined so the member-preview subqueries
  // (ORDER BY joined_at LIMIT 3/4) stop early instead of scan+sort.
  await migrate('index dedup 2026-06', async () => {
    // messages: keep idx_msg_group_created(group_id, created_at DESC); the other
    // two are an exact dup and a redundant (group_id) prefix.
    await db.query(`DROP INDEX IF EXISTS idx_messages_group`);
    await db.query(`DROP INDEX IF EXISTS idx_msg_group`);
    // group_members: PK is (group_id, user_id) and the new joined index covers
    // group_id-prefix lookups; keep idx_gm_user for the user_id direction only.
    await db.query(`DROP INDEX IF EXISTS idx_group_members_user`);
    await db.query(`DROP INDEX IF EXISTS idx_group_members_group`);
    await db.query(`DROP INDEX IF EXISTS idx_gm_group`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gm_group_joined ON group_members(group_id, joined_at)`);
    // groups: idx_groups_is_active (partial) + idx_groups_type_active cover
    // these; the bare (is_active) and (type) indexes are redundant.
    await db.query(`DROP INDEX IF EXISTS idx_groups_active`);
    await db.query(`DROP INDEX IF EXISTS idx_groups_type`);
  });
  // ── Hot-path join/favorites/waitlist indexes ──────────────────────────────
  // Every group detail page fires 3+ lookups against these tables. Without
  // composite indexes they are sequential scans even on small tables.
  await migrate('idx_hot_path_tables', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gjr_group_user   ON group_join_requests(group_id, user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gjr_pending       ON group_join_requests(group_id, status) WHERE status = 'pending'`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gfav_group_user  ON group_favorites(group_id, user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gwl_group_user   ON group_waitlist(group_id, user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_gwl_waiting       ON group_waitlist(group_id, position) WHERE status = 'waiting'`);
  });
  // ── Friendship query indexes ───────────────────────────────────────────────
  // OR-condition friend lookups (requester OR addressee) use these independently.
  await migrate('idx_friendships_directional', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_fs_requester_status  ON friendships(requester_id, status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_fs_addressee_status  ON friendships(addressee_id, status)`);
  });
  // The only uniqueness was directional UNIQUE(requester_id, addressee_id), so a
  // symmetric race (A→B and B→A at once) could create two rows for one pair.
  // Dedupe any existing unordered-pair duplicates (keep the earliest id), then
  // add a normalized unique index so the reverse direction collides at the DB.
  await migrate('uniq_friend_pair', async () => {
    await db.query(`
      DELETE FROM friendships f
      USING friendships f2
      WHERE f.id > f2.id
        AND LEAST(f.requester_id, f.addressee_id)    = LEAST(f2.requester_id, f2.addressee_id)
        AND GREATEST(f.requester_id, f.addressee_id) = GREATEST(f2.requester_id, f2.addressee_id)`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_friend_pair
      ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))`);
  });
  await migrate('groups.chat_only_owner', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS chat_only_owner BOOLEAN DEFAULT FALSE`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_chat_only_owner ON groups(chat_only_owner) WHERE chat_only_owner = TRUE`);
  });
  await migrate('groups.events_owner_only', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS events_owner_only BOOLEAN DEFAULT FALSE`);
  });
  // Tina's call (2026-06-09): default Clubs to "only founder creates events"
  // — most clubs in DACH are operator-led, so the default should match the
  // common case. Existing rows are NOT migrated: that's an explicit choice by
  // each existing owner. Only the column default + new INSERTs change.
  await migrate('groups.events_owner_only default true', async () => {
    await db.query(`ALTER TABLE groups ALTER COLUMN events_owner_only SET DEFAULT TRUE`);
  });
  // Target audience age range. NULL on both sides means "no restriction"
  // (group is visible to everyone), which matches the existing default.
  // "JAMIE Moment" photo: a post-event picture uploaded by the owner from the
  // Hall of Fame page. Decoupled from `image_url` (the pre-event cover) so we
  // can show the planned image until the owner replaces it with the real
  // moment afterwards. Hall of Fame renders moment_photo_url ?? image_url.
  await migrate('groups.moment_photo_url', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS moment_photo_url TEXT`);
  });
  // Timestamp the moment-prompt push so the cron only fires once per event.
  // Stays NULL until the cron sends, then gates re-sends forever (even if the
  // owner later uploads + deletes their moment photo).
  await migrate('groups.moment_prompt_sent_at', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS moment_prompt_sent_at TIMESTAMPTZ`);
  });

  // Weekly recurring events for groups (type='group'). NULL/FALSE = one-off.
  // The `date` column stays as the *first* occurrence; the frontend computes
  // the next occurrence (date + N*7 days) when displaying / exporting to
  // calendar. We deliberately do NOT pre-generate child rows: one weekly
  // event for 5 years would be 260 rows per series, and any change to the
  // start time would fan out to every child. A flag + helper keeps it cheap.
  await migrate('groups.is_recurring_weekly', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_recurring_weekly BOOLEAN NOT NULL DEFAULT FALSE`);
  });

  await migrate('groups.target_age_min_max', async () => {
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS target_age_min INTEGER`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS target_age_max INTEGER`);
    // Postgres has no IF NOT EXISTS for table constraints, so wrap each ADD
    // CONSTRAINT in a DO block that swallows duplicate_object errors.
    await db.query(`DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_target_age_range
        CHECK (target_age_min IS NULL OR target_age_min BETWEEN 14 AND 99);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
    await db.query(`DO $$ BEGIN
      ALTER TABLE groups ADD CONSTRAINT chk_target_age_min_max
        CHECK (target_age_min IS NULL OR target_age_max IS NULL OR target_age_min <= target_age_max);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
  });
  // Direct messaging tables were only defined in seed schema.sql, so any DB
  // bootstrapped without that seed (e.g. fresh Railway plugin instance) blew up
  // with "relation does not exist" on every DM read/write. These idempotent
  // CREATEs make sure the tables show up on first server start.
  await migrate('direct_messages table', async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id                  SERIAL PRIMARY KEY,
        sender_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content             TEXT NOT NULL,
        message_type        VARCHAR(20) DEFAULT 'text',
        is_read             BOOLEAN DEFAULT FALSE,
        is_deleted_sender   BOOLEAN DEFAULT FALSE,
        is_deleted_receiver BOOLEAN DEFAULT FALSE,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(receiver_id, is_read) WHERE is_read = FALSE`);
  });
  await migrate('dm_conversations table', async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS dm_conversations (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        other_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_message_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL,
        last_message_at TIMESTAMP,
        unread_count    INTEGER DEFAULT 0,
        is_archived     BOOLEAN DEFAULT FALSE,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, other_user_id)
      )
    `);
    // schema.sql-bootstrapped DBs have this table WITHOUT is_archived (the
    // CREATE above no-ops on an existing table) — the first archive tap then
    // 42703'd and was silently dropped. Explicit ALTER covers both paths.
    await db.query(`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
    // getConversations does WHERE user_id = $1 ORDER BY updated_at DESC. The
    // intended composite was historically created as `idx_dmc_user`, which
    // collides with schema.sql's idx_dmc_user(user_id) — IF NOT EXISTS then
    // silently skipped it, so the ORDER BY fell back to a sort. Recreate under
    // a distinct name (table is guaranteed to exist at this point).
    await db.query(`DROP INDEX IF EXISTS idx_dmc_user`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_dmc_user_updated ON dm_conversations(user_id, updated_at DESC)`);
  });
  await migrate('idx_groups_category_lower', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_groups_category_lower ON groups(LOWER(category))`));
  await migrate('idx_groups_feed + map', async () => {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_feed ON groups(type, created_at DESC) WHERE is_active = TRUE AND deleted_at IS NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_map  ON groups(type, category, created_at DESC) WHERE is_active = TRUE AND deleted_at IS NULL AND lat IS NOT NULL AND lng IS NOT NULL`);
  });
  // Discover-events feed: lets Postgres walk upcoming events in date order and
  // stop at LIMIT 60 without sorting the whole events set (clubController.getDiscoverEvents).
  await migrate('idx_groups_event_date', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_groups_event_date ON groups(date) WHERE type = 'event' AND is_active = TRUE AND deleted_at IS NULL`));

  // ── Full-text search (requires pg_trgm extension) ─────────────────────────
  await migrate('pg_trgm + gin indexes', async () => {
    await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_name_gin     ON groups USING gin(name gin_trgm_ops)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_desc_gin     ON groups USING gin(description gin_trgm_ops)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_groups_location_gin ON groups USING gin(location gin_trgm_ops)`);
  });

  // ── DB-level CHECK constraints ─────────────────────────────────────────────
  await migrate('chk_friendship_status', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE friendships ADD CONSTRAINT chk_friendship_status
        CHECK (status IN ('pending','accepted','blocked'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`));
  // Fix: original constraint was missing 'rejected' and 'expired', breaking respondFriendRequest and the nightly cron
  await migrate('chk_friendship_status_v2', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE friendships DROP CONSTRAINT IF EXISTS chk_friendship_status;
      ALTER TABLE friendships ADD CONSTRAINT chk_friendship_status
        CHECK (status IN ('pending','accepted','blocked','rejected','expired'));
    END $$`));
  await migrate('chk_gm_role', () => db.query(`
    DO $$ BEGIN
      ALTER TABLE group_members ADD CONSTRAINT chk_gm_role
        CHECK (role IN ('owner','admin','member'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`));

  // ── IAP receipt ledger ────────────────────────────────────────────────────
  // Folded from iap_migration.sql so fresh Railway deploys self-bootstrap
  // without an extra manual step.
  await migrate('iap_receipts', () => db.query(`
    CREATE TABLE IF NOT EXISTS iap_receipts (
      id                BIGSERIAL PRIMARY KEY,
      user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform          TEXT   NOT NULL CHECK (platform IN ('apple', 'google')),
      product_id        TEXT   NOT NULL,
      product_type      TEXT   NOT NULL CHECK (product_type IN ('boost', 'subscription')),
      transaction_id    TEXT   NOT NULL,
      original_transaction_id TEXT,
      environment       TEXT,
      raw_receipt       TEXT NOT NULL,
      payload           JSONB NOT NULL,
      credited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at        TIMESTAMPTZ
    )`));
  await migrate('idx_iap_receipts', async () => {
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS iap_receipts_platform_txid_idx ON iap_receipts (platform, transaction_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS iap_receipts_user_idx           ON iap_receipts (user_id, product_type, credited_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS iap_receipts_origtx_idx         ON iap_receipts (original_transaction_id) WHERE original_transaction_id IS NOT NULL`);
  });

  // ── Deal redemption ledger ───────────────────────────────────────────────
  // Folded from deal_redemptions_migration.sql so fresh Railway deploys
  // self-bootstrap. UNIQUE (deal_id, user_id) enforces the "once per user"
  // cap at the DB level — even a parallel double-tap can't sneak two rows in.
  await migrate('deal_redemptions', () => db.query(`
    CREATE TABLE IF NOT EXISTS deal_redemptions (
      id          BIGSERIAL PRIMARY KEY,
      deal_id     BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (deal_id, user_id)
    )`));
  await migrate('idx_deal_redemptions', () => db.query(
    `CREATE INDEX IF NOT EXISTS deal_redemptions_user_idx ON deal_redemptions (user_id, redeemed_at DESC)`
  ));
  // Per-period redemption uniqueness. MUST run after the deal_redemptions table
  // above exists: it was previously ordered ~370 lines earlier (before the
  // CREATE TABLE), so on a freshly-provisioned DB the period_key column was
  // never added and redeemDeal's INSERT ... (deal_id,user_id,period_key) 500'd.
  // Idempotent, so it's a no-op on the live DB where the column already exists.
  await migrate('deal_redemptions.period_key', async () => {
    await db.query(`ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS period_key TEXT NOT NULL DEFAULT 'once'`);
    // Drop the once-ever uniqueness (auto-named by Postgres) and replace it with
    // a per-period one. Existing rows all carry period_key='once', so they map
    // 1:1 onto the new index without conflict.
    await db.query(`ALTER TABLE deal_redemptions DROP CONSTRAINT IF EXISTS deal_redemptions_deal_id_user_id_key`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS deal_redemptions_period_uq
                    ON deal_redemptions (deal_id, user_id, period_key)`);
  });

  // ── Coming-soon interest signals ──────────────────────────────────────────
  // "Benachrichtige mich" on not-yet-launched features (Pro / buyable Boosts).
  // One row per (user, feature); UNIQUE makes repeat taps idempotent. Lets us
  // notify + optionally discount exactly the interested users at launch.
  await migrate('feature_interest', async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS feature_interest (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        feature    VARCHAR(30) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, feature)
      )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_feature_interest_feature ON feature_interest(feature, created_at DESC)`);
  });

  // ── Profile-completion trigger: drop the unfillable pinterest_url field ────
  // The original trigger counted 10 fields incl. pinterest_url, which has no UI
  // to set it — so a fully completed profile maxed out at 90%. Redefine the
  // function over the 9 reachable fields, then fire a no-op UPDATE so existing
  // rows recompute immediately (BEFORE UPDATE triggers run on every UPDATE).
  await migrate('profile_completion drops pinterest_url', async () => {
    await db.query(`
      CREATE OR REPLACE FUNCTION calculate_profile_completion()
      RETURNS TRIGGER AS $$
      DECLARE
          total_fields INTEGER := 9;
          filled INTEGER := 0;
      BEGIN
          IF NEW.name IS NOT NULL AND NEW.name <> '' THEN filled := filled + 1; END IF;
          IF NEW.gender IS NOT NULL THEN filled := filled + 1; END IF;
          IF NEW.date_of_birth IS NOT NULL THEN filled := filled + 1; END IF;
          IF NEW.bio IS NOT NULL AND NEW.bio <> '' THEN filled := filled + 1; END IF;
          IF NEW.location IS NOT NULL AND NEW.location <> '' THEN filled := filled + 1; END IF;
          IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url <> '' THEN filled := filled + 1; END IF;
          IF NEW.photos IS NOT NULL AND jsonb_array_length(NEW.photos) > 0 THEN filled := filled + 1; END IF;
          IF NEW.interests IS NOT NULL AND jsonb_array_length(NEW.interests) > 0 THEN filled := filled + 1; END IF;
          IF NEW.favorite_song IS NOT NULL THEN filled := filled + 1; END IF;
          NEW.profile_completion := (filled * 100) / total_fields;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    // Recompute every existing row under the new formula (fires the trigger).
    await db.query(`UPDATE users SET updated_at = NOW() WHERE profile_completion <> 100`);
  });

  // ── Website contact form (jamie-app.com footer) ──────────────────────────
  // Source of truth for contact submissions; each row is also forwarded via
  // email (best-effort) to CONTACT_EMAIL / office@jamie-app.com.
  await migrate('contact_messages', () => db.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id         SERIAL PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name  VARCHAR(100) NOT NULL,
      email      VARCHAR(254) NOT NULL,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));

  // ── In-app feedback (FeedbackModal → admin dashboard) ────────────────────
  // Source of truth for feedback submissions; each row is also forwarded via
  // email (best-effort) to FEEDBACK_EMAIL / CONTACT_EMAIL. user_id is SET NULL
  // on account deletion so the feedback text survives anonymized (parity with
  // how contact_messages keeps no account link at all).
  await migrate('app_feedback', () => db.query(`
    CREATE TABLE IF NOT EXISTS app_feedback (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      category   VARCHAR(20) NOT NULL,
      platform   VARCHAR(20) NOT NULL DEFAULT 'web',
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
  await migrate('idx_app_feedback_created', () =>
    db.query(`CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON app_feedback(created_at DESC)`));

  // ── One-time storage-domain rewrite (pub-*.r2.dev → custom domain) ──────
  // 2026-07-29: production images were served from Cloudflare's pub-*.r2.dev
  // dev domain — rate-limited, documented as not-for-production, AND on common
  // content-blocker filter lists. The Android app is a TWA that runs in the
  // device's default browser: on Samsungs that's Samsung Internet with its
  // blocker ecosystem → Samsung users saw NO uploaded images at all (real-user
  // report, S24, via Tina). Fix = custom domain on the R2 bucket.
  //
  // New uploads pick up STORAGE_PUBLIC_URL automatically (storage.js). This
  // block rewrites the STORED absolute URLs. To activate: set BOTH
  //   STORAGE_PUBLIC_URL     = https://<custom-domain>        (new)
  //   OLD_STORAGE_PUBLIC_URL = https://pub-….r2.dev           (previous value)
  // on Railway and redeploy. Idempotent — after the first pass no row matches
  // the old prefix — so the OLD_ var can stay set or be deleted later.
  // JSONB arrays are rewritten via text-cast replace: the URL prefix contains
  // no JSON metacharacters, so this cannot corrupt the array structure.
  const oldStorage = (process.env.OLD_STORAGE_PUBLIC_URL || '').replace(/\/+$/, '');
  const newStorage = (process.env.STORAGE_PUBLIC_URL || '').replace(/\/+$/, '');
  if (oldStorage && newStorage && oldStorage !== newStorage) {
    await migrate('storage URL rewrite (old → new public domain)', async () => {
      // $3 = LIKE guard: plain prefix for TEXT columns, %-wrapped for the
      // JSONB text-cast (URL sits mid-string there).
      const likeText = `${oldStorage}/%`;
      const likeJson = `%${oldStorage}/%`;
      const steps = [
        ['users.avatar_url', likeText,
          `UPDATE users SET avatar_url = replace(avatar_url, $1, $2) WHERE avatar_url LIKE $3`],
        ['users.photos', likeJson,
          `UPDATE users SET photos = replace(photos::text, $1, $2)::jsonb WHERE photos::text LIKE $3`],
        ['groups.image_url', likeText,
          `UPDATE groups SET image_url = replace(image_url, $1, $2) WHERE image_url LIKE $3`],
        ['groups.moment_photo_url', likeText,
          `UPDATE groups SET moment_photo_url = replace(moment_photo_url, $1, $2) WHERE moment_photo_url LIKE $3`],
        ['groups.photos', likeJson,
          `UPDATE groups SET photos = replace(photos::text, $1, $2)::jsonb WHERE photos::text LIKE $3`],
        ['user_pinnwand.image_url', likeText,
          `UPDATE user_pinnwand SET image_url = replace(image_url, $1, $2) WHERE image_url LIKE $3`],
        ['deals.photos', likeJson,
          `UPDATE deals SET photos = replace(photos::text, $1, $2)::jsonb WHERE photos::text LIKE $3`],
      ];
      for (const [label, like, sql] of steps) {
        const r = await db.query(sql, [oldStorage, newStorage, like]);
        if (r.rowCount > 0) console.log(`   [storage-rewrite] ${label}: ${r.rowCount} rows`);
      }
    });
  }

  // ── Push i18n: per-user locale (de/it/en) ─────────────────────────────────
  // Captured from the frontend's X-App-Locale header on login/refresh so
  // server-initiated pushes (new-group match, join requests, digests) can be
  // sent in the user's app language instead of hardcoded German.
  await migrate('users.locale', () =>
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR(5)`));

  // ── Category-push digest state ────────────────────────────────────────────
  // At most ONE immediate "Neue Gruppe — bist du dabei?" push per user per 24h;
  // further matches only bump pending_count, and the daily digest cron flushes
  // it as a single bundled push ("N neue Gruppen für dich").
  await migrate('category_push_state', () =>
    db.query(`
      CREATE TABLE IF NOT EXISTS category_push_state (
        user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_immediate_at TIMESTAMP,
        pending_count     INTEGER NOT NULL DEFAULT 0,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));

  // Offsite-backup audit trail (BACKUP-KONZEPT.md): one row per backup run,
  // written by jobs/backup.js + jobs/mediaBackupSync.js. Doubles as (1) the
  // cross-replica "already ran today" marker and (2) the insurer-facing
  // evidence that the nightly vault backup actually executes (Konzept §7).
  await migrate('backup_runs', () => db.query(`
    CREATE TABLE IF NOT EXISTS backup_runs (
      id          BIGSERIAL PRIMARY KEY,
      kind        TEXT NOT NULL,                    -- 'db' | 'media'
      started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status      TEXT NOT NULL DEFAULT 'running',  -- running | success | failed
      object_key  TEXT,
      bytes       BIGINT,
      detail      TEXT
    )
  `));
  await migrate('backup_runs index', () => db.query(`
    CREATE INDEX IF NOT EXISTS idx_backup_runs_kind_started ON backup_runs (kind, started_at DESC)
  `));

  // ── Post-migration schema assertion ────────────────────────────────────
  // The server accepts traffic BEFORE migrations finish (listen → migrate),
  // so health stays green during the boot window; only a PROVEN-broken
  // schema flips this instance to degraded.
  _schemaAssertionError = null;
  for (const [what, sql] of CRITICAL_SCHEMA_PROBES) {
    try {
      await db.query(sql);
    } catch (err) {
      _schemaAssertionError = `${what}: ${err.message}`;
      console.error(`🛑 Schema assertion FAILED (${what}) — /api/health will report degraded:`, err.message);
      Sentry.captureException?.(err, { tags: { area: 'migrations', kind: 'schema-assertion' }, extra: { what } });
      break;
    }
  }

  if (_migrationFailures.length) {
    console.warn(`⚠️ Startup migrations done with ${_migrationFailures.length} failed step(s): ${_migrationFailures.map(f => f.label).join(', ')}`);
  } else {
    console.log('✅ Startup migrations done');
  }
};

// Consumed by /api/health: schemaAssertionError degrades the instance;
// stepFailures are informational (surfaced in the non-prod health body).
const getMigrationHealth = () => ({
  stepFailures: [..._migrationFailures],
  schemaAssertionError: _schemaAssertionError,
});

export { runStartupMigrations, getMigrationHealth };
