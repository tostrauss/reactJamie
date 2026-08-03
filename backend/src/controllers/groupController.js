import db from '../config/database.js';
import { resolveCreateLocation, geocodeAllowedRegion } from '../utils/geocode.js';
import { checkTextSafety } from '../config/moderation.js';
import { sendPushToUser, sendPushToUsers } from './pushController.js';
import { expandMatchTerms } from '../utils/categoryFanout.js';
import { normalizeLocale, categoryPushText, joinRequestText } from '../utils/pushLocale.js';
import { getCached, setCached, invalidatePrefix, deleteCached } from '../utils/cache.js';
import { postSystemMessage } from '../utils/systemMessage.js';
import { isUserPro } from './subscriptionController.js';

const GROUPS_TTL  = 30_000;  // 30 s — acceptable staleness for list views
const AVATARS_TTL = 60_000;  // 60 s — avatars change only on join/leave

// Per-country bounding boxes for the "same-country" group feed filter — mirrors
// frontend/src/utils/regions.js REGION_BOUNDS. A logged-in user sees only groups
// whose coordinates fall in THEIR country's box (Tina 2026-07-27: a German user
// was seeing every group regardless of location). Deliberately generous
// rectangles: this is a soft market gate, so the shared Alpine borders overlap a
// little (a user near the border may see immediately-adjacent cross-border
// groups) — far-away groups (Vienna/Rome for a Berliner) are correctly hidden.
const COUNTRY_BOUNDS = {
  AT: { latMin: 46.37, latMax: 49.02, lngMin: 9.53, lngMax: 17.16 },
  DE: { latMin: 47.27, latMax: 55.06, lngMin: 5.87, lngMax: 15.04 },
  CH: { latMin: 45.82, latMax: 47.81, lngMin: 5.96, lngMax: 10.49 },
  IT: { latMin: 35.49, latMax: 47.09, lngMin: 6.62, lngMax: 18.52 },
};

// Anti-churn cap: a user may join any given group at most this many times
// (counted across leaves via group_join_counts) to stop join/leave spam.
// Groups are more casual/short-lived than clubs, so the cap is a bit higher.
const MAX_GROUP_JOINS = 3;

// ==========================================
// PIONEER HELPER
// Checks if a newly-created group is the first in its ~50km cell.
// If yes: awards pioneer badge + a free 7-day boost.
// ==========================================
async function checkAndAwardPioneer(userId, groupId, lat, lng) {
  try {
    const RADIUS_KM = 50;

    // Count other active groups within radius (Haversine formula)
    const nearbyRes = await db.query(
      `SELECT COUNT(*) AS count FROM groups
       WHERE is_active = TRUE
         AND id != $1
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND (
           6371 * acos(
             LEAST(1, cos(radians($2)) * cos(radians(lat))
               * cos(radians(lng) - radians($3))
               + sin(radians($2)) * sin(radians(lat))
             )
           )
         ) < $4`,
      [groupId, lat, lng, RADIUS_KM]
    );

    if (parseInt(nearbyRes.rows[0].count) > 0) return; // not pioneer territory

    // Grid cell: 0.5° ≈ 40-55 km
    const latCell = Math.floor(lat / 0.5) * 0.5;
    const lngCell = Math.floor(lng / 0.5) * 0.5;

    // Race-safe insert — ON CONFLICT means someone else was faster
    const claim = await db.query(
      `INSERT INTO pioneer_claims (user_id, group_id, lat_cell, lng_cell)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lat_cell, lng_cell) DO NOTHING
       RETURNING id`,
      [userId, groupId, latCell, lngCell]
    );

    if (claim.rowCount === 0) return; // cell already claimed

    // Award pioneer badge
    await db.query('UPDATE users SET is_pioneer = TRUE WHERE id = $1', [userId]);

    // Award the free 7-day boost promised by the map "Trau dich, sei der Erste!"
    // CTA — floats the pioneer's group to the top of the feed/map via the
    // is_boosted ordering. credits_spent = 0 marks it as a comped reward rather
    // than a paid/credit boost (the paid flow lives in boostController).
    await db.query(
      `INSERT INTO boosts (user_id, target_type, target_id, credits_spent, boosted_until)
       VALUES ($1, 'group', $2, 0, NOW() + INTERVAL '7 days')`,
      [userId, groupId]
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[pioneer] user ${userId} claimed cell (${latCell}, ${lngCell}) for group ${groupId} — badge + 7-day boost awarded`);
    }
  } catch (err) {
    // Non-critical — must not fail group creation
    console.error('[pioneer] check error:', err.message);
  }
}

// ==========================================
// CREATE GROUP / CLUB
// ==========================================
// Sanitize a multi-category selection → deduped, trimmed, max-3 string array
// (mirrors clubController). The singular `category` stays the primary.
function normalizeCategories(categories, category) {
  const src = Array.isArray(categories) ? categories : (category ? [category] : []);
  return [...new Set(src.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim()))].slice(0, 3);
}

// "Neue Gruppe — bist du dabei?" push to users whose profile interests match
// the group's categories (Tobi, 2026-07-30). Fire-and-forget after creation.
//
// Targeting rules:
//   - real groups only (no clubs; club events don't pass through createGroup)
//   - never the creator
//   - same launch-market country as the group, users with UNRESOLVED country
//     included (mirrors the feed's fall-through: they see every group anyway);
//     no country on the group (no pin) → no country filter
//   - capped at 500 recipients per group as a spam brake
//   - DIGEST: at most ONE immediate push per user per 24 h — further matches
//     only bump category_push_state.pending_count, which the daily digest cron
//     (server.js) flushes as a single bundled push. Prevents "20 Sport-Gruppen
//     an einem Tag = 20 Pushes".
//   - i18n: sent in each recipient's stored app language (users.locale).
// Delivery is push-only (no notifications row): it's an invitation nudge, not
// record-keeping — missing it costs nothing, the group is in the feed anyway.
async function notifyCategoryMatches(group, catList, countryCode, creatorId) {
  const terms = expandMatchTerms(catList);
  if (!terms.length) return;

  const matches = await db.query(
    `SELECT u.id, u.locale,
            s.last_immediate_at IS NOT NULL
              AND s.last_immediate_at > NOW() - INTERVAL '24 hours' AS recently_pushed
     FROM users u
     LEFT JOIN category_push_state s ON s.user_id = u.id
     WHERE u.id <> $1
       AND ($2::text IS NULL OR u.country IS NULL OR u.country = $2)
       AND u.interests IS NOT NULL
       AND jsonb_typeof(u.interests) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(u.interests) AS t(val)
         WHERE LOWER(TRIM(t.val)) = ANY($3::text[])
       )
     LIMIT 500`,
    [creatorId, countryCode, terms]
  );
  if (!matches.rows.length) return;

  const immediate = matches.rows.filter(r => !r.recently_pushed);
  const suppressed = matches.rows.filter(r => r.recently_pushed);

  // Suppressed → count towards today's digest.
  if (suppressed.length) {
    await db.query(
      `INSERT INTO category_push_state (user_id, pending_count, updated_at)
       SELECT unnest($1::int[]), 1, CURRENT_TIMESTAMP
       ON CONFLICT (user_id) DO UPDATE
         SET pending_count = category_push_state.pending_count + 1,
             updated_at = CURRENT_TIMESTAMP`,
      [suppressed.map(r => r.id)]
    ).catch(() => {});
  }

  if (!immediate.length) return;

  // Stamp BEFORE sending: two near-simultaneous creations must not both count
  // as "first of the day" for the same user.
  await db.query(
    `INSERT INTO category_push_state (user_id, last_immediate_at, updated_at)
     SELECT unnest($1::int[]), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     ON CONFLICT (user_id) DO UPDATE
       SET last_immediate_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    [immediate.map(r => r.id)]
  ).catch(() => {});

  // One bulk send per locale bucket (identical text within a bucket).
  const buckets = new Map();
  for (const r of immediate) {
    const l = normalizeLocale(r.locale);
    if (!buckets.has(l)) buckets.set(l, []);
    buckets.get(l).push(r.id);
  }
  for (const [locale, ids] of buckets) {
    const { title, body } = categoryPushText(locale, group);
    sendPushToUsers(ids, title, body, `/group/${group.id}`);
  }
}

// Creating a group/club requires a profile photo (Tina 2026-08-03): JAMIE is
// about real people + activities, so an avatar-less creator reads as a bot.
// Enforced server-side here; the frontend also gates the create flow. Exported
// so clubController.createClub reuses the exact same rule.
export async function creatorHasAvatar(userId) {
  const { rows } = await db.query('SELECT avatar_url FROM users WHERE id = $1', [userId]);
  const url = rows[0]?.avatar_url;
  return typeof url === 'string' && url.trim().length > 0;
}

