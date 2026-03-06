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

# Railway injects PORT at runtime; default matches local dev
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "src/server.js"]
