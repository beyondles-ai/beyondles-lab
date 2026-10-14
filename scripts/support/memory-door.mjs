/**
 * The memory door rule (card #377, docs/FRAME.md 4a): every Lab carries the
 * shared Brain client and says, per function, what it does with The Brain.
 *
 * Used by `npm run check:frame` (block 14) and by
 * tests/unit/memory-door.test.ts, so both read the same rule:
 *
 *  1. `.beyondles-shared.json` declares the module `brain-client` with dest
 *     `src/lib/brain-client`, and the copy is there. A Lab without the client
 *     fails: the client is mandatory, also for a Lab that only reads.
 *  2. `src/lib/platform/memory.ts` (the Lab's wrapper) is there and builds
 *     the client from the shared module.
 *  3. Every entry of `FUNCTIONS` in `src/server/functions.manifest.ts`
 *     declares `memory`: `{ writes: [...kinds], reads: boolean }` or
 *     `{ excluded: "<reason>" }`. Kinds are fact, decision, event, task, text.
 *  4. When any function writes, every delete path calls forget: the tenant
 *     deletion, the person deletion, and every service file of a writing
 *     function that deletes rows.
 *
 * Text only, no TypeScript import: the frame check runs with plain Node.
 * The manifest scanner skips strings and comments, so a route path such as
 * `/api/v1/notes/{noteId}` is no brace.
 */

export const MEMORY_KINDS = ["fact", "decision", "event", "task", "text"];

const MANIFEST = "src/server/functions.manifest.ts";
const WRAPPER = "src/lib/platform/memory.ts";
const CLIENT_DEST = "src/lib/brain-client";
const DELETE_PATHS = ["src/server/services/platform-delete.ts", "src/server/services/platform-delete-member.ts"];
/** The wrapper's forget functions (src/lib/platform/memory.ts). */
const FORGET_CALL = /\b(forgetMemory|forgetMemoryMany|forgetDeletedObjects)\s*\(/;
/** A statement that removes rows. */
const DELETE_STATEMENT = /\.(delete|deleteMany)\s*\(|\bDELETE\s+FROM\b/i;

/** Index after the string literal that starts at `i` (quote at `i`). */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") j += 2;
    else if (src[j] === quote) return j + 1;
    else j += 1;
  }
  return src.length;
}

