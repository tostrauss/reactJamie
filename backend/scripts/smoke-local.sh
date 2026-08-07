#!/usr/bin/env bash
# One-shot local runner for the real-Postgres write-endpoint smoke test.
# Spins up a throwaway Postgres in Docker, runs the smoke suite against it,
# and tears the container down afterwards. Requires Docker.
#
#   npm run test:smoke:local
#
# CI note: in CI, provide a Postgres service and set SMOKE_DATABASE_URL, then
# run `npm run test:smoke` directly — you do not need this Docker wrapper.
set -euo pipefail

CONTAINER="jamie-smoke-pg"
PORT="${SMOKE_PG_PORT:-55433}"
DB="jamie_smoke"
export MSYS_NO_PATHCONV=1  # keep Git-Bash from mangling docker args on Windows

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "[smoke] starting Postgres ($CONTAINER) on :$PORT ..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=pw -e POSTGRES_DB="$DB" \
  -p "$PORT:5432" postgres:16-alpine >/dev/null

echo "[smoke] waiting for Postgres to accept connections ..."
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    echo "[smoke] Postgres ready after ${i}s"; break
  fi
  if [ "$i" = "60" ]; then echo "[smoke] Postgres did not become ready" >&2; exit 1; fi
  sleep 1
done

export SMOKE_DATABASE_URL="postgres://postgres:pw@localhost:${PORT}/${DB}"
echo "[smoke] running smoke suite against $SMOKE_DATABASE_URL"
npx vitest run tests/integration/write-endpoints.pg.test.js
