import type { FoundRoute, ParitySources } from "../parity";
import { dirnameOf, joinPath, type SourceFiles } from "./source-files";

/**
 * Reads the REST routes of an Express product for `parityProblems` (new for #383; The Brain API is
 * CommonJS JavaScript, the Beyondles HorAIzon API is TypeScript with NodeNext).
 *
 * What it finds, by reading source text (nothing is imported or executed):
 *  - route registrations `<receiver>.<get|post|put|patch|delete>("<path>", ...)` (also with type
 *    arguments, `router.get<P>(...)`) where the receiver is `router`, `app` (both configurable) or
 *    a local router of the same file: `<name> = Router(...)`, `express.Router(...)` or
 *    `require("express").Router(...)`, with or without a type annotation (`const x: Router = ...`);
 *  - in each registration's argument list, the door call `openMachineDoor(req, "<functionId>")`
 *    (also `openMachineDoor(request, "<id>")`; the call name is configurable): that is `opens`;
 *  - mounts `<receiver>.use("<prefix>", ..., <router>)`, where the LAST argument is the router: an
 *    identifier or a call of one (`createBrainRoutes(pool)`) imported from a scanned file
 *    (`import x from "./routes/x.js"`, `import { a } from ...`, `const { x } = require("./routes/x")`),
 *    an inline `require("./routes/x")`, or a local router of the same file. Prefixes of nested
 *    mounts are joined, a router mounted twice yields its routes twice, Express parameters become
 *    OpenAPI parameters (`/:id` -> `/{id}`).
 *  - a mount is tied to the BINDING it imports: the route file's exports (`export const x =
 *    Router()`, `export default router`, `export { a as b }`, `module.exports = router`,
 *    `module.exports = { a, b: c }`, `exports.a = router`) name the router behind each binding, so a
 *    file that exports two routers gives each its own prefix, and a middleware of a route file
 *    mounted elsewhere lends its prefix to no router. When the binding cannot be tied to a router
 *    (a factory call `createRoutes(pool)`, an export the reader cannot follow) the prefix goes to
 *    every router of the file; with two or more routers in that file this is said in `unresolved`.
 * Registrations on an app receiver (`app.get("/api/health", ...)`) are absolute, also inside a
 * file that gets `app` passed in.
 *
 * Honest limits. What the reader cannot place is listed in `unresolved`, so a product test can
 * pin it:
 *  - a path or prefix that is not a plain string literal (a template with `${}`, an array of
 *    paths); a VARIABLE as the first argument of `.use(...)` cannot be told from a middleware and
 *    is read as one, so the router lands at `/` (NOT listed: the one silent limit);
 *  - `<router>.route("/x")...`, `<router>.all(...)`, `.head(...)` and `.options(...)` on a known
 *    router (listed, not read);
 *  - a call that looks like a route (`<name>.<method>("/...", <function>)`) on a receiver that is
 *    not a known router, also a member one (`this.router.get(...)`);
 *  - a `routeDirs` folder without source files (a typo or a moved folder);
 *  - a file whose routes are registered on a router but which no literal mount reaches (its routes
 *    are listed WITHOUT a prefix, so parity reports them rather than hiding them).
 * Not listed, by design: a mount whose router is a member expression (`routes.tasks`) or comes from
 * a file outside the scanned folders (taken for middleware), a handler defined elsewhere and passed
 * by name (the door call must be written inside the registration's argument list), and a door call
 * whose function id is not a string literal (the route then has `opens: null`, which parity
 * reports).
 */

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
/** Members of a known router that register routes this reader does not read: listed in `unresolved`. */
const UNREAD_MEMBERS = ["all", "head", "options", "route"] as const;

export interface ExpressOptions {
  files: SourceFiles;
  /** Files that mount routers and may register routes themselves (`api/src/server.js`, `api/src/index.ts`). */
  entryFiles: readonly string[];
  /** Folders whose files are route files (`api/src/routes`). Mount targets must be among the scanned files. */
  routeDirs?: readonly string[];
  /** Which files of `routeDirs` are read. Default: `.js`, `.cjs`, `.mjs`, `.ts`, `.mts`, `.cts`, not `.d.ts`. */
  sourceFile?: RegExp;
  /** The door call. Default `openMachineDoor`. */
  doorCall?: string;
  /** Names of the request argument of the door call. Default `req`, `request`. */
  requestNames?: readonly string[];
  /** Receivers whose `.get(...)` etc. are route registrations. Default `router`, `app`. */
  routerNames?: readonly string[];
  /** Receivers whose registrations and mounts are absolute. Default `app`. */
  appNames?: readonly string[];
}

export interface ExpressRoutes {
  routes: FoundRoute[];
  /** One sentence per registration or mount the reader could not resolve statically. */
  unresolved: string[];
}

/* ------------------------------------------------------------------ tokens */

