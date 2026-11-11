#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Update raulhandyman.net to the latest version on main
# =============================================================================
# Run as root on the VPS:
#
#   /opt/infra/apps/raulhandyman/deploy.sh           # deploy if main has new commits
#   /opt/infra/apps/raulhandyman/deploy.sh --force   # rebuild even if nothing changed
#   /opt/infra/apps/raulhandyman/deploy.sh --content # rebuild only if the admin published new
#                                                    # content (run by cron every 2 minutes)
#
# This script:
#   1. Fetches main and shows what changed
#   2. Updates the repo to origin/main
#   3. Syncs compose.yml if it changed
#   4. Keeps the running image as raulhandyman-web:previous
#   5. Builds the new image and restarts the container
#   6. Health-checks it; on failure rolls back the image and the repo
#   7. Syncs the proxy config if it changed (validated before reload)
#   8. Verifies the public site and removes dangling images
#
# The whole script runs inside main(), so bash has read all of it before
# `git reset` replaces this file on disk.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/infra/apps/raulhandyman"
REPO_DIR="${APP_DIR}/repo"
BRANCH="main"
DOMAIN="raulhandyman.net"
HOST_PORT="8330"
CONTAINER="raulhandyman-web"
IMAGE="raulhandyman-web"
PROXY_CONF_SRC="${REPO_DIR}/deploy/raulhandyman.conf"
# Content pipeline (projects published in the admin app). The token file holds a read-only
# credential for GET /api/site/*; it is mounted into the image build as a BuildKit secret and
# never lands in an image layer. An empty or missing file means "no admin yet": empty portfolio.
TOKEN_FILE="${APP_DIR}/.content-token"
VERSION_FILE="${APP_DIR}/.content-version"
ADMIN_API_URL="${ADMIN_API_URL:-http://127.0.0.1:8340}"
LOCK_FILE="/var/lock/raulhandyman-deploy.lock"
BUILD_LOG="/tmp/raulhandyman-build.log"
PROXY_CONF_DST="/opt/infra/proxy/nginx/conf.d/raulhandyman.conf"

TOTAL_STEPS=8
log() { echo "[raulhandyman] $*"; }
fail() { echo "[raulhandyman] ERROR: $*" >&2; exit 1; }

# Content version currently published in the admin app (empty if unreachable or no token).
fetch_content_version() {
  [ -s "${TOKEN_FILE}" ] || return 0
  curl -fsS --max-time 10 -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
    "${ADMIN_API_URL}/api/site/content/version" 2>/dev/null \
    | sed -n 's/.*"contentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' || true
}

# Tell the admin app how the build went (best effort; never fails the deploy).
# $1 = live|failed   $2 = content version   $3 = duration ms   $4 = error text (optional)
report_status() {
  [ -s "${TOKEN_FILE}" ] && [ -n "${2:-}" ] || return 0
  local err
  err="$(printf '%s' "${4:-}" | tr -d '"\\' | tr '\n\t' '  ' | cut -c1-1900)"
  err="${err//$(cat "${TOKEN_FILE}")/[redacted]}"
  curl -fsS --max-time 10 -X POST -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
    -H 'Content-Type: application/json' \
    -d "{\"contentVersion\":\"${2}\",\"status\":\"${1}\",\"durationMs\":${3:-0}$( [ -n "${err}" ] && printf ',\"error\":\"%s\"' "${err}" )}" \
    "${ADMIN_API_URL}/api/site/build-status" >/dev/null 2>&1 || log "  (could not report build status to the admin app)"
}

