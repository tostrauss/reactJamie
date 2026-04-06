FROM node:20-alpine

WORKDIR /app

# Copy backend dependencies first (cached layer)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/src ./src

# Create uploads directory (ephemeral — use cloud storage in production)
RUN mkdir -p uploads

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "src/server.js"]
