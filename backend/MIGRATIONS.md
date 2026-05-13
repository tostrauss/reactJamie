# JAMIE — Database Migration Reference

All migration SQL files live in `backend/src/config/`. Run them **once** against your production database after the initial schema is loaded.

Most migrations are idempotent (`IF NOT EXISTS`, `IF NOT EXISTS column`), so re-running is safe but not necessary.

---

## Run Order

### Step 0 — Base Schema (always first)

```bash
psql "$DATABASE_URL" -f backend/src/config/schema.sql
```

Creates all core tables: `users`, `groups`, `group_members`, `messages`, `notifications`, `friendships`, `password_reset_tokens`.

---

### Step 1 — Google OAuth

```bash
psql "$DATABASE_URL" -f backend/src/config/google_auth_migration.sql
```

Adds `google_id TEXT UNIQUE` column to `users`.  
Required for Google Sign-In flow.

---

### Step 2 — Email OTP

```bash
psql "$DATABASE_URL" -f backend/src/config/email_otp_migration.sql
```

Creates `email_verification_codes` table (6-digit codes, TTL-based expiry).  
Required for email verification during registration.

---

### Step 3 — Reports / Content Moderation

```bash
psql "$DATABASE_URL" -f backend/src/config/reports_migration.sql
```

Creates `reports` table (FK to `users` + `groups`).  
Required for the in-app report button and admin email alerts.

---

### Step 4 — Push Notifications

```bash
psql "$DATABASE_URL" -f backend/src/config/push_subscriptions_migration.sql
```

Creates `push_subscriptions` table (stores VAPID web-push endpoints and native APNs tokens).  
Required for push notification delivery.

---

### Step 5 — Boost & Referral System

```bash
psql "$DATABASE_URL" -f backend/src/config/boost_migration.sql
```

Creates `referral_codes`, `boost_transactions`, `boost_credits` tables.  
Required for the Boost feature (Stripe + PayPal payments, credit balance).

---

### Step 6 — Pro Subscriptions

```bash
psql "$DATABASE_URL" -f backend/src/config/subscriptions_migration.sql
```

Creates `subscriptions` table (FK to `users`).  
Required for Stripe subscription tracking.

---

### Step 7 — Analytics, Event Reviews, Trusted Users

```bash
psql "$DATABASE_URL" -f backend/src/config/analytics_migration.sql
```

Creates:
- `analytics_events` — telemetry events (screen views, app open/close)
- `category_suggestions` — user-submitted category ideas
- `event_reviews` — post-event review modal data

Adds columns to `users`:
- `is_trusted_user BOOLEAN DEFAULT FALSE`
- `trusted_count INTEGER DEFAULT 0`

---

### Step 8 — Geofencing / Pioneer Program

```bash
psql "$DATABASE_URL" -f backend/src/config/geofencing_migration.sql
```

Creates `waitlist`, `country_votes`, `pioneer_claims` tables.  
Adds columns to `users`: `is_pioneer`, `is_admin`.  
Required for the international expansion waitlist and pioneer-claim map.

---

### Step 9 — Chat Permissions

```bash
psql "$DATABASE_URL" -f backend/src/config/chat_permissions_migration.sql
```

Adds `chat_only_owner BOOLEAN DEFAULT FALSE` to `groups`.  
Required for the club owner-only chat toggle.

---

## Automatic Migrations (server boot)

The following are applied automatically each time the server starts via `runStartupMigrations()` in `server.js`. You do **not** need to run these manually — they are listed here for reference only.

| What | Effect |
|---|---|
| `email_verification_codes` table | Same as Step 2 — safe duplicate |
| `analytics_events` + indexes | Same as Step 7 — safe duplicate |
| `category_suggestions` | Same as Step 7 — safe duplicate |
| `event_reviews` + indexes | Same as Step 7 — safe duplicate |
| `users.is_trusted_user`, `trusted_count` | Same as Step 7 |
| `groups.lat`, `groups.lng` | Added for map feature |
| `waitlist`, `country_votes`, `pioneer_claims` | Same as Step 8 |
| `users.is_pioneer`, `users.is_admin` | Same as Step 8 |
| `groups.deleted_at` | Soft-delete support |
| `friendships.expires_at` | Pending request expiry |
| `deals` table + `booking_url` | Für Dich deals feature |
| Missing indexes (9 total) | Performance — safe to re-run |
| `groups.chat_only_owner` | Same as Step 9 — safe duplicate |

---

## Running All Migrations at Once

For a fresh production deployment after `schema.sql`:

```bash
for f in \
  backend/src/config/google_auth_migration.sql \
  backend/src/config/email_otp_migration.sql \
  backend/src/config/reports_migration.sql \
  backend/src/config/push_subscriptions_migration.sql \
  backend/src/config/boost_migration.sql \
  backend/src/config/subscriptions_migration.sql \
  backend/src/config/analytics_migration.sql \
  backend/src/config/geofencing_migration.sql \
  backend/src/config/chat_permissions_migration.sql; do
  echo "Running $f..."
  psql "$DATABASE_URL" -f "$f"
done
```

Then start the server — `runStartupMigrations()` will apply any remaining incremental changes.

---

## Notes

- `reset.sql` drops and recreates all tables. **Never run in production.** Development only.
- All migrations use `IF NOT EXISTS` / `IF NOT EXISTS` column guards — safe to re-run.
- After running migrations, verify with: `psql "$DATABASE_URL" -c "\dt"` to list all tables.