main() {
  local force="no" content_only="no" arg
  for arg in "$@"; do
    case "${arg}" in
      --force) force="yes" ;;
      --content) content_only="yes" ;;
      *) fail "Unknown option: ${arg}" ;;
    esac
  done

  [ "$(id -u)" -eq 0 ] || fail "Run this script as root."
  [ -d "${REPO_DIR}/.git" ] || fail "Repo not found at ${REPO_DIR}. Run install.sh first."

  # compose.yml mounts this file as a build secret, so it must exist (empty = no admin yet).
  [ -e "${TOKEN_FILE}" ] || install -m 600 /dev/null "${TOKEN_FILE}"

  # One deploy at a time (cron content runs and manual runs must never overlap).
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    log "Another deploy is running. Exiting."
    exit 0
  fi

  # Content pipeline: with a token the image build fetches published projects from the
  # admin app; without one (no admin yet) it builds an empty portfolio, never fixtures.
  local content_version="" started
  started="$(date +%s)"
  CONTENT_API_URL=""
  if [ -s "${TOKEN_FILE}" ]; then
    CONTENT_API_URL="${ADMIN_API_URL}"
    content_version="$(fetch_content_version)"
  fi
  export CONTENT_API_URL

  if [ "${content_only}" = "yes" ]; then
    [ -s "${TOKEN_FILE}" ] || exit 0
    if [ -z "${content_version}" ]; then
      log "Admin API not reachable at ${ADMIN_API_URL}. Keeping the current site."
      exit 0
    fi
    if [ "${content_version}" = "$(cat "${VERSION_FILE}" 2>/dev/null || true)" ] && [ "${force}" = "no" ]; then
      exit 0
    fi
    log "New content version ${content_version:0:12}. Rebuilding with the current code."
  fi

  # -------------------------------------------------------------------------
  # Step 1: Fetch
  # -------------------------------------------------------------------------
  cd "${REPO_DIR}"
  local old_commit new_commit
  if [ "${content_only}" = "yes" ]; then
    log "[1/${TOTAL_STEPS}] Content rebuild: keeping the current code."
    old_commit="$(git rev-parse HEAD)"
    new_commit="${old_commit}"
  else
    log "[1/${TOTAL_STEPS}] Fetching ${BRANCH}..."
    git fetch origin "${BRANCH}"
    old_commit="$(git rev-parse HEAD)"
    new_commit="$(git rev-parse "origin/${BRANCH}")"
  fi

  if [ "${old_commit}" = "${new_commit}" ] && [ "${force}" = "no" ] && [ "${content_only}" = "no" ]; then
    log "  Already up to date at $(git log -1 --format='%h %s')."
    log "  Nothing to deploy. Use --force to rebuild anyway."
    exit 0
  fi

  if [ "${old_commit}" != "${new_commit}" ]; then
    log "  Changes to deploy:"
    git log --oneline "${old_commit}..${new_commit}" | sed 's/^/    /'
  else
    log "  No new commits. Rebuilding because of --force."
  fi

  # -------------------------------------------------------------------------
  # Step 2: Update repo
  # -------------------------------------------------------------------------
  log ""
  log "[2/${TOTAL_STEPS}] Updating repo to origin/${BRANCH}..."
  git reset --hard "origin/${BRANCH}"
  log "  Now at $(git log -1 --format='%h %s')"

  # -------------------------------------------------------------------------
  # Step 3: Compose file
  # -------------------------------------------------------------------------
  log ""
  log "[3/${TOTAL_STEPS}] Checking compose.yml..."
  if cmp -s "${REPO_DIR}/deploy/compose.yml" "${APP_DIR}/compose.yml"; then
    log "  Unchanged."
  else
    cp "${REPO_DIR}/deploy/compose.yml" "${APP_DIR}/compose.yml"
    log "  Updated ${APP_DIR}/compose.yml (remember to commit it in /opt/infra)."
  fi

  # -------------------------------------------------------------------------
  # Step 4: Keep the current image for rollback
  # -------------------------------------------------------------------------
  log ""
  log "[4/${TOTAL_STEPS}] Saving current image as ${IMAGE}:previous..."
  local have_previous="no"
  if docker image inspect "${IMAGE}:latest" >/dev/null 2>&1; then
    docker tag "${IMAGE}:latest" "${IMAGE}:previous"
    have_previous="yes"
    log "  Saved."
  else
    log "  No current image found. Rollback will not be available."
  fi

  # -------------------------------------------------------------------------
  # Step 5: Build and restart
  # -------------------------------------------------------------------------
  log ""
  log "[5/${TOTAL_STEPS}] Building and restarting..."
  cd "${APP_DIR}"
  if ! docker compose build web 2>&1 | tee "${BUILD_LOG}"; then
    log "  Build failed. The running site was not touched."
    report_status failed "${content_version}" "$(( ($(date +%s) - started) * 1000 ))" "Build failed: $(tail -n 40 "${BUILD_LOG}")"
    cd "${REPO_DIR}"
    git reset --hard "${old_commit}"
    fail "Build failed. Repo reset to ${old_commit:0:7}."
  fi
  docker compose up -d web

  # -------------------------------------------------------------------------
  # Step 6: Health check (roll back on failure)
  # -------------------------------------------------------------------------
  log ""
  log "[6/${TOTAL_STEPS}] Health check..."
  if wait_for_health; then
    log "  Container is healthy."
    if [ -n "${content_version}" ]; then
      printf '%s' "${content_version}" > "${VERSION_FILE}"
      report_status live "${content_version}" "$(( ($(date +%s) - started) * 1000 ))"
    fi
  else
    log "  Health check FAILED. Recent logs:"
    docker logs --tail 30 "${CONTAINER}" || true
    if [ "${have_previous}" = "yes" ]; then
      log "  Rolling back to the previous image..."
      docker tag "${IMAGE}:previous" "${IMAGE}:latest"
      docker compose up -d --no-build web
      cd "${REPO_DIR}"
      git reset --hard "${old_commit}"
      if wait_for_health; then
        report_status failed "${content_version}" "$(( ($(date +%s) - started) * 1000 ))" "Health check failed after build; rolled back to the previous version."
        fail "Deploy failed. Rolled back to ${old_commit:0:7}; the site is running the previous version."
      fi
    fi
    report_status failed "${content_version}" "$(( ($(date +%s) - started) * 1000 ))" "Health check failed after build; rolled back. $(docker logs --tail 20 "${CONTAINER}" 2>&1 || true)"
    fail "Deploy failed and the site is not healthy. Check: docker logs ${CONTAINER}"
  fi

  # -------------------------------------------------------------------------
  # Step 7: Proxy config
  # -------------------------------------------------------------------------
  log ""
  log "[7/${TOTAL_STEPS}] Checking proxy config..."
  if cmp -s "${PROXY_CONF_SRC}" "${PROXY_CONF_DST}"; then
    log "  Unchanged."
  else
    cp "${PROXY_CONF_DST}" "${PROXY_CONF_DST}.bak"
    cp "${PROXY_CONF_SRC}" "${PROXY_CONF_DST}"
    if docker exec proxy-nginx nginx -t; then
      docker exec proxy-nginx nginx -s reload
      rm -f "${PROXY_CONF_DST}.bak"
      log "  Updated and reloaded proxy-nginx (remember to commit it in /opt/infra)."
    else
      mv "${PROXY_CONF_DST}.bak" "${PROXY_CONF_DST}"
      log "  WARN: New proxy config failed validation. Kept the old one."
    fi
  fi

  # -------------------------------------------------------------------------
  # Step 8: Verify and clean up
  # -------------------------------------------------------------------------
  log ""
  log "[8/${TOTAL_STEPS}] Verifying https://${DOMAIN}/ ..."
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/" || true)"
  if [ "${code}" = "200" ]; then
    log "  OK   200  https://${DOMAIN}/"
  else
    log "  WARN: https://${DOMAIN}/ returned ${code}. The container is healthy, so check the proxy."
  fi
  docker image prune -f >/dev/null
  log "  Removed dangling images."

  log ""
  log "Deployed $(git -C "${REPO_DIR}" log -1 --format='%h %s')"
}

wait_for_health() {
  local _
  for _ in $(seq 1 30); do
    if curl -fs "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

main "$@"
