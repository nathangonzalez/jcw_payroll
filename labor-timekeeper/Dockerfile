FROM node:20-bullseye-slim

WORKDIR /app

# Better-sqlite3 needs build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

# Ensure db dir exists
RUN mkdir -p /app/data

CMD ["bash","-lc","node scripts/seed.js && node server.js"]
