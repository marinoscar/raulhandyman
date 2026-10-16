# =============================================================================
# Raul Handyman — production image
# Stage 1 builds the static site with Astro. Stage 2 serves it with nginx.
# =============================================================================

# ---- Build stage ------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
FROM nginx:1.27-alpine AS production

# Replace the default server config with ours
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/site.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