export type ExpressToken =
  | { kind: "word"; value: string; start: number; end: number }
  | { kind: "string"; value: string; start: number; end: number }
  | { kind: "template"; value: string; dynamic: boolean; start: number; end: number }
  | { kind: "regex"; start: number; end: number }
  | { kind: "punct"; value: string; start: number; end: number };

type Token = ExpressToken;

const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);
const REGEX_AFTER_PUNCT = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

/**
 * The tokens of a JavaScript or TypeScript text: words, string literals, template literals,
 * regular expressions and punctuation. Comments are skipped. Not a parser: enough to find calls,
 * their arguments and their string literals without being fooled by comments or strings.
 */
export function tokenize(text: string): ExpressToken[] {
  const tokens: Token[] = [];
  const braces: Array<"code" | "template"> = [];
  /** The open template literals, as indexes of their (already emitted) tokens. */
  const openTemplates: number[] = [];
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const length = text.length;
  const isWordChar = (char: string) => /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) >= 0x80;

  const regexAllowed = () => {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.kind === "punct") {
      // `n++ / 2`, `n-- / 2`: a postfix operator ends an expression, so `/` divides.
      const before = tokens[tokens.length - 2];
      if (
        (last.value === "+" || last.value === "-") &&
        before?.kind === "punct" &&
        before.value === last.value &&
        before.end === last.start
      ) {
        return false;
      }
      return REGEX_AFTER_PUNCT.has(last.value);
    }
    if (last.kind === "word") return REGEX_AFTER_WORD.has(last.value);
    return false;
  };

  /** Reads template text from `index` to the closing backtick or `${`. */
  const templateChunk = (): { raw: string; opened: boolean } => {
    let raw = "";
    while (index < length) {
      const char = text[index] as string;
      if (char === "\\") {
        raw += text.slice(index, index + 2);
        index += 2;
      } else if (char === "`") {
        index += 1;
        return { raw, opened: false };
      } else if (char === "$" && text[index + 1] === "{") {
        index += 2;
        return { raw, opened: true };
      } else {
        raw += char;
        index += 1;
      }
    }
    return { raw, opened: false };
  };

  while (index < length) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? length : end;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? length : end + 2;
    } else if (char === '"' || char === "'") {
      const start = index;
      index += 1;
      let value = "";
      while (index < length && text[index] !== char && text[index] !== "\n") {
        if (text[index] === "\\") {
          value += text[index + 1] ?? "";
          index += 2;
        } else {
          value += text[index];
          index += 1;
        }
      }
      index += 1;
      tokens.push({ kind: "string", value, start, end: index });
    } else if (char === "`") {
      const start = index;
      index += 1;
      const chunk = templateChunk();
      if (chunk.opened) {
        braces.push("template");
        // Emitted at its START, so a call argument that begins with a template begins with it.
        openTemplates.push(tokens.length);
        tokens.push({ kind: "template", value: chunk.raw, dynamic: true, start, end: index });
      } else {
        tokens.push({ kind: "template", value: chunk.raw, dynamic: false, start, end: index });
      }
    } else if (char === "/" && regexAllowed()) {
      const start = index;
      index += 1;
      let inClass = false;
      while (index < length && text[index] !== "\n") {
        const current = text[index];
        if (current === "\\") {
          index += 2;
        } else if (current === "[") {
          inClass = true;
          index += 1;
        } else if (current === "]") {
          inClass = false;
          index += 1;
        } else if (current === "/" && !inClass) {
          break;
        } else {
          index += 1;
        }
      }
      index += 1;
      while (index < length && isWordChar(text[index] as string)) index += 1;
      tokens.push({ kind: "regex", start, end: index });
    } else if (isWordChar(char)) {
      const start = index;
      while (index < length && isWordChar(text[index] as string)) index += 1;
      tokens.push({ kind: "word", value: text.slice(start, index), start, end: index });
    } else if (char === "{") {
      braces.push("code");
      tokens.push({ kind: "punct", value: char, start: index, end: index + 1 });
      index += 1;
    } else if (char === "}") {
      const opened = braces.pop();
      if (opened === "template") {
        index += 1;
        const chunk = templateChunk();
        const at = openTemplates[openTemplates.length - 1];
        const open = at === undefined ? undefined : tokens[at];
        if (open && open.kind === "template") {
          open.value += "${…}" + chunk.raw;
          open.end = index;
        }
        if (chunk.opened) braces.push("template");
        else openTemplates.pop();
      } else {
        tokens.push({ kind: "punct", value: char, start: index, end: index + 1 });
        index += 1;
      }
    } else {
      tokens.push({ kind: "punct", value: char, start: index, end: index + 1 });
      index += 1;
    }
  }
  return tokens;
}

/* ---------------------------------------------------------------- helpers */

const isPunct = (token: Token | undefined, value: string): boolean =>
  token !== undefined && token.kind === "punct" && token.value === value;
const isWord = (token: Token | undefined, value?: string): token is Extract<Token, { kind: "word" }> =>
  token !== undefined && token.kind === "word" && (value === undefined || token.value === value);

