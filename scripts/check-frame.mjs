#!/usr/bin/env node
/**
 * Frame self-check: the repo half of the `/lab-pipeline check` list, run
 * in CI on every PR and locally with `npm run check:frame`.
 *
 * It checks what a Lab built from this template must keep, so that a Lab
 * passes the pipeline checklist without manual fixes. Server-side items
 * (ports, tunnel, DNS, Access, .env on the host) are outside the repo and
 * stay with `/lab-pipeline check`.
 *
 * Exit code 1 on the first group of findings; every finding is printed.
 *
 *   node scripts/check-frame.mjs                                  this repo, profile lab
 *   node scripts/check-frame.mjs --profile core --root <product>  a core product
 *
 * Profile "lab" (the default) checks a Lab built from this template; with
 * `--root` it checks another Lab's folder instead of this repo. Profile
 * "core" checks a core product (The Brain, Beyondles HorAIzon, Beyondles
 * Suite): the template layout (blocks 1, 2 and 8) is replaced by the door
 * files the product names in its `doors.config.json`; the principle blocks
 * run where they apply and print "n/a" with the reason where they do not.
 * The rules of that profile are in scripts/support/core-profile.mjs.
 * Exit code 2 = wrong usage.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrameArgs, runCoreProfile } from "./support/core-profile.mjs";
import { doorsPinFindings } from "./support/doors-pin.mjs";
import {
  AI_PROVIDER_ENV,
  AI_PROVIDER_SDKS,
  DARK_MODE,
  MAIL_ENV,
  MAIL_SDKS,
  RETIRED_ENV,
  SWALLOW,
} from "./support/frame-rules.mjs";
import { informalAddressFindings } from "./support/informal-address.mjs";
import { memoryDoorFindings } from "./support/memory-door.mjs";

const args = parseFrameArgs(process.argv.slice(2));
if (args.error) {
  console.error(`${args.error}\n${args.usage}`);
  process.exit(2);
}
if (args.profile === "core") process.exit(runCoreProfile(args.root));

const root = args.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findings = [];
const fail = (msg) => findings.push(msg);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => existsSync(path.join(root, rel));

// 1. Mandatory files of the frame.
for (const rel of [
  "docker/Dockerfile",
  "docker/docker-compose.yml",
  "docker/compose.staging.yml",
  ".github/workflows/ci.yml",
  ".env.example",
  "messages/de.json",
  "messages/en.json",
  "src/lib/auth.ts",
  "src/lib/jwt-guard.ts",
  "src/middleware.ts",
  "src/instrumentation.ts",
  // Self-registration at the platform registry (product registry follow-up).
  "src/lib/platform/register.ts",
  "src/app/api/health/route.ts",
  "src/app/api/platform/export/route.ts",
  "src/app/api/platform/organisation/route.ts",
  "src/server/services/platform-delete.ts",
  "tests/unit/platform-delete-coverage.test.ts",
  "src/app/api/platform/member/route.ts",
  "src/server/services/platform-delete-member.ts",
  "tests/unit/platform-delete-member-coverage.test.ts",
  "src/app/api/mcp/route.ts",
  "src/app/api/mcp/describe/route.ts",
  "src/app/api/platform/reassign-owner/route.ts",
  // The door code is the shared module `doors` (beyondles-shared, card #383),
  // generated into src/lib/doors and drift-checked by the shared check action.
  // The Lab keeps its manifest, scopes, settings and the thin wrappers.
  "src/lib/doors/.shared-version",
  "src/lib/doors/door-contract.md",
  "src/lib/doors/on-behalf.ts",
  "src/lib/doors/tool-door/markers.ts",
  "src/lib/doors/tool-door/obo-door.ts",
  "src/lib/doors/tool-door/release-gate.ts",
  "src/lib/platform/on-behalf.ts",
  "src/lib/tool-door/host.ts",
  "src/lib/tool-door/key-exchange.ts",
  "tests/unit/tool-catalog.test.ts",
  // Headless by construction (06.10.2026): the manifest, its parity test and
  // the generated exclusions list.
  "src/server/functions.manifest.ts",
  "src/server/machine-door.ts",
  "tests/unit/parity.test.ts",
  "docs/EXCLUSIONS.md",
  "src/app/icon.png",
  "src/app/apple-icon.png",
  "src/app/favicon.ico",
  "src/app/kein-zugriff/page.tsx",
  // Closed-pages design (card #350, 2026-10-13): the shared frame from
  // beyondles-shared (app-shell), the signed-in layout that renders it, the
  // states of the signed-in area, the no-access layout and the server-side
  // Suite links. Block 13 checks what they must contain.
  "src/components/app-shell/index.ts",
  "src/components/app-shell/app-shell.css",
  "src/components/app-shell/.shared-version",
  "src/app/(app)/layout.tsx",
  "src/app/(app)/loading.tsx",
  "src/app/(app)/error.tsx",
  "src/app/(app)/not-found.tsx",
  "src/app/not-found.tsx",
  "src/lib/lab-nav.tsx",
  "src/app/kein-zugriff/layout.tsx",
  "src/app/globals.css",
  "src/lib/frame.ts",
  "src/lib/suite-url.ts",
  "tests/unit/app-shell-frame.test.ts",
  "mcp/package.json",
  "mcp/server.mjs",
  "docs/OFFEN.md",
  "README.md",
  // Builder guidance (submission path, 2026-10-08): the template is the
  // teacher for people and for AI agents building a Lab outside Beyondles.
  "CLAUDE.md",
  "AGENTS.md",
  "docs/BUILDING.md",
  "docs/SUBMISSION.md",
  "docs/HANDOVER.md",
  // Lab learnings (Masoud, 30.09.2026): job frame, alert, heartbeat,
  // deletion guards, retention, handover with "Not tested".
  "src/server/jobs/run-job.ts",
  "src/server/jobs/alert.ts",
  "src/server/jobs/heartbeat.ts",
  "src/server/jobs/deletion-guard.ts",
  "src/server/retention/registry.ts",
  "src/server/retention/redaction.ts",
  "tests/unit/jobs.test.ts",
  "tests/unit/retention.test.ts",
  "tests/unit/locale.test.ts",
  "docs/RETENTION.md",
  "docs/HANDOVER.md",
  "src/server/jobs/contract-edges.ts",
  "scripts/contract-check.ts",
  ".github/workflows/contract-check.yml",
  "src/server/jobs/simulation.ts",
  "scripts/simulate.ts",
  "docs/SIMULATION.md",
  "ops/cron/expire-notes.sh",
]) {
  if (!exists(rel)) fail(`missing mandatory file: ${rel}`);
}

// 2. Forbidden files.
for (const rel of ["ecosystem.config.js", ".env", ".env.local"]) {
  if (exists(rel)) fail(`forbidden file in repo: ${rel}`);
}

// 3. CI calls the shared quality gates with the literal job name.
if (exists(".github/workflows/ci.yml")) {
  const ci = read(".github/workflows/ci.yml");
  if (!ci.includes("beyondles-ai/beyondles-ci/quality-gates@v1"))
    fail("ci.yml does not call beyondles-ai/beyondles-ci/quality-gates@v1");
  if (!ci.includes("name: Quality Gates · app"))
    fail('ci.yml job is not named "Quality Gates · app" (required-check context)');
}

// 4. No provider or mail SDK, no provider key, no retired variable.
const pkg = JSON.parse(read("package.json"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const sdk of [...AI_PROVIDER_SDKS, ...MAIL_SDKS]) {
  if (deps[sdk]) fail(`provider/mail SDK in package.json: ${sdk} (use the platform door)`);
}
if (pkg.scripts?.start && /\bnext start\b/.test(pkg.scripts.start))
  fail('"start" uses `next start` — standalone output needs scripts/start.mjs');

// Provider keys, mail settings and retired names (scripts/support/frame-rules.mjs).
const FORBIDDEN_ENV = {
  test: (line) => AI_PROVIDER_ENV.test(line) || MAIL_ENV.test(line) || RETIRED_ENV.test(line),
};
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
// The frame check's own files name every rule they enforce; they are not
// scanned by those rules.
const FRAME_CHECK_FILES = [
  ["scripts", "check-frame.mjs"],
  ["scripts", "support", "frame-rules.mjs"],
  ["scripts", "support", "core-profile.mjs"],
].map((parts) => path.join(root, ...parts));
const isFrameCheckFile = (f) => FRAME_CHECK_FILES.includes(f);
const sourceFiles = ["src", "docker", "ops", "scripts", "mcp", ".github"]
  .flatMap((d) => walk(path.join(root, d)))
  .filter((f) => !isFrameCheckFile(f))
  .concat([path.join(root, ".env.example")]);

// JWT_SECRET must never be passed by Compose (a server .env must not carry it).
{
  const compose = read("docker/docker-compose.yml");
  for (const name of ["JWT_SECRET", "ALLOW_LOCAL_JWT"]) {
    if (new RegExp(`^\\s+${name}:`, "m").test(compose)) fail(`docker-compose.yml passes ${name} to the container`);
  }
}

// Unknown files at the repo root are almost always a shell mishap (six of
// them once got committed to this template). Everything at the root must be
// on this list.
const ROOT_ALLOWED = new Set([
  ".beyondles-shared.json", ".dockerignore", ".env.example", ".gitattributes", ".gitignore", ".prettierignore", ".prettierrc.json",
  "README.md", "eslint.config.mjs", "next.config.ts", "next-env.d.ts", "package-lock.json", "package.json",
  "postcss.config.mjs", "prisma.config.ts", "tsconfig.json", "tsconfig.tsbuildinfo", "vitest.config.ts",
  "CLAUDE.md", "AGENTS.md", "LICENSE",
  // In a `git worktree` checkout `.git` is a file pointing at the main clone.
  ".git",
]);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory()) continue;
  if (!ROOT_ALLOWED.has(entry.name)) fail(`unexpected file at the repo root: ${JSON.stringify(entry.name)}`);
}
for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  // Comments may NAME the forbidden variables (that is how the rule is
  // explained); an assignment or a read of them is the finding.
  const hits = text
    .split("\n")
    .filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line))
    .filter((line) => FORBIDDEN_ENV.test(line));
  if (hits.length > 0)
    fail(`${path.relative(root, file)} uses a forbidden variable: ${hits[0].trim()}`);
}

// 5. Sign-in and platform variables: present in .env.example, no JWT_SECRET
//    as a mandatory line.
const envExample = read(".env.example");
for (const name of [
  "NEXT_PUBLIC_PLATFORM_URL",
  "NEXT_PUBLIC_APP_URL",
  "PLATFORM_API_URL",
  "PLATFORM_API_KEY",
  "PLATFORM_EXPORT_KEY",
]) {
  if (!new RegExp(`^${name}=`, "m").test(envExample))
    fail(`.env.example has no line ${name}=`);
}
if (/^JWT_SECRET=/m.test(envExample) || /^ALLOW_LOCAL_JWT=/m.test(envExample))
  fail(".env.example sets JWT_SECRET/ALLOW_LOCAL_JWT — a server .env must never carry them");

// 5b. The tenant deletion: its own key, passed by Compose, and never the
//     export key. (`.env.example` is checked above for the export key only;
//     the delete key is checked where it reaches the container.)
{
  const compose = read("docker/docker-compose.yml");
  if (!/^\s+PLATFORM_DELETE_KEY:/m.test(compose))
    fail("docker-compose.yml does not pass PLATFORM_DELETE_KEY to the container");
  // Comments may NAME the export key (that is how the rule is explained);
  // reading it is the finding.
  const code = (rel) =>
    read(rel)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
  if (exists("src/lib/platform-delete-auth.ts") && /PLATFORM_EXPORT_KEY/.test(code("src/lib/platform-delete-auth.ts")))
    fail("platform-delete-auth.ts reads PLATFORM_EXPORT_KEY — deletion needs its own key");
  if (
    exists("src/app/api/platform/organisation/route.ts") &&
    !/export\s+async\s+function\s+DELETE\b/.test(read("src/app/api/platform/organisation/route.ts"))
  )
    fail("src/app/api/platform/organisation/route.ts exports no DELETE handler");
}

// 5c. One on-behalf verifier (connection layer contract, stage 6, 2.5). Its
//     source is the shared module `doors` (src/lib/doors/on-behalf.ts, synced
//     from beyondles-shared). src/lib/platform/on-behalf.ts only keeps the
//     Lab's import path: after its comments it must be exactly the re-export,
//     so nobody re-inlines a verifier that checks tokens differently from every
//     other product.
{
  const rel = "src/lib/platform/on-behalf.ts";
  const WRAPPER = 'export * from "@/lib/doors/on-behalf";';
  if (exists(rel)) {
    const code = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (code !== WRAPPER)
      fail(`${rel} must be only the re-export of the shared verifier (${WRAPPER}); found other code`);
  }
}

// 5d. The generated copy of `doors` is byte-for-byte the pinned shared version.
//     The shared check action compares it with beyondles-shared, but that job
//     does not run in this public template or in a Lab outside the
//     organisation. This pin is the check that always runs: an edited verifier,
//     token door, release gate or scope model fails here. Line endings are
//     normalised to LF first. After each doors sync, replace the "ts" table in
//     scripts/support/doors-pin.mjs with the digests the failure lists (and
//     review that diff like code); the core profile reads the same pin.
{
  const DOORS_DIR = "src/lib/doors";
  if (exists(DOORS_DIR)) {
    const list = (dir) =>
      readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? list(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
      );
    for (const finding of doorsPinFindings({ read, exists, list }, DOORS_DIR, "ts")) fail(finding);
  }
}

// 6. Sign-in never hard-codes the production Suite for /api/auth/me.
for (const file of sourceFiles.filter((f) => /\.tsx?$/.test(f))) {
  const text = readFileSync(file, "utf8");
  if (text.includes("beyondles.ai/api/auth/me"))
    fail(`${path.relative(root, file)} hard-codes the Suite address for /api/auth/me`);
}

// 6b. The Lab registers itself at the platform on start (product registry follow-up):
// without it the Suite never lists the Lab and somebody writes the migrations by hand again.
if (exists("src/instrumentation.ts") && !/registerInBackground\(\)/.test(read("src/instrumentation.ts")))
  fail("src/instrumentation.ts does not call registerInBackground() (self-registration at the platform registry)");
if (exists("src/lib/platform/register.ts") && !/\/api\/registry\/self/.test(read("src/lib/platform/register.ts")))
  fail("src/lib/platform/register.ts does not post to /api/registry/self");

// 7. Both languages carry the same keys and no empty text.
const keys = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
const de = JSON.parse(read("messages/de.json"));
const en = JSON.parse(read("messages/en.json"));
const deKeys = keys(de).sort();
const enKeys = keys(en).sort();
if (JSON.stringify(deKeys) !== JSON.stringify(enKeys))
  fail("messages/de.json and messages/en.json do not have the same keys");
// 7b. German addresses the reader with the formal "Sie" (card #350): no
//     "du/dich/dir/dein...", no informal plural "ihr/euch/euer...". Formal
//     "Ihr/Ihre/Ihnen" is correct. Rule and allow-list in
//     scripts/support/informal-address.mjs.
for (const { key, hits } of informalAddressFindings(de))
  fail(`messages/de.json "${key}" addresses the reader informally (${hits.join(", ")}); use the formal "Sie"`);

// 8. The Lab still carries the template name? The literals are assembled at
//    runtime so `npm run rename` cannot rewrite them (it skips this file too);
//    otherwise the check would switch itself off after the rename.
const TEMPLATE_KEY = ["example", "lab"].join("");
const TEMPLATE_NAME = ["Example", "Lab"].join("");
const IS_TEMPLATE_REPO = pkg.name === TEMPLATE_KEY && /\btemplate\b/.test(pkg.description ?? "");
if (!IS_TEMPLATE_REPO) {
  const pattern = new RegExp(`${TEMPLATE_KEY}|${TEMPLATE_NAME}`);
  const leftovers = walk(root)
    .filter((f) => /\.(ts|tsx|json|yml|md|prisma|sh|mjs)$/.test(f) || path.basename(f) === "Dockerfile")
    .filter((f) => !f.endsWith("rename-lab.mjs") && !f.endsWith("check-frame.mjs"))
    .filter((f) => pattern.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f));
  if (leftovers.length > 0)
    fail(`template name still present in: ${leftovers.slice(0, 10).join(", ")} — run \`npm run rename\``);
  if (pkg.name === TEMPLATE_KEY)
    fail(`package.json still carries the template name "${TEMPLATE_KEY}" — run \`npm run rename\``);
}

// 9. No swallowed failure (lab learnings, rule 2): no empty catch block, no
//    `.catch(() => {})`, no `|| true` in code and scripts. A failure is
//    handled, logged with a reason, or it propagates.
{
  const generated = [
    `${path.sep}src${path.sep}lib${path.sep}platform-client${path.sep}`,
    `${path.sep}src${path.sep}components${path.sep}share${path.sep}`,
    `${path.sep}node_modules${path.sep}`,
  ];
  const files = ["src", "scripts", "ops", "mcp", "docker"]
    .flatMap((d) => walk(path.join(root, d)))
    .filter((f) => /\.(ts|tsx|mjs|js|sh)$/.test(f) || path.basename(f) === "Dockerfile")
    .filter((f) => !isFrameCheckFile(f) && !generated.some((g) => f.includes(g)));
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(#|\/\/|\*|\/\*)/.test(line)) return;
        for (const [pattern, what] of SWALLOW) {
          if (pattern.test(line)) fail(`${path.relative(root, file)}:${i + 1}: ${what}`);
        }
      });
  }
}

// 10. Every doc is generated or dated (lab learnings, rule 9): a
//     "Checked on: YYYY-MM-DD" line, or a `<!-- GENERATED` marker (a test
//     compares it with its source). A doc nobody re-read is a doc that lies
//     (it said four assistants, there were three). docs/OFFEN.md stays the
//     ONE open-items file.
for (const file of walk(path.join(root, "docs")).filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(file, "utf8");
  if (!/^Checked on: \d{4}-\d{2}-\d{2}\s*$/m.test(text) && !text.includes("<!-- GENERATED"))
    fail(`${path.relative(root, file)} is neither generated nor has a "Checked on: YYYY-MM-DD" line`);
  if (/^(todo|open|open-items|backlog)\b/i.test(path.basename(file)))
    fail(`${path.relative(root, file)}: open items belong in docs/OFFEN.md only`);
}
if (exists("docs/HANDOVER.md") && !/^## Not tested\s*$/m.test(read("docs/HANDOVER.md")))
  fail('docs/HANDOVER.md has no "## Not tested" section');

// 11. Labs never hold provider keys (lab learnings, rule 10): no
//     PLATFORM_LLM_* setting outside the door client (src/lib/platform/).
//     Model choice and keys live on the platform; a Lab sends useCase/level.
for (const file of sourceFiles) {
  if (file.includes(`${path.sep}src${path.sep}lib${path.sep}platform${path.sep}`)) continue;
  const hit = readFileSync(file, "utf8")
    .split("\n")
    .find((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line) && /\bPLATFORM_LLM_[A-Z0-9_]+/.test(line));
  if (hit) fail(`${path.relative(root, file)} names a PLATFORM_LLM_* setting outside the door client: ${hit.trim()}`);
}

// 12. Third-party images pinned by digest (lab learnings, rule 10). A WARNING,
//     not a failure: renewing a digest is a deliberate act, and the Lab's own
//     images (built here) have no digest to pin.
const warnings = [];
{
  const dockerfile = read("docker/Dockerfile");
  const stages = new Set([...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)].map((m) => m[1].toLowerCase()));
  for (const m of dockerfile.matchAll(/^FROM\s+(\S+)/gim)) {
    if (!stages.has(m[1].toLowerCase()) && !m[1].includes("@sha256:"))
      warnings.push(`docker/Dockerfile: FROM ${m[1]} is not pinned by digest`);
  }
  for (const rel of ["docker/docker-compose.yml", "docker/compose.staging.yml", ".github/workflows/ci.yml"]) {
    if (!exists(rel)) continue;
    for (const m of read(rel).matchAll(/^\s+image:\s*(\S+)/gm)) {
      const own = m[1].startsWith("${") || m[1].startsWith(`${pkg.name}-`);
      if (!own && !m[1].includes("@sha256:")) warnings.push(`${rel}: image ${m[1]} is not pinned by digest`);
    }
  }
}
if (warnings.length > 0) console.warn("Frame check warnings:\n" + warnings.map((w) => `  - ${w}`).join("\n"));

// 13. Closed-pages design (card #350, design system "closed pages v1"). The
//     signed-in area renders the shared frame (AppShell from
//     src/components/app-shell, generated from beyondles-shared) and only
//     fills its content. Light only, Beyondles values only, no own way back
//     to the Suite (the frame's topbar has it), no language switch (the
//     language comes from the Suite through the NEXT_LOCALE cookie).
{
  const manifest = exists(".beyondles-shared.json") ? JSON.parse(read(".beyondles-shared.json")) : {};
  if (!(manifest.modules ?? []).some((m) => m.name === "app-shell" && m.dest === "src/components/app-shell"))
    fail('.beyondles-shared.json has no module { "name": "app-shell", "dest": "src/components/app-shell" }');

  // Code without comment lines, so a comment may NAME a rule.
  const code = (rel) =>
    read(rel)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
  const layout = "src/app/(app)/layout.tsx";
  if (exists(layout)) {
    const text = code(layout);
    if (!/import\s*\{[^}]*\bAppShell\b[^}]*\}\s*from\s*["']@\/components\/app-shell["']/.test(text) || !/<AppShell\b/.test(text))
      fail(`${layout} does not render AppShell from @/components/app-shell (the shared frame)`);
    if (!/["']@\/components\/app-shell\/app-shell\.css["']/.test(text))
      fail(`${layout} does not import @/components/app-shell/app-shell.css`);
  }
  // An address that matches no page must not fall back to Next's own
  // unstyled, English-only 404 page.
  const rootNotFound = "src/app/not-found.tsx";
  if (exists(rootNotFound)) {
    const text = code(rootNotFound);
    if (!/<PageState\b/.test(text) || !/["']@\/components\/app-shell\/app-shell\.css["']/.test(text))
      fail(`${rootNotFound} does not render PageState with @/components/app-shell/app-shell.css (the styled not-found state)`);
    if (!/getTranslations\(\s*["']states["']\s*\)/.test(text))
      fail(`${rootNotFound} does not take its texts from the "states" messages (English and German)`);
  }
  const noAccessPage = "src/app/kein-zugriff/page.tsx";
  if (exists(noAccessPage) && !/<NoAccess\b/.test(code(noAccessPage)))
    fail(`${noAccessPage} does not render NoAccess from @/components/app-shell`);
  const noAccessLayout = "src/app/kein-zugriff/layout.tsx";
  if (exists(noAccessLayout) && !/["']@\/components\/app-shell\/app-shell\.css["']/.test(code(noAccessLayout)))
    fail(`${noAccessLayout} does not import @/components/app-shell/app-shell.css`);

  if (deps["next-themes"]) fail("package.json depends on next-themes: light only, no theme switch");

  const PALETTE =
    "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
  const TOKENS = "use the Beyondles names from src/app/globals.css";
  const DESIGN = [
    ...DARK_MODE,
    [new RegExp(`\\b[a-z-]+-(${PALETTE})-\\d{2,3}\\b`), `Tailwind default palette class: ${TOKENS}`],
    [new RegExp(`--color-(${PALETTE})-\\d{2,3}\\b`), `Tailwind default palette value: ${TOKENS}`],
    [/\b[a-z-]+-\[(#|rgb|hsl|oklch)/, `arbitrary colour class: ${TOKENS}`],
    [/(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/, `raw hex colour: ${TOKENS}`],
    [/\bback\s*to\s*(the\s+)?(beyondles\s+)?suite\b|\bbackToSuite\b|\/toolbox\b/i, "own way back to the Suite: the frame's topbar has it"],
    [/\b(Language|Locale|Lang)(Switch|Switcher|Select|Selector|Toggle|Picker|Menu)\b/, "language switch: the language comes from the Suite (NEXT_LOCALE)"],
    [/\.set\(\s*(LOCALE_COOKIE|["']NEXT_LOCALE["'])/, "writes the language cookie: only the Suite does"],
  ];
  const generatedDirs = [
    ["src", "lib", "platform-client"],
    ["src", "components", "share"],
    ["src", "components", "app-shell"],
    ["src", "generated"],
  ].map((parts) => path.join(root, ...parts) + path.sep);
  const globalsCss = path.join(root, "src", "app", "globals.css");
  const blank = (chunk) => chunk.replace(/[^\n]/g, " ");
  const designFiles = walk(path.join(root, "src"))
    .filter((f) => /\.(ts|tsx|css|mjs|js)$/.test(f))
    .filter((f) => !generatedDirs.some((dir) => f.startsWith(dir)));
  for (const file of designFiles) {
    // Block comments are blanked (line numbers stay); a comment may name a rule.
    let text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, blank);
    // The theme mapping in globals.css is the one place that names colour
    // values; it is blanked, the rest of that file is checked like any other.
    if (file === globalsCss) text = text.replace(/@theme[^{]*\{[^}]*\}/g, blank);
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const [pattern, what] of DESIGN) {
        if (pattern.test(line)) fail(`${path.relative(root, file)}:${i + 1}: ${what}`);
      }
    });
  }
  // The same rule for the texts: no own "Back to Suite" entry in the messages.
  for (const [rel, tree] of [
    ["messages/en.json", en],
    ["messages/de.json", de],
  ]) {
    const hit = keys(tree).find((k) => {
      const value = k.split(".").reduce((cur, part) => cur?.[part], tree);
      return typeof value === "string" && /\bback to (the )?(beyondles )?suite\b|zurück zur (beyondles )?suite/i.test(value);
    });
    if (hit) fail(`${rel}: "${hit}" is an own "Back to Suite" text; the frame's topbar has the way back`);
  }
}

// 14. Memory door (card #377, docs/FRAME.md 4a). Every Lab carries the
//     shared Brain client (module brain-client) and its wrapper
//     src/lib/platform/memory.ts; every manifest function declares `memory`
//     (what it writes and reads, or why not); when any function writes,
//     every delete path forgets in The Brain. A Lab without the client
//     fails. Rule and scanner in scripts/support/memory-door.mjs.
for (const finding of memoryDoorFindings({ read, exists })) fail(finding);

if (findings.length > 0) {
  console.error("Frame check FAILED:\n" + findings.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("Frame check passed.");
