import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  configPathProblem,
  coreProfileReport,
  exclusionsDocEntries,
  generatedMarker,
  generatorScript,
  importSpecifiers,
  manifestFunctions,
  parseFrameArgs,
  readDoorsConfig,
  withoutComments,
} from "../../scripts/support/core-profile.mjs";
import { DOORS_PIN_VERSION } from "../../scripts/support/doors-pin.mjs";

/**
 * Profile "core" of `scripts/check-frame.mjs` (card #383, step E): a core
 * product names its door files in doors.config.json, and the check holds
 * them like the template's file list. The config reading runs against the
 * fixtures in tests/fixtures/core-profile; the whole profile runs against a
 * small product written to a temporary folder, with the template's own
 * synced copy of doors as the product's shared copy.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const fixtures = path.join(repoRoot, "tests", "fixtures", "core-profile");

/** An io that sees one fixture as the product's doors.config.json. */
function configIo(fixture: string | null) {
  return {
    exists: (rel: string) => rel === "doors.config.json" && fixture !== null,
    read: (rel: string) => {
      if (rel !== "doors.config.json" || fixture === null)
        throw new Error(`ENOENT ${rel}`);
      return readFileSync(path.join(fixtures, fixture), "utf8");
    },
  };
}

describe("doors.config.json", () => {
  it("reads a TypeScript product's config", () => {
    const { config, problems } = readDoorsConfig(configIo("valid-ts.json"));
    expect(problems).toEqual([]);
    expect(config).toEqual({
      manifest: "lib/doors/functions.manifest.ts",
      parityTest: "tests/door-parity.test.ts",
      machineDoor: "lib/doors/machine-door.ts",
      mcpRoute: "app/api/mcp/route.ts",
      openapiRoute: "app/api/v1/openapi.json/route.ts",
      exclusionsDoc: "docs/EXCLUSIONS.md",
      sharedCopy: "lib/shared-doors",
    });
  });

  it("reads a CommonJS product's config with its variant", () => {
    const { config, problems } = readDoorsConfig(configIo("valid-cjs.json"));
    expect(problems).toEqual([]);
    expect(config?.variant).toBe("cjs");
    expect(config?.sharedCopy).toBe("api/src/shared-doors");
  });

  it("refuses a product without the file", () => {
    const { config, problems } = readDoorsConfig(configIo(null));
    expect(config).toBeNull();
    expect(problems).toEqual([
      expect.stringContaining("no doors.config.json at the product root"),
    ]);
  });

  it("refuses text that is not JSON and JSON that is not one object", () => {
    expect(readDoorsConfig(configIo("not-json.txt")).problems).toEqual([
      expect.stringContaining("is not valid JSON"),
    ]);
    expect(readDoorsConfig(configIo("not-an-object.json")).problems).toEqual([
      "doors.config.json must be one JSON object",
    ]);
  });

  it("names a missing key and an unknown key", () => {
    expect(readDoorsConfig(configIo("missing-key.json")).problems).toEqual([
      'doors.config.json: "parityTest" is missing (the parity test)',
    ]);
    const unknown = readDoorsConfig(configIo("unknown-key.json"));
    expect(unknown.config).toBeNull();
    expect(unknown.problems).toEqual([
      expect.stringContaining('unknown key "parity"'),
    ]);
  });

  it("refuses paths that leave the product root or are not plain", () => {
    const { config, problems } = readDoorsConfig(configIo("unsafe-paths.json"));
    expect(config).toBeNull();
    expect(problems).toEqual([
      'doors.config.json: "manifest" must stay inside the product root (no ..)',
      'doors.config.json: "parityTest" must be relative to the product root',
      'doors.config.json: "machineDoor" must use "/" as separator',
      'doors.config.json: "mcpRoute" must be a non-empty path',
      'doors.config.json: "openapiRoute" must be a plain path (no empty or "." segment)',
      'doors.config.json: "exclusionsDoc" must be a non-empty path',
      'doors.config.json: "sharedCopy" must be relative to the product root',
    ]);
  });

  it("knows only the shared variants of doors", () => {
    expect(readDoorsConfig(configIo("bad-variant.json")).problems).toEqual([
      'doors.config.json: "variant" must be one of cjs or left out (TypeScript source)',
    ]);
  });

  it("checks one path at a time", () => {
    expect(configPathProblem("api/src/doors/machine-door.js")).toBeNull();
    expect(configPathProblem("docs//EXCLUSIONS.md")).toMatch(/plain path/);
    expect(configPathProblem("lib/../../x")).toMatch(/no \.\./);
  });
});