/** Index after the comment that starts at `i`, or `i` when there is none. */
function skipComment(src, i) {
  if (src[i] !== "/") return i;
  if (src[i + 1] === "/") {
    const end = src.indexOf("\n", i);
    return end === -1 ? src.length : end;
  }
  if (src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

/** The balanced `{...}` that starts at `open`, or null. */
function balancedObject(src, open) {
  if (src[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < src.length; ) {
    const after = skipComment(src, i);
    if (after !== i) {
      i = after;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{") depth += 1;
    if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
    i += 1;
  }
  return null;
}

/**
 * The entries of an object literal: `[{ name, props: Map<key, valueText> }]`,
 * one per `name: { ... }` member, with the entry's own keys and the raw text
 * of their values. `body` is the literal including its braces.
 */
export function objectEntries(body) {
  const entries = [];
  let depth = 0;
  let pendingName = null;
  let entry = null;
  let prop = null;
  let propStart = 0;
  const closeProp = (end) => {
    if (entry && prop) entry.props.set(prop, body.slice(propStart, end).trim());
    prop = null;
  };
  for (let i = 0; i < body.length; ) {
    const after = skipComment(body, i);
    if (after !== i) {
      i = after;
      continue;
    }
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(body, i);
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      if (depth === 1 && c === "{" && pendingName) {
        entry = { name: pendingName, props: new Map() };
        entries.push(entry);
      }
      pendingName = null;
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      if (depth === 2 && c === "}") {
        closeProp(i);
        entry = null;
      }
      depth -= 1;
      i += 1;
      continue;
    }
    if (c === "," && depth === 2) {
      closeProp(i);
      i += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c) && (depth === 1 || (depth === 2 && entry && !prop))) {
      const match = /^[A-Za-z_$][\w$]*/.exec(body.slice(i));
      const name = match[0];
      let j = i + name.length;
      while (/\s/.test(body[j] ?? "")) j += 1;
      if (body[j] === ":") {
        if (depth === 1) pendingName = name;
        else {
          prop = name;
          propStart = j + 1;
        }
        i = j + 1;
        continue;
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return entries;
}

/** The text of `export const FUNCTIONS = { ... }`, or null. */
function functionsLiteral(manifest) {
  const at = /export\s+const\s+FUNCTIONS\b[^=]*=\s*/.exec(manifest);
  if (!at) return null;
  return balancedObject(manifest, at.index + at[0].length);
}

/** A constant's object literal (`const NAME: Type = { ... }`), or null. */
function constantObject(manifest, name) {
  const at = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*`).exec(manifest);
  if (!at) return null;
  return balancedObject(manifest, at.index + at[0].length);
}

/** The strings inside `[...]`. */
function stringList(text) {
  return [...text.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
}

/**
 * What one `memory` value declares: `{ kind: "excluded" | "door" | "invalid",
 * writes: string[], problem?: string }`.
 */
export function readMemoryDoor(value, manifest) {
  let text = value.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    const resolved = constantObject(manifest, text);
    if (!resolved) return { kind: "invalid", writes: [], problem: `names ${text}, which is no object constant in the manifest` };
    text = resolved;
  }
  if (!text.startsWith("{")) return { kind: "invalid", writes: [], problem: "is not an object" };
  const excluded = /\bexcluded\s*:\s*(["'`])([\s\S]*?)\1/.exec(text);
  if (excluded) {
    if (excluded[2].trim().length < 10) return { kind: "invalid", writes: [], problem: "excludes without a written reason" };
    return { kind: "excluded", writes: [] };
  }
  const writes = /\bwrites\s*:\s*\[([^\]]*)\]/.exec(text);
  const reads = /\breads\s*:\s*(true|false)\b/.exec(text);
  if (!writes || !reads) return { kind: "invalid", writes: [], problem: "needs writes: [...] and reads: true|false, or excluded: \"<reason>\"" };
  const kinds = stringList(writes[1]);
  const unknown = kinds.filter((k) => !MEMORY_KINDS.includes(k));
  if (unknown.length > 0) return { kind: "invalid", writes: kinds, problem: `writes unknown kinds ${unknown.join(", ")} (allowed: ${MEMORY_KINDS.join(", ")})` };
  return { kind: "door", writes: kinds };
}

/** Code without line comments and block comments, so a comment may name a rule. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The findings of the memory door rule. `io` = `{ read(rel), exists(rel) }`
 * with paths relative to the repo root.
 */
export function memoryDoorFindings(io) {
  const findings = [];
  const fail = (message) => findings.push(message);

  // 1. The shared client.
  let shared = {};
  try {
    shared = io.exists(".beyondles-shared.json") ? JSON.parse(io.read(".beyondles-shared.json")) : {};
  } catch {
    fail(".beyondles-shared.json is not valid JSON");
  }
  if (!(shared.modules ?? []).some((m) => m.name === "brain-client" && m.dest === CLIENT_DEST))
    fail(`.beyondles-shared.json has no module { "name": "brain-client", "dest": "${CLIENT_DEST}" } (the Brain client is mandatory)`);
  for (const rel of [`${CLIENT_DEST}/index.ts`, `${CLIENT_DEST}/client.ts`, `${CLIENT_DEST}/.shared-version`]) {
    if (!io.exists(rel)) fail(`missing ${rel}: sync the brain-client module from beyondles-shared`);
  }

  // 2. The wrapper.
  if (!io.exists(WRAPPER)) fail(`missing ${WRAPPER} (the Lab's memory door on the shared client)`);
  else if (!/\bcreateBrainClient\s*\(/.test(code(io.read(WRAPPER))) || !/["']@\/lib\/brain-client["']/.test(io.read(WRAPPER)))
    fail(`${WRAPPER} does not build its client with createBrainClient from @/lib/brain-client`);

  // 3. Every function declares its memory door.
  if (!io.exists(MANIFEST)) {
    fail(`missing ${MANIFEST}`);
    return findings;
  }
  const manifest = io.read(MANIFEST);
  const literal = functionsLiteral(manifest);
  if (!literal) {
    fail(`${MANIFEST} has no "export const FUNCTIONS = { ... }"`);
    return findings;
  }
  const entries = objectEntries(literal);
  if (entries.length === 0) fail(`${MANIFEST}: FUNCTIONS lists no function`);
  const writingServices = new Set();
  for (const entry of entries) {
    const value = entry.props.get("memory");
    if (value === undefined) {
      fail(`${MANIFEST}: ${entry.name} declares no memory door (memory: { writes, reads } or { excluded: "<reason>" })`);
      continue;
    }
    const door = readMemoryDoor(value, manifest);
    if (door.kind === "invalid") fail(`${MANIFEST}: ${entry.name}.memory ${door.problem}`);
    if (door.writes.length > 0) {
      const service = /^["'`]([^"'`]+)["'`]$/.exec(entry.props.get("service") ?? "")?.[1];
      if (service) writingServices.add(`src/server/services/${service}.ts`);
    }
  }

  // 4. Writes need forgets on every delete path.
  if (writingServices.size > 0) {
    for (const rel of DELETE_PATHS) {
      if (io.exists(rel) && !FORGET_CALL.test(code(io.read(rel))))
        fail(`${rel} deletes without forgetting in The Brain (call forgetMemory/forgetMemoryMany from ${WRAPPER})`);
    }
    for (const rel of writingServices) {
      if (!io.exists(rel)) continue;
      const text = code(io.read(rel));
      if (DELETE_STATEMENT.test(text) && !FORGET_CALL.test(text))
        fail(`${rel} writes to The Brain and deletes rows, but never forgets (call forgetDeletedObjects after the delete)`);
    }
  }
  return findings;
}
