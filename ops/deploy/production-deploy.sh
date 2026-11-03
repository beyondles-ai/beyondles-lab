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
# database, so the dumps are private and age out:
#  - nothing for "other": the folder is root:docker 2770 (setgid, so every
#    dump gets the docker group, and root and every dev-* user can write and
#    prune it), the dumps are 640. The docker group can read the live
#    database anyway (docker exec), so the group adds no reader.
#  - a dump is deleted once older than PRE_DEPLOY_DUMP_MAX_DAYS (default 7),
#    checked at every deploy and daily, so none lives longer than that plus
#    one day; at most 5 are kept. The daily check needs a line in
#    /etc/cron.d/beyondles-jobs, e.g.
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
BACKUP_GROUP="docker"
# Host setting: environment first, then the production .env, read the way
# `docker compose --env-file` reads it: CR (CRLF file), surrounding blanks,
# one pair of quotes and, when unquoted, a trailing " # comment" are dropped.
host_setting() {
  local v
  if v="$(printenv "$1")"; then printf '%s' "$v"; return 0; fi
  [ -f "$REPO/.env" ] || return 0
  local dq='^"(.*)"[[:space:]]*(#.*)?$' sq="^'(.*)'[[:space:]]*(#.*)?\$"
  v="$(sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?$1=//p" "$REPO/.env" | tail -n 1 | tr -d '\r')"
  v="${v#"${v%%[![:space:]]*}"}"
  if [[ $v =~ $dq || $v =~ $sq ]]; then
    v="${BASH_REMATCH[1]}"
  else
    v="${v%%[[:space:]]#*}"
    v="${v%"${v##*[![:space:]]}"}"
  fi
  printf '%s' "$v"
}
PRE_DEPLOY_DUMP_MAX_DAYS="$(host_setting PRE_DEPLOY_DUMP_MAX_DAYS)"
PRE_DEPLOY_AGE_RECIPIENT="$(host_setting PRE_DEPLOY_AGE_RECIPIENT)"
DUMP_MAX_DAYS="${PRE_DEPLOY_DUMP_MAX_DAYS:-7}"
# Whole days, never 0 (and no leading zero: bash would read 08 as octal).
[[ "$DUMP_MAX_DAYS" =~ ^[1-9][0-9]*$ ]] || DUMP_MAX_DAYS=7

say() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# Age rule first, then keep at most the 5 newest. Minutes, not -mtime: find
# drops the fractional day there, so -mtime +7 only matches from 8 days on.
prune_dumps() {
  [ -d "$BACKUPS" ] || return 0
  local rc=0
  find "$BACKUPS" -maxdepth 1 -type f -name 'pre-deploy-*.dump*' -mmin +$((DUMP_MAX_DAYS * 1440)) -delete || rc=1
  local dumps=("$BACKUPS"/pre-deploy-*.dump*)
  if [ -e "${dumps[0]}" ]; then
    ls -t "${dumps[@]}" | tail -n +6 | xargs -r rm -- || rc=1
  fi
  return "$rc"
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
umask 027
mkdir -p "$BACKUPS"
if [ "$(stat -c '%G %a' "$BACKUPS")" != "$BACKUP_GROUP 2770" ]; then
  { chgrp "$BACKUP_GROUP" "$BACKUPS" && chmod 2770 "$BACKUPS"; } 2>/dev/null \
    || say "could not set $BACKUPS to group $BACKUP_GROUP, mode 2770 (only its owner or root can); the dump file itself is 640"
fi
DUMP="$BACKUPS/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
if [ -n "${PRE_DEPLOY_AGE_RECIPIENT:-}" ]; then
  DUMP="$DUMP.age"
  docker exec examplelab-production-postgres-1 pg_dump -U examplelab -d examplelab -Fc | age -r "$PRE_DEPLOY_AGE_RECIPIENT" > "$DUMP"
else
  say "PRE_DEPLOY_AGE_RECIPIENT not set: dump is NOT encrypted (mode 640, deleted once older than ${DUMP_MAX_DAYS} days)"
  docker exec examplelab-production-postgres-1 pg_dump -U examplelab -d examplelab -Fc > "$DUMP"
fi
chmod 640 "$DUMP"
umask "$OLD_UMASK"
# A dump another user cannot delete must not stop the deploy; the daily
# root cron run catches it.
prune_dumps || say "WARNING: could not prune every pre-deploy dump in $BACKUPS"

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
