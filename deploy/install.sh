#!/usr/bin/env bash
# =============================================================================
# install.sh — First-time install of raulhandyman.net on the VPS
# =============================================================================
# Run ONCE, as root, after cloning the repo:
#
#   mkdir -p /opt/infra/apps/raulhandyman
#   cd /opt/infra/apps/raulhandyman
#   git clone git@github.com:marinoscar/raulhandyman.git repo
#   bash repo/deploy/install.sh
#
# This script:
#   1. Checks prerequisites (root, docker, proxy-nginx, repo)
#   2. Checks DNS for raulhandyman.net and www.raulhandyman.net points here
#   3. Copies compose.yml into /opt/infra/apps/raulhandyman
#   4. Builds the image and starts the container on 127.0.0.1:8330
#   5. Issues one Let's Encrypt certificate for both names (if needed)
#   6. Installs the proxy config and reloads proxy-nginx
#   7. Verifies the public site over HTTPS
#   8. Links deploy.sh into the app folder for future updates
#
# For updates after this, run: /opt/infra/apps/raulhandyman/deploy.sh
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_DIR="/opt/infra/apps/raulhandyman"
REPO_DIR="${APP_DIR}/repo"
DOMAIN="raulhandyman.net"
WWW_DOMAIN="www.raulhandyman.net"
HOST_PORT="8330"
CONTAINER="raulhandyman-web"
CERT_EMAIL="oscar@marin.cr"

PROXY_CONF_DIR="/opt/infra/proxy/nginx/conf.d"
PROXY_CONF_SRC="${REPO_DIR}/deploy/raulhandyman.conf"
PROXY_CONF_DST="${PROXY_CONF_DIR}/raulhandyman.conf"
LE_HOST="/opt/infra/proxy/letsencrypt"
WEBROOT_HOST="/opt/infra/proxy/webroot"
CERT_DIR="${LE_HOST}/live/${DOMAIN}"

TOTAL_STEPS=8
log() { echo "[raulhandyman] $*"; }
fail() { echo "[raulhandyman] ERROR: $*" >&2; exit 1; }

