/**
 * Profile "core" of the frame check (card #383, step E): the same principles
 * as a Lab, applied to a core product (The Brain, Beyondles HorAIzon,
 * Beyondles Suite).
 *
 *   node scripts/check-frame.mjs --profile core --root <product folder>
 *
 * A core product does not have the template's layout, so the layout blocks
 * of profile lab (1 mandatory files, 2 forbidden files, 8 template name) are
 * replaced. The product names its door files in `doors.config.json` at its
 * root:
 *
 *   {
 *     "manifest":      the functions manifest (every function, its three doors),
 *     "parityTest":    the unit test that holds manifest and code together,
 *     "machineDoor":   the REST door (openMachineDoor),
 *     "mcpRoute":      the MCP door,
 *     "openapiRoute":  the route that serves the OpenAPI document,
 *     "exclusionsDoc": the generated list of deliberate exclusions,
 *     "sharedCopy":    the folder with the synced copy of the shared module doors,
 *     "variant":       optional, the doors variant the copy is ("cjs")
 *   }
 *
 * All paths are relative to the product root, with "/". The blocks:
 *
 *   1   the config is valid and every named file is there
 *   2   no environment file is tracked by git
 *   3   CI runs the shared quality gates and the shared check at the pinned version
 *   4   no AI provider SDK or key in the product (mail is reported, see below)
 *   5c  the machine door uses the shared doors code
 *   5d  the shared copy is byte for byte doors 1.5.1 and declared as such
 *   6   no hard-coded Suite address for /api/auth/me
 *   7   every messages/ folder has the same keys in de.json and en.json
 *   8   the manifest is not empty and the exclusions doc is current
 *   12  third-party images pinned by digest (warning, as in profile lab)
 *   13  the shared frame app-shell is declared, light only
 *
 * Blocks 5, 5b, 6b and 14 are Lab mechanics (sign-in variables, the Lab's
 * deletion route, self-registration, the memory door into The Brain) and
 * print "n/a" with the reason. Blocks 7b, 9, 10 and 11 are Lab learnings the
 * core products have not adopted yet: they print their hits as warnings, so
 * the gap is visible, and do not fail the check.
 *
 * Text only, no import of product code: the check runs with plain Node and
 * never executes the product.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { DOORS_PIN_VERSION, doorsPinFindings } from "./doors-pin.mjs";
import {
  AI_PROVIDER_ENV,
  AI_PROVIDER_SDKS,
  COMMENT_LINE,
  DARK_MODE,
  MAIL_ENV,
  MAIL_SDKS,
  RETIRED_ENV,
  SWALLOW,
  messageKeys,
} from "./frame-rules.mjs";
import { informalAddressFindings } from "./informal-address.mjs";

export const DOORS_CONFIG_FILE = "doors.config.json";

/** The file keys of doors.config.json and what each names. */
export const DOORS_CONFIG_FILES = {
  manifest: "the functions manifest",
  parityTest: "the parity test",
  machineDoor: "the machine door (REST)",
  mcpRoute: "the MCP door route",
  openapiRoute: "the OpenAPI route",
  exclusionsDoc: "the generated exclusions doc",
};
/** The folder key: the synced copy of the shared module doors. */
export const SHARED_COPY_KEY = "sharedCopy";
/** Variants of the shared module doors besides the TypeScript source. */
export const DOORS_VARIANTS = ["cjs"];

const CONFIG_KEYS = [
  ...Object.keys(DOORS_CONFIG_FILES),
  SHARED_COPY_KEY,
  "variant",
];

export const USAGE = [
  "usage: node scripts/check-frame.mjs [--profile lab|core] [--root <folder>]",
  "  --profile lab   (default) a Lab built from this template; --root defaults to this repo",
  `  --profile core  a core product; --root <product folder> with a ${DOORS_CONFIG_FILE}`,
].join("\n");

/** `{ profile, root }` or `{ error, usage }`. `root` is absolute or undefined. */
export function parseFrameArgs(argv) {
  let profile = "lab";
  let root;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag !== "--profile" && flag !== "--root")
      return { error: `unknown argument ${JSON.stringify(arg)}`, usage: USAGE };
    let value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    if (eq === -1) i += 1;
    if (value === undefined || value === "" || value.startsWith("--"))
      return { error: `${flag} needs a value`, usage: USAGE };
    if (flag === "--profile") profile = value;
    else root = path.resolve(value);
  }
  if (profile !== "lab" && profile !== "core")
    return {
      error: `unknown profile ${JSON.stringify(profile)} (lab or core)`,
      usage: USAGE,
    };
  if (profile === "core" && root === undefined)
    return {
      error: "--profile core needs --root <product folder>",
      usage: USAGE,
    };
  if (root !== undefined && !(existsSync(root) && statSync(root).isDirectory()))
    return { error: `--root ${root} is not a folder`, usage: USAGE };
  return { profile, root };
}