export const createGroup = async (req, res) => {
  const { name, description, type, category, categories, date, time, location, image_url, max_members, is_private, skill_level, chat_only_owner, target_age_min, target_age_max, is_recurring_weekly } = req.body;
  const userId = req.userId; // JWT auth (not session)
  const catList = normalizeCategories(categories, category);

  if (!userId) return res.status(401).json({ error: 'Nicht autorisiert' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name ist erforderlich' });
  if (name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
  if (description && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });
  if (location && location.length > 200) return res.status(400).json({ error: 'Ort darf maximal 200 Zeichen lang sein' });

  try {
    // Profile-photo gate (Tina 2026-08-03).
    if (!(await creatorHasAvatar(userId))) {
      return res.status(403).json({
        error: 'Bitte lade zuerst ein Profilbild hoch, um eine Gruppe zu erstellen.',
        requiresAvatar: true,
      });
    }

    // Per-user daily limit: max 10 groups/clubs created in 24 hours
    const dailyCount = await db.query(
      `SELECT COUNT(*) FROM groups WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (parseInt(dailyCount.rows[0].count) >= 10) {
      return res.status(429).json({ error: 'Du kannst maximal 10 Gruppen pro Tag erstellen.' });
    }

    const textToCheck = [name, description].filter(Boolean).join('\n');
    const { safe, reason } = await checkTextSafety(textToCheck);
    if (!safe) {
      return res.status(422).json({ error: reason });
    }

    // Combine date + time if both provided
    let dateTime = date || null;
    if (date && time) {
      dateTime = `${date}T${time}`;
    }

    // Events must be in the future (clubs have no date, so skip check).
    // Two modes:
    //   - date-only payload ("2026-06-15"): "today or later" is OK because
    //     the exact time is coordinated later in the chat.
    //   - date+time payload ("2026-06-15T18:00"): must be a future timestamp.
    if (dateTime && (type === 'group' || !type)) {
      const eventDate = new Date(dateTime);
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'Ungültiges Datum' });
      }
      const hasTime = typeof dateTime === 'string' && dateTime.includes('T');
      if (hasTime) {
        if (eventDate <= new Date()) {
          return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
        }
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const eventDay = new Date(eventDate);
        eventDay.setHours(0, 0, 0, 0);
        if (eventDay < today) {
          return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
        }
      }
    }

    // Validate max_members — GROUPS are 4-20 (Tobi 2026-07-30, was de-facto
    // 2-20 in the stepper and "3-10" in copy); clubs keep the wide 2-500 range.
    const parsedMax = parseInt(max_members, 10);
    if ((type || 'group') === 'group') {
      if (max_members !== undefined && (isNaN(parsedMax) || parsedMax < 4 || parsedMax > 20)) {
        return res.status(400).json({ error: 'Teilnehmerzahl muss zwischen 4 und 20 liegen' });
      }
    } else if (max_members !== undefined && (isNaN(parsedMax) || parsedMax < 2 || parsedMax > 500)) {
      return res.status(400).json({ error: 'Maximale Teilnehmerzahl muss zwischen 2 und 500 liegen' });
    }

    // Validate target age range: optional, but if either bound is set it must
    // be a sane integer 14-99, and min <= max. Frontend should enforce this too.
    const parseAge = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? NaN : n;
    };
    const ageMin = parseAge(target_age_min);
    const ageMax = parseAge(target_age_max);
    if (Number.isNaN(ageMin) || Number.isNaN(ageMax)) {
      return res.status(400).json({ error: 'Ungültige Altersangabe' });
    }
    if ((ageMin !== null && (ageMin < 14 || ageMin > 99)) ||
        (ageMax !== null && (ageMax < 14 || ageMax > 99))) {
      return res.status(400).json({ error: 'Alter muss zwischen 14 und 99 liegen' });
    }
    if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
      return res.status(400).json({ error: 'Mindestalter darf nicht größer als Maximalalter sein' });
    }

    // Region gate: resolve coords only inside the launch markets, and REJECT a
    // location that resolves OUTSIDE them. The frontend Places picker is already
    // restricted, but a crafted API call could otherwise create a group with an
    // out-of-region pin. Unresolvable location → created without a pin (unchanged).
    const geo = await resolveCreateLocation(location);
    if (!geo.ok) {
      return res.status(400).json({ error: 'Dieser Ort liegt außerhalb der verfügbaren Regionen (Österreich, Deutschland, Schweiz, Italien).' });
    }
    const coords = geo.coords;

    // Weekly recurrence only applies to events (type='group'); silently ignored for clubs.
    const recurringWeekly = !!is_recurring_weekly && (type === 'group' || !type);

    const result = await db.query(
      `INSERT INTO groups (name, description, type, category, categories, date, location, image_url, max_members, is_private, skill_level, owner_id, lat, lng, chat_only_owner, target_age_min, target_age_max, is_recurring_weekly)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [name, description, type || 'group', (catList[0] || category), (catList.length ? catList : null), dateTime, location, image_url, max_members || 10, is_private || false, skill_level, userId, coords?.lat ?? null, coords?.lng ?? null, chat_only_owner || false, ageMin, ageMax, recurringWeekly]
    );

    const newGroup = result.rows[0];

    // Auto-add creator as member
    await db.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
      [newGroup.id, userId, 'owner']
    );

    // Pioneer check (fire-and-forget — must not block the response)
    if (coords?.lat && coords?.lng) {
      checkAndAwardPioneer(userId, newGroup.id, coords.lat, coords.lng).catch(() => {});
    }

    // Interest-match push: "bist du dabei?" to same-country users who favor
    // one of the group's categories (fire-and-forget, groups only — clubs
    // have their own follower semantics).
    if ((type || 'group') === 'group') {
      const groupCountry = coords?.countryCode ? coords.countryCode.toUpperCase() : null;
      notifyCategoryMatches(newGroup, catList, groupCountry, userId).catch(() => {});
    }

    // Welcome system message (fire-and-forget, no live broadcast — nobody is
    // in the chat yet anyway).
    const welcomeText = (type || 'group') === 'club'
      ? `Willkommen bei ${newGroup.name}! Stell euch kurz vor 👋`
      : `Willkommen bei ${newGroup.name}! Stell dich kurz vor 👋`;
    postSystemMessage(newGroup.id, welcomeText).catch(() => {});

    invalidatePrefix('groups:');
    invalidatePrefix('map:');
    res.status(201).json(newGroup);
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht erstellt werden' });
  }
};

// ==========================================
// GET ALL GROUPS (with filters)
// ==========================================
export const getGroups = async (req, res) => {
  try {
    const { type, search, category, location, upcoming, limit, offset } = req.query;

    if (search && search.length > 100) return res.status(400).json({ error: 'Suchbegriff zu lang' });

    // #1 Pro gate: non-Pro, non-admin callers see only 3 member previews per
    // group; Pro users AND admins see up to 4. The frontend blurs just the 4th
    // (bottom-right) tile as the "unlock with Pro" gate for the gated audience.
    //
    // Pro flag + caller age + admin flag in ONE round trip (was two: a separate
    // isUserPro subscriptions SELECT + a users SELECT, both before the cache
    // check). EXISTS predicate mirrors isUserPro exactly. Users without DOB are
    // included in everything (friendly default, Tina).
    let callerAge = null;
    let callerIsAdmin = false;
    let callerIsPro = false;
    let callerLocation = null;
    let callerCountry = null;
    if (req.userId) {
      try {
        const r = await db.query(
          `SELECT EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age,
                  is_admin, location, country,
                  EXISTS(
                    SELECT 1 FROM subscriptions s
                    WHERE s.user_id = users.id
                      AND (s.status = 'active' OR s.status = 'canceling' OR s.status = 'trialing')
                      AND s.current_period_end > NOW()
                  ) AS is_pro
           FROM users WHERE id = $1`,
          [req.userId]
        );
        callerAge = r.rows[0]?.age ?? null;
        callerIsAdmin = !!r.rows[0]?.is_admin;
        callerIsPro = !!r.rows[0]?.is_pro;
        callerLocation = r.rows[0]?.location ?? null;
        callerCountry = r.rows[0]?.country ?? null;
      } catch (err) {
        // subscriptions table not bootstrapped yet → no Pro; still need age/admin
        if (err.code === '42P01') {
          const r = await db.query(
            'SELECT EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age, is_admin, location FROM users WHERE id = $1',
            [req.userId]
          );
          callerAge = r.rows[0]?.age ?? null;
          callerIsAdmin = !!r.rows[0]?.is_admin;
          callerLocation = r.rows[0]?.location ?? null;
        } else {
          throw err;
        }
      }
    }

    // Same-country group filter: a logged-in user sees only groups in their own
    // launch-market country. The country is geocoded from the profile city ONCE
    // and cached in users.country; thereafter it's a plain column read. Guests
    // and users without a resolvable location fall through to "see everything".
    //
    // MUST be the market-restricted lookup (countrycodes=at,de,ch,it), not the
    // global one: Nominatim's global top hit for ambiguous Austrian town names
    // (Haag, Neumarkt, Gmünd, …) is often the bigger German namesake — the user
    // then got country='DE' PERSISTED and their feed silently collapsed to the
    // DE box + coordinate-less groups ("sieht nur noch 1 Gruppe", Tina
    // 2026-08-02). Out-of-market cities now resolve to null → country stays
    // NULL → the user sees everything, same as before.
    if (req.userId && !callerCountry && callerLocation) {
      const geo = await geocodeAllowedRegion(callerLocation);
      const cc = geo?.countryCode ? geo.countryCode.toUpperCase() : null;
      if (cc) {
        callerCountry = cc;
        db.query('UPDATE users SET country = $1 WHERE id = $2', [cc, req.userId]).catch(() => {});
      }
    }
    const regionBox = (callerCountry && COUNTRY_BOUNDS[callerCountry]) || null;

    // Admins bypass the gate entirely → full 4 previews like Pro.
    const previewLimit = (callerIsPro || callerIsAdmin) ? 4 : 3;

    // Cache only filter combinations that don't involve free-text search or location
    // (those are low-frequency, high-variability and not worth the memory).
    // Pro flag + admin flag + caller age are part of the key so users with
    // different visibility never share a cache row.
    const cacheKey = !search && !location
      ? `groups:${type || ''}:${category || ''}:${upcoming || ''}:${limit || ''}:${offset || ''}:p${callerIsPro ? 1 : 0}:adm${callerIsAdmin ? 1 : 0}:a${callerAge ?? 'x'}:c${callerCountry ?? 'x'}`
      : null;
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }

    // ── Filter predicate ────────────────────────────────────────────────────
    // Built ONCE and used by the paging CTE below. Everything here is a plain
    // column test on `groups`, so it can be evaluated before the expensive
    // per-row projections.
    const params = [];
    let paramIndex = 1;
    let where = `g.is_active = TRUE AND g.deleted_at IS NULL AND g.type IN ('group', 'club')`;

    // Clubs awaiting moderation must NOT surface in the public feed — getClubs
    // and getMapPins already gate on approval_status, but getGroups (a public
    // route that returns clubs too) did not, so a pending club's name/image was
    // visible to everyone, bypassing the human-approval queue. Groups have no
    // approval flow. Admins see everything (the flag is in the cache key, so
    // this stays cache-safe); a club owner still sees their own pending club in
    // "Meine Clubs" (getClubs), just not in this public discovery feed.
    if (!callerIsAdmin) {
      where += ` AND (g.type <> 'club' OR g.approval_status = 'approved')`;
    }

    // Apply target-age hard filter. NULL caller age = pass everything; otherwise
    // exclude groups whose [min,max] range doesn't contain the caller.
    if (callerAge !== null) {
      where += ` AND (g.target_age_min IS NULL OR g.target_age_min <= $${paramIndex})
                 AND (g.target_age_max IS NULL OR g.target_age_max >= $${paramIndex})`;
      params.push(callerAge);
      paramIndex++;
    }

    // Same-country box filter (see COUNTRY_BOUNDS). Groups without coordinates are
    // kept (can't place them — don't over-hide). Only applied for known markets.
    if (regionBox) {
      where += ` AND (g.lat IS NULL OR (g.lat BETWEEN $${paramIndex} AND $${paramIndex + 1}
                                        AND g.lng BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}))`;
      params.push(regionBox.latMin, regionBox.latMax, regionBox.lngMin, regionBox.lngMax);
      paramIndex += 4;
    }

    if (type) {
      where += ` AND g.type = $${paramIndex++}`;
      params.push(type);
    }
    if (search) {
      where += ` AND (g.name ILIKE $${paramIndex} OR g.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category) {
      // OR-match across the multi-category array, falling back to the primary.
      where += ` AND (g.category ILIKE $${paramIndex} OR $${paramIndex} = ANY(g.categories))`;
      params.push(category);
      paramIndex++;
    }
    if (location) {
      where += ` AND g.location ILIKE $${paramIndex++}`;
      params.push(`%${location}%`);
    }
    if (upcoming === 'true') {
      // Compare by DAY (CURRENT_DATE), not the exact moment. Date-only events
      // ("time coordinated in chat") store at midnight, so `>= CURRENT_TIMESTAMP`
      // dropped an event happening later TODAY from the feed at 00:01 — a freed
      // spot on a today event became un-joinable (Lea's picnic). Mirrors the
      // club-event feed. Weekly recurring events never go "past".
      //
      // `g.date IS NULL` must be spelled out: date is nullable (createGroup only
      // validates it `if (dateTime)`), and NULL >= CURRENT_DATE evaluates to NULL,
      // not TRUE — so an undated group was silently dropped from the Groups tab
      // FOREVER while still showing on the map, which applies the NULL-safe form
      // (mapController: `g.date IS NULL OR g.date >= CURRENT_DATE`). An undated
      // group is ongoing, not past. Reported by Tina 2026-07-28 ("Komisch mir wird
      // eine Gruppe in der Map angezeigt, die mir aber bei den Gruppen nicht").
      where += ` AND (g.date IS NULL OR g.date >= CURRENT_DATE OR g.is_recurring_weekly = TRUE)`;
    }

    const safeLimit = Math.min(parseInt(limit, 10) || 100, 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    params.push(safeLimit);
    const limitParam = paramIndex++;
    let offsetClause = '';
    if (safeOffset > 0) {
      params.push(safeOffset);
      offsetClause = ` OFFSET $${paramIndex++}`;
    }

    // ── Page FIRST, decorate SECOND ─────────────────────────────────────────
    // The sort keys (is_boosted, is_full) are computed expressions, so Postgres
    // cannot use an index to satisfy the ORDER BY and stop early — it must
    // materialise every matching row before applying LIMIT. When the expensive
    // projections (member_previews, the age-range LATERAL, like_count) live in
    // that same SELECT, they run for EVERY matching group and ~98% of the work
    // is then discarded by the LIMIT.
    //
    // Measured at 6 000 groups / 120 000 memberships: the old single-statement
    // form took ~450 ms and 309 897 shared buffer hits per request, of which the
    // age-range LATERAL alone was 97% (95 672 users_pkey lookups). Splitting it
    // so only the paged rows get decorated: ~23 ms and 8 834 buffers — 19x
    // faster, 35x less I/O, identical columns. The gap widens linearly with the
    // total group count, so this is what keeps the feed flat as JAMIE grows.
    //
    // `g.id DESC` is a deliberate addition to the sort: created_at alone is not
    // unique, and without a stable tie-breaker LIMIT/OFFSET paging can repeat or
    // skip a row across page boundaries.
    const query = `
      WITH page AS (
        SELECT g.id,
               CASE WHEN g.members_count >= g.max_members THEN 1 ELSE 0 END AS is_full,
               EXISTS (
                 SELECT 1 FROM boosts b
                 WHERE b.target_id = g.id AND b.target_type = g.type
                   AND b.boosted_until > NOW()
               ) AS is_boosted,
               g.created_at
        FROM groups g
        WHERE ${where}
        ORDER BY is_boosted DESC, is_full ASC, g.created_at DESC, g.id DESC
        LIMIT $${limitParam}${offsetClause}
      )
      SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
             EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age,
             page.is_full,
             (
               SELECT COALESCE(json_agg(sub), '[]'::json)
               FROM (
                 SELECT u2.id, u2.name, u2.avatar_url,
                        EXTRACT(YEAR FROM AGE(u2.date_of_birth))::int AS age
                 FROM group_members gm
                 JOIN users u2 ON gm.user_id = u2.id
                 WHERE gm.group_id = g.id
                 ORDER BY gm.joined_at ASC
                 LIMIT ${previewLimit}
               ) sub
             ) AS member_previews,
             ages.age_min,
             ages.age_max,
             page.is_boosted,
             (SELECT COUNT(*) FROM event_likes el WHERE el.group_id = g.id)::int AS like_count
      FROM page
      JOIN groups g ON g.id = page.id
      LEFT JOIN users u ON g.owner_id = u.id
      LEFT JOIN LATERAL (
        SELECT MIN(EXTRACT(YEAR FROM AGE(uu.date_of_birth))::int) AS age_min,
               MAX(EXTRACT(YEAR FROM AGE(uu.date_of_birth))::int) AS age_max
        FROM group_members gmx
        JOIN users uu ON gmx.user_id = uu.id
        WHERE gmx.group_id = g.id AND uu.date_of_birth IS NOT NULL
      ) ages ON TRUE
      -- Re-stated: the JOIN above does not preserve the CTE's ordering.
      ORDER BY page.is_boosted DESC, page.is_full ASC, g.created_at DESC, g.id DESC
    `;

    const result = await db.query(query, params);
    if (cacheKey) setCached(cacheKey, result.rows, GROUPS_TTL);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ error: 'Gruppen konnten nicht geladen werden' });
  }
};

// ==========================================
// GET SINGLE GROUP BY ID
// ==========================================
export const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS owner_age,
              (
                SELECT MIN(EXTRACT(YEAR FROM AGE(u2.date_of_birth))::int)
                FROM group_members gm
                JOIN users u2 ON gm.user_id = u2.id
                WHERE gm.group_id = g.id AND u2.date_of_birth IS NOT NULL
              ) AS age_min,
              (
                SELECT MAX(EXTRACT(YEAR FROM AGE(u3.date_of_birth))::int)
                FROM group_members gm2
                JOIN users u3 ON gm2.user_id = u3.id
                WHERE gm2.group_id = g.id AND u3.date_of_birth IS NOT NULL
              ) AS age_max
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE g.id = $1 AND g.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }

    const group = result.rows[0];

    // Check if current user is member/favorite/pending (if authenticated)
    if (req.userId) {
      const [memberCheck, favCheck, requestCheck, waitlistCheck] = await Promise.all([
        db.query('SELECT role, notifications_muted FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
        db.query('SELECT 1 FROM group_favorites WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
        db.query(
          `SELECT status FROM group_join_requests WHERE group_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 1`,
          [id, req.userId]
        ),
        db.query(
          `SELECT status, position FROM group_waitlist WHERE group_id = $1 AND user_id = $2`,
          [id, req.userId]
        ),
      ]);
      group.is_member = memberCheck.rows.length > 0;
      // Per-group push mute state for the chat-header bell (null for non-members).
      group.is_muted = memberCheck.rows[0] ? !!memberCheck.rows[0].notifications_muted : false;
      // Co-manager (clubs): owner OR a member promoted to role='admin'. Lets the
      // edit page + manage UI grant access to managers, not just the owner.
      group.my_role = memberCheck.rows[0]?.role || null;
      group.is_manager = Number(group.owner_id) === Number(req.userId) || memberCheck.rows[0]?.role === 'admin';
      // Club events: the parent club's owner / co-managers may also manage the
      // event (edit time, photo, …), not only the member who created it — so the
      // edit gear shows for them on the event page too.
      if (!group.is_manager && group.type === 'event' && group.parent_club_id) {
        const clubMgr = await db.query(
          `SELECT 1 FROM groups c
             LEFT JOIN group_members gm ON gm.group_id = c.id AND gm.user_id = $2
           WHERE c.id = $1 AND (c.owner_id = $2 OR gm.role = 'admin') LIMIT 1`,
          [group.parent_club_id, req.userId]
        );
        if (clubMgr.rowCount > 0) group.is_manager = true;
      }
      group.is_favorite = favCheck.rows.length > 0;
      group.join_request_status = requestCheck.rows[0]?.status || null;
      group.waitlist_status = waitlistCheck.rows[0]?.status || null;
      group.waitlist_position = waitlistCheck.rows[0]?.position || null;
    }

    res.json(group);
  } catch (err) {
    console.error('Error fetching group:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// UPDATE GROUP (owner only)
// ==========================================
export const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, categories, date, location, image_url, max_members, is_private, skill_level, chat_only_owner, target_age_min, target_age_max, is_recurring_weekly, moment_photo_url } = req.body;
    // Multi-category: catList = full set; category column = primary. Empty
    // (neither sent) → null params → COALESCE keeps existing values.
    const catList = normalizeCategories(categories, category);

    if (name !== undefined && name.length > 100) return res.status(400).json({ error: 'Name darf maximal 100 Zeichen lang sein' });
    if (description !== undefined && description.length > 2000) return res.status(400).json({ error: 'Beschreibung darf maximal 2.000 Zeichen lang sein' });
    if (location !== undefined && location.length > 200) return res.status(400).json({ error: 'Ort darf maximal 200 Zeichen lang sein' });

    // Same age-range validation as createGroup; null clears the bound.
    const parseAgeUpdate = (v) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? NaN : n;
    };
    const ageMinU = parseAgeUpdate(target_age_min);
    const ageMaxU = parseAgeUpdate(target_age_max);
    if (Number.isNaN(ageMinU) || Number.isNaN(ageMaxU)) {
      return res.status(400).json({ error: 'Ungültige Altersangabe' });
    }
    if ((typeof ageMinU === 'number' && (ageMinU < 14 || ageMinU > 99)) ||
        (typeof ageMaxU === 'number' && (ageMaxU < 14 || ageMaxU > 99))) {
      return res.status(400).json({ error: 'Alter muss zwischen 14 und 99 liegen' });
    }
    if (typeof ageMinU === 'number' && typeof ageMaxU === 'number' && ageMinU > ageMaxU) {
      return res.status(400).json({ error: 'Mindestalter darf nicht größer als Maximalalter sein' });
    }

    // Verify ownership (type also feeds the 4-20 group-size rule below)
    const group = await db.query('SELECT owner_id, type FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    const textToCheck = [name, description].filter(Boolean).join('\n');
    if (textToCheck) {
      const { safe, reason } = await checkTextSafety(textToCheck);
      if (!safe) {
        return res.status(422).json({ error: reason });
      }
    }

    // Validate future date on update (groups only, clubs have no date).
    // Skip the future check when the (incoming or stored) event is weekly
    // recurring — past start dates are normal for recurring series. Date-only
    // payloads also pass when the date is today (time is set in chat).
    if (date !== undefined && date !== null) {
      const eventDate = new Date(date);
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'Ungültiges Datum' });
      }
      let recurringForCheck = !!is_recurring_weekly;
      if (is_recurring_weekly === undefined) {
        const cur = await db.query('SELECT is_recurring_weekly FROM groups WHERE id = $1', [id]);
        recurringForCheck = !!cur.rows[0]?.is_recurring_weekly;
      }
      if (!recurringForCheck) {
        const hasTime = typeof date === 'string' && date.includes('T');
        if (hasTime) {
          if (eventDate <= new Date()) {
            return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
          }
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const eventDay = new Date(eventDate);
          eventDay.setHours(0, 0, 0, 0);
          if (eventDay < today) {
            return res.status(400).json({ error: 'Das Event-Datum muss in der Zukunft liegen' });
          }
        }
      }
    }

    // Validate max_members is not set below current member count.
    // Groups: 4-20 (mirror of create); clubs/events keep 2-500. A legacy group
    // that already grew PAST 20 (the old edit cap was 100) may keep or shrink
    // toward its current size — a hard 20 would make every edit unsaveable for
    // its owner (frontend always sends max_members).
    if (max_members !== undefined) {
      const parsedMax = parseInt(max_members, 10);
      const countRes = await db.query('SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = $1', [id]);
      const currentCount = parseInt(countRes.rows[0]?.cnt ?? 0, 10);
      if (group.rows[0].type === 'group') {
        const upper = Math.max(20, currentCount);
        if (isNaN(parsedMax) || parsedMax < 4 || parsedMax > upper) {
          return res.status(400).json({ error: `Teilnehmerzahl muss zwischen 4 und ${upper} liegen` });
        }
      } else if (isNaN(parsedMax) || parsedMax < 2 || parsedMax > 500) {
        return res.status(400).json({ error: 'Maximale Teilnehmerzahl muss zwischen 2 und 500 liegen' });
      }
      if (parsedMax < currentCount) {
        return res.status(400).json({ error: `Gruppe hat bereits ${currentCount} Mitglieder. Maximale Teilnehmerzahl darf nicht darunter liegen.` });
      }
    }

    // Re-geocode if location is being updated
    let latUpdate = null;
    let lngUpdate = null;
    if (location !== undefined) {
      // Region gate — see createGroup: reject out-of-region, no pin if unresolvable.
      const geo = await resolveCreateLocation(location);
      if (!geo.ok) {
        return res.status(400).json({ error: 'Dieser Ort liegt außerhalb der verfügbaren Regionen (Österreich, Deutschland, Schweiz, Italien).' });
      }
      latUpdate = geo.coords?.lat ?? null;
      lngUpdate = geo.coords?.lng ?? null;
    }

    // Sentinels: ageMin/MaxU is `undefined` when client didn't touch the field
    // (keep existing), `null` when explicitly clearing, integer when setting.
    const result = await db.query(
      `UPDATE groups
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           categories = COALESCE($18, categories),
           date = COALESCE($4, date),
           location = COALESCE($5, location),
           image_url = COALESCE($6, image_url),
           max_members = COALESCE($7, max_members),
           is_private = COALESCE($8, is_private),
           skill_level = COALESCE($9, skill_level),
           chat_only_owner = COALESCE($13, chat_only_owner),
           target_age_min = CASE WHEN $14::text = '__keep__' THEN target_age_min ELSE NULLIF($14, '__null__')::int END,
           target_age_max = CASE WHEN $15::text = '__keep__' THEN target_age_max ELSE NULLIF($15, '__null__')::int END,
           is_recurring_weekly = COALESCE($16, is_recurring_weekly),
           moment_photo_url = COALESCE($17, moment_photo_url),
           lat = CASE WHEN $5 IS NOT NULL THEN $11 ELSE lat END,
           lng = CASE WHEN $5 IS NOT NULL THEN $12 ELSE lng END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [
        name, description, (catList.length ? catList[0] : null), date, location, image_url, max_members, is_private, skill_level,
        id, latUpdate, lngUpdate, chat_only_owner ?? null,
        ageMinU === undefined ? '__keep__' : (ageMinU === null ? '__null__' : String(ageMinU)),
        ageMaxU === undefined ? '__keep__' : (ageMaxU === null ? '__null__' : String(ageMaxU)),
        is_recurring_weekly === undefined ? null : !!is_recurring_weekly,
        moment_photo_url ?? null,
        catList.length ? catList : null,
      ]
    );

    // Invalidate AFTER the write commits — busting before let a concurrent
    // getGroups re-cache the PRE-update row and serve it for the full TTL.
    invalidatePrefix('groups:');
    invalidatePrefix('map:');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht aktualisiert werden' });
  }
};

