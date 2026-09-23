#!/bin/bash
# ---------------------------------------------------------------------------
# Production deploy for EXAMPLELAB (main -> :__PROD_PORT__) on the Playground.
# Called by the production watcher (playground-production-auto-deploy.sh) and
# usable by hand. Allowed for: root, dev-* users (docker group is enough).
# NO seed here, ever.
#
# Install: copy to /opt/scripts/examplelab-production-deploy.sh, replace
# __PROD_PORT__, chmod 750.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="/opt/examplelab/production"
BRANCH="main"
PORT="__PROD_PORT__"
LOG="/var/log/examplelab-production-deploy.log"
BACKUPS="/opt/examplelab/backups"

say() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

cd "$REPO"
git fetch origin "$BRANCH"
LOCAL="$(git rev-parse @)"; REMOTE="$(git rev-parse origin/$BRANCH)"
say "deploy by $(whoami): $LOCAL -> $REMOTE"
git reset --hard "origin/$BRANCH"

COMPOSE=(docker compose --env-file "$REPO/.env" -f "$REPO/docker/docker-compose.yml")

say "[build]"
"${COMPOSE[@]}" build app toolchain 2>&1 | tee -a "$LOG" | tail -3

say "[db up]"
"${COMPOSE[@]}" up -d postgres >>"$LOG" 2>&1
for i in $(seq 1 30); do
  status="$("${COMPOSE[@]}" ps postgres --format '{{.Health}}' 2>/dev/null || echo '')"
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "$("${COMPOSE[@]}" ps postgres --format '{{.Health}}')" = "healthy" ] || { say "postgres not healthy"; exit 1; }

say "[safety dump before migrations]"
mkdir -p "$BACKUPS"
docker exec examplelab-production-postgres-1 pg_dump -U examplelab -d examplelab -Fc > "$BACKUPS/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
ls -t "$BACKUPS"/pre-deploy-*.dump 2>/dev/null | tail -n +6 | xargs -r rm --

say "[migrate]"
"${COMPOSE[@]}" run --rm --no-deps toolchain npx prisma migrate deploy 2>&1 | tee -a "$LOG" | tail -3

say "[swap containers]"
"${COMPOSE[@]}" up -d app 2>&1 | tee -a "$LOG" | tail -2

say "[health]"
ok=0
for i in $(seq 1 45); do
  curl -sf -o /dev/null "http://127.0.0.1:${PORT}/api/health" && { ok=1; break; }
  sleep 2
done
[ "$ok" = "1" ] || { say "HEALTH CHECK FAILED on :${PORT}"; exit 1; }
say "deploy OK: $(git rev-parse --short @)"
