# JAMIE — Database Migrations

How the JAMIE database schema is created and kept current. For backend devs.

## TL;DR

You do not run migrations by hand. The schema is built and updated automatically every time the server boots. `runStartupMigrations()` in `backend/src/server.js` runs the full set of `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` steps idempotently on every start. Booting a fresh, empty database brings it fully up to date with no manual step.

The standalone `*_migration.sql` files in `backend/src/config/` are kept as documentation and as a manual fallback. They mirror a subset of what the startup code does. They are not the source of truth — `server.js` is.

> The old "ALL 4 must be run on production DB" note in MEMORY.md is stale. Startup migrations self-bootstrap everything. You do not need to run any `.sql` file by hand on a normal deploy.

## How it runs

1. On boot, `server.js` calls `runStartupMigrations()` before the HTTP server starts listening.
2. It first waits for the database to accept connections: up to 90s (18 retries x 5s), since Railway Postgres can take 60-75s on a cold start. If the DB is still unreachable after 90s, migrations are skipped and a warning is logged.
3. Each migration step runs independently via a `migrate(...)` wrapper. A failing index never blocks a critical table.
4. Every step is idempotent (`IF NOT EXISTS` guards), so re-running on an already-migrated DB is a no-op.

There is nothing to invoke. Deploy the backend and the schema is correct.

## Tables created, in order

This is the order `runStartupMigrations()` creates tables. Order matters in one place: `deal_redemptions` is created last because its `deal_id` foreign key references `deals(id)`.

1. `email_verification_codes`
2. `waitlist_votes`
3. `analytics_events`
4. `category_suggestions`
5. `event_reviews`
6. `waitlist`
7. `country_votes`
8. `pioneer_claims`
9. `deals`
10. `subscriptions`
11. `referral_codes`
12. `boost_credits`
13. `boosts`
14. `boost_transactions`
15. `push_subscriptions`
16. `reports`
17. `password_reset_tokens`
18. `direct_messages`
19. `dm_conversations`
20. `iap_receipts`
21. `deal_redemptions` (last — FK `deal_id` REFERENCES `deals(id)`)

In addition to these tables, startup runs many `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, index, and `CHECK` steps against the existing `users`, `groups`, `friendships`, and `group_members` tables. Columns added at startup that exist **only** in `server.js` (no named `.sql` file) include:

| Table | Columns added at startup |
|---|---|
| `users` | `is_trusted_user`, `trusted_count`, `google_id`, `apple_id`, `is_pioneer`, `is_admin`, `last_seen` |
| `groups` | `lat`, `lng`, `deleted_at`, `parent_club_id`, `approval_status`, `chat_only_owner`, `events_owner_only`, `moment_photo_url`, `moment_prompt_sent_at`, `is_recurring_weekly`, `target_age_min`, `target_age_max` |
| `friendships` | `expires_at` |

## Standalone *_migration.sql files

These 13 files live in `backend/src/config/`. They mirror the folded startup steps and exist for documentation / manual recovery. They are **not** run automatically.

| File | Mirrors startup step | Notes |
|---|---|---|
| `schema.sql` | base seed schema | Core seed: `users`, `groups`, `group_members`, etc. Not part of `runStartupMigrations()`. |
| `reset.sql` | — | Drops and recreates all tables. Dev only. Never run in production. |
| `email_otp_migration.sql` | `email_verification_codes` | |
| `geofencing_migration.sql` | `waitlist`, `country_votes`, `pioneer_claims`, pioneer/admin cols | |
| `analytics_migration.sql` | `analytics_events`, `event_reviews`, trusted-user cols | |
| `subscriptions_migration.sql` | `subscriptions` | |
| `boost_migration.sql` | `referral_codes`, `boost_credits`, `boosts`, `boost_transactions` | |
| `push_subscriptions_migration.sql` | `push_subscriptions` | |
| `reports_migration.sql` | `reports` | |
| `google_auth_migration.sql` | `users.google_id` | |
| `chat_permissions_migration.sql` | `groups.chat_only_owner` | |
| `iap_migration.sql` | `iap_receipts` | Apple/Google in-app purchase receipts. |
| `deal_redemptions_migration.sql` | `deal_redemptions` | One-redemption-per-user deal proof. |

### Drift: startup creates more than the .sql files define

`server.js` is ahead of the `.sql` files. There is **no** standalone `.sql` for several things that startup creates:

- Tables: `waitlist_votes`, `category_suggestions`, `deals`, `password_reset_tokens`, `direct_messages`, `dm_conversations`
- Columns: `users.apple_id`, and the `groups` columns `events_owner_only`, `moment_photo_url`, `moment_prompt_sent_at`, `is_recurring_weekly`, `target_age_min`, `target_age_max`, `approval_status`, `parent_club_id`, `deleted_at`

These exist only in `server.js` (or the seed `schema.sql`). Treat `server.js` as authoritative. The `.sql` files are a partial mirror, not a complete one.

## Adding a new migration safely

Do the change in `server.js` so it runs automatically. Optionally add a mirroring `.sql` file for documentation.

1. Open `backend/src/config/` and decide whether you need a new table or just a column.
2. Add the step inside `runStartupMigrations()` in `backend/src/server.js`, wrapped in the existing `migrate('<label>', () => db.query(\`...\`))` pattern.
3. Make it idempotent. Tables use `CREATE TABLE IF NOT EXISTS`; columns use `ALTER TABLE x ADD COLUMN IF NOT EXISTS y`; indexes use `CREATE INDEX IF NOT EXISTS`.
4. If the new table has a foreign key, place its `migrate(...)` call **after** the referenced table's call. `deal_redemptions` after `deals` is the precedent.
5. Keep each step in its own `migrate(...)` block so one failure does not abort the rest.
6. (Optional) Add a mirroring `*_migration.sql` file and a row in the table above so the docs stay in sync.
7. Test locally against a fresh DB and again against an already-migrated DB to confirm idempotency:

   ```powershell
   # PowerShell (Windows)
   npm run dev    # from backend/ — boot once, watch the [migrations] logs
   npm run dev    # boot a second time — every step must be a no-op
   ```

   ```bash
   # bash equivalent
   npm run dev && npm run dev
   ```

- [ ] After merging a schema change, confirm the production boot logs show no migration errors (Railway logs, around the `[migrations]` lines).

## Manual fallback (rarely needed)

Normal deploys need none of this. Only run a `.sql` file by hand if you are recovering a database where startup migrations could not run.

```powershell
# PowerShell (Windows) — psql must be on PATH; DATABASE_URL set in the environment
psql $env:DATABASE_URL -f backend/src/config/schema.sql
psql $env:DATABASE_URL -f backend/src/config/<some>_migration.sql
```

```bash
# bash equivalent
psql "$DATABASE_URL" -f backend/src/config/schema.sql
psql "$DATABASE_URL" -f backend/src/config/<some>_migration.sql
```

List the resulting tables:

```powershell
psql $env:DATABASE_URL -c "\dt"
```

## Notes

- `reset.sql` drops and recreates all tables. Dev only. Never run in production.
- After a manual run, prefer to just boot the server — `runStartupMigrations()` reconciles anything the `.sql` files missed (they are a partial mirror).
- `is_recurring_weekly` exists on `groups`, but as of 2026-06-11 standalone groups send `is_recurring_weekly: false`. Only clubs' events set it true. The column stays; the behavior is product-level.