describe("arguments", () => {
  it("defaults to profile lab and this repo", () => {
    expect(parseFrameArgs([])).toEqual({ profile: "lab", root: undefined });
  });

  it("takes --profile core with --root, also in the --flag=value form", () => {
    expect(parseFrameArgs(["--profile", "core", "--root", repoRoot])).toEqual({
      profile: "core",
      root: repoRoot,
    });
    expect(parseFrameArgs([`--root=${repoRoot}`, "--profile=core"])).toEqual({
      profile: "core",
      root: repoRoot,
    });
  });

  it("refuses what it does not know", () => {
    expect(parseFrameArgs(["--profile", "core"]).error).toMatch(/needs --root/);
    expect(parseFrameArgs(["--profile", "brain"]).error).toMatch(
      /unknown profile/,
    );
    expect(parseFrameArgs(["--fix"]).error).toMatch(/unknown argument/);
    expect(parseFrameArgs(["--root"]).error).toMatch(/needs a value/);
    expect(
      parseFrameArgs(["--root", path.join(repoRoot, "no-such-folder")]).error,
    ).toMatch(/is not a folder/);
  });
});

describe("reading source text", () => {
  it("finds functions with all three doors and their literal exclusions", () => {
    const text = `
      // listGhosts: { screen: {}, rest: {}, mcp: {} } is a comment, not a function
      export const FUNCTIONS = defineFunctions()({
        listNotes: { scopes: ["read"], screen: { page: "/notes" }, rest: GET("/notes"), mcp: { tool: "x_list_notes" } },
        "delete-note": {
          screen: { page: "/notes" },
          rest: { excluded: "Irreversible; the screen only." },
          mcp: { excluded: "See the REST door." },
          input: { schema: { type: "object" } },
        },
        helpers: { screen: page("/x") },
      });`;
    const { ids, excluded } = manifestFunctions(text);
    expect([...ids].sort()).toEqual(["delete-note", "listNotes"]);
    expect([...excluded].sort()).toEqual([
      "delete-note mcp",
      "delete-note rest",
    ]);
  });

  it("reads the rows of the generated exclusions doc", () => {
    const doc = [
      "# Deliberate exclusions",
      "",
      "<!-- GENERATED from lib/doors/functions.manifest.ts by `npm run docs:exclusions --workspace=api`. Do not edit by hand: a unit test fails when this file differs. -->",
      "",
      "## Doors deliberately left out",
      "",
      "| Function | Door | Why |",
      "|---|---|---|",
      "| `deleteNote` | REST /api/v1 | Irreversible. |",
      "| `deleteNote` | MCP tool | Irreversible. |",
      "| `exportAll` | screen | no page yet |",
      "",
      "## Worker-triggered routes (WORKER key only, REST only)",
      "",
      "| `expireNotes` | `POST /api/v1/worker/expire` | worker |",
      "",
      "## Outside the rule",
      "",
      "| `health.routes` | Health checks. |",
    ].join("\r\n");
    const { ids, excluded } = exclusionsDocEntries(doc);
    expect([...ids].sort()).toEqual(["deleteNote", "expireNotes", "exportAll"]);
    expect([...excluded].sort()).toEqual([
      "deleteNote mcp",
      "deleteNote rest",
      "exportAll screen",
    ]);
    expect(generatedMarker(doc)).toEqual({
      manifest: "lib/doors/functions.manifest.ts",
      command: "npm run docs:exclusions --workspace=api",
    });
  });

  it("knows the three ways the products name their generator", () => {
    expect(generatorScript("npm run docs:exclusions")).toEqual({
      script: "docs:exclusions",
      packageJson: "package.json",
    });
    expect(generatorScript("npm run docs:exclusions --workspace=api")).toEqual({
      script: "docs:exclusions",
      packageJson: "api/package.json",
    });
    expect(generatorScript("npm run docs:exclusions (in api/)")).toEqual({
      script: "docs:exclusions",
      packageJson: "api/package.json",
    });
    expect(generatorScript("make exclusions")).toBeNull();
  });

  it("reads imports and requires, not comments, and keeps // inside strings", () => {
    const text = [
      'import type { DoorHost } from "@/lib/shared-doors/door-host";',
      "// import { old } from '../legacy/door';",
      "const { createOboDoor } = require('../shared-doors/tool-door/obo-door');",
      'const url = "https://example.org/a"; /* import x from "./ghost" */',
    ].join("\n");
    expect(importSpecifiers(text)).toEqual([
      "@/lib/shared-doors/door-host",
      "../shared-doors/tool-door/obo-door",
    ]);
    expect(withoutComments(text)).toContain('"https://example.org/a"');
  });
});

