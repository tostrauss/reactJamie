# Local-dev only — used by docker-compose.yml for the monorepo simulation
# where the frontend runs as a separate `node:20-alpine` container.
# Production deploys to Railway use the root Dockerfile (monorepo bundle).

FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create uploads directory (note: Railway filesystem is ephemeral —
# files uploaded by users won't survive redeploys. See DEPLOYMENT.md)
RUN mkdir -p uploads

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "src/server.js"]
