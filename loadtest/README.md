# JAMIE load / scale verification

Turns "should scale to 1000+" into measured numbers for **your** Railway box.
Two independent tests:

| Test | Runner | Measures |
|------|--------|----------|
| `http-load.js` | [k6](https://k6.io) | Feed/API p95 latency + error rate under N ramping users; whether the DB pool (max 50) saturates |
| `socket-storm.js` | Node | How many concurrent live WebSocket connections one instance holds before latency/RAM tips over |

## ⚠️ Run against STAGING, never production

This generates real load and opens thousands of real connections. Point it at a
staging Railway service (a duplicate of prod with its own DB), or at worst a
quiet maintenance window — never the live app your users are on. `JWT_SECRET` is
only needed to mint valid tokens; treat it like the secret it is (don't paste it
into shell history on a shared machine — use an env file).

## Setup

```bash
cd loadtest
npm install          # socket-storm deps (k6 is a separate binary)
# k6: winget install k6   (Windows) | brew install k6 (macOS)
```

## 1. HTTP ramp (k6)

```bash
# Public read paths only (feed/clubs/discover) — no secret needed:
k6 run -e BASE_URL=https://staging.example.com http-load.js

# Include authenticated endpoints (needs the signing secret + a REAL user id):
k6 run -e BASE_URL=https://staging.example.com \
       -e JWT_SECRET=<staging JWT_SECRET> -e USER_ID=123 http-load.js

# Push harder / longer:
k6 run -e BASE_URL=... -e TARGET_VUS=2000 -e HOLD=10m http-load.js
```

Ramps 0 → `TARGET_VUS` (default 1000) over 2m, holds 3m, drains 1m. The run
**fails its thresholds** if >1% of requests error or p95 > 800ms — that's your
pass/fail line. Watch `http_req_duration` p95 and `app_errors` in the summary.

## 2. Socket connection storm (Node)

```bash
JWT_SECRET=<staging secret> BASE_URL=https://staging.example.com \
  CONNECTIONS=1000 node socket-storm.js
```

Opens 1000 sockets in waves, reports connect success/latency, then holds them
open for 30s. **While it holds, watch the backend's RAM/CPU graph in the Railway
dashboard** — that graph is the real answer to "how big can one Hobby instance
go." Bump `CONNECTIONS` until connect p95 climbs or the instance OOM-restarts.

## Reading the results (what each outcome means)

- **p95 latency creeps up but errors stay 0** → CPU/pool pressure, still serving.
  You have headroom; note the VU count where it starts bending.
- **`app_errors` / `http_req_failed` spikes, 5xx** → pool exhausted or instance
  overloaded. The DB-pool warning (`[db-pool] At max capacity`) will be in the
  Railway logs. Raise `DB_POOL_MAX` (only if Postgres `max_connections` allows)
  or scale the instance up.
- **Socket connects start failing / instance restarts mid-hold** → hit the RAM
  ceiling for one instance. On Hobby that's your wall → go Pro + add a replica
  (and put a Postgres pooler in front so `replicas × DB_POOL_MAX` stays under
  `max_connections`). Requires `REDIS_URL` set so the Socket.IO adapter fans
  messages across replicas.

## Prerequisites checklist before trusting the numbers

- [ ] Staging has `REDIS_URL` set (else you're testing the single-instance path only)
- [ ] Staging DB is comparable in size/plan to prod (so query costs are realistic)
- [ ] You know staging Postgres `max_connections` (Railway ≈100 on smaller plans)