/** The literal text of a string or a template without `${}`; null for anything else. */
function literal(tokens: readonly Token[]): string | null {
  if (tokens.length !== 1) return null;
  const only = tokens[0] as Token;
  if (only.kind === "string") return only.value;
  if (only.kind === "template" && !only.dynamic) return only.value;
  return null;
}

/**
 * From the `(` at `open`, the index of its matching `)` and the top-level arguments as token
 * ranges. Returns null when the call is not closed.
 */
function callArguments(tokens: readonly Token[], open: number): { close: number; args: Token[][] } | null {
  let depth = 0;
  const args: Token[][] = [];
  let current: Token[] = [];
  for (let at = open; at < tokens.length; at += 1) {
    const token = tokens[at] as Token;
    if (token.kind === "punct" && (token.value === "(" || token.value === "[" || token.value === "{")) {
      depth += 1;
      if (depth === 1) continue;
    } else if (token.kind === "punct" && (token.value === ")" || token.value === "]" || token.value === "}")) {
      depth -= 1;
      if (depth === 0) {
        if (current.length > 0) args.push(current);
        return { close: at, args };
      }
    } else if (depth === 1 && isPunct(token, ",")) {
      args.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  return null;
}

function normalisePosix(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/** Express path to OpenAPI form: `:id` (also `:id?`, `:id(\\d+)`) -> `{id}`. */
export function expressPathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?\??/g, "{$1}");
}

/** Joins a mount prefix and a route path the way Express does. */
export function joinExpressPath(prefix: string, path: string): string {
  const head = prefix.replace(/\/+$/, "");
  if (path === "" || path === "/") return head || "/";
  return `${head}${path.startsWith("/") ? path : `/${path}`}`;
}

/* --------------------------------------------------------------- the file */

interface Registration {
  receiver: string;
  method: string;
  path: string | null;
  opens: string | null;
  line: number;
}

/** What a mount points at, after specifiers are resolved. `binding` = the export it imports. */
type MountTarget =
  | { kind: "file"; file: string; binding: string | null; called: boolean }
  | { kind: "local"; name: string };

/** A mount target as written in the file, before specifiers are resolved. */
type RawMountTarget =
  | { kind: "local"; name: string }
  | { kind: "import"; name: string; called: boolean }
  | { kind: "spec"; spec: string; called: boolean };

interface Mount {
  from: string;
  receiver: string;
  prefix: string | null;
  target: MountTarget;
  line: number;
}

/** A local name bound by `import` or `require`: the module specifier and the export it names. */
interface ImportBinding {
  spec: string;
  /** `default` for a default import or a whole `require(...)`, `*` for a namespace, else the export name. */
  binding: string;
}

interface FileFacts {
  registrations: Registration[];
  mounts: Array<Omit<Mount, "from" | "target"> & { target: RawMountTarget }>;
  imports: Map<string, ImportBinding>;
  localRouters: Set<string>;
  /** Export name (`default` for `export default` / `module.exports =`) to the local name behind it; null = not a plain name. */
  exports: Map<string, string | null>;
  /** Things this file registers that the reader cannot place, without the file name. */
  notes: string[];
}

type WordToken = Extract<Token, { kind: "word" }>;

function lineOf(text: string, at: number): number {
  let line = 1;
  for (let i = 0; i < at && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Local names bound by `import` or `require` in a file, to the module specifier and the export. */
function readImports(tokens: readonly Token[]): Map<string, ImportBinding> {
  const imports = new Map<string, ImportBinding>();
  tokens.forEach((token, at) => {
    if (!isWord(token) || isPunct(tokens[at - 1], ".")) return;
    if (token.value === "import") {
      // import X, { a, b as c } from "spec" / import * as ns from "spec"; not import.meta, not import("x")
      if (isPunct(tokens[at + 1], ".") || isPunct(tokens[at + 1], "(")) return;
      const bound: Array<[string, string]> = [];
      let inBraces = false;
      for (let i = at + 1; i < tokens.length; i += 1) {
        const t = tokens[i] as Token;
        if (!inBraces && isWord(t, "from") && tokens[i + 1]?.kind === "string") {
          const spec = (tokens[i + 1] as Extract<Token, { kind: "string" }>).value;
          for (const [local, binding] of bound) imports.set(local, { spec, binding });
          return;
        }
        if (t.kind === "string" || isPunct(t, ";") || isPunct(t, "(")) return;
        if (isPunct(t, "{")) {
          inBraces = true;
          continue;
        }
        if (isPunct(t, "}")) {
          inBraces = false;
          continue;
        }
        if (isPunct(t, "*") && isWord(tokens[i + 1], "as") && isWord(tokens[i + 2])) {
          bound.push([(tokens[i + 2] as WordToken).value, "*"]);
          i += 2;
          continue;
        }
        if (!isWord(t)) continue;
        // `import type X`, `{ type A }`: the modifier, not a binding.
        if (t.value === "type" && (isWord(tokens[i + 1]) || isPunct(tokens[i + 1], "{"))) continue;
        if (isWord(tokens[i + 1], "as") && isWord(tokens[i + 2])) {
          bound.push([(tokens[i + 2] as WordToken).value, inBraces ? t.value : "default"]);
          i += 2;
          continue;
        }
        bound.push([t.value, inBraces ? t.value : "default"]);
      }
    } else if (token.value === "require" && isPunct(tokens[at + 1], "(") && tokens[at + 2]?.kind === "string") {
      if (!isPunct(tokens[at - 1], "=")) return;
      const spec = (tokens[at + 2] as Extract<Token, { kind: "string" }>).value;
      const before = tokens[at - 2];
      if (isWord(before)) {
        // const x = require("spec"), or const x = require("spec").name
        const member =
          isPunct(tokens[at + 3], ")") && isPunct(tokens[at + 4], ".") && isWord(tokens[at + 5])
            ? (tokens[at + 5] as WordToken).value
            : "default";
        imports.set(before.value, { spec, binding: member });
      } else if (isPunct(before, "}")) {
        // const { a, b: c } = require("spec")
        let depth = 0;
        for (let i = at - 2; i >= 0; i -= 1) {
          const t = tokens[i] as Token;
          if (isPunct(t, "}")) depth += 1;
          else if (isPunct(t, "{")) {
            depth -= 1;
            if (depth === 0) break;
          } else if (depth === 1 && isWord(t) && !isPunct(tokens[i + 1], ":")) {
            const renamed = isPunct(tokens[i - 1], ":") && isWord(tokens[i - 2]);
            imports.set(t.value, { spec, binding: renamed ? (tokens[i - 2] as WordToken).value : t.value });
          }
        }
      }
    }
  });
  return imports;
}

/** The plain name at `at` when it is the whole value (`router;`, `router\n}`), else null. */
function plainName(tokens: readonly Token[], at: number): string | null {
  const t = tokens[at];
  if (!isWord(t)) return null;
  const after = tokens[at + 1];
  if (isPunct(after, "(") || isPunct(after, ".") || isPunct(after, "[") || isPunct(after, "=")) return null;
  if (["function", "class", "async", "new", "await"].includes(t.value)) return null;
  return t.value;
}

/** Export name to local name, from the ES and CommonJS export forms. */
function readExports(tokens: readonly Token[]): Map<string, string | null> {
  const exported = new Map<string, string | null>();
  tokens.forEach((token, at) => {
    if (!isWord(token) || isPunct(tokens[at - 1], ".")) return;
    if (token.value === "export") {
      let i = at + 1;
      if (isWord(tokens[i], "default")) {
        exported.set("default", plainName(tokens, i + 1));
        return;
      }
      if (isWord(tokens[i], "async")) i += 1;
      const kind = tokens[i];
      if (isWord(kind) && ["const", "let", "var", "function", "class"].includes(kind.value) && isWord(tokens[i + 1])) {
        const name = (tokens[i + 1] as WordToken).value;
        exported.set(name, name);
        return;
      }
      if (isPunct(kind, "{")) {
        const list = callArguments(tokens, i);
        if (!list) return;
        const reexport = isWord(tokens[list.close + 1], "from");
        for (const item of list.args) {
          const parts = item.filter((t): boolean => !isWord(t, "type"));
          const local = parts[0];
          if (!isWord(local)) continue;
          const name = isWord(parts[1], "as") && isWord(parts[2]) ? (parts[2] as WordToken).value : local.value;
          exported.set(name, reexport ? null : local.value);
        }
      }
      return;
    }
    const isModuleExports = token.value === "module" && isPunct(tokens[at + 1], ".") && isWord(tokens[at + 2], "exports");
    const isExports = token.value === "exports";
    if (!isModuleExports && !isExports) return;
    const after = isModuleExports ? at + 3 : at + 1;
    // module.exports.x = value / exports.x = value
    if (isPunct(tokens[after], ".") && isWord(tokens[after + 1]) && isPunct(tokens[after + 2], "=") && !isPunct(tokens[after + 3], "=")) {
      exported.set((tokens[after + 1] as WordToken).value, plainName(tokens, after + 3));
      return;
    }
    if (!isModuleExports || !isPunct(tokens[after], "=") || isPunct(tokens[after + 1], "=")) return;
    if (isPunct(tokens[after + 1], "{")) {
      // module.exports = { a, b: c, d() {} }
      const object = callArguments(tokens, after + 1);
      if (!object) return;
      for (const property of object.args) {
        const key = property[0];
        if (!isWord(key)) continue;
        if (property.length === 1) exported.set(key.value, key.value);
        else if (isPunct(property[1], ":") && property.length === 3 && isWord(property[2])) {
          exported.set(key.value, (property[2] as WordToken).value);
        } else exported.set(key.value, null);
      }
      return;
    }
    exported.set("default", plainName(tokens, after + 1));
  });
  return exported;
}

/**
 * The name a declaration `<name> = ...` or `<name>: <Type> = ...` binds, given the index of its
 * `=`; null when the `=` is not a declaration of a plain name.
 */
function declaredName(tokens: readonly Token[], eq: number): string | null {
  const before = tokens[eq - 1];
  if (!isWord(before)) return null;
  // Walk back over a type annotation (`Router`, `express.Router`, `Map<string, Router>`) to its `:`.
  let i = eq - 1;
  while (i >= 0) {
    const t = tokens[i] as Token;
    if (isWord(t) || (t.kind === "punct" && ".<>,[]|&".includes(t.value))) i -= 1;
    else break;
  }
  if (isPunct(tokens[i], ":") && isWord(tokens[i - 1])) return (tokens[i - 1] as WordToken).value;
  return before.value;
}

/** Local routers: `<name> (: <Type>)? = (express. | require("express").)?Router(` and `new Router(`. */
function readLocalRouters(tokens: readonly Token[]): Set<string> {
  const routers = new Set<string>();
  tokens.forEach((token, at) => {
    if (!isWord(token, "Router") || !isPunct(tokens[at + 1], "(")) return;
    let back = at - 1;
    if (isPunct(tokens[back], ".")) {
      if (isWord(tokens[back - 1])) back -= 2;
      else if (
        isPunct(tokens[back - 1], ")") &&
        tokens[back - 2]?.kind === "string" &&
        isPunct(tokens[back - 3], "(") &&
        isWord(tokens[back - 4], "require")
      ) {
        back -= 5;
      } else return;
    }
    if (isWord(tokens[back], "new")) back -= 1;
    if (!isPunct(tokens[back], "=")) return;
    const name = declaredName(tokens, back);
    if (name) routers.add(name);
  });
  return routers;
}

/** From the `<` at `open`, the index of the matching `>` of a type argument list; null when there is none. */
function typeArgumentsEnd(tokens: readonly Token[], open: number): number | null {
  let depth = 0;
  for (let at = open; at < tokens.length && at < open + 400; at += 1) {
    const t = tokens[at] as Token;
    if (isPunct(t, ";")) return null;
    if (isPunct(t, "<")) depth += 1;
    else if (isPunct(t, ">") && !(isPunct(tokens[at - 1], "=") && (tokens[at - 1] as Token).end === t.start)) {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return null;
}

/** Does this argument start with a function (`async (...) =>`, `(req, res) =>`, `req =>`, `function`)? */
function looksLikeHandler(arg: readonly Token[]): boolean {
  let at = 0;
  if (isWord(arg[at], "async")) at += 1;
  if (isWord(arg[at], "function")) return true;
  const arrowAt = (i: number) => isPunct(arg[i], "=") && isPunct(arg[i + 1], ">");
  if (isWord(arg[at])) return arrowAt(at + 1);
  if (isPunct(arg[at], "(")) {
    let depth = 0;
    for (let i = at; i < arg.length; i += 1) {
      const t = arg[i] as Token;
      if (isPunct(t, "(")) depth += 1;
      else if (isPunct(t, ")")) {
        depth -= 1;
        if (depth === 0) {
          // `(req: Request): Promise<void> =>`: skip a return type up to the arrow.
          for (let j = i + 1; j < arg.length; j += 1) if (arrowAt(j)) return true;
          return false;
        }
      }
    }
  }
  return false;
}

function readFile(text: string, options: Required<Pick<ExpressOptions, "doorCall" | "requestNames" | "routerNames">>): FileFacts {
  const tokens = tokenize(text);
  const imports = readImports(tokens);
  const exported = readExports(tokens);
  const localRouters = readLocalRouters(tokens);
  const receivers = new Set([...options.routerNames, ...localRouters]);
  const notes: string[] = [];

  const doorIn = (from: number, to: number): string | null => {
    for (let at = from; at < to; at += 1) {
      const t = tokens[at] as Token;
      if (!isWord(t, options.doorCall) || !isPunct(tokens[at + 1], "(")) continue;
      const request = tokens[at + 2];
      if (!isWord(request) || !options.requestNames.includes(request.value)) continue;
      if (!isPunct(tokens[at + 3], ",")) continue;
      const id = tokens[at + 4];
      if (id?.kind === "string" && /^[A-Za-z0-9_]+$/.test(id.value) && isPunct(tokens[at + 5], ")")) return id.value;
    }
    return null;
  };

  const registrations: Registration[] = [];
  const mounts: FileFacts["mounts"] = [];
  tokens.forEach((token, at) => {
    if (!isWord(token) || !isPunct(tokens[at + 1], ".")) return;
    const member = tokens[at + 2];
    if (!isWord(member)) return;
    let open = at + 3;
    if (isPunct(tokens[open], "<")) {
      const close = typeArgumentsEnd(tokens, open);
      if (close === null) return;
      open = close + 1;
    }
    if (!isPunct(tokens[open], "(")) return;
    const isMethod = (METHODS as readonly string[]).includes(member.value);
    const isUnread = (UNREAD_MEMBERS as readonly string[]).includes(member.value);
    const known = receivers.has(token.value) && !isPunct(tokens[at - 1], ".");
    if (!known && !isMethod && !isUnread) return;
    const call = callArguments(tokens, open);
    if (!call) return;
    const line = lineOf(text, token.start);
    const first = call.args[0] ?? [];

    if (!known) {
      // `tasks.get("/x", (req, res) => ...)` on a name the reader does not know as a router.
      if (member.value === "route" || call.args.length < 2) return;
      const path = first[0]?.kind === "string" || first[0]?.kind === "template" ? (first[0] as { value: string }).value : null;
      if (path === null || !path.startsWith("/")) return;
      const handler = call.args.slice(1).some(looksLikeHandler) || doorIn(open, call.close) !== null;
      if (!handler) return;
      const receiver = isPunct(tokens[at - 1], ".") ? `<member>.${token.value}` : token.value;
      notes.push(
        `${line}: ${receiver}.${member.value}("${path}", ...) looks like a route, but "${token.value}" is not a known router (declare it with Router() in this file, or add it to routerNames)`,
      );
      return;
    }

    if (isUnread) {
      if (member.value !== "route" && call.args.length < 2) return;
      notes.push(
        member.value === "route"
          ? `${line}: ${token.value}.route(...) chains are not read; register each method with ${token.value}.<method>(path, ...)`
          : `${line}: ${token.value}.${member.value}(...) registers a route the reader does not read (only get, post, put, patch, delete)`,
      );
      return;
    }

    if (isMethod) {
      // `app.get("x")` with ONE argument is Express's settings getter, not a route.
      if (call.args.length < 2) return;
      const path = literal(first);
      registrations.push({
        receiver: token.value,
        method: member.value.toUpperCase(),
        path,
        opens: doorIn(open, call.close),
        line,
      });
      return;
    }

    if (member.value !== "use" || call.args.length === 0) return;
    const last = call.args[call.args.length - 1] as Token[];
    const target = mountTarget(last, localRouters);
    if (target === null) return;
    // A string, template or array first argument is the path (null when it is not a plain
    // literal). Without one, Express mounts at "/" (`app.use(router)`, `app.use(auth, router)`).
    // A variable that holds a path is taken for middleware here: a documented limit.
    const pathLike =
      call.args.length > 1 && (first[0]?.kind === "string" || first[0]?.kind === "template" || isPunct(first[0], "["));
    const prefix = pathLike ? literal(first) : "";
    mounts.push({ receiver: token.value, prefix, target, line });
  });

  return { registrations, mounts, imports, localRouters, exports: exported, notes };
}

/** What the last argument of a `.use(...)` mounts, in the forms this reader knows; null otherwise. */
function mountTarget(
  arg: readonly Token[],
  localRouters: ReadonlySet<string>,
): RawMountTarget | null {
  const first = arg[0];
  if (!isWord(first)) return null;
  // require("./x") or require("./x")(...)
  if (first.value === "require" && isPunct(arg[1], "(") && arg[2]?.kind === "string" && isPunct(arg[3], ")")) {
    return { kind: "spec", spec: (arg[2] as Extract<Token, { kind: "string" }>).value, called: arg.length > 4 };
  }
  // x or x(...): an identifier, or a call of one (and nothing after the call)
  if (arg.length === 1) {
    return localRouters.has(first.value) ? { kind: "local", name: first.value } : { kind: "import", name: first.value, called: false };
  }
  if (isPunct(arg[1], "(") && isPunct(arg[arg.length - 1], ")")) {
    let depth = 0;
    for (let i = 1; i < arg.length; i += 1) {
      const t = arg[i] as Token;
      if (t.kind === "punct" && "([{".includes(t.value)) depth += 1;
      else if (t.kind === "punct" && ")]}".includes(t.value)) {
        depth -= 1;
        if (depth === 0 && i !== arg.length - 1) return null;
      }
    }
    return { kind: "import", name: first.value, called: true };
  }
  return null;
}

/* ------------------------------------------------------------ the product */

const DEFAULT_SOURCE = /\.(js|cjs|mjs|ts|mts|cts)$/;

/** The route files and entry files as one list of paths (entry files first), and the empty route folders. */
function scannedFiles(options: ExpressOptions): { files: string[]; emptyDirs: string[] } {
  const sourceFile = options.sourceFile ?? DEFAULT_SOURCE;
  const seen = new Set<string>();
  const out: string[] = [];
  const emptyDirs: string[] = [];
  const add = (file: string) => {
    const clean = joinPath(file);
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  };
  for (const file of options.entryFiles) add(file);
  for (const dir of options.routeDirs ?? []) {
    let found = 0;
    for (const relative of options.files.list(dir)) {
      if (sourceFile.test(relative) && !/\.d\.[cm]?ts$/.test(relative)) {
        add(joinPath(dir, relative));
        found += 1;
      }
    }
    if (found === 0) emptyDirs.push(dir);
  }
  return { files: out, emptyDirs };
}

/** The scanned file a specifier names, trying the extensions NodeNext and CommonJS allow. */
function resolveSpecifier(from: string, spec: string, known: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalisePosix(joinPath(dirnameOf(from), spec));
  const stem = base.replace(/\.(js|cjs|mjs)$/, "");
  const candidates = [
    base,
    `${stem}.ts`,
    `${stem}.mts`,
    `${stem}.cts`,
    `${stem}.js`,
    `${stem}.cjs`,
    `${stem}.mjs`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

export function readExpressRoutes(options: ExpressOptions): ExpressRoutes {
  const settings = {
    doorCall: options.doorCall ?? "openMachineDoor",
    requestNames: options.requestNames ?? ["req", "request"],
    routerNames: options.routerNames ?? ["router", "app"],
  };
  const appNames = new Set(options.appNames ?? ["app"]);
  const { files, emptyDirs } = scannedFiles(options);
  const known = new Set(files);
  const facts = new Map<string, FileFacts>();
  for (const file of files) facts.set(file, readFile(options.files.read(file), settings));

  const unresolved: string[] = [];
  for (const dir of emptyDirs) {
    unresolved.push(`${joinPath(dir)}: a route folder without source files (does it exist?); no route of it is read`);
  }
  for (const [file, fact] of facts) for (const note of fact.notes) unresolved.push(`${file}:${note}`);

  const mounts: Mount[] = [];
  for (const [file, fact] of facts) {
    for (const mount of fact.mounts) {
      let target: MountTarget | null = null;
      if (mount.target.kind === "local") target = mount.target;
      else if (mount.target.kind === "spec") {
        const resolved = resolveSpecifier(file, mount.target.spec, known);
        target = resolved ? { kind: "file", file: resolved, binding: "default", called: mount.target.called } : null;
      } else {
        const imported = fact.imports.get(mount.target.name);
        const resolved = imported ? resolveSpecifier(file, imported.spec, known) : null;
        target =
          resolved && imported
            ? { kind: "file", file: resolved, binding: imported.binding, called: mount.target.called }
            : null;
      }
      if (!target) continue; // middleware or a router outside the scanned folders
      if (mount.prefix === null) {
        const what = target.kind === "file" ? target.file : target.name;
        unresolved.push(`${file}:${mount.line}: ${mount.receiver}.use(...) mounts ${what} under a prefix that is not a string literal`);
      }
      mounts.push({ from: file, receiver: mount.receiver, prefix: mount.prefix, target, line: mount.line });
    }
  }

  /** The routers of a file that only a mount from ANOTHER file can reach (not app, not mounted locally). */
  const topReceivers = new Map<string, Set<string>>();
  for (const [file, fact] of facts) {
    const locallyMounted = new Set(
      mounts.filter((m) => m.from === file && m.target.kind === "local").map((m) => (m.target as { name: string }).name),
    );
    const top = new Set<string>();
    for (const r of fact.registrations) if (!appNames.has(r.receiver) && !locallyMounted.has(r.receiver)) top.add(r.receiver);
    for (const m of mounts) if (m.from === file && !appNames.has(m.receiver) && !locallyMounted.has(m.receiver)) top.add(m.receiver);
    topReceivers.set(file, top);
  }

  /**
   * Does a mount of `file` reach `receiver`? `yes` when its binding is that router, `no` when it is
   * another router or a non-router export (a middleware), `unknown` when the reader cannot tell (a
   * factory call, an export it cannot follow): then every router of the file gets the prefix.
   */
  const notedUnknown = new Set<Mount>();
  function reaches(mount: Mount, file: string, receiver: string): boolean {
    if (mount.target.kind !== "file") return false;
    const exported = facts.get(file)?.exports;
    const local = mount.target.called || mount.target.binding === null ? undefined : exported?.get(mount.target.binding);
    if (typeof local === "string") return local === receiver;
    const routers = topReceivers.get(file) ?? new Set<string>();
    if (routers.size >= 2 && !notedUnknown.has(mount)) {
      notedUnknown.add(mount);
      unresolved.push(
        `${mount.from}:${mount.line}: ${mount.receiver}.use(...) mounts ${file}, whose routers (${[...routers].sort().join(", ")}) the mount cannot be tied to; its prefix is given to each of them`,
      );
    }
    return true;
  }

  const incomingMemo = new Map<string, Mount[]>();
  /** The mounts from other files that reach `receiver` of `file`. */
  function incoming(file: string, receiver: string): Mount[] {
    const key = `${file}#${receiver}`;
    const memo = incomingMemo.get(key);
    if (memo) return memo;
    const out = mounts.filter((m) => m.target.kind === "file" && m.target.file === file && reaches(m, file, receiver));
    incomingMemo.set(key, out);
    return out;
  }

  const prefixMemo = new Map<string, string[]>();
  const visiting = new Set<string>();

  const cross = (bases: readonly string[], prefix: string): string[] =>
    bases.map((base) => joinExpressPath(base, expressPathToOpenApi(prefix)));

  function receiverPrefixes(file: string, receiver: string): string[] {
    if (appNames.has(receiver)) return [""];
    const key = `${file}#${receiver}`;
    const memo = prefixMemo.get(key);
    if (memo) return memo;
    if (visiting.has(key)) return [];
    visiting.add(key);
    const local = mounts.filter((m) => m.from === file && m.target.kind === "local" && m.target.name === receiver);
    const reaching = local.length > 0 ? local : incoming(file, receiver);
    const literalMounts = reaching.filter((m) => m.prefix !== null);
    // No mount, or only dynamic ones (already in `unresolved`): listed without a prefix.
    const out =
      literalMounts.length === 0
        ? [""]
        : literalMounts.flatMap((m) => cross(receiverPrefixes(m.from, m.receiver), m.prefix as string));
    visiting.delete(key);
    const unique = [...new Set(out)];
    prefixMemo.set(key, unique);
    return unique;
  }

  const routes: FoundRoute[] = [];
  const seen = new Set<string>();
  const entries = new Set(options.entryFiles.map((file) => joinPath(file)));
  for (const [file, fact] of facts) {
    const notedUnmounted = new Set<string>();
    for (const registration of fact.registrations) {
      if (registration.path === null) {
        unresolved.push(
          `${file}:${registration.line}: ${registration.receiver}.${registration.method.toLowerCase()}(...) has a path that is not a string literal`,
        );
        continue;
      }
      const absolute = appNames.has(registration.receiver);
      const mountedHere = mounts.some(
        (m) => m.from === file && m.target.kind === "local" && m.target.name === registration.receiver,
      );
      const mounted = !absolute && !mountedHere && incoming(file, registration.receiver).some((m) => m.prefix !== null);
      if (!absolute && !mountedHere && !mounted && !entries.has(file) && !notedUnmounted.has(registration.receiver)) {
        notedUnmounted.add(registration.receiver);
        unresolved.push(
          `${file}: routes are registered on "${registration.receiver}", but no mount with a literal prefix reaches it; they are listed without a prefix`,
        );
      }
      const prefixes = absolute ? [""] : receiverPrefixes(file, registration.receiver);
      for (const prefix of prefixes) {
        const path = joinExpressPath(prefix, expressPathToOpenApi(registration.path));
        const key = `${registration.method} ${path} ${registration.opens ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ method: registration.method, path, opens: registration.opens });
      }
    }
  }
  return { routes, unresolved };
}

/**
 * Function names a CommonJS file exports: `module.exports = { a, b: c }`, `module.exports.a = ...`,
 * `exports.a = ...`, plus ES `export function a` / `export async function a`. For the services of
 * a JavaScript product.
 */
export function commonJsExports(source: string): string[] {
  const tokens = tokenize(source);
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };
  tokens.forEach((token, at) => {
    if (isWord(token, "export") && !isPunct(tokens[at - 1], ".")) {
      let i = at + 1;
      if (isWord(tokens[i], "async")) i += 1;
      if (isWord(tokens[i], "function") && isWord(tokens[i + 1])) add((tokens[i + 1] as Extract<Token, { kind: "word" }>).value);
      return;
    }
    const isModuleExports = isWord(token, "module") && isPunct(tokens[at + 1], ".") && isWord(tokens[at + 2], "exports");
    const isExports = isWord(token, "exports") && !isPunct(tokens[at - 1], ".");
    if (!isModuleExports && !isExports) return;
    const after = isModuleExports ? at + 3 : at + 1;
    if (isPunct(tokens[after], ".") && isWord(tokens[after + 1]) && isPunct(tokens[after + 2], "=")) {
      add((tokens[after + 1] as Extract<Token, { kind: "word" }>).value);
      return;
    }
    if (isModuleExports && isPunct(tokens[after], "=") && isPunct(tokens[after + 1], "{")) {
      const object = callArguments(tokens, after + 1);
      if (!object) return;
      for (const property of object.args) {
        const key = property[0];
        if (isWord(key) && (property.length === 1 || isPunct(property[1], ":") || isPunct(property[1], "("))) {
          add(key.value);
        }
      }
    }
  });
  return names;
}

/**
 * A complete `Found` for an Express product: the routes from `readExpressRoutes`, the rest as the
 * product reads it (services with `commonJsExports` or `exportedFunctions`, pages of its dashboard
 * with the Next reader, tools from its catalogue). `unresolved` rides along for the product's test.
 */
export function readExpressSources(
  options: ExpressOptions & { other?: Partial<Omit<ParitySources, "routes">> },
): ParitySources & { unresolved: string[] } {
  const { routes, unresolved } = readExpressRoutes(options);
  return {
    services: options.other?.services ?? {},
    actions: options.other?.actions ?? [],
    pages: options.other?.pages ?? [],
    tools: options.other?.tools ?? [],
    routes,
    unresolved,
  };
}
