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
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  "src/app/api/health/route.ts",
  "src/app/api/platform/export/route.ts",
  "src/app/api/mcp/route.ts",
  "src/app/icon.png",
  "src/app/apple-icon.png",
  "src/app/favicon.ico",
  "src/app/kein-zugriff/page.tsx",
  "mcp/package.json",
  "mcp/server.mjs",
  "docs/OFFEN.md",
  "README.md",
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
for (const sdk of [
  "@anthropic-ai/sdk",
  "openai",
  "@google/generative-ai",
  "@google/genai",
  "resend",
  "nodemailer",
  "@mistralai/mistralai",
]) {
  if (deps[sdk]) fail(`provider/mail SDK in package.json: ${sdk} (use the platform door)`);
}
if (pkg.scripts?.start && /\bnext start\b/.test(pkg.scripts.start))
  fail('"start" uses `next start` — standalone output needs scripts/start.mjs');

const FORBIDDEN_ENV =
  /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_[A-Z_]*API_KEY|MISTRAL_API_KEY|DEEPSEEK_API_KEY|RESEND_API_KEY|SMTP_PASS(WORD)?|PLATFORM_SSO_URL)\b/;
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const sourceFiles = walk(path.join(root, "src")).concat(
  walk(path.join(root, "docker")),
  [path.join(root, ".env.example")],
);
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

// 6. Sign-in never hard-codes the production Suite for /api/auth/me.
for (const file of sourceFiles.filter((f) => /\.tsx?$/.test(f))) {
  const text = readFileSync(file, "utf8");
  if (text.includes("beyondles.ai/api/auth/me"))
    fail(`${path.relative(root, file)} hard-codes the Suite address for /api/auth/me`);
}

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

// 8. The Lab still carries the template name? Only a warning for the
//    template itself, a finding for a renamed Lab.
if (pkg.name !== "examplelab") {
  const leftovers = walk(root)
    .filter((f) => /\.(ts|tsx|json|yml|md|prisma|sh|mjs)$/.test(f) || path.basename(f) === "Dockerfile")
    .filter((f) => !f.includes("rename-lab.mjs") && !f.endsWith("package-lock.json"))
    .filter((f) => /examplelab|ExampleLab/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f));
  if (leftovers.length > 0)
    fail(`template name still present in: ${leftovers.slice(0, 10).join(", ")}`);
}

if (findings.length > 0) {
  console.error("Frame check FAILED:\n" + findings.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("Frame check passed.");
