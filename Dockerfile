FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]