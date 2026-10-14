import path from "node:path";

import { TOOL_DEFINITIONS } from "@/lib/mcp/catalog";
import { nodeSourceFiles } from "@/lib/doors/readers/node-fs";
import {
  readNextAppRouterSources,
  toolsFromCatalogue,
} from "@/lib/doors/readers/next-app-router";
import type { FoundTool, ParitySources } from "@/server/parity";

export {
  exportedFunctions,
  routeHandlers,
} from "@/lib/doors/readers/next-app-router";

/**
 * Reads what the code really contains, for `parityProblems`: service and
 * action exports (source text, no import, so no database is needed), the
 * `/api/v1` route files and their handlers, the pages, and the MCP catalogue.
 * The reader is the shared one (`src/lib/doors/readers/next-app-router.ts`,
 * generated from beyondles-shared); this file names the Lab's folders and the
 * sample arguments the catalogue's `toCall` needs.
 */

const root = path.resolve(__dirname, "..", "..");

const SAMPLE_ARGS = {
  noteId: "00000000-0000-4000-8000-000000000000",
  title: "t",
  body: "b",
  visibility: "private",
};

export function toolsFound(definitions = TOOL_DEFINITIONS): FoundTool[] {
  return toolsFromCatalogue(definitions, SAMPLE_ARGS);
}

export function readParitySources(): ParitySources {
  return readNextAppRouterSources({
    files: nodeSourceFiles(root),
    servicesDir: "src/server/services",
    actionsDir: "src/server/actions",
    appDir: "src/app",
    apiDir: "src/app/api/v1",
    doorCall: "openMachineDoor",
    readTools: () => toolsFound(),
  });
}
