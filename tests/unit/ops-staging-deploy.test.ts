import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The staging watcher (cron, every 2 minutes) runs `git reset --hard` BEFORE
 * build, migrate, app up and the health checks. If HEAD alone decides "already
 * deployed", a failed deploy is never retried (the next tick sees HEAD ==
 * origin/develop) and its alert is "resolved" two minutes later although
 * staging is still old or half-migrated. A marker written only after a
 * successful deploy decides instead, and only a real deploy resolves the alert.
 */

const root = path.resolve(__dirname, "..", "..");
const script = () => readFileSync(path.join(root, "ops", "deploy", "staging-auto-deploy.sh"), "utf8");

// Via stdin: a Windows path means nothing to a WSL bash. /usr/bin first.
const runBash = (body: string) =>
  spawnSync("bash", ["-s"], { input: `export PATH="/usr/bin:/bin:$PATH"\n${body}\n`, encoding: "utf8" });
const bashWorks = (() => {
  let works: boolean | undefined;
  return () => (works ??= runBash("echo ok").stdout?.trim() === "ok");
})();

/**
 * Copies the script into a temp dir, points REPO/LOG/LOCK/MARK and the mailer
 * there, puts stub git/docker/curl/flock first on PATH and runs `ticks`
 * (a bash snippet calling `tick <build-rc>`; each tick prints its exit code).
 */
function harness(ticks: string): string {
  return [
    'T="$(mktemp -d)"',
    'mkdir -p "$T/bin" "$T/scripts" "$T/repo/.git" "$T/state"',
    "cat > \"$T/deploy.sh\" <<'__STAGING_SCRIPT_EOF__'",
    script(),
    "__STAGING_SCRIPT_EOF__",
    'sed -i -e "s#/opt/scripts/#$T/scripts/#g" -e "s#^REPO=\\"[^\\"]*\\"#REPO=\\"$T/repo\\"#" ' +
      '-e "s#^LOG=\\"[^\\"]*\\"#LOG=\\"$T/deploy.log\\"#" -e "s#^LOCK=\\"[^\\"]*\\"#LOCK=\\"$T/deploy.lock\\"#" ' +
      '-e "s#/var/lib/beyondles-autodeploy#$T/state#g" "$T/deploy.sh"',
    // mailer: one line per call with its arguments
    'printf \'#!/bin/bash\ncat >/dev/null\necho "$*" >> "%s/mail.log"\n\' "$T" > "$T/scripts/alert-mail.sh"',
    // git: HEAD in $T/local, origin/develop in $T/remote, reset copies it over
    "cat > \"$T/bin/git\" <<'__STUB__'",
    "#!/bin/bash",
    'case "$1" in',
    "  fetch) exit 0 ;;",
    '  rev-parse) if [ "$2" = "--short" ]; then cat "$STUB_DIR/local"; elif [ "$2" = "@" ]; then cat "$STUB_DIR/local"; else cat "$STUB_DIR/remote"; fi ;;',
    '  reset) cp "$STUB_DIR/remote" "$STUB_DIR/local" ;;',
    "esac",
    "__STUB__",
    // docker: build fails with $T/build_rc, postgres always healthy
    "cat > \"$T/bin/docker\" <<'__STUB__'",
    "#!/bin/bash",
    'echo "$*" >> "$STUB_DIR/docker.log"',
    'case " $* " in',
    '  *" build "*) exit "$(cat "$STUB_DIR/build_rc")" ;;',
    '  *" ps postgres "*) echo healthy ;;',
    "esac",
    "exit 0",
    "__STUB__",
    "cat > \"$T/bin/curl\" <<'__STUB__'",
    "#!/bin/bash",
    'case " $* " in *" -sf "*) exit 0 ;; *) echo \'{"status":"ok","access":"ok"}\' ;; esac',
    "__STUB__",
    'printf \'#!/bin/bash\nexit "$(cat "%s/flock_rc")"\n\' "$T" > "$T/bin/flock"',
    'chmod +x "$T/bin/"* "$T/scripts/alert-mail.sh"',
    'export STUB_DIR="$T" PATH="$T/bin:$PATH"',
    'echo aaaa > "$T/local"; echo bbbb > "$T/remote"; echo 0 > "$T/flock_rc"',
    'tick() { echo "$1" > "$T/build_rc"; : > "$T/mail.log"; : > "$T/docker.log"; bash "$T/deploy.sh"; local rc=$?;',
    '  local builds; builds=$(grep -c " build " "$T/docker.log");',
    '  local resolves; resolves=$(grep -c -- "--resolve" "$T/mail.log");',
    '  local mails; mails=$(grep -c . "$T/mail.log");',
    '  echo "rc=$rc builds=$builds mails=$mails resolves=$resolves mark=$(cat "$T/state/"* 2>/dev/null)"; }',
    ticks,
    'rm -rf "$T"',
  ].join("\n");
}

describe("staging auto-deploy retries a failed deploy", () => {
  it("rebuilds the same commit until it succeeds and resolves the alert only after a real deploy", { timeout: 60_000 }, () => {
    if (!bashWorks()) return; // no bash on this machine
    const run = runBash(
      harness(
        [
          "tick 1", // new commit, build fails -> alert
          "tick 1", // same commit: must be rebuilt, alert must stay open
          "tick 0", // build works -> marker, alert resolved
          "tick 0", // idle -> nothing
          'echo 1 > "$T/flock_rc"; tick 0', // lock busy -> nothing
        ].join("\n"),
      ),
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split("\n")).toEqual([
      "rc=1 builds=1 mails=1 resolves=0 mark=",
      "rc=1 builds=1 mails=1 resolves=0 mark=",
      "rc=0 builds=1 mails=1 resolves=1 mark=bbbb",
      "rc=0 builds=0 mails=0 resolves=0 mark=bbbb",
      "rc=0 builds=0 mails=0 resolves=0 mark=bbbb",
    ]);
  });

  it("decides 'already deployed' by the success marker, not by HEAD", () => {
    const text = script();
    expect(text).not.toMatch(/\[ "\$LOCAL" = "\$REMOTE" \] && exit 0/);
    expect(text).toMatch(/^MARK="\/var\/lib\/beyondles-autodeploy\/[a-z]+-staging-deployed"$/m);
    expect(text).toMatch(/\[ -f "\$MARK" \] && \[ "\$\(cat "\$MARK"\)" = "\$REMOTE" \]/);
    // written after "deploy OK", the last step of the deploy block
    expect(text.indexOf('echo "$REMOTE" > "$MARK"')).toBeGreaterThan(text.indexOf("deploy OK"));
  });

  it("resolves only after a successful deploy and no longer claims an aborted deploy left staging untouched", () => {
    const text = script();
    expect(text).toMatch(/elif \[ "\$\{DEPLOYED:-0\}" = 1 \]; then\n\s*"\$mailer" --key "\$name" --resolve/);
    expect(text).not.toContain("nothing was half-rolled-out");
    expect(text).toContain("--min-interval 3600");
  });

  it("the script is valid bash", { timeout: 30_000 }, () => {
    const check = spawnSync("bash", ["-n"], { input: script(), encoding: "utf8" });
    if (check.error) return; // no bash on this machine
    expect(check.status, check.stderr).toBe(0);
  });
});
