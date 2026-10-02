import { LAB_KEY } from "@/lib/lab";

/**
 * The tool catalogue — the ONE truth about what agents can do with this Lab.
 *
 * Every tool maps to exactly one `/api/v1` call. The MCP server never touches
 * the database: it calls the HTTP door with the same `x-api-key`, so tenant
 * separation, access model and error handling apply unchanged. A tool can
 * never see more than an ordinary API caller.
 *
 * Schemas are literal JSON Schema, as they reach the agent. Descriptions are
 * English and say what the tool does for the person, not how it is built.
 *
 * Add a tool for every new API route. There is deliberately no delete tool
 * in the example: deleting through an agent needs a human decision first.
 */

export type ToolArguments = Record<string, unknown>;

export interface V1Call {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  toCall: (args: ToolArguments) => V1Call;
}

function str(args: ToolArguments, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: `${LAB_KEY}_list_notes`,
    description:
      "List the notes visible to the key's organisation and view, newest first. " +
      "Optional free-text search over title and body.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional text to search for." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max rows (default 50)." },
      },
      additionalProperties: false,
    },
    toCall: (args) => {
      const params = new URLSearchParams();
      const search = str(args, "search");
      if (search) params.set("search", search);
      if (typeof args.limit === "number") params.set("limit", String(args.limit));
      const qs = params.toString();
      return { method: "GET", path: `/api/v1/notes${qs ? `?${qs}` : ""}` };
    },
  },
  {
    name: `${LAB_KEY}_get_note`,
    description: "Read one note by id, if the key's view may see it.",
    inputSchema: {
      type: "object",
      properties: { noteId: { type: "string", description: "The note id (uuid)." } },
      required: ["noteId"],
      additionalProperties: false,
    },
    toCall: (args) => ({
      method: "GET",
      path: `/api/v1/notes/${encodeURIComponent(str(args, "noteId") ?? "")}`,
    }),
  },
  {
    name: `${LAB_KEY}_create_note`,
    description:
      "Create a note. `visibility` is required: 'private' (only the key's person) or " +
      "'organisation' (everybody in the organisation). A worker key can only " +
      "create organisation-wide notes, so pass 'organisation' for worker keys.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        body: { type: "string", maxLength: 20000 },
        visibility: { type: "string", enum: ["private", "organisation"] },
      },
      required: ["title", "visibility"],
      additionalProperties: false,
    },
    toCall: (args) => ({
      method: "POST",
      path: "/api/v1/notes",
      body: {
        title: str(args, "title") ?? "",
        body: typeof args.body === "string" ? args.body : "",
        visibility: str(args, "visibility") ?? "",
      },
    }),
  },
];

export const TOOLS_BY_NAME = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));
export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);
