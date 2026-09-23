import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { LAB_KEY, LAB_NAME } from "@/lib/lab";
import { TOOLS_BY_NAME, TOOL_DEFINITIONS, TOOL_NAMES, type ToolArguments } from "@/lib/mcp/catalog";

/**
 * The Lab's MCP server — built per request, stateless.
 *
 * One server per request: the key of the request decides organisation and
 * view; a server living across requests would have to forget the previous
 * caller, which is exactly the kind of bug nobody notices until one
 * organisation sees another's rows.
 *
 * No database access: `tools/call` calls the own HTTP door `/api/v1` with the
 * SAME `x-api-key`. The MCP path cannot bypass the access model because it
 * takes the same path as every foreign caller.
 */

export const MCP_SERVER_VERSION = "1.0.0";

const V1_TIMEOUT_MS = 15_000;

export interface McpServerContext {
  /** Base URL of the own app, without trailing slash. */
  baseUrl: string;
  /** The key of the incoming request, passed on unchanged. */
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Where the own base URL comes from — and why NOTHING of it comes from the
 * request. The Host header belongs to the CALLER; using it as the target of
 * the self-call would let a stranger decide where this server sends the
 * `x-api-key`. Seven Labs share loopback ports on the Playground.
 *
 * 1. `MCP_SELF_BASE_URL` if set (proxy, other network namespace).
 * 2. `http://127.0.0.1:${PORT}` — the runtime container sets PORT=3000.
 * 3. `http://127.0.0.1:3390` — `next dev` without PORT.
 */
export function resolveSelfBaseUrl(): string {
  const override = process.env.MCP_SELF_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  const port = process.env.PORT?.trim();
  if (port) return `http://127.0.0.1:${port}`;
  return "http://127.0.0.1:3390";
}

function asText(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** An error of the v1 door becomes a RESULT, not an abort: a model can act on it. */
function asError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function shorten(text: string, limit = 500): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Exported so the unit test can call it without HTTP server or MCP client. */
export async function callTool(
  context: McpServerContext,
  name: string,
  args: ToolArguments,
): Promise<CallToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return asError(`Unknown tool: ${name}. Available: ${TOOL_NAMES.join(", ")}.`);

  const call = tool.toCall(args);
  const fetchImpl = context.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${context.baseUrl}${call.path}`, {
      method: call.method,
      headers: {
        "x-api-key": context.apiKey,
        ...(call.body ? { "Content-Type": "application/json" } : {}),
      },
      body: call.body ? JSON.stringify(call.body) : undefined,
      signal: AbortSignal.timeout(V1_TIMEOUT_MS),
      // A redirect would never be right here (login page or foreign host).
      redirect: "manual",
    });
    const body = await res.text();
    if (!res.ok) return asError(`Error in ${name}: HTTP ${res.status}: ${shorten(body)}`);
    try {
      return asText(JSON.parse(body) as unknown);
    } catch {
      return asError(`Error in ${name}: the HTTP door did not return JSON: ${shorten(body)}`);
    }
  } catch (error) {
    console.error(`[mcp] tool ${name} failed:`, error);
    return asError(
      `Error in ${name}: ${LAB_NAME} was not reachable (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

export function createMcpServer(context: McpServerContext): Server {
  const server = new Server(
    { name: LAB_KEY, version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        `${LAB_NAME} for one organisation. Every tool acts only on the organisation ` +
        "the API key belongs to, and only on the rows the person behind that key may see.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> =>
      callTool(context, request.params.name, (request.params.arguments ?? {}) as ToolArguments),
  );

  return server;
}
