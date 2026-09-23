import { afterEach, describe, expect, it, vi } from "vitest";

import { TOOL_DEFINITIONS, TOOL_NAMES } from "@/lib/mcp/catalog";
import { callTool, resolveSelfBaseUrl } from "@/lib/mcp/server";
import { LAB_KEY } from "@/lib/lab";

describe("MCP catalogue", () => {
  it("every tool carries the Lab prefix, a description and an object schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name.startsWith(`${LAB_KEY}_`)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });

  it("maps arguments to the v1 door", () => {
    const list = TOOL_DEFINITIONS.find((t) => t.name === `${LAB_KEY}_list_notes`)!;
    expect(list.toCall({ search: "x y", limit: 5 })).toEqual({ method: "GET", path: "/api/v1/notes?search=x+y&limit=5" });
    const create = TOOL_DEFINITIONS.find((t) => t.name === `${LAB_KEY}_create_note`)!;
    expect(create.inputSchema.required).toContain("visibility");
    expect(create.toCall({ title: "T", visibility: "organisation" })).toEqual({
      method: "POST",
      path: "/api/v1/notes",
      body: { title: "T", body: "", visibility: "organisation" },
    });
  });
});

describe("callTool", () => {
  it("calls the own v1 door with the same key and returns JSON as text", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await callTool({ baseUrl: "http://127.0.0.1:3000", apiKey: "k1", fetchImpl }, `${LAB_KEY}_list_notes`, {});
    expect(seen[0].url).toBe("http://127.0.0.1:3000/api/v1/notes");
    expect(seen[0].headers["x-api-key"]).toBe("k1");
    expect(result.isError).toBeUndefined();
  });

  it("turns an HTTP error into a tool error, not an exception", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const result = await callTool({ baseUrl: "http://x", apiKey: "k", fetchImpl }, `${LAB_KEY}_get_note`, { noteId: "1" });
    expect(result.isError).toBe(true);
  });

  it("rejects unknown tools", async () => {
    const result = await callTool({ baseUrl: "http://x", apiKey: "k" }, "nothing", {});
    expect(result.isError).toBe(true);
  });
});

describe("resolveSelfBaseUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never takes the address from the request: override, then PORT, then dev", () => {
    vi.stubEnv("MCP_SELF_BASE_URL", "http://proxy:9/");
    expect(resolveSelfBaseUrl()).toBe("http://proxy:9");
    vi.stubEnv("MCP_SELF_BASE_URL", "");
    vi.stubEnv("PORT", "3000");
    expect(resolveSelfBaseUrl()).toBe("http://127.0.0.1:3000");
    vi.stubEnv("PORT", "");
    expect(resolveSelfBaseUrl()).toBe("http://127.0.0.1:3390");
  });
});
