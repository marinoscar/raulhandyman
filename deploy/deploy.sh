#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Update raulhandyman.net to the latest version on main
# =============================================================================
# Run as root on the VPS:
#
#   /opt/infra/apps/raulhandyman/deploy.sh           # deploy if main has new commits
#   /opt/infra/apps/raulhandyman/deploy.sh --force   # rebuild even if nothing changed
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
PROXY_CONF_DST="/opt/infra/proxy/nginx/conf.d/raulhandyman.conf"

TOTAL_STEPS=8
log() { echo "[raulhandyman] $*"; }
fail() { echo "[raulhandyman] ERROR: $*" >&2; exit 1; }

main() {
  local force="no"
  if [ "${1:-}" = "--force" ]; then
    force="yes"
  fi

  [ "$(id -u)" -eq 0 ] || fail "Run this script as root."
  [ -d "${REPO_DIR}/.git" ] || fail "Repo not found at ${REPO_DIR}. Run install.sh first."

  # -------------------------------------------------------------------------
  # Step 1: Fetch
  # -------------------------------------------------------------------------
  log "[1/${TOTAL_STEPS}] Fetching ${BRANCH}..."
  cd "${REPO_DIR}"
  git fetch origin "${BRANCH}"
  local old_commit new_commit
  old_commit="$(git rev-parse HEAD)"
  new_commit="$(git rev-parse "origin/${BRANCH}")"

  if [ "${old_commit}" = "${new_commit}" ] && [ "${force}" = "no" ]; then
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
  if ! docker compose build web; then
    log "  Build failed. The running site was not touched."
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
        fail "Deploy failed. Rolled back to ${old_commit:0:7}; the site is running the previous version."
      fi
    fi
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
