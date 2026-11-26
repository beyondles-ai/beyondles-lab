import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/platform/brain-status/route";
import { resetBrainClientForTests } from "@/lib/platform/memory";

/**
 * `GET /api/platform/brain-status` (the Lab side of the contract edge
 * `brain-memory-recall`): export key like the export route, one real recall
 * through the shared client, and an answer that holds states and codes only.
 * The network is a fake `fetch` playing platform-api (token) and The Brain.
 */

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAIN = "https://brain-api.test";
const PLATFORM = "https://platform.test";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeNetwork(recall: () => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    let answer: { status: number; body: unknown };
    if (url === `${PLATFORM}/api/on-behalf/token`) {
      answer = { status: 200, body: { success: true, data: { token: "obo-token", expiresAt: new Date(Date.now() + 300_000).toISOString() } } };
    } else if (url === `${BRAIN}/api/memory/recall`) {
      answer = recall();
    } else {
      answer = { status: 404, body: { success: false, error: { code: "NOT_FOUND", message: "unexpected" } } };
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, fetchImpl };
}

function request(key: string | undefined, organisationId = ORG): NextRequest {
  return new NextRequest(`http://lab.test/api/platform/brain-status?organisationId=${organisationId}`, {
    headers: key === undefined ? {} : { "x-api-key": key },
  });
}

function stubSettings(settings: Record<string, string>) {
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
}

const STAGING = {
  PLATFORM_EXPORT_KEY: "export-key",
  BRAIN_API_URL: BRAIN,
  PLATFORM_API_URL: PLATFORM,
  PLATFORM_API_KEY: "lab-service-key",
  ON_BEHALF_ISSUER: "beyondles-platform:staging",
};

const anItem = {
  id: "11111111-1111-4111-8111-111111111111",
  brainId: "22222222-2222-4222-8222-222222222222",
  brainKind: "organisation",
  title: "Confidential title",
  snippet: "Confidential snippet",
  content: "Confidential content",
  source: "lab",
  sourceRef: "note:1",
  kind: "fact",
  event: null,
  reviewState: "confirmed",
  occurredAt: null,
  originEntryId: null,
  originBrainId: null,
  score: 0.9,
};

beforeEach(() => {
  resetBrainClientForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/platform/brain-status", () => {
  it("is closed without PLATFORM_EXPORT_KEY (503) and refuses a wrong key (401), without any call", async () => {
    const { fetchImpl } = fakeNetwork(() => ({ status: 200, body: { success: true, data: { items: [] } } }));
    stubSettings({ ...STAGING, PLATFORM_EXPORT_KEY: "" });
    const closed = await GET(request("anything"));
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("no-store");

    stubSettings(STAGING);
    expect((await GET(request(undefined))).status).toBe(401);
    expect((await GET(request("wrong-key"))).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an organisation id that is not a uuid", async () => {
    stubSettings(STAGING);
    const res = await GET(request("export-key", "not-a-uuid"));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("recalls once with an on-behalf token and answers ok with a count, never the items or a setting", async () => {
    const { calls } = fakeNetwork(() => ({ status: 200, body: { success: true, data: { items: [anItem] } } }));
    stubSettings(STAGING);
    const res = await GET(request("export-key"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ success: true, data: { state: "ok", environment: "staging", items: 1 } });
    for (const secret of ["Confidential", "brain-api.test", "platform.test", "lab-service-key", "obo-token", "export-key"]) {
      expect(text, secret).not.toContain(secret);
    }

    const recall = calls.filter((c) => c.url === `${BRAIN}/api/memory/recall`);
    expect(recall).toHaveLength(1);
    expect(recall[0].method).toBe("POST");
    expect(recall[0].body).toMatchObject({ limit: 1 });
    // Only the token route and the recall: nothing is written.
    expect(calls.map((c) => c.url).sort()).toEqual([`${BRAIN}/api/memory/recall`, `${PLATFORM}/api/on-behalf/token`]);
  });

  it("answers failed with the client's code and status when The Brain refuses", async () => {
    fakeNetwork(() => ({ status: 401, body: { success: false, error: { code: "UNAUTHORIZED", message: "token" } } }));
    stubSettings(STAGING);
    const body = await (await GET(request("export-key"))).json();
    expect(body).toEqual({
      success: true,
      data: { state: "failed", environment: "staging", failure: { code: "UNAUTHORIZED", status: 401 } },
    });
  });

  it("answers unconfigured with the NAMES of the missing settings, without any call", async () => {
    const { fetchImpl } = fakeNetwork(() => ({ status: 200, body: { success: true, data: { items: [] } } }));
    stubSettings({ ...STAGING, BRAIN_API_URL: "" });
    const body = await (await GET(request("export-key"))).json();
    expect(body).toEqual({ success: true, data: { state: "unconfigured", environment: "staging", missing: ["BRAIN_API_URL"] } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never calls the production Brain, the dashboard or the platform from staging, and names no host", async () => {
    for (const url of ["https://api.beyondles.ai", "https://brain-staging.beyondles.ai", PLATFORM]) {
      resetBrainClientForTests();
      const { fetchImpl } = fakeNetwork(() => ({ status: 200, body: { success: true, data: { items: [] } } }));
      stubSettings({ ...STAGING, BRAIN_API_URL: url });
      const text = await (await GET(request("export-key"))).text();
      expect(JSON.parse(text), url).toEqual({ success: true, data: { state: "wrong-host", environment: "staging" } });
      expect(text, url).not.toContain(new URL(url).hostname);
      expect(fetchImpl, url).not.toHaveBeenCalled();
    }
  });

  it("treats an environment it cannot name like staging: no call to the production Brain", async () => {
    const { fetchImpl } = fakeNetwork(() => ({ status: 200, body: { success: true, data: { items: [] } } }));
    stubSettings({ ...STAGING, ON_BEHALF_ISSUER: "", BRAIN_API_URL: "https://api.beyondles.ai" });
    const body = await (await GET(request("export-key"))).json();
    expect(body).toEqual({ success: true, data: { state: "wrong-host", environment: "unknown" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets a production Lab call the production Brain", async () => {
    const { calls } = fakeNetwork(() => ({ status: 200, body: { success: true, data: { items: [] } } }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET", headers: {}, body: null });
        if (url.endsWith("/api/on-behalf/token")) {
          return Response.json({ success: true, data: { token: "obo-token", expiresAt: new Date(Date.now() + 300_000).toISOString() } });
        }
        return Response.json({ success: true, data: { items: [] } });
      }),
    );
    stubSettings({ ...STAGING, ON_BEHALF_ISSUER: "beyondles-platform:production", BRAIN_API_URL: "https://api.beyondles.ai" });
    const body = await (await GET(request("export-key"))).json();
    expect(body).toEqual({ success: true, data: { state: "ok", environment: "production", items: 0 } });
    expect(calls.map((c) => c.url)).toContain("https://api.beyondles.ai/api/memory/recall");
  });
});
