# ─── Stage 1: Build frontend ───────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./

# Vite env vars: prefer build args (set via Railway/CI), fall back to .env.production
# values committed in the repo. Without this, an empty ARG would BLANK OUT the
# .env.production value (process.env overrides .env.* files in Vite), silently
# disabling the Google Maps key in production.
ARG VITE_SENTRY_DSN
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_VAPID_PUBLIC_KEY
RUN if [ -n "$VITE_SENTRY_DSN" ];          then echo "VITE_SENTRY_DSN=$VITE_SENTRY_DSN"                   >> .env.production; fi && \
    if [ -n "$VITE_GOOGLE_CLIENT_ID" ];    then echo "VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID"       >> .env.production; fi && \
    if [ -n "$VITE_GOOGLE_MAPS_API_KEY" ]; then echo "VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY" >> .env.production; fi && \
    if [ -n "$VITE_VAPID_PUBLIC_KEY" ];    then echo "VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY"       >> .env.production; fi

RUN npm run build

# ─── Stage 2: Backend + bundled frontend ───────────────────────────
FROM node:20-alpine
WORKDIR /app

# pg_dump/psql for the nightly encrypted offsite DB backup (src/jobs/backup.js)
# and scripts/restore-backup.js — see BACKUP-KONZEPT.md.
# pg_dump MUST be >= the server's major version -- it can dump older servers,
# never newer ones. Railway's Postgres is 18.x, so 18 is a hard requirement,
# NOT a preference. The previous `17 || 16 || any` fallback chain is exactly
# what hid the outage: the build happily installed pg_dump 17, and every
# nightly dump from 2026-08-18 to 2026-09-04 died with "aborting because of
# server version mismatch (server 18.6, pg_dump 17.11)" while the boot log
# still said [backup] ARMED. No silent fallback: if a pg_dump >= 18 cannot be
# installed the BUILD fails, loudly, now -- instead of the backup failing
# quietly at 03:15 UTC for another two months. The Alpine release behind
# node:20-alpine may predate PG18, hence the edge/community fallback.
RUN (apk add --no-cache postgresql18-client \
     || apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community postgresql18-client \
     || apk add --no-cache postgresql17-client) \
 && PGDUMP_MAJOR="$(pg_dump --version | awk '{print $3}' | cut -d. -f1)" \
 && echo "pg_dump major: $PGDUMP_MAJOR" \
 && [ "$PGDUMP_MAJOR" -ge 18 ] \
 || (echo "FATAL: pg_dump >= 18 required (Railway Postgres is 18.x), got $(pg_dump --version 2>&1)" >&2; exit 1)

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/src ./src
# Ops scripts (restore-backup.js, run-backup-now.js, …) so drills can run
# inside the container (railway ssh) — not only from a dev machine.
COPY backend/scripts ./scripts
COPY --from=frontend-builder /frontend/dist ./public

RUN mkdir -p uploads

ENV PORT=5000
ENV NODE_ENV=production
# bcrypt (@node-rs) hashes on the libuv threadpool, and sharp resizes share
# the SAME pool (upload path + /media?size=thumb). At 8, a signup wave with
# avatar uploads capped auth at ~26 bcrypt ops/sec/instance (audit 2026-09-02,
# risk #4). 16 doubles that headroom for TV-spike nights; size vCPU to match
# (a Railway env var of the same name overrides this if set).
ENV UV_THREADPOOL_SIZE=16

EXPOSE 5000
CMD ["node", "src/server.js"]
