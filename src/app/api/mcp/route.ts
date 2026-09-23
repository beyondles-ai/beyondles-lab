import { NextResponse, type NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { requireApiKey } from "@/lib/api-auth";
import { ApiError } from "@/lib/api-errors";
import { createMcpServer, resolveSelfBaseUrl } from "@/lib/mcp/server";

/**
 * `POST /api/mcp` — the Lab as a tool for agents, over HTTP.
 *
 * Streamable HTTP, stateless (`sessionIdGenerator: undefined`), JSON answers
 * (`enableJsonResponse: true`). The key is checked BEFORE anything else; the
 * route is on the middleware's public list because an agent has no Suite
 * cookie. Its security boundary is `requireApiKey`, the same as `/api/v1`.
 *
 * Nothing else happens here: no Prisma, no service. The tools call the own
 * `/api/v1` with the same key (`src/lib/mcp/server.ts`).
 */
export const dynamic = "force-dynamic";

function jsonRpcError(status: number, code: number, message: string): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function rpcCodeFor(status: number): number {
  if (status === 401) return -32001;
  if (status === 403) return -32002;
  if (status === 503) return -32003;
  return -32603;
}

const ACCEPT = "application/json, text/event-stream";

/**
 * Streamable HTTP demands that the client accepts BOTH answer forms; the SDK
 * answers 406 otherwise. `curl` sends an Accept that names neither, so a
 * hand check would fail for the wrong reason. Missing forms are ADDED.
 */
async function withAcceptHeader(request: NextRequest): Promise<Request> {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/json") && accept.includes("text/event-stream")) return request;
  const headers = new Headers(request.headers);
  headers.set("accept", ACCEPT);
  return new Request(request.url, { method: "POST", headers, body: await request.text() });
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";

  try {
    await requireApiKey(request);
  } catch (error) {
    if (error instanceof ApiError) return jsonRpcError(error.status, rpcCodeFor(error.status), error.message);
    console.error("[mcp] key check failed:", error);
    return jsonRpcError(500, -32603, "Internal error in the MCP endpoint.");
  }

  const server = createMcpServer({ baseUrl: resolveSelfBaseUrl(), apiKey });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(await withAcceptHeader(request));
  } catch (error) {
    console.error("[mcp] request failed:", error);
    return jsonRpcError(500, -32603, "Internal error in the MCP endpoint.");
  } finally {
    await server.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

/** GET/DELETE belong to the session mechanics of Streamable HTTP; stateless has none. */
export function GET(): NextResponse {
  return jsonRpcError(405, -32601, "This MCP endpoint is stateless — use POST.");
}

export function DELETE(): NextResponse {
  return jsonRpcError(405, -32601, "This MCP endpoint is stateless — nothing to end.");
}
