import type { FoundRoute, FoundTool, ParitySources } from "../parity";
import { basenameOf, dirnameOf, joinPath, type SourceFiles } from "./source-files";

/**
 * Reads what a Next.js App Router product really contains, for `parityProblems`: service and
 * action exports (source text, no import, so no database is needed), the REST route files and
 * their handlers, the pages, and the MCP catalogue (through the product's callback).
 *
 * Moved from the Lab template (`tests/support/parity-sources.ts`) for #383. With the default
 * options it reads exactly what the template's reader reads, the same way. Known limits (as in
 * the template): it does not see `export const GET = ...`, it cannot tell whether a page really
 * calls its service, and a tool that calls a service directly has no route to compare.
 */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export interface NextAppRouterOptions {
  files: SourceFiles;
  /** Default `src/server/services`. Every file there is one service; its name is the file name without extension. */
  servicesDir?: string;
  /** Default `src/server/actions`. */
  actionsDir?: string;
  /** The App Router folder pages and routes are relative to. Default `src/app`. */
  appDir?: string;
  /** The REST door's folder, inside `appDir`. Default `src/app/api/v1`. */
  apiDir?: string;
  /** Default `/\.ts$/`. */
  sourceFile?: RegExp;
  /** Default `/^page\.tsx$/`. */
  pageFile?: RegExp;
  /** Default `/^route\.ts$/`. */
  routeFile?: RegExp;
  /** The door call every handler starts with. Default `openMachineDoor`. */
  doorCall?: string;
  /** The MCP catalogue as found tools (see `toolsFromCatalogue`). Default: no tools. */
  readTools?: () => FoundTool[];
}

/** Strip comments so a commented-out export does not count. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function exportedFunctions(source: string): string[] {
  return [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1] as string);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Each exported HTTP handler with the function id it passes to the door call (`openMachineDoor(request, "<id>")`). */
export function routeHandlers(source: string, routePath: string, doorCall = "openMachineDoor"): FoundRoute[] {
  const heads = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Z]+)\b/gm)].filter((m) =>
    METHODS.includes(m[1] as string),
  );
  const call = new RegExp(`${escapeRegExp(doorCall)}\\(\\s*request\\s*,\\s*"([A-Za-z0-9_]+)"\\s*\\)`);
  return heads.map((head, i) => {
    const end = heads[i + 1]?.index ?? source.length;
    const body = source.slice(head.index ?? 0, end);
    const opens = call.exec(body)?.[1] ?? null;
    return { method: head[1] as string, path: routePath, opens };
  });
}

/** `api/v1/notes/[noteId]` -> `/api/v1/notes/{noteId}`. */
export function routePathOf(folderInApp: string): string {
  return `/${folderInApp}`.replace(/\/+$/, "").replace(/\[([^\]]+)\]/g, "{$1}") || "/";
}

/** `(app)/notes/[noteId]` -> `/notes/[noteId]` (route groups dropped). */
export function pagePathOf(folderInApp: string): string {
  const parts = folderInApp.split("/").filter((p) => p && !/^\(.*\)$/.test(p));
  return `/${parts.join("/")}`;
}

/**
 * The MCP catalogue as found tools: name, declared scopes, and what `toCall` makes of sample
 * arguments. The product passes its own sample arguments (ids its routes need, required fields).
 */
export function toolsFromCatalogue<A>(
  definitions: ReadonlyArray<{
    name: string;
    scopes: readonly string[];
    toCall?: (args: A) => { method: string; path: string };
  }>,
  sampleArgs: A,
): FoundTool[] {
  return definitions.map((tool) => {
    const call = tool.toCall ? tool.toCall(sampleArgs) : null;
    return {
      name: tool.name,
      scopes: tool.scopes,
      call: call ? { method: call.method, path: call.path } : null,
    };
  });
}

function filesIn(files: SourceFiles, dir: string, name: RegExp): string[] {
  return files
    .list(dir)
    .filter((relative) => name.test(basenameOf(relative)))
    .map((relative) => joinPath(dir, relative));
}

function folderInside(parent: string, child: string): string {
  const p = joinPath(parent);
  const c = joinPath(child);
  if (c === p) return "";
  if (!c.startsWith(`${p}/`)) throw new Error(`${child} is not inside ${parent}`);
  return c.slice(p.length + 1);
}

export function readServices(options: NextAppRouterOptions): Record<string, string[]> {
  const sourceFile = options.sourceFile ?? /\.ts$/;
  const services: Record<string, string[]> = {};
  for (const file of filesIn(options.files, options.servicesDir ?? "src/server/services", sourceFile)) {
    services[basenameOf(file).replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/, "")] = exportedFunctions(
      stripComments(options.files.read(file)),
    );
  }
  return services;
}

export function readActions(options: NextAppRouterOptions): string[] {
  const sourceFile = options.sourceFile ?? /\.ts$/;
  return filesIn(options.files, options.actionsDir ?? "src/server/actions", sourceFile).flatMap((file) =>
    exportedFunctions(stripComments(options.files.read(file))),
  );
}

export function readRoutes(options: NextAppRouterOptions): FoundRoute[] {
  const appDir = options.appDir ?? "src/app";
  const apiDir = options.apiDir ?? "src/app/api/v1";
  folderInside(appDir, apiDir); // throws when the REST folder is not inside the app folder
  return filesIn(options.files, apiDir, options.routeFile ?? /^route\.ts$/).flatMap((file) =>
    routeHandlers(
      stripComments(options.files.read(file)),
      routePathOf(folderInside(appDir, dirnameOf(file))),
      options.doorCall ?? "openMachineDoor",
    ),
  );
}

export function readPages(options: NextAppRouterOptions): string[] {
  const appDir = options.appDir ?? "src/app";
  return filesIn(options.files, appDir, options.pageFile ?? /^page\.tsx$/).map((file) =>
    pagePathOf(folderInside(appDir, dirnameOf(file))),
  );
}

export function readNextAppRouterSources(options: NextAppRouterOptions): ParitySources {
  return {
    services: readServices(options),
    actions: readActions(options),
    pages: readPages(options),
    routes: readRoutes(options),
    tools: options.readTools ? options.readTools() : [],
  };
}