/** Why a configured path is not acceptable, or null. */
export function configPathProblem(value) {
  if (typeof value !== "string" || value.trim() === "")
    return "must be a non-empty path";
  if (value.includes("\\")) return 'must use "/" as separator';
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value))
    return "must be relative to the product root";
  const parts = value.split("/");
  if (parts.includes("..")) return "must stay inside the product root (no ..)";
  if (parts.some((part) => part === "" || part === "."))
    return 'must be a plain path (no empty or "." segment)';
  return null;
}

/**
 * @typedef {{
 *   manifest: string, parityTest: string, machineDoor: string, mcpRoute: string,
 *   openapiRoute: string, exclusionsDoc: string, sharedCopy: string, variant?: string
 * }} DoorsConfig
 */

/**
 * Reads and validates doors.config.json. `io.exists(rel)` and `io.read(rel)`
 * see the product. Returns `{ config, problems }`: `config` is null as soon as
 * there is one problem.
 *
 * @param {{ exists: (rel: string) => boolean, read: (rel: string) => string }} io
 * @returns {{ config: DoorsConfig | null, problems: string[] }}
 */
export function readDoorsConfig(io) {
  if (!io.exists(DOORS_CONFIG_FILE))
    return {
      config: null,
      problems: [
        `no ${DOORS_CONFIG_FILE} at the product root: it names the door files the core profile checks`,
      ],
    };
  let raw;
  try {
    raw = JSON.parse(io.read(DOORS_CONFIG_FILE));
  } catch (error) {
    return {
      config: null,
      problems: [`${DOORS_CONFIG_FILE} is not valid JSON: ${error.message}`],
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {
      config: null,
      problems: [`${DOORS_CONFIG_FILE} must be one JSON object`],
    };

  const problems = [];
  for (const key of Object.keys(raw))
    if (!CONFIG_KEYS.includes(key))
      problems.push(
        `${DOORS_CONFIG_FILE}: unknown key "${key}" (known: ${CONFIG_KEYS.join(", ")})`,
      );
  for (const [key, what] of [
    ...Object.entries(DOORS_CONFIG_FILES),
    [SHARED_COPY_KEY, "the synced copy of doors"],
  ]) {
    if (raw[key] === undefined) {
      problems.push(`${DOORS_CONFIG_FILE}: "${key}" is missing (${what})`);
      continue;
    }
    const problem = configPathProblem(raw[key]);
    if (problem) problems.push(`${DOORS_CONFIG_FILE}: "${key}" ${problem}`);
  }
  if (raw.variant !== undefined && !DOORS_VARIANTS.includes(raw.variant))
    problems.push(
      `${DOORS_CONFIG_FILE}: "variant" must be one of ${DOORS_VARIANTS.join(", ")} or left out (TypeScript source)`,
    );
  if (problems.length > 0) return { config: null, problems };

  const config = /** @type {DoorsConfig} */ ({});
  for (const key of CONFIG_KEYS)
    if (raw[key] !== undefined) config[key] = raw[key];
  return { config, problems: [] };
}

// --- reading the product -------------------------------------------------------

/** Folders never walked: dependencies, build output, git. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "coverage",
  "dist",
  "build",
  "out",
  ".test-out",
  ".turbo",
  ".vercel",
  ".cache",
]);
const TEST_SEGMENTS = new Set([
  "tests",
  "test",
  "__tests__",
  "e2e",
  "__mocks__",
  "fixtures",
]);
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** File access below `root`; every path in and out is relative, with "/". */
export function productIo(root) {
  const abs = (rel) => path.join(root, ...rel.split("/"));
  const list = (rel = "") => {
    const out = [];
    const visit = (dirRel) => {
      const dirAbs = dirRel ? abs(dirRel) : root;
      for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(childRel);
        else if (entry.isFile()) out.push(childRel);
      }
    };
    if (
      rel === "" ||
      (existsSync(abs(rel)) && statSync(abs(rel)).isDirectory())
    )
      visit(rel);
    return out;
  };
  return {
    root,
    read: (rel) => readFileSync(abs(rel), "utf8"),
    exists: (rel) => existsSync(abs(rel)),
    isFile: (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isFile(),
    isDir: (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory(),
    list,
  };
}

const isTest = (rel) =>
  rel.split("/").some((segment) => TEST_SEGMENTS.has(segment)) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) ||
  rel.includes("__smoke__");
const isDoc = (rel) => rel.split("/").includes("docs") || rel.endsWith(".md");
const isEnvFile = (rel) => path.posix.basename(rel).startsWith(".env");
const isUnder = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);

/** The `.beyondles-shared.json` files at the root and one level below. */
export function sharedManifests(io) {
  const found = [];
  const problems = [];
  const candidates = [".beyondles-shared.json"];
  for (const name of readdirSync(io.root, { withFileTypes: true })) {
    if (name.isDirectory() && !SKIP_DIRS.has(name.name))
      candidates.push(`${name.name}/.beyondles-shared.json`);
  }
  for (const file of candidates) {
    if (!io.exists(file)) continue;
    try {
      found.push({
        file,
        dir: path.posix.dirname(file) === "." ? "" : path.posix.dirname(file),
        data: JSON.parse(io.read(file)),
      });
    } catch (error) {
      problems.push(`${file} is not valid JSON: ${error.message}`);
    }
  }
  return { found, problems };
}

/** Every `dest` the shared manifests declare, relative to the product root. */
function generatedDirs(manifests) {
  return manifests.flatMap(({ dir, data }) =>
    (data.modules ?? [])
      .filter((m) => typeof m.dest === "string")
      .map((m) => (dir ? `${dir}/${m.dest}` : m.dest)),
  );
}

// --- reading source text -------------------------------------------------------

/** Index after the string literal that starts at `i`. */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") j += 2;
    else if (src[j] === quote) return j + 1;
    else if (quote !== "`" && src[j] === "\n") return j;
    else j += 1;
  }
  return src.length;
}