// ==========================================
// DELETE GROUP (owner only)
// ==========================================
export const deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Soft delete — preserves messages, reviews, and member history
    await db.query('UPDATE groups SET deleted_at = NOW() WHERE id = $1', [id]);
    invalidatePrefix('groups:');
    invalidatePrefix('map:');
    // Drop the per-member chat-list cache too, so the deleted group disappears
    // from every member's "Chats" immediately instead of lingering for the 15s
    // user_groups TTL (the query already filters deleted_at, this kills the lag).
    invalidatePrefix('user_groups:');
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    console.error('Error deleting group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht gelöscht werden' });
  }
};

// A club event (parent_club_id set) that belongs to a PRIVATE club may only be
// JOINED / waitlisted by members of that club — non-members can still SEE it on
// the Discover-events feed but must join the club first. Returns true if the
// caller must be blocked. A normal group (parentClubId NULL) is never blocked.
async function isPrivateClubEventBlocked(parentClubId, userId) {
  if (!parentClubId) return false;
  const { rows } = await db.query(
    `SELECT c.is_private, cm.user_id AS is_member
     FROM groups c
     LEFT JOIN group_members cm ON cm.group_id = c.id AND cm.user_id = $2
     WHERE c.id = $1`,
    [parentClubId, userId]
  );
  return !!(rows[0]?.is_private && !rows[0].is_member);
}