// --- the whole profile against a small product ---------------------------------

const MANIFEST = `import { defineFunctions } from "@/lib/shared-doors/manifest";

export const FUNCTIONS = defineFunctions()({
  listNotes: {
    service: "notes",
    scopes: ["read"],
    screen: { page: "/notes" },
    rest: { method: "GET", path: "/api/v1/notes" },
    mcp: { tool: "core_list_notes" },
  },
  deleteNote: {
    service: "notes",
    scopes: ["write"],
    screen: { page: "/notes" },
    rest: { excluded: "Irreversible; a signed-in person does it on the screen." },
    mcp: { tool: "core_delete_note" },
  },
});
`;

const EXCLUSIONS = `# Deliberate exclusions

<!-- GENERATED from lib/doors/functions.manifest.ts by \`npm run docs:exclusions\`. Do not edit by hand: a unit test fails when this file differs. -->

Every function of the product is reachable through the screen, REST \`/api/v1\` and the MCP tool door, except where listed here with the reason.

## Doors deliberately left out

| Function | Door | Why |
|---|---|---|
| \`deleteNote\` | REST /api/v1 | Irreversible; a signed-in person does it on the screen. |

## Worker-triggered routes (WORKER key only, REST only)

| Function | Route | Scopes |
|---|---|---|
| (none) | | |
`;

