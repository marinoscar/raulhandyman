# syntax=docker/dockerfile:1.7
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

# Published projects come from the admin app at build time (scripts/fetch-content.mjs).
# CONTENT_MODE=production means: never use fixtures. With no CONTENT_API_URL the build has an
# empty portfolio; with a URL but no token the build fails. The token is a BuildKit secret, so
# it is never stored in an image layer.
ARG CONTENT_API_URL=""
ENV CONTENT_MODE=production
# Build, then precompress (.gz/.br) and generate dist/_redirects.map
RUN --mount=type=secret,id=content_token,required=false \
    if [ -s /run/secrets/content_token ]; then export CONTENT_API_TOKEN_FILE=/run/secrets/content_token; fi; \
    CONTENT_API_URL="$CONTENT_API_URL" npm run build && node scripts/compress.mjs

# ---- Runtime stage ----------------------------------------------------------
FROM nginx:1.27-alpine AS production

# Replace the default server config with ours
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/site.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
