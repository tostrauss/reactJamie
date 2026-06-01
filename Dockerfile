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

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/src ./src
COPY --from=frontend-builder /frontend/dist ./public

RUN mkdir -p uploads

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000
CMD ["node", "src/server.js"]