// ==========================================
// JOIN GROUP
// ==========================================
export const joinGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Single query: group info + membership check via LEFT JOIN
    const groupRes = await db.query(
      `SELECT g.owner_id, g.name, g.members_count, g.max_members, g.is_private,
              g.type, g.parent_club_id,
              gm.user_id AS already_member
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [id, req.userId]
    );
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (groupRes.rows[0].already_member) return res.status(400).json({ error: 'Already a member' });

    // Club-event membership gate: a private club's event is joinable ONLY by
    // members of that club. Non-members still SEE it on Discover but must join
    // the club first — before this, joinGroup treated an event like any group
    // and a non-member (e.g. a man joining an "only girls" club's private event)
    // could join outright (reported live 2026-08-03).
    if (await isPrivateClubEventBlocked(groupRes.rows[0].parent_club_id, req.userId)) {
      return res.status(403).json({
        error: 'Dieses Event gehört zu einem privaten Club. Tritt zuerst dem Club bei, um teilzunehmen.',
        code: 'CLUB_MEMBERS_ONLY',
      });
    }

    // Anti-churn: a user may join any given group at most MAX_GROUP_JOINS times.
    // The counter persists across leaves (group_members rows are deleted on
    // leave), so constant join/leave spam is capped. Checked here so it blocks
    // both a public join and a new private join-request.
    const jc = await db.query(
      'SELECT join_count FROM group_join_counts WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if ((jc.rows[0]?.join_count || 0) >= MAX_GROUP_JOINS) {
      return res.status(403).json({
        error: 'Du bist dieser Gruppe bereits dreimal beigetreten und kannst ihr nicht erneut beitreten.',
      });
    }

    // Check capacity
    const g = groupRes.rows[0];
    if (g.members_count >= g.max_members) {
      return res.status(400).json({ error: 'Die Gruppe ist bereits voll' });
    }

    // Private group → create join request (or reset a previous rejection to pending).
    // Club EVENTS are excluded (parent_club_id set): they inherit the club's
    // is_private, but their access is gated by CLUB membership above, not by a
    // per-event join request — a club member who cleared that gate joins the
    // event directly (below), a non-member was already 403'd.
    if (g.is_private && !g.parent_club_id) {
      const existingReq = await db.query(
        `SELECT status FROM group_join_requests WHERE group_id = $1 AND user_id = $2`,
        [id, req.userId]
      );
      if (existingReq.rows.length > 0 && existingReq.rows[0].status === 'pending') {
        return res.status(400).json({ error: 'Beitrittsanfrage bereits ausstehend' });
      }

      await db.query(
        `INSERT INTO group_join_requests (group_id, user_id, message)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, user_id)
         DO UPDATE SET status = 'pending', message = $3, updated_at = CURRENT_TIMESTAMP`,
        [id, req.userId, message || null]
      );
      // Notify owner about the new join request (fire-and-forget)
      if (g.owner_id && Number(g.owner_id) !== Number(req.userId)) {
        notifyJoinRequest(req.userId, g.owner_id, g.name || '', id).catch(() => {});
      }
      return res.json({ message: 'Join request sent', status: 'pending' });
    }

    // Public group → join inside a transaction with FOR UPDATE to prevent TOCTOU race
    let didJoin = false;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Re-check capacity under lock so concurrent requests can't both sneak in
      const locked = await client.query(
        'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (locked.rows[0].members_count >= locked.rows[0].max_members) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Die Gruppe ist bereits voll' });
      }
      // ON CONFLICT DO NOTHING so a mobile double-tap no-ops instead of hitting
      // the PK and 500ing ("Beitritt fehlgeschlagen" on a benign double-click).
      const memberIns = await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, req.userId, 'member']
      );
      // Bump the persistent churn counter ONLY on a real insert — the second of
      // two racing requests would otherwise double-count one join and, with
      // MAX_GROUP_JOINS=3, erode the user's remaining joins for free.
      if (memberIns.rowCount > 0) {
        await client.query(
          `INSERT INTO group_join_counts (group_id, user_id, join_count)
           VALUES ($1, $2, 1)
           ON CONFLICT (group_id, user_id)
           DO UPDATE SET join_count = group_join_counts.join_count + 1`,
          [id, req.userId]
        );
      }
      await client.query('DELETE FROM group_waitlist WHERE group_id = $1 AND user_id = $2', [id, req.userId]);
      didJoin = memberIns.rowCount > 0;
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Notify group owner (fire-and-forget), gated on a real join.
    if (didJoin && g.owner_id && Number(g.owner_id) !== Number(req.userId)) {
      notifyGroupJoin(req.userId, g.owner_id, g.name || '', id).catch(() => {});
    }

    // Post a "X ist beigetreten 🎉" system message, broadcast live to anyone
    // currently in the chat room. Fire-and-forget — never let it break the join.
    db.query('SELECT name FROM users WHERE id = $1', [req.userId])
      .then(r => {
        const name = r.rows[0]?.name || 'Jemand';
        postSystemMessage(id, `${name} ist der Gruppe beigetreten 🎉`, req.app.get('io')).catch(() => {});
      })
      .catch(() => {});

    deleteCached(`user_groups:${req.userId}`);
    res.json({ message: 'Joined group successfully', status: 'joined' });
  } catch (err) {
    console.error('Error joining group:', err);
    res.status(500).json({ error: 'Beitritt fehlgeschlagen' });
  }
};

// ==========================================
// LEAVE GROUP
// ==========================================
export const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent owner from leaving (they must delete the group)
    const group = await db.query('SELECT owner_id, members_count, max_members FROM groups WHERE id = $1', [id]);
    if (group.rows.length > 0 && Number(group.rows[0].owner_id) === Number(req.userId)) {
      return res.status(400).json({ error: 'Als Ersteller kannst du die Gruppe nicht verlassen – lösche sie stattdessen.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not a member of this group' });
    }

    // A seat just opened → atomically promote the next waiter (own transaction,
    // locks the group row + claims one 'waiting' row, so two concurrent leaves
    // can never notify the same person twice or promote past capacity). The old
    // inline version read a stale members_count, never guarded the UPDATE on
    // status, and looked up a group name it never SELECTed (always empty push).
    promoteFromWaitlist(id).then(promoted => {
      if (promoted) {
        sendPushToUser(promoted.userId, 'Platz frei!', `Ein Platz in "${promoted.groupName}" ist frei geworden`, `/group/${id}`);
      }
    }).catch(() => {});

    // Announce the departure so the earlier "beigetreten 🎉" message isn't left
    // dangling — otherwise the roster silently loses a member and it looks like
    // a bug (someone "joined" but isn't in the list).
    db.query('SELECT name FROM users WHERE id = $1', [req.userId])
      .then(r => {
        const name = r.rows[0]?.name || 'Jemand';
        postSystemMessage(id, `${name} hat die Gruppe verlassen 👋`, req.app.get('io')).catch(() => {});
      })
      .catch(() => {});

    deleteCached(`user_groups:${req.userId}`);
    res.json({ message: 'Left group successfully' });
  } catch (err) {
    console.error('Error leaving group:', err);
    res.status(500).json({ error: 'Verlassen fehlgeschlagen' });
  }
};

// ==========================================
// TOGGLE FAVORITE
// ==========================================
export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if already favorited
    const existing = await db.query(
      'SELECT * FROM group_favorites WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    if (existing.rows.length > 0) {
      // Remove favorite
      await db.query(
        'DELETE FROM group_favorites WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      return res.json({ favorited: false, message: 'Removed from favorites' });
    }

    // Add favorite
    await db.query(
      'INSERT INTO group_favorites (group_id, user_id) VALUES ($1, $2)',
      [id, req.userId]
    );
    res.json({ favorited: true, message: 'Added to favorites' });
  } catch (err) {
    console.error('Error toggling favorite:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// TOGGLE LIKE (public, Hall-of-Fame moments)
// ==========================================
// Distinct from favorites: a like is public (counts on the card) and pushes the
// poster (group owner). Returns the new { liked, like_count } so the frontend
// can sync the count without a refetch.
export const toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query(
      'SELECT 1 FROM event_likes WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );

    let liked;
    if (existing.rows.length > 0) {
      await db.query('DELETE FROM event_likes WHERE group_id = $1 AND user_id = $2', [id, req.userId]);
      liked = false;
    } else {
      // ON CONFLICT guards a double-tap race; the group FK guards a bad id.
      const ins = await db.query(
        `INSERT INTO event_likes (group_id, user_id) VALUES ($1, $2)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [id, req.userId]
      );
      liked = true;
      // Notify the poster (owner) only on a genuinely new like, never self.
      if (ins.rowCount > 0) {
        const g = await db.query('SELECT owner_id, name FROM groups WHERE id = $1', [id]);
        const ownerId = g.rows[0]?.owner_id;
        if (ownerId && Number(ownerId) !== Number(req.userId)) {
          notifyEventLike(req.userId, ownerId, g.rows[0].name || '').catch(() => {});
        }
      }
    }

    const countRes = await db.query('SELECT COUNT(*)::int AS c FROM event_likes WHERE group_id = $1', [id]);
    res.json({ liked, like_count: countRes.rows[0].c });
  } catch (err) {
    console.error('Error toggling like:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// Group ids the caller has liked — mirrors the favorites-id pattern the Explore
// page uses to render filled hearts on load.
export const getMyLikes = async (req, res) => {
  try {
    const result = await db.query('SELECT group_id FROM event_likes WHERE user_id = $1', [req.userId]);
    res.json(result.rows.map(r => r.group_id));
  } catch (err) {
    console.error('Error fetching likes:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

async function notifyEventLike(likerId, ownerId, groupName) {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [likerId]);
    const name = rows[0]?.name || 'Jemand';
    const label = groupName ? `„${groupName}"` : 'deinen Moment';
    sendPushToUser(ownerId, 'Neuer Like ❤️', `${name} hat ${label} geliked`, '/explore');
  } catch { /* non-critical */ }
}

// ==========================================
// GET USER FAVORITES
// ==========================================
export const getUserFavorites = async (req, res) => {
  try {
    // Filter by type='group' so this endpoint only returns group favourites —
    // clubs live in the same table and have their own /api/clubs/user/favorites
    // endpoint. Without the type filter Profile.jsx concatenated both lists
    // and rendered every favourited club twice.
    const result = await db.query(
      `SELECT g.*, u.name as owner_name, u.avatar_url as owner_avatar
       FROM group_favorites gf
       JOIN groups g ON gf.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       WHERE gf.user_id = $1
         AND g.deleted_at IS NULL
         AND g.is_active = TRUE
         AND g.type = 'group'
       ORDER BY gf.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET GROUP MEMBERS
// ==========================================
export const getGroupMembers = async (req, res) => {
  try {
    const { id } = req.params;

    // No is_private 403 for GROUPS here: the Home feed embeds member_previews
    // for private groups to every viewer, so hiding the same people on the
    // detail page only rendered an empty photo grid (tester bug 2026-06-11).
    // "Privat" gates JOINING (request flow), not the member preview — the
    // Pro gate below limits what non-members see either way.
    const groupRes = await db.query(
      'SELECT type, is_private, owner_id FROM groups WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    }

    const isCallerMember = (await db.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    )).rows.length > 0;

    // CLUBS resolve through this route too (legacy /group/:id links — same
    // table). Their roster privacy is owned by getClubMembers, which 403s
    // private clubs to non-members; mirror that here so the club rule cannot
    // be bypassed by swapping /clubs/ for /groups/ in the URL.
    if (groupRes.rows[0].type === 'club' && groupRes.rows[0].is_private && !isCallerMember) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const fullList = await db.query(
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.location, u.is_trusted_user,
              gm.role, gm.joined_at,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
         -- Hide blocked users from each other (bidirectional), same rule the
         -- user-search surface enforces.
         AND u.id NOT IN (
           SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
           FROM friendships
           WHERE status = 'blocked' AND (requester_id = $2 OR addressee_id = $2)
         )
       ORDER BY gm.joined_at ASC`,
      [id, req.userId]
    );
    const total = fullList.rows.length;

    // #1 Pro gate: for GROUPS, seeing the FULL member roster is a Pro feature —
    // only Pro users (and admins) get the whole list; EVERYONE else, including
    // members who already joined, sees only the first 3 entries (the frontend
    // renders the next slot as a blurred locked tile with a ProModal CTA).
    // Product call 2026-07-02: groups' member-bypass was removed so the roster
    // is Pro-only. With payments off, effectively only admins see it in v1.
    // Clubs/events KEEP the member-bypass — members see the roster; only
    // non-members are gated there (this endpoint also serves clubs).
    const entityType = groupRes.rows[0].type;
    const callerIsPro = req.userId ? await isUserPro(req.userId) : false;
    // The owner always sees — and manages — their own full roster. The Pro gate
    // is a tease for OTHER viewers, not a lock on the organiser's own group.
    // Without this a non-Pro owner saw only 3 of their members and couldn't
    // remove no-shows from the roster (Lea, 2026-07-30).
    const callerIsOwner = req.userId != null &&
      Number(groupRes.rows[0].owner_id) === Number(req.userId);
    const gateApplies = !callerIsPro && !callerIsOwner && (entityType === 'group' || !isCallerMember);
    let callerIsAdmin = false;
    if (gateApplies && req.userId) {
      const adm = await db.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
      callerIsAdmin = !!adm.rows[0]?.is_admin;
    }
    if (gateApplies && !callerIsAdmin) {
      return res.json({
        // Same field set the Home feed previews expose (+ the trusted badge
        // the grids render). bio/location/role/joined_at stay members-only.
        members: fullList.rows.slice(0, 3).map(m => ({
          id: m.id,
          name: m.name,
          avatar_url: m.avatar_url,
          age: m.age,
          is_trusted_user: m.is_trusted_user,
        })),
        total_count: total,
        gated: true,
      });
    }
    return res.json({
      members: fullList.rows,
      total_count: total,
      gated: false,
    });
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ error: 'Mitglieder konnten nicht geladen werden' });
  }
};

// ==========================================
// GET USER'S JOINED GROUPS
// ==========================================
export const getUserGroups = async (req, res) => {
  try {
    const cacheKey = `user_groups:${req.userId}`;
    // ?fresh=1 — used by the nav unread badge, which must reflect read
    // markers immediately. Bypasses the cache in BOTH directions: no stale
    // read, and no setCached either (writing here could re-cache a result
    // that raced a concurrent read-stamp invalidation).
    const fresh = req.query.fresh === '1';
    if (!fresh) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }

    const result = await db.query(
      `SELECT g.id, g.name, g.type, g.category, g.image_url, g.is_private,
              g.max_members, g.members_count, g.location, g.date, g.deleted_at,
              g.chat_only_owner, g.parent_club_id,
              u.name as owner_name, gm.role, gm.archived,
              lm.content as last_message,
              lm.created_at as last_message_time,
              lm_user.name as last_message_sender,
              (SELECT COUNT(*)::int FROM messages m2
                WHERE m2.group_id = g.id
                  AND m2.created_at > COALESCE(gm.last_read_at, gm.joined_at)
                  AND m2.user_id IS DISTINCT FROM $1
                  AND m2.message_type IS DISTINCT FROM 'system'
              ) AS unread_count,
              -- Pending join requests to show a count badge on the owner's
              -- "Anfragen" button (Tobi 2026-07-28). 0 for groups you don't own.
              (SELECT COUNT(*)::int FROM group_join_requests jr
                 WHERE jr.group_id = g.id AND jr.status = 'pending' AND g.owner_id = $1
              ) AS pending_request_count
       FROM group_members gm
       JOIN groups g ON gm.group_id = g.id
       LEFT JOIN users u ON g.owner_id = u.id
       LEFT JOIN LATERAL (
         SELECT m.content, m.created_at, m.user_id
         FROM messages m
         WHERE m.group_id = g.id
           -- Chat-list preview must not leak pre-join history: getMessages
           -- hides messages older than the member's joined_at, so the
           -- preview applies the same cutoff.
           AND m.created_at >= gm.joined_at
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON TRUE
       LEFT JOIN users lm_user ON lm.user_id = lm_user.id
       WHERE gm.user_id = $1
         AND g.deleted_at IS NULL
       ORDER BY lm.created_at DESC NULLS LAST, gm.joined_at DESC`,
      [req.userId]
    );
    if (!fresh) setCached(cacheKey, result.rows, 15_000);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user groups:', err);
    res.status(500).json({ error: 'Gruppen konnten nicht geladen werden' });
  }
};

