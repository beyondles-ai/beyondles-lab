#!/bin/bash
# ---------------------------------------------------------------------------
# Poll-based auto-deploy for EXAMPLELAB STAGING (develop -> :__STAGING_PORT__)
# on the Playground server. Cron runs this every 2 minutes; silent when idle.
# NO `git clean` (the untracked .env lives at the repo root). NO seed, ever.
#
# Install: copy to /opt/scripts/examplelab-staging-auto-deploy.sh, replace
# __STAGING_PORT__, chmod 750, add to /etc/cron.d/beyondles-autodeploy.
# ---------------------------------------------------------------------------
set -u

_beyondles_alert_on_exit() {
  local rc=$?
  local mailer="/opt/scripts/alert-mail.sh"
  local name; name="$(basename "$0" .sh)"
  [ -x "$mailer" ] || return 0
  if [ "$rc" -ne 0 ]; then
    {
      echo "The deployment was aborted (exit code $rc)."
      echo "The running version is untouched -- nothing was half-rolled-out."
      echo
      echo "Last log lines from ${LOG:-(no log file configured)}:"
      if [ -n "${LOG:-}" ] && [ -r "${LOG:-}" ]; then tail -n 30 "$LOG"; fi
    } | "$mailer" --key "$name" --min-interval 3600 "Auto-deploy aborted: $name" >/dev/null 2>&1
  else
    "$mailer" --key "$name" --resolve "Auto-deploy: $name" </dev/null >/dev/null 2>&1
  fi
  return 0
}
trap _beyondles_alert_on_exit EXIT
# ---------------------------------------------------------------------------
REPO="/opt/examplelab/staging"
BRANCH="develop"
PORT="__STAGING_PORT__"
LOG="/var/log/examplelab-staging-autodeploy.log"
LOCK="/tmp/examplelab-staging-autodeploy.lock"

exec 9>"$LOCK"
flock -n 9 || exit 0

[ -d "$REPO/.git" ] || exit 0
cd "$REPO" || exit 1

git fetch --quiet origin "$BRANCH" || { echo "[$(date '+%F %T')] git fetch failed" >>"$LOG"; exit 1; }
LOCAL="$(git rev-parse @ 2>/dev/null)"
REMOTE="$(git rev-parse "origin/$BRANCH" 2>/dev/null)"
[ -n "$REMOTE" ] || { echo "[$(date '+%F %T')] cannot resolve origin/$BRANCH" >>"$LOG"; exit 1; }
[ "$LOCAL" = "$REMOTE" ] && exit 0

{
  # Inside the block every failing step aborts the run (a failed build must
  # never be followed by an "up" of the old image and a "deploy OK").
  set -eo pipefail
  echo "===================================================================="
  echo "[$(date '+%F %T')] new commits on $BRANCH: $LOCAL -> $REMOTE"
  git reset --hard "origin/$BRANCH"

  COMPOSE=(docker compose --env-file "$REPO/.env" -f "$REPO/docker/docker-compose.yml" -f "$REPO/docker/compose.staging.yml")

  echo "[build]"
  "${COMPOSE[@]}" build app toolchain

  echo "[db up]"
  "${COMPOSE[@]}" up -d postgres
  for i in $(seq 1 30); do
    status="$("${COMPOSE[@]}" ps postgres --format '{{.Health}}' 2>/dev/null || echo '')"
    [ "$status" = "healthy" ] && break
    sleep 2
  done
  [ "$("${COMPOSE[@]}" ps postgres --format '{{.Health}}')" = "healthy" ] || { echo "postgres not healthy"; exit 1; }

  echo "[migrate]"
  "${COMPOSE[@]}" run --rm --no-deps toolchain npx prisma migrate deploy

  echo "[app up]"
  "${COMPOSE[@]}" up -d app

  echo "[health]"
  ok=0
  for i in $(seq 1 45); do
    curl -sf -o /dev/null "http://127.0.0.1:${PORT}/api/health" && { ok=1; break; }
    sleep 2
  done
  [ "$ok" = "1" ] || { echo "health check on :${PORT} failed"; exit 1; }
  # Access door (access model, 2026-09-03): /api/health must report access == ok,
  # i.e. NEXT_PUBLIC_PLATFORM_URL AND the platform door are set. Otherwise the
  # Lab runs but lets nobody in — a deploy must not call that a success.
  ACCESS_DOOR="$(curl -s --max-time 10 "http://127.0.0.1:${PORT}/api/health" | grep -oE '"access":"[a-z_]+"' | cut -d'"' -f4 || true)"
  if [ "${ACCESS_DOOR:-}" != "ok" ]; then
    echo "ACCESS DOOR NOT OK on :${PORT} (access='${ACCESS_DOOR:-empty}'): NEXT_PUBLIC_PLATFORM_URL, PLATFORM_API_URL or PLATFORM_API_KEY missing in the .env."
    exit 1
  fi
  echo "[access door] ok"
  echo "[$(date '+%F %T')] deploy OK: $(git rev-parse --short @)"
} >>"$LOG" 2>&1
