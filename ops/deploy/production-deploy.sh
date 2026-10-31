#!/bin/bash
# ---------------------------------------------------------------------------
# Production deploy for EXAMPLELAB (main -> :__PROD_PORT__) on the Playground.
# Called by the production watcher (playground-production-auto-deploy.sh) and
# usable by hand. Allowed for: root, dev-* users (docker group is enough).
# NO seed here, ever.
#
# Install: copy to /opt/scripts/examplelab-production-deploy.sh, replace
# __PROD_PORT__, chmod 750.
#
# Safety dumps (docs/RETENTION.md): every deploy dumps ALL tenants before the
# migration. Tenant/member deletion and retention only erase the live
# database, so the dumps are private (umask 077, dir 700, file 600) and are
# deleted once older than PRE_DEPLOY_DUMP_MAX_DAYS (default 7), at most 5 are
# kept. The age rule must hold without a deploy too, so add a daily line to
# /etc/cron.d/beyondles-jobs, e.g.
#   15 3 * * * root /opt/scripts/examplelab-production-deploy.sh --prune-dumps
# Set PRE_DEPLOY_AGE_RECIPIENT (an age public key, same tool as the backups)
# to store the dumps encrypted only (pre-deploy-*.dump.age). Both settings
# come from the environment or, if unset there, from "$REPO/.env".
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="/opt/examplelab/production"
BRANCH="main"
PORT="__PROD_PORT__"
LOG="/var/log/examplelab-production-deploy.log"
BACKUPS="/opt/examplelab/backups"
# Host setting: environment first, then the production .env.
host_setting() {
  if printenv "$1"; then return 0; fi
  [ -f "$REPO/.env" ] || return 0
  sed -n "s/^$1=//p" "$REPO/.env" | tail -n 1
}
PRE_DEPLOY_DUMP_MAX_DAYS="$(host_setting PRE_DEPLOY_DUMP_MAX_DAYS)"
PRE_DEPLOY_AGE_RECIPIENT="$(host_setting PRE_DEPLOY_AGE_RECIPIENT)"
DUMP_MAX_DAYS="${PRE_DEPLOY_DUMP_MAX_DAYS:-7}"
[[ "$DUMP_MAX_DAYS" =~ ^[0-9]+$ ]] || DUMP_MAX_DAYS=7

say() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# Age rule first, then keep at most the 5 newest.
prune_dumps() {
  [ -d "$BACKUPS" ] || return 0
  find "$BACKUPS" -maxdepth 1 -type f -name 'pre-deploy-*.dump*' -mtime +"$DUMP_MAX_DAYS" -delete
  ls -t "$BACKUPS"/pre-deploy-*.dump* 2>/dev/null | tail -n +6 | xargs -r rm --
}

if [ "${1:-}" = "--prune-dumps" ]; then
  prune_dumps
  say "pre-deploy dumps pruned (max ${DUMP_MAX_DAYS} days, max 5)"
  exit 0
fi

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
# Private only for the dump: the checkout above keeps the host's umask.
OLD_UMASK="$(umask)"
umask 077
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS" 2>/dev/null || say "could not set $BACKUPS to 700 (not the owner); the dump file itself is 600"
DUMP="$BACKUPS/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
if [ -n "${PRE_DEPLOY_AGE_RECIPIENT:-}" ]; then
  DUMP="$DUMP.age"
  docker exec examplelab-production-postgres-1 pg_dump -U examplelab -d examplelab -Fc | age -r "$PRE_DEPLOY_AGE_RECIPIENT" > "$DUMP"
else
  say "PRE_DEPLOY_AGE_RECIPIENT not set: dump is NOT encrypted (mode 600, deleted after ${DUMP_MAX_DAYS} days)"
  docker exec examplelab-production-postgres-1 pg_dump -U examplelab -d examplelab -Fc > "$DUMP"
fi
chmod 600 "$DUMP"
umask "$OLD_UMASK"
prune_dumps

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
# Access door (access model, 2026-09-03): /api/health must report access == ok,
# i.e. NEXT_PUBLIC_PLATFORM_URL AND the platform door are set.
ACCESS_DOOR="$(curl -s --max-time 10 "http://127.0.0.1:${PORT}/api/health" | grep -oE '"access":"[a-z_]+"' | cut -d'"' -f4)" || ACCESS_DOOR=""
if [ "${ACCESS_DOOR:-}" != "ok" ]; then
  say "ACCESS DOOR NOT OK on :${PORT} (access='${ACCESS_DOOR:-empty}'): NEXT_PUBLIC_PLATFORM_URL, PLATFORM_API_URL or PLATFORM_API_KEY missing in the .env."
  exit 1
fi
say "[access door] ok"
say "deploy OK: $(git rev-parse --short @)"