// ==========================================
// ARCHIVE / UNARCHIVE A GROUP-OR-CLUB CHAT (per-user "hide")
// ==========================================
export const setGroupChatArchived = async (req, res) => {
  try {
    const { id } = req.params;
    const archived = req.body.archived === true || req.body.archived === 'true';
    const result = await db.query(
      'UPDATE group_members SET archived = $1 WHERE group_id = $2 AND user_id = $3 RETURNING group_id',
      [archived, id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nicht Mitglied dieser Gruppe' });
    }
    // The chat list caches the joined-chats query for 15s — bust it so the row
    // moves into/out of the "Ausgeblendet" section immediately.
    deleteCached(`user_groups:${req.userId}`);
    res.json({ archived });
  } catch (err) {
    console.error('Error archiving group chat:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// MUTE / UNMUTE GROUP NOTIFICATIONS (per-member)
// The chat-header bell toggles this; the message push fan-out
// (messageController.sendMessage) skips members with notifications_muted = true.
// ==========================================
export const setGroupNotifications = async (req, res) => {
  try {
    const { id } = req.params;
    // `muted: true` silences; anything else (or `muted: false`) re-enables.
    const muted = req.body.muted === true || req.body.muted === 'true';
    const result = await db.query(
      'UPDATE group_members SET notifications_muted = $1 WHERE group_id = $2 AND user_id = $3 RETURNING group_id',
      [muted, id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nicht Mitglied dieser Gruppe' });
    }
    res.json({ muted });
  } catch (err) {
    console.error('Error updating group notifications:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET JOIN REQUESTS (owner only)
// ==========================================
export const getJoinRequests = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    const result = await db.query(
      `SELECT jr.*, u.name as user_name, u.avatar_url as user_avatar, u.bio as user_bio,
              u.interests as user_interests, u.date_of_birth as user_dob,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS user_age,
              u.is_trusted_user as user_trusted
       FROM group_join_requests jr
       JOIN users u ON jr.user_id = u.id
       WHERE jr.group_id = $1 AND jr.status = 'pending'
       ORDER BY jr.created_at DESC
       LIMIT 100`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching join requests:', err);
    res.status(500).json({ error: 'Anfragen konnten nicht geladen werden' });
  }
};

// ==========================================
// HANDLE JOIN REQUEST (accept/reject)
// ==========================================
export const handleJoinRequest = async (req, res) => {
  try {
    const { id, requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    // Verify ownership + fetch group name in one query
    const [groupRes, request] = await Promise.all([
      db.query('SELECT owner_id, name FROM groups WHERE id = $1', [id]),
      db.query('SELECT user_id, status FROM group_join_requests WHERE id = $1 AND group_id = $2', [requestId, id]),
    ]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(groupRes.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });
    if (request.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const joinReq = request.rows[0];
    const gname = groupRes.rows[0].name;

    if (action === 'accept') {
      // Enforce capacity inside a transaction to prevent race with concurrent accepts
      let didAccept = false;
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
          [id]
        );
        // Status guard FIRST so a double-click on "Annehmen" (or re-accepting an
        // already-handled request) is a clean no-op instead of re-adding the
        // member, re-bumping the churn counter, and possibly 400ing "full".
        const upd = await client.query(
          `UPDATE group_join_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'pending'`,
          [requestId]
        );
        if (upd.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.json({ message: 'Request already handled', status: 'accepted' });
        }
        const cap = await client.query(
          'SELECT members_count, max_members FROM groups WHERE id = $1',
          [id]
        );
        if (cap.rows[0].max_members && cap.rows[0].members_count >= cap.rows[0].max_members) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Gruppe ist bereits voll. Anfrage kann nicht angenommen werden.' });
        }
        const memberIns = await client.query(
          'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, joinReq.user_id, 'member']
        );
        // Bump the churn counter only on a real insert (see joinGroup note).
        if (memberIns.rowCount > 0) {
          await client.query(
            `INSERT INTO group_join_counts (group_id, user_id, join_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (group_id, user_id)
             DO UPDATE SET join_count = group_join_counts.join_count + 1`,
            [id, joinReq.user_id]
          );
        }
        await client.query('COMMIT');
        didAccept = true;
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      if (!didAccept) return; // already-handled path already responded

      sendPushToUser(joinReq.user_id, 'Beitrittsanfrage akzeptiert', `Du bist jetzt Mitglied von "${gname}"`, `/group/${id}`);

      // Post "X ist beigetreten 🎉" so existing members see it. Fire-and-forget.
      db.query('SELECT name FROM users WHERE id = $1', [joinReq.user_id])
        .then(r => {
          const name = r.rows[0]?.name || 'Jemand';
          postSystemMessage(id, `${name} ist der Gruppe beigetreten 🎉`, req.app.get('io')).catch(() => {});
        })
        .catch(() => {});

      res.json({ message: 'Request accepted', status: 'accepted' });
    } else if (action === 'reject') {
      await db.query(
        `UPDATE group_join_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId]
      );
      res.json({ message: 'Request rejected', status: 'rejected' });
    } else if (action === 'undo') {
      // Undo an accidental reject → back to pending. Reject has no side effects
      // (no push, no membership change), so this is a clean revert. Only touches
      // a currently-rejected row (never resurrects an accepted one).
      await db.query(
        `UPDATE group_join_requests SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'rejected'`,
        [requestId]
      );
      res.json({ message: 'Request restored', status: 'pending' });
    } else {
      res.status(400).json({ error: 'Ungültige Aktion' });
    }
  } catch (err) {
    console.error('Error handling join request:', err);
    res.status(500).json({ error: 'Anfrage konnte nicht verarbeitet werden' });
  }
};

// ==========================================
// KICK/REMOVE MEMBER (owner only)
// ==========================================
export const kickMember = async (req, res) => {
  try {
    const { id, userId } = req.params;

    // Verify ownership
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Cannot kick yourself (owner)
    if (parseInt(userId, 10) === req.userId) {
      return res.status(400).json({ error: 'Du kannst dich nicht selbst entfernen – lösche die Gruppe stattdessen.' });
    }

    const result = await db.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Nutzer ist kein Mitglied dieser Gruppe' });
    }

    // Neutral departure message (same wording as a voluntary leave) so the
    // roster stays consistent without publicly announcing a removal.
    db.query('SELECT name FROM users WHERE id = $1', [userId])
      .then(r => {
        const name = r.rows[0]?.name || 'Jemand';
        postSystemMessage(id, `${name} hat die Gruppe verlassen 👋`, req.app.get('io')).catch(() => {});
      })
      .catch(() => {});

    // A kick frees a seat too — promote the next waiter (this was missing, so
    // kicking a no-show from a full group never notified the waitlist, even
    // though kicking is exactly how owners of full groups make room).
    promoteFromWaitlist(id).then(promoted => {
      if (promoted) {
        sendPushToUser(promoted.userId, 'Platz frei!', `Ein Platz in "${promoted.groupName}" ist frei geworden`, `/group/${id}`);
      }
    }).catch(() => {});

    // Evict the removed member's live sockets from the chat room so they stop
    // receiving messages immediately — room membership is otherwise only checked
    // at join time, so a kicked member with the chat open kept getting every
    // broadcast until they disconnected. Also nudge their client to leave the UI.
    await evictFromRoom(req.app.get('io'), userId, id);

    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Error kicking member:', err);
    res.status(500).json({ error: 'Mitglied konnte nicht entfernt werden' });
  }
};

// ==========================================
// CANCEL GROUP/EVENT (owner only — notifies all members)
// ==========================================
export const cancelGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Verify ownership + fetch members in parallel
    const [groupRes, members] = await Promise.all([
      db.query('SELECT owner_id, name FROM groups WHERE id = $1', [id]),
      db.query('SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2', [id, req.userId]),
    ]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(groupRes.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    // Mark group as inactive (soft delete)
    await db.query(
      'UPDATE groups SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    invalidatePrefix('groups:');
    invalidatePrefix('map:');
    invalidatePrefix('user_groups:'); // reflect the cancellation in chat lists now

    const groupName = groupRes.rows[0].name;
    const io = req.app?.get('io');

    if (members.rows.length > 0) {
      const title = `${groupName} wurde abgesagt`;
      const body = reason || 'Das Event wurde vom Ersteller abgesagt.';
      // Batch into chunks of 1000 to avoid PostgreSQL's 65535 bind-parameter limit (5 params × 1000 = 5000)
      const CHUNK = 1000;
      for (let start = 0; start < members.rows.length; start += CHUNK) {
        const chunk = members.rows.slice(start, start + CHUNK);
        const valuesClauses = chunk.map(
          (_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, 'group_cancelled', $${i * 5 + 3}, $${i * 5 + 4}, 'group', $${i * 5 + 5})`
        ).join(', ');
        const params = chunk.flatMap(m => [m.user_id, req.userId, title, body, id]);
        const notifResult = await db.query(
          `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
           VALUES ${valuesClauses} RETURNING *`,
          params
        );
        if (io) {
          for (const notif of notifResult.rows) {
            io.to(`user_${notif.user_id}`).emit('new_notification', notif);
          }
        }
      }
    }

    res.json({ message: 'Group cancelled and members notified', notified: members.rows.length });
  } catch (err) {
    console.error('Error cancelling group:', err);
    res.status(500).json({ error: 'Gruppe konnte nicht deaktiviert werden' });
  }
};

// ==========================================
// JOIN WAITLIST
// ==========================================
export const joinWaitlist = async (req, res) => {
  try {
    const { id } = req.params;

    // Three checks in parallel: group exists, already member, already on waitlist
    const [groupRes, memberCheck, waitlistCheck] = await Promise.all([
      db.query('SELECT members_count, max_members, parent_club_id FROM groups WHERE id = $1', [id]),
      db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
      db.query('SELECT position FROM group_waitlist WHERE group_id = $1 AND user_id = $2', [id, req.userId]),
    ]);
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (memberCheck.rows.length > 0) return res.status(400).json({ error: 'Already a member' });
    if (waitlistCheck.rows.length > 0) {
      return res.json({ message: 'Already on waitlist', position: waitlistCheck.rows[0].position });
    }
    // Same private-club-event gate as joinGroup — otherwise a non-member could
    // waitlist a full private event and get auto-promoted into it.
    if (await isPrivateClubEventBlocked(groupRes.rows[0].parent_club_id, req.userId)) {
      return res.status(403).json({
        error: 'Dieses Event gehört zu einem privaten Club. Tritt zuerst dem Club bei, um teilzunehmen.',
        code: 'CLUB_MEMBERS_ONLY',
      });
    }

    const g = groupRes.rows[0];
    if (g.members_count < g.max_members) {
      return res.status(400).json({ error: 'Group not full. Join directly.' });
    }

    const result = await db.query(
      'INSERT INTO group_waitlist (group_id, user_id) VALUES ($1, $2) RETURNING *',
      [id, req.userId]
    );

    res.json({ message: 'Added to waitlist', position: result.rows[0].position });
  } catch (err) {
    console.error('Error joining waitlist:', err);
    res.status(500).json({ error: 'Warteliste-Beitritt fehlgeschlagen' });
  }
};

// ==========================================
// LEAVE WAITLIST
// ==========================================
export const leaveWaitlist = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'DELETE FROM group_waitlist WHERE group_id = $1 AND user_id = $2 RETURNING position',
      [id, req.userId]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Not on waitlist' });
    }
    res.json({ message: 'Removed from waitlist' });
  } catch (err) {
    console.error('Error leaving waitlist:', err);
    res.status(500).json({ error: 'Warteliste verlassen fehlgeschlagen' });
  }
};

// ==========================================
// GET WAITLIST FOR A GROUP
// ==========================================
export const getWaitlist = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await db.query('SELECT owner_id FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });
    const result = await db.query(
      `SELECT w.*, u.name, u.avatar_url, u.bio
       FROM group_waitlist w
       JOIN users u ON w.user_id = u.id
       WHERE w.group_id = $1 AND w.status = 'waiting'
       ORDER BY w.position ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching waitlist:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET USER'S WAITLIST STATUS FOR A GROUP
// ==========================================
export const getUserWaitlistStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'SELECT * FROM group_waitlist WHERE group_id = $1 AND user_id = $2',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ on_waitlist: false });
    }
    res.json({
      on_waitlist: true,
      position: result.rows[0].position,
      status: result.rows[0].status
    });
  } catch (err) {
    console.error('Error checking waitlist:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// GET MEMBER AVATARS FOR CARD DISPLAY
// ==========================================
export const getGroupMemberAvatars = async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 4, 50);

    const group = await db.query('SELECT is_private FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.json([]);

    if (group.rows[0].is_private) {
      // Private groups: auth-dependent, no shared cache
      if (!req.userId) return res.json([]);
      const member = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
        [id, req.userId]
      );
      if (member.rows.length === 0) return res.json([]);
    } else {
      // Public groups: all users see the same avatars — cache aggressively
      const cacheKey = `avatars:${id}:${limit}`;
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);

      const result = await db.query(
        `SELECT u.id, u.avatar_url, u.name,
              EXTRACT(YEAR FROM AGE(u.date_of_birth))::int AS age
         FROM group_members gm
         JOIN users u ON gm.user_id = u.id
         WHERE gm.group_id = $1
         ORDER BY gm.joined_at ASC
         LIMIT $2`,
        [id, limit]
      );
      setCached(cacheKey, result.rows, AVATARS_TTL);
      return res.json(result.rows);
    }

    const result = await db.query(
      `SELECT u.id, u.avatar_url, u.name
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC
       LIMIT $2`,
      [id, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching avatars:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

// ==========================================
// INVITE FRIEND TO GROUP (owner only)
// ==========================================
export const inviteMember = async (req, res) => {
  try {
    const { id, friendId } = req.params;

    const group = await db.query('SELECT owner_id, name, max_members FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Keine Berechtigung' });

    const g = group.rows[0];

    // Friendship + existing-member check can race-safely run outside the txn —
    // friendship status doesn't change between checks, and the (group_id,user_id)
    // PK on group_members blocks duplicates regardless.
    const [friendship, existing] = await Promise.all([
      db.query(
        `SELECT 1 FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
        [req.userId, friendId]
      ),
      db.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [id, friendId]),
    ]);
    if (friendship.rows.length === 0) return res.status(403).json({ error: 'Nur Freunde können eingeladen werden' });
    if (existing.rows.length) return res.status(400).json({ error: 'Already a member' });

    // Capacity check + insert inside a transaction with FOR UPDATE so two
    // concurrent invites cannot both pass the count check and both insert,
    // pushing the group over max_members. Mirrors joinGroup / handleJoinRequest.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (locked.rows[0].max_members && locked.rows[0].members_count >= locked.rows[0].max_members) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Group is full' });
      }
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, friendId, 'member']
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await db.query(
      `INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, 'group_invite', $3, $4, 'group', $5)`,
      [friendId, req.userId, `Einladung: ${g.name}`, `Du wurdest zur Gruppe "${g.name}" eingeladen!`, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error inviting member:', err);
    res.status(500).json({ error: 'Einladung fehlgeschlagen' });
  }
};

