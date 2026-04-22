# ─── Stage 1: Build frontend ───────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# .env.production sets VITE_API_URL=/api so API calls are same-origin
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
