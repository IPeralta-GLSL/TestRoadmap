# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Production stage
FROM node:20-alpine AS production

# Install build dependencies for better-sqlite3 runtime if needed, though prebuilts often work
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy compiled backend from builder stage
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "dist/index.js"]