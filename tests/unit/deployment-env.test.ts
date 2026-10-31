import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_POOL_MAX, poolMax } from "@/lib/db";
import { PRE_DEPLOY_DUMP_MAX_DAYS } from "@/server/retention/registry";

/**
 * Two traps between "is in .env.example" and "arrives in the running
 * process". Both snapped once, both were invisible.
 *
 * 1. `docker compose --env-file .env` fills only the placeholders IN the
 *    Compose file — the container gets exactly what `environment:` lists. A
 *    variable the code reads that is missing there is silently unset.
 * 2. An EMPTY value is not a missing value (`Number("")` is 0).
 */

const root = path.resolve(__dirname, "..", "..");

function appEnvironmentBlock(): string {
  const text = readFileSync(path.join(root, "docker", "docker-compose.yml"), "utf8");
  const start = text.indexOf("\n  app:");
  expect(start, "service `app` not found in docker-compose.yml").toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const end = rest.search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const envStart = block.indexOf("environment:");
  expect(envStart, "`app` has no environment block").toBeGreaterThan(-1);
  return block.slice(envStart);
}

/** Variables the code reads that DELIBERATELY do not go into the container. */
const NOT_IN_CONTAINER = new Map<string, string>([
  ["NODE_ENV", "set by the runtime image (Dockerfile)."],
  ["NEXT_RUNTIME", "set by Next.js itself."],
  ["JWT_SECRET", "must never be on a server — production asks the Suite."],
  ["ALLOW_LOCAL_JWT", "the switch for CI/E2E/local only, never for a server."],
  ["PORT", "set by the runtime image (PORT=3000), locally by scripts/start.mjs."],
  ["HOSTNAME", "set by the runtime image."],
]);

function variablesRead(): string[] {
  const files: string[] = [];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  collect(path.join(root, "src"));

  const names = new Set<string>();
  for (const file of files) {
    const content = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const hit of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(hit[1]);
  }
  return [...names].sort();
}

describe("docker-compose passes every variable the code reads", () => {
  it("the door variables are visible to this guard at all", () => {
    const read = variablesRead();
    expect(read).toContain("PLATFORM_API_URL");
    expect(read).toContain("PLATFORM_API_KEY");
    expect(read).toContain("NEXT_PUBLIC_PLATFORM_URL");
  });

  it("no variable read by the code is missing in the container", () => {
    const env = appEnvironmentBlock();
    const missing = variablesRead().filter(
      (name) => !NOT_IN_CONTAINER.has(name) && !new RegExp(`^\\s+${name}:`, "m").test(env),
    );
    expect(missing, `read by the code but not passed to service app: ${missing.join(", ")}`).toEqual([]);
  });

  it("no forbidden variable is passed to the container", () => {
    const env = appEnvironmentBlock();
    for (const name of ["JWT_SECRET", "ALLOW_LOCAL_JWT", "PLATFORM_SSO_URL"]) {
      expect(new RegExp(`^\\s+${name}:`, "m").test(env), `${name} must not be in docker-compose.yml`).toBe(false);
    }
  });

  it("every variable read by the code is explained in .env.example", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    const missing = variablesRead().filter(
      (name) => !["NODE_ENV", "NEXT_RUNTIME", "PORT", "HOSTNAME"].includes(name) && !example.includes(name),
    );
    expect(missing, `not explained in .env.example: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("poolMax", () => {
  it("takes a valid number and falls back otherwise", () => {
    expect(poolMax("8")).toBe(8);
    expect(poolMax(undefined)).toBe(DEFAULT_POOL_MAX);
    expect(poolMax("")).toBe(DEFAULT_POOL_MAX);
    for (const v of ["eight", "0", "-5", "2.5", "NaN"]) expect(poolMax(v)).toBe(DEFAULT_POOL_MAX);
  });
});

/**
 * The production deploy writes a full dump of ALL tenants before every
 * migration. Erasure (tenant/member delete, retention redaction) only touches
 * the live database, so these dumps must be private (umask 077, 600/700),
 * must age out on a fixed clock and must be named in docs/RETENTION.md.
 */
describe("pre-deploy safety dumps", () => {
  const script = () => readFileSync(path.join(root, "ops", "deploy", "production-deploy.sh"), "utf8");

  it("sets umask 077 before the dump folder and file are created", () => {
    const text = script();
    const umask = text.search(/^umask 077$/m);
    expect(umask, "production-deploy.sh has no `umask 077`").toBeGreaterThan(-1);
    expect(umask).toBeLessThan(text.indexOf("mkdir -p"));
    expect(umask).toBeLessThan(text.indexOf("pg_dump"));
  });

  it("restricts the backup directory to 700 and every dump to 600", () => {
    const text = script();
    expect(text).toMatch(/chmod 700 "\$BACKUPS"/);
    expect(text).toMatch(/chmod 600 "\$DUMP"/);
    expect(text).toMatch(/pg_dump[^\n]*>\s*"\$DUMP"/);
  });

  it("prunes dumps by age, not only by count, also without a deploy", () => {
    const text = script();
    expect(text).toMatch(/-name 'pre-deploy-\*\.dump\*' -mtime \+"\$DUMP_MAX_DAYS" -delete/);
    expect(text).toContain(`\${PRE_DEPLOY_DUMP_MAX_DAYS:-${PRE_DEPLOY_DUMP_MAX_DAYS}}`);
    expect(text).toMatch(/"\$\{1:-\}" = "--prune-dumps"/);
  });

  it("encrypts with age when a recipient is set, and keeps no plaintext then", () => {
    const text = script();
    expect(text).toMatch(/\| age -r "\$PRE_DEPLOY_AGE_RECIPIENT" > "\$DUMP"/);
  });

  it("docs/RETENTION.md names the dumps and their maximum age", () => {
    const doc = readFileSync(path.join(root, "docs", "RETENTION.md"), "utf8");
    expect(doc).toContain("pre-deploy");
    expect(doc).toContain(`\`PRE_DEPLOY_DUMP_MAX_DAYS\` (days, default ${PRE_DEPLOY_DUMP_MAX_DAYS})`);
  });

  // Starting bash (WSL on Windows) can take seconds on a busy machine.
  it("the script is valid bash", { timeout: 30_000 }, () => {
    // Via stdin: a Windows path means nothing to a WSL bash.
    const check = spawnSync("bash", ["-n"], { input: script(), encoding: "utf8" });
    if (check.error) return; // no bash on this machine
    expect(check.status, check.stderr).toBe(0);
  });
});
