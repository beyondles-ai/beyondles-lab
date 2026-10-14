import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  brain,
  brainAddressProblem,
  brainConfigState,
  brainHealthField,
  forgetDeletedObjects,
  forgetMemory,
  forgetMemoryMany,
  labEnvironment,
  MEMORY_REF_PREFIXES,
  MEMORY_SOURCE,
  noteSourceRef,
  resetBrainClientForTests,
} from "@/lib/platform/memory";

/**
 * The memory door wrapper (src/lib/platform/memory.ts): which Brain address
 * counts, and what a forget really sends. The network is a fake `fetch` that
 * plays platform-api (token route) and The Brain (memory routes); everything
 * between is the real shared client and the real on-behalf token helper.
 */

const ORG = "AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENV = {
  BRAIN_API_URL: "https://brain-api.test",
  PLATFORM_API_URL: "https://platform.test",
  PLATFORM_API_KEY: "lab-service-key",
  ON_BEHALF_ISSUER: "beyondles-platform:staging",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeNetwork(options: {
  token?: (body: Record<string, unknown>) => { status: number; body: unknown };
  forget?: (body: Record<string, unknown>) => { status: number; body: unknown };
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body });
    let answer: { status: number; body: unknown };
    if (url === "https://platform.test/api/on-behalf/token") {
      answer = options.token?.(body) ?? {
        status: 200,
        body: { success: true, data: { token: "obo-token", expiresAt: new Date(Date.now() + 300_000).toISOString() } },
      };
    } else if (url === "https://brain-api.test/api/memory/forget") {
      answer = options.forget?.(body) ?? { status: 200, body: { success: true, data: { deleted: 2 } } };
    } else {
      answer = { status: 404, body: { success: false, error: { code: "NOT_FOUND", message: url } } };
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, fetchImpl };
}

beforeEach(() => {
  resetBrainClientForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the address of The Brain", () => {
  it("knows the environment from ON_BEHALF_ISSUER, else from the platform address", () => {
    expect(labEnvironment({ ON_BEHALF_ISSUER: "beyondles-platform:staging" })).toBe("staging");
    expect(labEnvironment({ ON_BEHALF_ISSUER: "beyondles-platform:production" })).toBe("production");
    expect(labEnvironment({ PLATFORM_API_URL: "https://api-staging.beyondles.ai" })).toBe("staging");
    expect(labEnvironment({ PLATFORM_API_URL: "https://platform.beyondles.ai" })).toBe("production");
    expect(labEnvironment({})).toBe("unknown");
  });

  it("accepts the API hosts of each environment", () => {
    expect(brainAddressProblem("https://api.beyondles.ai", "production")).toBeNull();
    expect(brainAddressProblem("http://10.0.0.3:3337", "staging")).toBeNull();
    expect(brainAddressProblem("http://localhost:3336", "unknown")).toBeNull();
  });

  it("refuses the dashboard, the platform, plain http to a public host and an /api suffix", () => {
    expect(brainAddressProblem("https://brain.beyondles.ai", "production")).toMatch(/dashboard/);
    expect(brainAddressProblem("https://brain-staging.beyondles.ai", "staging")).toMatch(/dashboard/);
    expect(brainAddressProblem("https://api-staging.beyondles.ai", "staging")).toMatch(/platform API/);
    expect(brainAddressProblem("https://platform.beyondles.ai", "production")).toMatch(/platform API/);
    expect(brainAddressProblem("https://same.test", "unknown", "https://same.test/")).toMatch(/platform API/);
    expect(brainAddressProblem("http://api.beyondles.ai", "production")).toMatch(/https/);
    expect(brainAddressProblem("https://api.beyondles.ai/api", "production")).toMatch(/\/api/);
    expect(brainAddressProblem("api.beyondles.ai", "production")).not.toBeNull();
  });

  it("never lets a staging Lab point at the production Brain", () => {
    expect(brainAddressProblem("https://api.beyondles.ai", "staging")).toMatch(/production Brain/);
    expect(brainConfigState({ ...ENV, BRAIN_API_URL: "https://api.beyondles.ai" })).toMatchObject({
      state: "wrong-host",
      host: "api.beyondles.ai",
      environment: "staging",
    });
  });

  it("is unconfigured without the address or without the platform door that issues the token", () => {
    expect(brainConfigState({ ...ENV, BRAIN_API_URL: "" })).toMatchObject({ state: "unconfigured", missing: ["BRAIN_API_URL"] });
    expect(brainConfigState({ ...ENV, PLATFORM_API_KEY: "" })).toMatchObject({
      state: "unconfigured",
      missing: ["PLATFORM_API_URL", "PLATFORM_API_KEY"],
    });
    expect(brainConfigState(ENV)).toEqual({ state: "ok", baseUrl: "https://brain-api.test", environment: "staging" });
    expect(brainHealthField({})).toBe("unconfigured");
  });

  it("builds no client while the settings are not usable, and one client per setting", () => {
    expect(brain({ ...ENV, BRAIN_API_URL: "" })).toBeNull();
    expect(brain({ ...ENV, BRAIN_API_URL: "https://brain.beyondles.ai" })).toBeNull();
    const first = brain(ENV);
    expect(first).not.toBeNull();
    expect(brain(ENV)).toBe(first);
    expect(brain({ ...ENV, BRAIN_API_URL: "https://other-brain.test" })).not.toBe(first);
  });
});

