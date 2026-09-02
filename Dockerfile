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
# and scripts/restore-backup.js — see BACKUP-KONZEPT.md. Prefer the newest
# client the Alpine release offers: pg_dump must be >= the server's major
# version (it can always dump OLDER servers, never newer ones).
RUN apk add --no-cache postgresql17-client \
 || apk add --no-cache postgresql16-client \
 || apk add --no-cache postgresql-client

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