const CI = `name: CI Gates
jobs:
  app:
    name: Quality Gates
    steps:
      - uses: beyondles-ai/beyondles-ci/quality-gates@v1
      - name: Shared code is unchanged
        uses: beyondles-ai/beyondles-shared/check@v${DOORS_PIN_VERSION}
`;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A core product that passes, with some files replaced (`null` = removed). */
function product(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "core-profile-"));
  temps.push(root);
  const files: Record<string, string> = {
    "doors.config.json": readFileSync(
      path.join(fixtures, "valid-ts.json"),
      "utf8",
    ),
    ".beyondles-shared.json": JSON.stringify({
      version: DOORS_PIN_VERSION,
      modules: [
        { name: "app-shell", dest: "components/app-shell" },
        { name: "doors", dest: "lib/shared-doors" },
      ],
    }),
    "package.json": JSON.stringify({
      name: "coreproduct",
      scripts: { "docs:exclusions": "node scripts/docs-exclusions.js" },
      dependencies: {},
    }),
    "lib/doors/functions.manifest.ts": MANIFEST,
    "lib/doors/machine-door.ts":
      'import { createOboDoor } from "@/lib/shared-doors/tool-door/obo-door";\nexport const door = createOboDoor;\n',
    "app/api/mcp/route.ts":
      "// The MCP door.\nexport const POST = () => null;\n",
    "app/api/v1/openapi.json/route.ts":
      "// The OpenAPI document of the REST door.\nexport const GET = () => null;\n",
    "docs/EXCLUSIONS.md": EXCLUSIONS,
    "tests/door-parity.test.ts":
      'import { staleExclusions } from "@/lib/shared-doors/exclusions";\nconst file = "docs/EXCLUSIONS.md";\nstaleExclusions(file, "", "npm run docs:exclusions");\n',
    "messages/de.json": JSON.stringify({
      notes: { title: "Notizen", empty: "Legen Sie die erste Notiz an." },
    }),
    "messages/en.json": JSON.stringify({
      notes: { title: "Notes", empty: "Create the first note." },
    }),
    "app/notes/page.tsx":
      'export default function Page() { return <main className="by-app-page">Notes</main>; }\n',
    ".github/workflows/ci.yml": CI,
  };
  cpSync(
    path.join(repoRoot, "src", "lib", "doors"),
    path.join(root, "lib", "shared-doors"),
    { recursive: true },
  );
  for (const [rel, text] of Object.entries({ ...files, ...overrides })) {
    const abs = path.join(root, ...rel.split("/"));
    if (text === null) {
      rmSync(abs, { force: true });
      continue;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

const statusOf = (
  report: { rows: { block: string; status: string }[] },
  block: string,
) => report.rows.filter((row) => row.block === block).map((row) => row.status);

describe("profile core", () => {
  it("passes a product that keeps the frame, with the Lab-only blocks as n/a", () => {
    const report = coreProfileReport(product());
    expect(report.findings).toEqual([]);
    for (const block of ["1", "3", "4", "5c", "5d", "6", "7", "7b", "8", "13"])
      expect(statusOf(report, block)).toEqual(["ok"]);
    for (const block of ["2", "5", "5b", "6b", "12", "14"])
      expect(statusOf(report, block)).toEqual(["n/a"]);
    expect(report.rows.find((row) => row.block === "8")?.text).toMatch(
      /^2 functions in 1 manifest file/,
    );
  });

  it("stops at block 1 without a valid config", () => {
    const report = coreProfileReport(product({ "doors.config.json": null }));
    expect(report.findings).toEqual([
      expect.stringContaining("[1] no doors.config.json"),
    ]);
    expect(report.rows.map((row) => row.block)).toEqual(["1", "-"]);
  });

  it("fails a configured door file that is missing", () => {
    const report = coreProfileReport(product({ "app/api/mcp/route.ts": null }));
    expect(report.findings).toEqual([
      "[1] app/api/mcp/route.ts (mcpRoute, the MCP door route) does not exist",
    ]);
  });

  it("fails an edited shared copy and a wrong pinned version", () => {
    const edited = coreProfileReport(
      product({ "lib/shared-doors/scopes.ts": "export const SCOPES = [];\n" }),
    );
    expect(edited.findings).toEqual([
      expect.stringMatching(
        /^\[5d\] lib\/shared-doors\/scopes\.ts differs from doors /,
      ),
    ]);
    const version = coreProfileReport(
      product({ "lib/shared-doors/.shared-version": "1.5.0\n" }),
    );
    expect(version.findings).toEqual([
      expect.stringContaining(
        '[5d] lib/shared-doors/.shared-version says "1.5.0"',
      ),
    ]);
  });

  it("fails a doors declaration that does not match the config", () => {
    const report = coreProfileReport(
      product({
        ".beyondles-shared.json": JSON.stringify({
          version: DOORS_PIN_VERSION,
          modules: [
            { name: "app-shell", dest: "components/app-shell" },
            { name: "doors", dest: "lib/shared-doors", variant: "cjs" },
          ],
        }),
      }),
    );
    expect(report.findings).toEqual([
      expect.stringContaining(
        'declares doors with variant "cjs", doors.config.json says null',
      ),
    ]);
  });

  it("fails CI that runs the shared check at another version", () => {
    const report = coreProfileReport(
      product({
        ".github/workflows/ci.yml": CI.replace(
          `@v${DOORS_PIN_VERSION}`,
          "@v1.5.0",
        ),
      }),
    );
    expect(report.findings).toEqual([
      `[3] .github/workflows/ci.yml runs beyondles-shared/check@v1.5.0, the pinned version is v${DOORS_PIN_VERSION}`,
    ]);
  });

  it("fails a stale exclusions doc in both directions", () => {
    const removed = coreProfileReport(
      product({
        "docs/EXCLUSIONS.md": EXCLUSIONS.replace(
          /\| `deleteNote` \|/,
          "| `archiveNote` |",
        ),
      }),
    );
    expect(removed.findings).toEqual([
      expect.stringContaining(
        "[8] docs/EXCLUSIONS.md lists archiveNote, which the manifest does not declare",
      ),
      expect.stringContaining(
        "[8] docs/EXCLUSIONS.md misses the exclusions deleteNote rest of the manifest",
      ),
    ]);
  });

  it("fails an exclusions doc that is not generated from the configured manifest", () => {
    const report = coreProfileReport(
      product({
        "docs/EXCLUSIONS.md": EXCLUSIONS.replace(
          "GENERATED from lib/doors/functions.manifest.ts",
          "GENERATED from src/server/functions.manifest.ts",
        ),
      }),
    );
    expect(report.findings).toEqual([
      "[8] docs/EXCLUSIONS.md says it is generated from src/server/functions.manifest.ts, the manifest is lib/doors/functions.manifest.ts",
    ]);
  });

  it("fails a named generator that does not exist and a parity test that does not hold the doc", () => {
    const report = coreProfileReport(
      product({
        "package.json": JSON.stringify({ name: "coreproduct", scripts: {} }),
        "tests/door-parity.test.ts":
          "// staleExclusions(docs/EXCLUSIONS.md) is mentioned in a comment only\n",
      }),
    );
    expect(report.findings).toEqual([
      '[8] docs/EXCLUSIONS.md names `npm run docs:exclusions`, but package.json has no script "docs:exclusions"',
      "[8] tests/door-parity.test.ts does not compare docs/EXCLUSIONS.md with the manifest (staleExclusions from the shared doors)",
    ]);
  });

  it("fails an empty manifest", () => {
    const report = coreProfileReport(
      product({
        "lib/doors/functions.manifest.ts": "export const FUNCTIONS = {};\n",
        "docs/EXCLUSIONS.md": EXCLUSIONS.replace(/\| `deleteNote`.*\n/, ""),
      }),
    );
    expect(report.findings).toEqual([
      "[8] lib/doors/functions.manifest.ts declares no function (no entry with screen, rest and mcp in lib/doors/functions.manifest.ts)",
    ]);
  });

  it("fails a machine door that does not use the shared doors code", () => {
    const report = coreProfileReport(
      product({
        "lib/doors/machine-door.ts":
          'import { verify } from "./own-verifier";\nexport const door = verify;\n',
      }),
    );
    expect(report.findings).toEqual([
      "[5c] lib/doors/machine-door.ts imports nothing from lib/shared-doors: the machine door must use the shared doors code",
    ]);
  });

  it("fails an AI provider SDK, an AI key, different message keys and dark mode", () => {
    const report = coreProfileReport(
      product({
        "package.json": JSON.stringify({
          name: "coreproduct",
          scripts: { "docs:exclusions": "node x.js" },
          dependencies: { openai: "^4.0.0" },
        }),
        "lib/llm.ts": "export const key = process.env.OPENAI_API_KEY;\n",
        "messages/en.json": JSON.stringify({ notes: { title: "Notes" } }),
        "app/notes/page.tsx":
          'export default function Page() { return <main className="bg-card dark:bg-black">Notes</main>; }\n',
      }),
    );
    expect(report.findings).toEqual([
      "[4] package.json depends on openai (AI goes through the platform door)",
      "[4] lib/llm.ts:1 reads an AI provider key (keys live on the platform only)",
      "[7] messages/de.json and en.json differ: only German notes.empty; only English -",
      "[13] app/notes/page.tsx:1: dark: class (light only, no dark mode)",
    ]);
  });

  it("reports Lab learnings the core products have not adopted as warnings, not failures", () => {
    const report = coreProfileReport(
      product({
        "lib/mail.ts":
          "export const host = process.env.SMTP_HOST;\ntry { send(); } catch {}\n",
        "docs/NOTES.md": "# Notes\n",
        "messages/de.json": JSON.stringify({
          notes: { title: "Notizen", empty: "Leg deine erste Notiz an." },
        }),
      }),
    );
    expect(report.findings).toEqual([]);
    expect(statusOf(report, "4")).toEqual(["ok", "warn"]);
    for (const block of ["7b", "9", "10"])
      expect(statusOf(report, block)).toEqual(["warn"]);
    expect(report.warnings.join("\n")).toContain("lib/mail.ts:2");
  });

  it("does not scan tests, docs or the generated copies", () => {
    const report = coreProfileReport(
      product({
        "tests/llm.test.ts": "process.env.OPENAI_API_KEY = 'x';\n",
        "components/app-shell/shell.css":
          "@media (prefers-color-scheme: dark) {}\n",
      }),
    );
    expect(report.findings).toEqual([]);
  });
});

describe("the command line", () => {
  const script = path.join(repoRoot, "scripts", "check-frame.mjs");

  it("runs the core profile and exits 0 on a passing product", () => {
    const run = spawnSync(
      process.execPath,
      [script, "--profile", "core", "--root", product()],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Frame check, profile core:");
    expect(run.stdout).toMatch(/ 5b +n\/a /);
    expect(run.stdout).toContain("Frame check (core) passed.");
  });

  it("exits 1 with the findings on a failing product", () => {
    const run = spawnSync(
      process.execPath,
      [
        script,
        "--profile",
        "core",
        "--root",
        product({ "lib/doors/machine-door.ts": null }),
      ],
      {
        encoding: "utf8",
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Frame check (core) FAILED:");
  });

  it("exits 2 on wrong usage", () => {
    const run = spawnSync(process.execPath, [script, "--profile", "core"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage: node scripts/check-frame.mjs");
  });

  it("keeps the lab profile as the default", () => {
    expect(existsSync(path.join(repoRoot, "doors.config.json"))).toBe(false);
    const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Frame check passed.");
  });
});
