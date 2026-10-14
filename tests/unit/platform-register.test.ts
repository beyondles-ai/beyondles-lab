import { describe, expect, it, vi } from "vitest";

import { LAB_KEY, LAB_NAME } from "@/lib/lab";
import {
  registerInBackground,
  registerOnce,
  registrationBody,
} from "@/lib/platform/register";

/**
 * Self-registration at the platform registry: the Lab tells the platform on every start that it
 * exists, so it appears in the Suite without a manual migration. It must never block or break the
 * start, and it must do nothing without a platform door.
 */

const DOOR = {
  PLATFORM_API_URL: "https://api-staging.beyondles.ai",
  PLATFORM_API_KEY: "test-key-not-real",
};
const APP = { NEXT_PUBLIC_APP_URL: `https://${LAB_KEY}-staging.beyondles.ai/` };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("registrationBody", () => {
  it("names the Lab, kind lab, with its own address and tool door", () => {
    expect(registrationBody(APP)).toEqual({
      name: LAB_NAME,
      kind: "lab",
      baseUrl: `https://${LAB_KEY}-staging.beyondles.ai`,
      toolDoorUrl: `https://${LAB_KEY}-staging.beyondles.ai/api/mcp`,
      toolDoorProtocol: "mcp",
    });
  });
  it("without an address only the name and kind", () => {
    expect(registrationBody({})).toEqual({ name: LAB_NAME, kind: "lab" });
    expect(registrationBody({ NEXT_PUBLIC_APP_URL: "not a url" })).toEqual({
      name: LAB_NAME,
      kind: "lab",
    });
  });
  it("never carries a key, a protection flag or role labels", () => {
    const body = registrationBody(APP) as unknown as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "baseUrl",
      "kind",
      "name",
      "toolDoorProtocol",
      "toolDoorUrl",
    ]);
  });
});

describe("registerOnce", () => {
  it("does nothing without a platform door", async () => {
    const fetchImpl = vi.fn();
    expect(
      await registerOnce(fetchImpl as unknown as typeof fetch, APP),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to /api/registry/self with the service key", async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, { success: true, data: { outcome: "registered" } }),
    );
    const result = await registerOnce(fetchImpl as unknown as typeof fetch, {
      ...DOOR,
      ...APP,
    });
    expect(result).toEqual({ ok: true, outcome: "registered" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api-staging.beyondles.ai/api/registry/self");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(
      DOOR.PLATFORM_API_KEY,
    );
  });

  it("a 4xx is final, a 5xx and a network error may be retried", async () => {
    const env = { ...DOOR, ...APP };
    const conflict = await registerOnce(
      (async () =>
        reply(409, {
          success: false,
          error: { code: "PRODUCT_KIND_CONFLICT" },
        })) as unknown as typeof fetch,
      env,
    );
    expect(conflict).toEqual({
      ok: false,
      status: 409,
      code: "PRODUCT_KIND_CONFLICT",
      retry: false,
    });
    const down = await registerOnce(
      (async () => reply(503, {})) as unknown as typeof fetch,
      env,
    );
    expect(down).toMatchObject({ ok: false, status: 503, retry: true });
    const network = await registerOnce(
      (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      env,
    );
    expect(network).toMatchObject({ ok: false, code: "NETWORK", retry: true });
  });
});

describe("registerInBackground", () => {
  it("retries a platform that is still starting, then succeeds", async () => {
    const answers = [
      reply(503, {}),
      reply(200, { success: true, data: { outcome: "refreshed" } }),
    ];
    const fetchImpl = vi.fn(async () => answers.shift() as Response);
    const waits: number[] = [];
    const result = await registerInBackground(
      fetchImpl as unknown as typeof fetch,
      { ...DOOR, ...APP },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(result).toEqual({ ok: true, outcome: "refreshed" });
    expect(waits).toHaveLength(1);
  });

  it("gives up after the last retry with one log line and never throws", async () => {
    const logs: string[] = [];
    const result = await registerInBackground(
      (async () => reply(503, {})) as unknown as typeof fetch,
      { ...DOOR, ...APP },
      async () => undefined,
      (line) => logs.push(line),
    );
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(logs).toHaveLength(1);
  });

  it("does not retry a refusal", async () => {
    const fetchImpl = vi.fn(async () =>
      reply(403, { success: false, error: { code: "KEY_MAY_NOT_REGISTER" } }),
    );
    await registerInBackground(
      fetchImpl as unknown as typeof fetch,
      { ...DOOR, ...APP },
      async () => undefined,
      () => undefined,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