// ── Push helpers (fire-and-forget) ──────────────────────────────────────────
export async function notifyJoinRequest(requesterUserId, ownerUserId, groupName, groupId) {
  try {
    // Requester name + OWNER's app language in one round trip — the push must
    // read in the recipient's locale, and it should feel like a small win
    // ("leute müssen geil drauf werden, anfragen zu bekommen" — Tobi 2026-07-30).
    const { rows } = await db.query(
      `SELECT r.name AS requester_name, o.locale AS owner_locale
       FROM users r LEFT JOIN users o ON o.id = $2
       WHERE r.id = $1`,
      [requesterUserId, ownerUserId]
    );
    const { title, body } = joinRequestText(rows[0]?.owner_locale, {
      requesterName: rows[0]?.requester_name,
      groupName,
    });
    sendPushToUser(ownerUserId, title, body, `/group/${groupId}/requests`);
  } catch { /* non-critical */ }
}

// Atomically promote the next person off a group/club waitlist when a seat
// frees up (leave or kick). Runs in its own transaction: FOR UPDATE on the
// group row serialises concurrent departures, and the CTE claims exactly one
// 'waiting' row with FOR UPDATE SKIP LOCKED so two parallel promotions pick
// DIFFERENT people and nobody is notified twice. Only promotes when a seat is
// genuinely free (members_count already reflects the departure, which happened
// before this is called). Returns { userId, groupName } or null.
export async function promoteFromWaitlist(groupId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query(
      'SELECT name, members_count, max_members FROM groups WHERE id = $1 FOR UPDATE',
      [groupId]
    );
    if (g.rows.length === 0) { await client.query('ROLLBACK'); return null; }
    const { name, members_count, max_members } = g.rows[0];
    if (max_members && members_count >= max_members) { await client.query('ROLLBACK'); return null; }

    const claim = await client.query(
      `WITH next AS (
         SELECT user_id FROM group_waitlist
         WHERE group_id = $1 AND status = 'waiting'
         ORDER BY position ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE group_waitlist w
       SET status = 'notified', notified_at = CURRENT_TIMESTAMP
       FROM next
       WHERE w.group_id = $1 AND w.user_id = next.user_id
       RETURNING w.user_id`,
      [groupId]
    );
    if (claim.rows.length === 0) { await client.query('ROLLBACK'); return null; }
    const userId = claim.rows[0].user_id;

    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       VALUES ($1, 'waitlist_opening', 'Platz frei!', 'Ein Platz ist in deiner Warteliste-Gruppe frei geworden.', 'group', $2)`,
      [userId, groupId]
    );
    await client.query('COMMIT');
    return { userId, groupName: name || '' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Force a user's live sockets out of a chat room (used on kick). Room
// membership is otherwise only validated at join time, so without this a
// kicked member keeps receiving every broadcast until they disconnect. Also
// emits `removed_from_group` so the client can leave the chat UI. Best-effort.
export async function evictFromRoom(io, userId, groupId) {
  if (!io) return;
  try {
    const sockets = await io.in(`user_${userId}`).fetchSockets();
    for (const s of sockets) {
      s.leave(String(groupId));
      s.emit('removed_from_group', { groupId: Number(groupId) });
    }
  } catch { /* best-effort */ }
}

// Exported: clubController reuses this for public club joins (basePath 'club'
// deep-links to /club/:id instead of /group/:id).
export async function notifyGroupJoin(joinerUserId, ownerUserId, groupName, groupId, basePath = 'group') {
  try {
    const { rows } = await db.query('SELECT name FROM users WHERE id = $1', [joinerUserId]);
    const name = rows[0]?.name || 'Jemand';
    // Link to the group itself — '/my-groups' is not a real route (the SW
    // opened it on tap and the owner landed on the 404 page).
    sendPushToUser(ownerUserId, 'Neues Mitglied', `${name} ist "${groupName}" beigetreten`, groupId ? `/${basePath}/${groupId}` : '/chats');
  } catch { /* non-critical */ }
}

// ==========================================
// GET CATEGORIES — 1-hour in-memory cache (categories change rarely)
// ==========================================
let _categoriesCache = null;
let _categoriesCacheExp = 0;

export const getCategories = async (_req, res) => {
  try {
    if (_categoriesCache && Date.now() < _categoriesCacheExp) {
      return res.json(_categoriesCache);
    }
    const result = await db.query('SELECT * FROM categories ORDER BY name ASC');
    _categoriesCache = result.rows;
    _categoriesCacheExp = Date.now() + 60 * 60 * 1000;
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
  }
};