main() {
  log "============================================"
  log " raulhandyman.net installer"
  log "============================================"

  # -------------------------------------------------------------------------
  # Step 1: Prerequisites
  # -------------------------------------------------------------------------
  log ""
  log "[1/${TOTAL_STEPS}] Checking prerequisites..."

  if [ "$(id -u)" -ne 0 ]; then
    fail "Run this script as root."
  fi
  command -v docker >/dev/null 2>&1 || fail "docker is not installed."
  docker compose version >/dev/null 2>&1 || fail "docker compose plugin is not installed."
  if [ "$(docker inspect -f '{{.State.Running}}' proxy-nginx 2>/dev/null)" != "true" ]; then
    fail "proxy-nginx is not running. Start it: cd /opt/infra/proxy && docker compose up -d"
  fi
  [ -d "${REPO_DIR}/.git" ] || fail "Repo not found at ${REPO_DIR}. Clone it first (see the header of this script)."
  log "  OK."

  # -------------------------------------------------------------------------
  # Step 2: DNS
  # -------------------------------------------------------------------------
  log ""
  log "[2/${TOTAL_STEPS}] Checking DNS..."

  PUBLIC_IP="$(curl -4 -s --max-time 10 https://api.ipify.org || true)"
  APEX_IP="$(getent ahostsv4 "${DOMAIN}" | awk 'NR==1 {print $1}' || true)"
  WWW_IP="$(getent ahostsv4 "${WWW_DOMAIN}" | awk 'NR==1 {print $1}' || true)"
  log "  This server:          ${PUBLIC_IP:-unknown}"
  log "  ${DOMAIN}:     ${APEX_IP:-not resolving}"
  log "  ${WWW_DOMAIN}: ${WWW_IP:-not resolving}"

  if [ -z "${PUBLIC_IP}" ]; then
    log "  WARN: Could not detect this server's public IP. Continuing."
  elif [ "${APEX_IP}" != "${PUBLIC_IP}" ] || [ "${WWW_IP}" != "${PUBLIC_IP}" ]; then
    log "  DNS does not point to this server yet."
    log "  In GoDaddy DNS set:  A  @  -> ${PUBLIC_IP}   and   CNAME  www -> ${DOMAIN}"
    log "  Wait for it to propagate, then re-run this script."
    fail "DNS not ready."
  fi
  log "  OK."

  # -------------------------------------------------------------------------
  # Step 3: Compose file
  # -------------------------------------------------------------------------
  log ""
  log "[3/${TOTAL_STEPS}] Installing compose.yml..."
  cp "${REPO_DIR}/deploy/compose.yml" "${APP_DIR}/compose.yml"
  log "  Copied to ${APP_DIR}/compose.yml"

  # -------------------------------------------------------------------------
  # Step 4: Build and start
  # -------------------------------------------------------------------------
  log ""
  log "[4/${TOTAL_STEPS}] Building image and starting container..."
  cd "${APP_DIR}"
  docker compose build web
  docker compose up -d web

  log "  Waiting for http://127.0.0.1:${HOST_PORT}/healthz ..."
  for attempt in $(seq 1 30); do
    if curl -fs "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null; then
      log "  Container is healthy."
      break
    fi
    if [ "${attempt}" -eq 30 ]; then
      docker logs --tail 50 "${CONTAINER}" || true
      fail "Container did not become healthy."
    fi
    sleep 1
  done

  # -------------------------------------------------------------------------
  # Step 5: Certificate
  # -------------------------------------------------------------------------
  log ""
  log "[5/${TOTAL_STEPS}] Checking TLS certificate..."

  if [ -f "${CERT_DIR}/fullchain.pem" ]; then
    log "  Certificate already exists at ${CERT_DIR}. Skipping issuance."
  else
    log "  No certificate yet. Deploying temporary HTTP-only config for the ACME challenge..."
    cat > "${PROXY_CONF_DST}" << TEMP_NGINX_EOF
# Temporary HTTP-only config for Let's Encrypt certificate issuance
server {
    listen 80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 503 "Certificate pending";
    }
}
TEMP_NGINX_EOF

    if docker exec proxy-nginx nginx -t; then
      docker exec proxy-nginx nginx -s reload
      log "  Proxy reloaded with temporary config."
    else
      rm -f "${PROXY_CONF_DST}"
      fail "Nginx config validation failed. Check: docker exec proxy-nginx nginx -t"
    fi

    docker run --rm \
      -v "${LE_HOST}:/etc/letsencrypt" \
      -v "${WEBROOT_HOST}:/var/www/certbot" \
      certbot/certbot:latest certonly \
        --webroot -w /var/www/certbot \
        -d "${DOMAIN}" \
        -d "${WWW_DOMAIN}" \
        --cert-name "${DOMAIN}" \
        --non-interactive \
        --agree-tos \
        --email "${CERT_EMAIL}"

    [ -f "${CERT_DIR}/fullchain.pem" ] || fail "Certificate was not created. Check the certbot output above."
    log "  Certificate issued for ${DOMAIN} and ${WWW_DOMAIN}."
  fi

  # -------------------------------------------------------------------------
  # Step 6: Proxy config
  # -------------------------------------------------------------------------
  log ""
  log "[6/${TOTAL_STEPS}] Installing proxy config..."
  cp "${PROXY_CONF_SRC}" "${PROXY_CONF_DST}"
  if docker exec proxy-nginx nginx -t; then
    docker exec proxy-nginx nginx -s reload
    log "  Installed ${PROXY_CONF_DST} and reloaded proxy-nginx."
  else
    rm -f "${PROXY_CONF_DST}"
    docker exec proxy-nginx nginx -s reload || true
    fail "Proxy config failed validation and was removed. Check: docker exec proxy-nginx nginx -t"
  fi

  # -------------------------------------------------------------------------
  # Step 7: Verify
  # -------------------------------------------------------------------------
  log ""
  log "[7/${TOTAL_STEPS}] Verifying public site..."
  sleep 2
  check_status "https://${DOMAIN}/" "200"
  check_status "https://${DOMAIN}/sitemap-index.xml" "200"
  check_status "https://${WWW_DOMAIN}/" "301"
  check_status "http://${DOMAIN}/" "301"

  # -------------------------------------------------------------------------
  # Step 8: Link deploy.sh
  # -------------------------------------------------------------------------
  log ""
  log "[8/${TOTAL_STEPS}] Linking deploy.sh..."
  chmod +x "${REPO_DIR}/deploy/deploy.sh"
  ln -sfn "${REPO_DIR}/deploy/deploy.sh" "${APP_DIR}/deploy.sh"
  log "  ${APP_DIR}/deploy.sh -> ${REPO_DIR}/deploy/deploy.sh"

  log ""
  log "============================================"
  log " Done. https://${DOMAIN} is live."
  log "============================================"
  log " Update later with:  ${APP_DIR}/deploy.sh"
  log ""
  log " Next, record the new app in the infra repo:"
  log "   cd /opt/infra"
  log "   git add apps/raulhandyman/compose.yml proxy/nginx/conf.d/raulhandyman.conf"
  log "   nano SERVER.md      # add raulhandyman.net (port 8330)"
  log "   git commit -m \"Add raulhandyman.net static site\""
  log ""
  log " Then submit https://${DOMAIN}/sitemap-index.xml in Google Search Console."
}

check_status() {
  local url="$1"
  local expected="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${url}" || true)"
  if [ "${code}" = "${expected}" ]; then
    log "  OK   ${code}  ${url}"
  else
    fail "${url} returned ${code}, expected ${expected}."
  fi
}

main "$@"