describe("forgetMemory", () => {
  it("asks the platform for a token with audience brain, then forgets the Lab's own source in The Brain", async () => {
    const { calls } = fakeNetwork();
    const outcome = await forgetMemory(ORG, { sourceRef: noteSourceRef("n1") }, ENV);
    expect(outcome).toEqual({ status: "forgotten", deleted: 2 });

    const [token, forget] = calls;
    expect(token.url).toBe("https://platform.test/api/on-behalf/token");
    expect(token.headers["X-API-Key"]).toBe("lab-service-key");
    // A Lab job: organisation only, no person, no agent.
    expect(token.body).toEqual({ audience: "brain", organisationId: ORG.toLowerCase() });

    expect(forget.url).toBe("https://brain-api.test/api/memory/forget");
    expect(forget.method).toBe("POST");
    expect(forget.headers.Authorization).toBe("Bearer obo-token");
    expect(forget.headers["X-API-Key"]).toBeUndefined();
    expect(forget.body).toEqual({ source: MEMORY_SOURCE, sourceRef: "note:n1" });
    expect(calls).toHaveLength(2);
  });

  it("forgets by prefix for a whole object type", async () => {
    const { calls } = fakeNetwork();
    expect(MEMORY_REF_PREFIXES).toContain("note:");
    await forgetMemory(ORG, { sourceRefPrefix: "note:" }, ENV);
    expect(calls[1].body).toEqual({ source: MEMORY_SOURCE, sourceRefPrefix: "note:" });
  });

  it("sends nothing when The Brain is not configured or the address is wrong", async () => {
    const { fetchImpl } = fakeNetwork();
    expect(await forgetMemory(ORG, { sourceRef: "note:n1" }, { ...ENV, BRAIN_API_URL: "" })).toMatchObject({ status: "not_configured" });
    expect(
      await forgetMemory(ORG, { sourceRef: "note:n1" }, { ...ENV, BRAIN_API_URL: "https://api.beyondles.ai" }),
    ).toMatchObject({ status: "not_configured", detail: expect.stringMatching(/production Brain/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls a refused organisation 'refused' (the platform issues no token for it any more)", async () => {
    fakeNetwork({
      token: () => ({ status: 403, body: { success: false, error: { code: "ORGANISATION_INACTIVE", message: "inactive" } } }),
    });
    expect(await forgetMemory(ORG, { sourceRef: "note:n1" }, ENV)).toMatchObject({ status: "refused", code: "FORBIDDEN" });
  });

  it("calls an unreachable Brain 'failed', so a deletion run can say so and try again", async () => {
    fakeNetwork({ forget: () => ({ status: 503, body: { success: false, error: { code: "DOWN", message: "down" } } }) });
    expect(await forgetMemory(ORG, { sourceRef: "note:n1" }, ENV)).toMatchObject({ status: "failed", code: "UNREACHABLE" });
  });

  it("calls a broken edge 'failed' (the platform does not know The Brain)", async () => {
    fakeNetwork({
      token: () => ({ status: 404, body: { success: false, error: { code: "AUDIENCE_UNKNOWN", message: "no brain" } } }),
    });
    expect(await forgetMemory(ORG, { sourceRef: "note:n1" }, ENV)).toMatchObject({ status: "failed", code: "UNAUTHORIZED" });
  });
});

describe("forgetMemoryMany and forgetDeletedObjects", () => {
  it("forgets every object, adds up, and keeps failures apart from refusals", async () => {
    fakeNetwork({
      forget: (body) =>
        body.sourceRef === "note:bad"
          ? { status: 503, body: { success: false, error: { code: "DOWN", message: "down" } } }
          : body.sourceRef === "note:gone"
            ? { status: 403, body: { success: false, error: { code: "FORBIDDEN", message: "no" } } }
            : { status: 200, body: { success: true, data: { deleted: 1 } } },
    });
    const refs = ["note:a", "note:b", "note:bad", "note:gone", "note:c"];
    const outcome = await forgetMemoryMany(ORG, refs, ENV);
    expect(outcome.deleted).toBe(3);
    expect(outcome.failed).toEqual([{ sourceRef: "note:bad", code: "UNREACHABLE" }]);
    expect(outcome.refused).toEqual([{ sourceRef: "note:gone", code: "FORBIDDEN" }]);
    expect(outcome.notConfigured).toBeNull();
  });

  it("stops sending after The Brain proved down, and reports the rest failed for the retry", async () => {
    const { calls } = fakeNetwork({ forget: () => ({ status: 503, body: { success: false, error: { code: "DOWN", message: "down" } } }) });
    const refs = Array.from({ length: 40 }, (_, i) => `note:n${i}`);
    const outcome = await forgetMemoryMany(ORG, refs, ENV);
    const sent = calls.filter((c) => c.url === "https://brain-api.test/api/memory/forget");
    // One wave of parallel calls (the concurrency limit), not one call per object.
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(outcome.failed).toHaveLength(40);
    expect(new Set(outcome.failed.map((f) => f.code))).toEqual(new Set(["UNREACHABLE"]));
    expect(outcome.failed.map((f) => f.sourceRef).sort()).toEqual([...refs].sort());
    expect(outcome.deleted).toBe(0);
  });

  it("keeps sending after a refusal about one object", async () => {
    const { calls } = fakeNetwork({
      forget: (body) =>
        body.sourceRef === "note:n0"
          ? { status: 403, body: { success: false, error: { code: "FORBIDDEN", message: "no" } } }
          : { status: 200, body: { success: true, data: { deleted: 1 } } },
    });
    const refs = Array.from({ length: 20 }, (_, i) => `note:n${i}`);
    const outcome = await forgetMemoryMany(ORG, refs, ENV);
    expect(calls.filter((c) => c.url === "https://brain-api.test/api/memory/forget")).toHaveLength(20);
    expect(outcome.deleted).toBe(19);
    expect(outcome.refused).toEqual([{ sourceRef: "note:n0", code: "FORBIDDEN" }]);
  });

  it("stops at once when The Brain is not configured", async () => {
    const { fetchImpl } = fakeNetwork();
    const outcome = await forgetMemoryMany(ORG, ["note:a", "note:b"], { ...ENV, BRAIN_API_URL: "" });
    expect(outcome.notConfigured).toMatch(/BRAIN_API_URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list", async () => {
    const { fetchImpl } = fakeNetwork();
    expect(await forgetMemoryMany(ORG, [], ENV)).toEqual({ deleted: 0, failed: [], refused: [], notConfigured: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logs ids and codes of a failed forget, never content, and never throws", async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    fakeNetwork({ forget: () => ({ status: 503, body: { success: false, error: { code: "DOWN", message: "secret text" } } }) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await forgetDeletedObjects(ORG, ["note:n1"]);
    expect(outcome.failed).toHaveLength(1);
    const lines = errors.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(
      `[memory] forget failed source=${MEMORY_SOURCE} organisation=${ORG.toLowerCase()} ref=note:n1 code=UNREACHABLE`,
    );
    expect(lines.join("\n")).not.toContain("secret text");
    vi.unstubAllEnvs();
  });

  it("writes at most 20 failure lines and one line with the rest", async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    fakeNetwork({ forget: () => ({ status: 503, body: { success: false, error: { code: "DOWN", message: "down" } } }) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await forgetDeletedObjects(ORG, Array.from({ length: 50 }, (_, i) => `note:n${i}`));
    expect(outcome.failed).toHaveLength(50);
    const lines = errors.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toBe(`[memory] forget failed source=${MEMORY_SOURCE} organisation=${ORG.toLowerCase()} and 30 more objects`);
    vi.unstubAllEnvs();
  });
});