/** The text with comments removed (strings kept, so "//" in a URL stays). */
export function withoutComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
    } else if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const comment = src.slice(i, end === -1 ? src.length : end + 2);
      out += comment.replace(/[^\n]/g, " ");
      i = end === -1 ? src.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * The keys at the top level of the object literal that opens at `open`, each
 * with the index where its value starts.
 */
function topLevelKeys(src, open) {
  const keys = new Map();
  let depth = 0;
  let expectKey = true;
  for (let i = open; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, i);
      if (depth === 1 && expectKey && c !== "`") {
        const after = src.slice(end).match(/^\s*:/);
        if (after) keys.set(src.slice(i + 1, end - 1), end + after[0].length);
      }
      expectKey = false;
      i = end;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth += 1;
      expectKey = depth === 1;
    } else if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) return { keys, end: i + 1 };
    } else if (c === "," && depth === 1) {
      expectKey = true;
    } else if (depth === 1 && expectKey && /[A-Za-z_$]/.test(c)) {
      const word = src.slice(i).match(/^[A-Za-z_$][\w$]*/)[0];
      const colon = src.slice(i + word.length).match(/^\s*:/);
      if (colon) keys.set(word, i + word.length + colon[0].length);
      expectKey = false;
      i += word.length;
      continue;
    }
    i += 1;
  }
  return { keys, end: src.length };
}

/**
 * The functions a manifest text declares: every `id: { ... }` whose own keys
 * include all three doors (screen, rest, mcp). Returns `{ ids, excluded }`:
 * `excluded` holds "<id> <door>" for every door written as a literal
 * `{ excluded: ... }` (a door excluded through a helper call is not seen).
 */
