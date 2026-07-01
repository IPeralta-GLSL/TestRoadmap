# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json ./
COPY index.html ./index.html
COPY src/ ./src/
COPY vite.config.ts ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

RUN npm run build

# Production stage
FROM nginx:alpine AS production

COPY --from=builder /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]