import type { ToolAccess, ToolCapability, ToolMarker } from "./markers";

/**
 * The answer of `GET /api/mcp/describe` (connection layer contract, stage 6, 2.4).
 *
 * One address per product that says which tools it offers, what each one does (`access`,
 * `idempotent`, `capability`), its title in German and English, and whether the caller's
 * credential covers it (`available`). Order = catalogue order.
 *
 * Moved from the Lab template (`src/lib/tool-door/describe.ts`) for #383, unchanged apart from
 * this comment and the relative import. Pure.
 */

export interface DescribedTool {
  name: string;
  title: { de: string; en: string };
  description: string;
  access: ToolAccess;
  idempotent: boolean;
  capability: ToolCapability | null;
  available: boolean;
  /** The scopes a credential needs for this tool; `[]` when the Lab declares none. */
  scopes: string[];
  inputSchema: Record<string, unknown>;
}

export interface ToolDoorDescription {
  product: string;
  name: string;
  version: string;
  protocol: "mcp";
  toolDoorUrl: string | null;
  toolPrefix: string;
  tools: DescribedTool[];
}

export function describeToolDoor(input: {
  product: string;
  name: string;
  version: string;
  toolPrefix: string;
  appUrl: string | null;
  tools: ReadonlyArray<
    { name: string; description: string; inputSchema: Record<string, unknown>; scopes?: readonly string[] } & ToolMarker
  >;
  isAvailable: (toolName: string) => boolean;
}): ToolDoorDescription {
  const base = input.appUrl?.trim().replace(/\/+$/, "") ?? "";
  return {
    product: input.product,
    name: input.name,
    version: input.version,
    protocol: "mcp",
    toolDoorUrl: base ? `${base}/api/mcp` : null,
    toolPrefix: input.toolPrefix,
    tools: input.tools.map((tool) => ({
      name: tool.name,
      title: { de: tool.title.de, en: tool.title.en },
      description: tool.description,
      access: tool.access,
      idempotent: tool.idempotent,
      capability: tool.capability ?? null,
      available: input.isAvailable(tool.name),
      scopes: [...(tool.scopes ?? [])],
      inputSchema: tool.inputSchema,
    })),
  };
}