export function manifestFunctions(text) {
  const src = withoutComments(text);
  const ids = new Set();
  const excluded = new Set();
  const pattern =
    /(?:^|[{,\s])(?:([A-Za-z_$][\w$]*)|'([^'\n]+)'|"([^"\n]+)")\s*:\s*\{/g;
  for (const m of src.matchAll(pattern)) {
    const open = m.index + m[0].length - 1;
    const { keys } = topLevelKeys(src, open);
    if (!(keys.has("screen") && keys.has("rest") && keys.has("mcp"))) continue;
    const id = m[1] ?? m[2] ?? m[3];
    ids.add(id);
    for (const door of ["screen", "rest", "mcp"])
      if (/^\s*\{\s*excluded\s*:/.test(src.slice(keys.get(door))))
        excluded.add(`${id} ${door}`);
  }
  return { ids, excluded };
}

/** Import and require specifiers of a source text. */
export function importSpecifiers(text) {
  const src = withoutComments(text);
  const out = [];
  for (const m of src.matchAll(
    /\bfrom\s*(['"])([^'"\n]+)\1|\brequire\(\s*(['"])([^'"\n]+)\3\s*\)|\bimport\(\s*(['"])([^'"\n]+)\5\s*\)|^\s*import\s*(['"])([^'"\n]+)\7/gm,
  ))
    out.push(m[2] ?? m[4] ?? m[6] ?? m[8]);
  return out;
}

/** The product-relative paths a specifier may point at (no extension resolution). */
function specifierTargets(fromFile, spec) {
  const dir = path.posix.dirname(fromFile);
  if (spec.startsWith("."))
    return [path.posix.normalize(path.posix.join(dir, spec))];
  if (spec.startsWith("@/")) {
    const rest = spec.slice(2);
    const targets = [rest, `src/${rest}`];
    const parts = dir.split("/");
    for (let n = 1; n <= parts.length; n += 1) {
      const base = parts.slice(0, n).join("/");
      targets.push(`${base}/${rest}`, `${base}/src/${rest}`);
    }
    return targets;
  }
  return [];
}

/** The file a relative specifier resolves to, or null. */
function resolveSource(io, fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), spec),
  );
  const stem = base.replace(/\.(js|mjs|cjs)$/, "");
  for (const candidate of [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.js`,
    `${stem}.mjs`,
    `${stem}.cjs`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ])
    if (io.isFile(candidate)) return candidate;
  return null;
}

/** The parsed `<!-- GENERATED from <manifest> by `<command>` -->` marker, or null. */
export function generatedMarker(text) {
  const m = text.match(/<!-- GENERATED from (\S+) by `([^`]+)`/);
  return m ? { manifest: m[1], command: m[2] } : null;
}

/**
 * The package.json and script an `npm run` command names:
 * `npm run <script>`, `npm run <script> --workspace=<dir>` or
 * `npm run <script> (in <dir>/)`. Null when the command is not one of them.
 */
export function generatorScript(command) {
  const m = command
    .trim()
    .match(
      /^npm run (\S+)(?:\s+--workspace[= ](\S+))?(?:\s+\(in ([^)\s]+?)\/?\))?$/,
    );
  if (!m) return null;
  const dir = (m[2] ?? m[3] ?? "").replace(/\/$/, "");
  return {
    script: m[1],
    packageJson: dir ? `${dir}/package.json` : "package.json",
  };
}

/**
 * What the exclusions doc lists: `ids` (the function ids of the door and the
 * worker table) and `excluded` ("<id> <door>" per row of the door table).
 */
export function exclusionsDocEntries(text) {
  const ids = new Set();
  const excluded = new Set();
  let table = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("## "))
      table = line.startsWith("## Doors deliberately left out")
        ? "doors"
        : line.startsWith("## Worker-triggered routes")
          ? "workers"
          : null;
    const m = table ? line.match(/^\| `([^`]+)` \| ([^|]+?) \|/) : null;
    if (!m) continue;
    ids.add(m[1]);
    if (table === "doors") {
      const door =
        m[2] === "screen"
          ? "screen"
          : m[2] === "MCP tool"
            ? "mcp"
            : m[2].startsWith("REST")
              ? "rest"
              : m[2];
      excluded.add(`${m[1]} ${door}`);
    }
  }
  return { ids, excluded };
}

// --- the blocks ----------------------------------------------------------------

const SAMPLE = 5;
const sample = (hits) =>
  hits.slice(0, SAMPLE).join(", ") +
  (hits.length > SAMPLE ? `, ... (${hits.length} in all)` : "");

/**
 * Runs the core profile against the product at `root`. Returns
 * `{ rows, findings, warnings }`: one row per block (`{ block, status, text }`,
 * status ok | n/a | warn | fail), every failure and every warning as a sentence.
 */
export function coreProfileReport(root) {
  const io = productIo(root);
  const rows = [];
  const findings = [];
  const warnings = [];
  const row = (block, status, text) => rows.push({ block, status, text });
  const failBlock = (block, list, okText) => {
    if (list.length > 0) {
      for (const f of list) findings.push(`[${block}] ${f}`);
      row(
        block,
        "fail",
        `${list.length} finding${list.length === 1 ? "" : "s"}`,
      );
    } else row(block, "ok", okText);
  };
  const warnBlock = (block, label, hits, why, okText) => {
    if (hits.length > 0) {
      warnings.push(`[${block}] ${label}: ${sample(hits)}`);
      row(
        block,
        "warn",
        `${hits.length} hit${hits.length === 1 ? "" : "s"}, not enforced for core products: ${why}`,
      );
    } else row(block, "ok", okText);
  };

  // 1. The door files the product names (replaces the template's file list).
  const { config, problems } = readDoorsConfig(io);
  if (!config) {
    failBlock("1", problems, "");
    row(
      "-",
      "fail",
      "the other blocks need a valid doors.config.json and did not run",
    );
    return { rows, findings, warnings };
  }
  {
    const missing = [];
    for (const key of Object.keys(DOORS_CONFIG_FILES))
      if (!io.isFile(config[key]))
        missing.push(
          `${config[key]} (${key}, ${DOORS_CONFIG_FILES[key]}) does not exist`,
        );
    if (!io.isDir(config.sharedCopy))
      missing.push(`${config.sharedCopy} (sharedCopy) is not a folder`);
    if (
      io.isFile(config.mcpRoute) &&
      !/\bmcp\b/i.test(io.read(config.mcpRoute))
    )
      missing.push(
        `${config.mcpRoute} (mcpRoute) never mentions MCP: is it the MCP door?`,
      );
    if (
      io.isFile(config.openapiRoute) &&
      !/openapi/i.test(io.read(config.openapiRoute))
    )
      missing.push(
        `${config.openapiRoute} (openapiRoute) never mentions OpenAPI: is it the OpenAPI route?`,
      );
    failBlock(
      "1",
      missing,
      `${DOORS_CONFIG_FILE} names ${Object.keys(DOORS_CONFIG_FILES).length} door files and the doors copy; all present`,
    );
    if (missing.length > 0) {
      row(
        "-",
        "fail",
        "the other blocks need the configured files and did not run",
      );
      return { rows, findings, warnings };
    }
  }

  const shared = sharedManifests(io);
  const generated = generatedDirs(shared.found);
  const allFiles = io.list();
  const inGenerated = (rel) => generated.some((dir) => isUnder(rel, dir));
  /** Product source: no tests, docs, CI, environment files or generated copies. */
  const runtime = allFiles.filter(
    (rel) =>
      !isTest(rel) &&
      !isDoc(rel) &&
      !isUnder(rel, ".github") &&
      !isEnvFile(rel) &&
      !inGenerated(rel),
  );
  const runtimeCode = runtime.filter(
    (rel) =>
      CODE_FILE.test(rel) ||
      rel.endsWith(".sh") ||
      /(^|\/)Dockerfile[^/]*$/.test(rel),
  );
  const codeLines = (files, predicate) => {
    const hits = [];
    for (const rel of files) {
      io.read(rel)
        .split("\n")
        .forEach((line, i) => {
          if (!COMMENT_LINE.test(line) && predicate(line))
            hits.push(`${rel}:${i + 1}`);
        });
    }
    return hits;
  };
  const packageFiles = allFiles.filter(
    (rel) => path.posix.basename(rel) === "package.json" && !isTest(rel),
  );
  const dependencies = packageFiles.map((rel) => {
    const pkg = JSON.parse(io.read(rel));
    return { rel, deps: { ...pkg.dependencies, ...pkg.devDependencies } };
  });

  // 2. No environment file tracked (replaces the template's forbidden files).
  {
    const git = spawnSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
    });
    if (git.error || git.status !== 0)
      row("2", "n/a", "not a git checkout: which files are tracked is unknown");
    else {
      const tracked = git.stdout.split("\0").filter(Boolean);
      const env = tracked.filter((rel) => {
        const base = path.posix.basename(rel);
        return (
          /^\.env(\..+)?$/.test(base) &&
          !/\.(example|sample|template)$/.test(base)
        );
      });
      failBlock(
        "2",
        env.map((rel) => `environment file tracked by git: ${rel}`),
        `no environment file tracked (${tracked.length} tracked files)`,
      );
    }
  }

  // 3. CI: the shared quality gates and the shared check at the pinned version.
  {
    const workflows = allFiles.filter(
      (rel) => isUnder(rel, ".github/workflows") && /\.ya?ml$/.test(rel),
    );
    if (workflows.length === 0)
      row("3", "n/a", "no .github/workflows in this product");
    else {
      const out = [];
      const texts = workflows.map((rel) => ({ rel, text: io.read(rel) }));
      if (
        !texts.some(({ text }) =>
          text.includes("beyondles-ai/beyondles-ci/quality-gates@v1"),
        )
      )
        out.push(
          "no workflow calls beyondles-ai/beyondles-ci/quality-gates@v1",
        );
      const checks = texts.flatMap(({ rel, text }) =>
        [
          ...text.matchAll(
            /beyondles-ai\/beyondles-shared\/check@([^\s"'#]+)/g,
          ),
        ].map((m) => ({ rel, ref: m[1] })),
      );
      if (checks.length === 0)
        out.push(
          `no workflow runs beyondles-ai/beyondles-shared/check@v${DOORS_PIN_VERSION}`,
        );
      for (const { rel, ref } of checks)
        if (ref !== `v${DOORS_PIN_VERSION}`)
          out.push(
            `${rel} runs beyondles-shared/check@${ref}, the pinned version is v${DOORS_PIN_VERSION}`,
          );
      failBlock(
        "3",
        out,
        `quality-gates@v1 and ${checks.length} shared check step${checks.length === 1 ? "" : "s"} at v${DOORS_PIN_VERSION}`,
      );
    }
  }

  // 4. No AI provider SDK or key; mail SDKs and settings are reported.
  {
    const out = [];
    for (const { rel, deps } of dependencies)
      for (const sdk of AI_PROVIDER_SDKS)
        if (deps[sdk])
          out.push(
            `${rel} depends on ${sdk} (AI goes through the platform door)`,
          );
    for (const hit of codeLines(runtimeCode, (line) =>
      AI_PROVIDER_ENV.test(line),
    ))
      out.push(
        `${hit} reads an AI provider key (keys live on the platform only)`,
      );
    for (const hit of codeLines(runtimeCode, (line) => RETIRED_ENV.test(line)))
      out.push(
        `${hit} uses the retired PLATFORM_SSO_URL (NEXT_PUBLIC_PLATFORM_URL)`,
      );
    failBlock(
      "4",
      out,
      `no AI provider SDK or key in ${packageFiles.length} package.json and ${runtimeCode.length} source files`,
    );
    const mail = [
      ...dependencies.flatMap(({ rel, deps }) =>
        MAIL_SDKS.filter((sdk) => deps[sdk]).map((sdk) => `${rel}: ${sdk}`),
      ),
      ...codeLines(runtimeCode, (line) => MAIL_ENV.test(line)),
    ];
    if (mail.length > 0) {
      warnings.push(
        `[4] mail sent by the product itself, not through the platform mail door: ${sample(mail)}`,
      );
      row(
        "4",
        "warn",
        `${mail.length} mail SDK/setting hit${mail.length === 1 ? "" : "s"} (Lab rule "mail through the door" not enforced for core products)`,
      );
    }
  }

  // 5, 5b. Lab sign-in variables and the Lab's tenant deletion route.
  row(
    "5",
    "n/a",
    "Lab sign-in variables (.env.example, JWT_SECRET): a core product owns its sign-in; the Suite issues the session",
  );
  row(
    "5b",
    "n/a",
    "the Lab's tenant deletion route and PLATFORM_DELETE_KEY: core products have their own deletion paths (card #335)",
  );

  // 5c. One door implementation: the machine door uses the shared doors code.
  {
    const specs = importSpecifiers(io.read(config.machineDoor));
    const fromShared = specs.filter((spec) =>
      specifierTargets(config.machineDoor, spec).some((target) =>
        isUnder(target.replace(/\.(js|mjs|cjs|ts)$/, ""), config.sharedCopy),
      ),
    );
    failBlock(
      "5c",
      fromShared.length > 0
        ? []
        : [
            `${config.machineDoor} imports nothing from ${config.sharedCopy}: the machine door must use the shared doors code`,
          ],
      `${config.machineDoor} imports ${fromShared.length} module${fromShared.length === 1 ? "" : "s"} of the shared copy`,
    );
  }

  // 5d. The shared copy: declared in .beyondles-shared.json, pinned version, byte for byte.
  {
    const out = [...shared.problems];
    const declared = shared.found.flatMap(({ file, dir, data }) =>
      (data.modules ?? [])
        .filter((m) => m.name === "doors")
        .map((m) => ({
          file,
          data,
          module: m,
          dest: dir ? `${dir}/${m.dest}` : m.dest,
        })),
    );
    const match = declared.find((d) => d.dest === config.sharedCopy);
    let flavour = config.variant ?? "ts";
    if (!match)
      out.push(
        `no .beyondles-shared.json declares the module doors with dest ${config.sharedCopy}`,
      );
    else {
      if (match.data.version !== DOORS_PIN_VERSION)
        out.push(
          `${match.file} declares version ${JSON.stringify(match.data.version)}, the pinned version is ${DOORS_PIN_VERSION}`,
        );
      if ((match.module.variant ?? undefined) !== (config.variant ?? undefined))
        out.push(
          `${match.file} declares doors with variant ${JSON.stringify(match.module.variant ?? null)}, ${DOORS_CONFIG_FILE} says ${JSON.stringify(config.variant ?? null)}`,
        );
      if (match.module.importSuffix !== undefined && !match.module.variant)
        flavour = `ts+${match.module.importSuffix}`;
    }
    out.push(...doorsPinFindings(io, config.sharedCopy, flavour));
    failBlock(
      "5d",
      out,
      `${config.sharedCopy} is doors ${DOORS_PIN_VERSION} (${flavour}), byte for byte`,
    );
  }

  // 6. Sign-in never hard-codes the production Suite for /api/auth/me.
  failBlock(
    "6",
    codeLines(runtimeCode, (line) =>
      line.includes("beyondles.ai/api/auth/me"),
    ).map((hit) => `${hit} hard-codes the Suite address for /api/auth/me`),
    "no hard-coded Suite address for /api/auth/me",
  );
  row(
    "6b",
    "n/a",
    "self-registration at the platform registry is how a Lab appears in the Suite; core products are fixed entries",
  );

  // 7. Both languages carry the same keys; 7b. formal "Sie" (reported).
  {
    const dirs = [
      ...new Set(
        allFiles
          .filter(
            (rel) =>
              /(^|\/)messages\/(de|en)\.json$/.test(rel) &&
              !isTest(rel) &&
              !inGenerated(rel),
          )
          .map((rel) => path.posix.dirname(rel)),
      ),
    ]
      .filter(
        (dir) => io.isFile(`${dir}/de.json`) && io.isFile(`${dir}/en.json`),
      )
      .sort();
    if (dirs.length === 0)
      row("7", "n/a", "no messages/ folder with de.json and en.json");
    else {
      const out = [];
      const informal = [];
      for (const dir of dirs) {
        const de = JSON.parse(io.read(`${dir}/de.json`));
        const en = JSON.parse(io.read(`${dir}/en.json`));
        const deKeys = new Set(messageKeys(de));
        const enKeys = new Set(messageKeys(en));
        const onlyDe = [...deKeys].filter((k) => !enKeys.has(k));
        const onlyEn = [...enKeys].filter((k) => !deKeys.has(k));
        if (onlyDe.length + onlyEn.length > 0)
          out.push(
            `${dir}/de.json and en.json differ: only German ${sample(onlyDe) || "-"}; only English ${sample(onlyEn) || "-"}`,
          );
        for (const { key, hits } of informalAddressFindings(de))
          informal.push(`${dir}/de.json "${key}" (${hits.join(", ")})`);
      }
      failBlock(
        "7",
        out,
        `${dirs.join(", ")}: German and English carry the same keys`,
      );
      warnBlock(
        "7b",
        "German text that reads as informal address",
        informal,
        "the product keeps its own formal-address test with reasoned exceptions",
        'German addresses the reader with "Sie"',
      );
    }
  }

  // 8. The manifest is not empty and the exclusions doc is current (replaces the template name).
  {
    const out = [];
    const sources = [config.manifest];
    for (const spec of importSpecifiers(io.read(config.manifest))) {
      const file = resolveSource(io, config.manifest, spec);
      if (file && !isUnder(file, config.sharedCopy) && !sources.includes(file))
        sources.push(file);
    }
    const declared = sources.map((rel) => manifestFunctions(io.read(rel)));
    const ids = new Set(declared.flatMap((d) => [...d.ids]));
    const excludedDoors = new Set(declared.flatMap((d) => [...d.excluded]));
    if (ids.size === 0)
      out.push(
        `${config.manifest} declares no function (no entry with screen, rest and mcp in ${sources.join(", ")})`,
      );

    const doc = io.read(config.exclusionsDoc);
    const marker = generatedMarker(doc);
    if (!marker)
      out.push(
        `${config.exclusionsDoc} has no "<!-- GENERATED from <manifest> by \`<command>\`" line: it must be generated from the manifest`,
      );
    else {
      if (marker.manifest !== config.manifest)
        out.push(
          `${config.exclusionsDoc} says it is generated from ${marker.manifest}, the manifest is ${config.manifest}`,
        );
      const generator = generatorScript(marker.command);
      if (generator) {
        const pkg = io.isFile(generator.packageJson)
          ? JSON.parse(io.read(generator.packageJson))
          : null;
        if (!pkg?.scripts?.[generator.script])
          out.push(
            `${config.exclusionsDoc} names \`${marker.command}\`, but ${generator.packageJson} has no script "${generator.script}"`,
          );
      } else
        row(
          "8",
          "n/a",
          `generator \`${marker.command}\` is not an npm script: only the parity test holds the doc current`,
        );
      const listed = exclusionsDocEntries(doc);
      const gone = [...listed.ids].filter((id) => !ids.has(id));
      if (gone.length > 0 && ids.size > 0)
        out.push(
          `${config.exclusionsDoc} lists ${sample(gone)}, which the manifest does not declare: the doc is stale, run \`${marker.command}\``,
        );
      const unlisted = [...excludedDoors].filter(
        (entry) => !listed.excluded.has(entry),
      );
      if (unlisted.length > 0)
        out.push(
          `${config.exclusionsDoc} misses the exclusions ${sample(unlisted)} of the manifest: the doc is stale, run \`${marker.command}\``,
        );
    }
    const parity = withoutComments(io.read(config.parityTest));
    if (
      !/\bstaleExclusions\s*\(/.test(parity) ||
      !parity.includes(path.posix.basename(config.exclusionsDoc))
    )
      out.push(
        `${config.parityTest} does not compare ${config.exclusionsDoc} with the manifest (staleExclusions from the shared doors)`,
      );
    failBlock(
      "8",
      out,
      `${ids.size} functions in ${sources.length} manifest file${sources.length === 1 ? "" : "s"}; ${config.exclusionsDoc} generated from it and held by ${config.parityTest}`,
    );
  }

  // 9, 10, 11. Lab learnings, reported for the core products.
  warnBlock(
    "9",
    "swallowed failure",
    codeLines(runtimeCode, (line) =>
      SWALLOW.some(([pattern]) => pattern.test(line)),
    ),
    "lab learnings rule 2 (no empty catch, no `|| true`)",
    "no swallowed failure",
  );
  warnBlock(
    "10",
    "doc neither generated nor dated",
    allFiles
      .filter(
        (rel) =>
          rel.startsWith("docs/") &&
          rel.endsWith(".md") &&
          rel !== config.exclusionsDoc,
      )
      .filter((rel) => {
        const text = io.read(rel);
        return (
          !/^Checked on: \d{4}-\d{2}-\d{2}\s*$/m.test(text) &&
          !text.includes("<!-- GENERATED")
        );
      }),
    'lab learnings rule 9 ("Checked on: YYYY-MM-DD" or generated)',
    "every doc is generated or dated",
  );
  warnBlock(
    "11",
    "PLATFORM_LLM_* named in product code",
    codeLines(runtimeCode, (line) => /\bPLATFORM_LLM_[A-Z0-9_]+/.test(line)),
    "lab learnings rule 10 (model choice and keys live on the platform)",
    "no PLATFORM_LLM_* setting",
  );

  // 12. Third-party images pinned by digest (a warning, as in profile lab).
  {
    const dockerfiles = runtime.filter((rel) =>
      /(^|\/)Dockerfile[^/]*$/.test(rel),
    );
    const composeFiles = runtime.filter((rel) =>
      /(^|\/)[^/]*compose[^/]*\.ya?ml$/.test(rel),
    );
    const workflows = allFiles.filter(
      (rel) => isUnder(rel, ".github/workflows") && /\.ya?ml$/.test(rel),
    );
    if (dockerfiles.length + composeFiles.length === 0)
      row("12", "n/a", "no Dockerfile or Compose file");
    else {
      const names = new Set(
        dependencies
          .map(({ rel }) => JSON.parse(io.read(rel)).name)
          .filter(Boolean),
      );
      const unpinned = [];
      for (const rel of dockerfiles) {
        const text = io.read(rel);
        const stages = new Set(
          [...text.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)].map((m) =>
            m[1].toLowerCase(),
          ),
        );
        for (const m of text.matchAll(/^FROM\s+(\S+)/gim))
          if (!stages.has(m[1].toLowerCase()) && !m[1].includes("@sha256:"))
            unpinned.push(`${rel}: FROM ${m[1]}`);
      }
      for (const rel of [...composeFiles, ...workflows])
        for (const m of io.read(rel).matchAll(/^\s+image:\s*(\S+)/gm)) {
          const own =
            m[1].startsWith("${") ||
            [...names].some((name) => m[1].startsWith(`${name}-`));
          if (!own && !m[1].includes("@sha256:"))
            unpinned.push(`${rel}: image ${m[1]}`);
        }
      if (unpinned.length > 0) {
        warnings.push(`[12] not pinned by digest: ${sample(unpinned)}`);
        row(
          "12",
          "warn",
          `${unpinned.length} third-party image${unpinned.length === 1 ? "" : "s"} not pinned by digest (a warning in both profiles)`,
        );
      } else row("12", "ok", "third-party images pinned by digest");
    }
  }

  // 13. Closed pages: the shared frame app-shell is declared; light only.
  {
    const out = [];
    const appShell = shared.found.filter(({ data }) =>
      (data.modules ?? []).some((m) => m.name === "app-shell"),
    );
    if (appShell.length === 0)
      out.push(
        "no .beyondles-shared.json declares the module app-shell (the shared frame of the closed pages)",
      );
    for (const { rel, deps } of dependencies)
      if (deps["next-themes"])
        out.push(`${rel} depends on next-themes: light only, no theme switch`);
    const ui = runtime.filter(
      (rel) =>
        /\.(tsx|jsx|css|ts|js|mjs)$/.test(rel) &&
        !/(^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(rel),
    );
    for (const rel of ui) {
      const text = withoutComments(io.read(rel));
      text.split("\n").forEach((line, i) => {
        for (const [pattern, what] of DARK_MODE)
          if (pattern.test(line)) out.push(`${rel}:${i + 1}: ${what}`);
      });
    }
    failBlock(
      "13",
      out,
      `app-shell declared in ${appShell.map(({ file }) => file).join(", ")}; no dark mode in ${ui.length} UI files`,
    );
  }

  row(
    "14",
    "n/a",
    "the memory door (card #377) is how a Lab writes into The Brain; it is not part of the core profile",
  );

  return { rows, findings, warnings };
}

/** Prints the report of `coreProfileReport` and returns the exit code. */
export function runCoreProfile(root) {
  const { rows, findings, warnings } = coreProfileReport(root);
  console.log(`Frame check, profile core: ${root}`);
  for (const { block, status, text } of rows)
    console.log(`  ${block.padEnd(3)} ${status.padEnd(4)}  ${text}`);
  if (warnings.length > 0)
    console.warn(
      "Frame check warnings:\n" + warnings.map((w) => `  - ${w}`).join("\n"),
    );
  if (findings.length > 0) {
    console.error(
      "Frame check (core) FAILED:\n" +
        findings.map((f) => `  - ${f}`).join("\n"),
    );
    return 1;
  }
  console.log("Frame check (core) passed.");
  return 0;
}
