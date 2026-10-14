import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  JWKS_URL,
  PLATFORM,
  TEST_ISSUER,
  keyDocument,
  signToken,
} from "../support/on-behalf";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const apiKey = { findUnique: vi.fn(), update: vi.fn() };
  const note = { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() };
  const organisation = { upsert: vi.fn() };
  return { apiKey, note, organisation, dbMock: { apiKey, note, organisation } };
});
vi.mock("@/lib/db", () => ({ db: h.dbMock }));

import { POST as mcpRoute } from "@/app/api/mcp/route";
import { DELETE as deleteNoteRoute } from "@/app/api/v1/notes/[noteId]/route";
import { GET as listNotesRoute } from "@/app/api/v1/notes/route";
import { requireApiKey } from "@/lib/api-auth";
import { ApiError } from "@/lib/api-errors";
import { __clearAccessCacheForTests } from "@/lib/platform/access";
import { __resetRateLimitForTests } from "@/lib/rate-limit";
import { __resetKeyExchangeForTests } from "@/lib/tool-door/key-exchange";
import { __resetOboDoorForTests } from "@/lib/tool-door/obo-door";
import { __resetReleaseGateForTests } from "@/lib/tool-door/release-gate";

/**
 * A Beyondles key at this Lab's machine door (door contract, sections 2 to
 * 4): sent as `x-api-key` (the door exchanges it at the platform) or as a key
 * token the client exchanged (`typ: beyondles-obo-key+jwt`). Its `scp` decide
 * the scopes, with the Lab prefix stripped; the person behind it is checked
 * like every person; the release gate and the per-key rate limit apply as to
 * a Lab key.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const KEY_ID = "5d0c0000-0000-4000-8000-000000000001";
const AUD = "examplelab";
const NOTE = "00000000-0000-4000-8000-000000000000";
const BEYONDLES_KEY = `bk_72093b0f_${createHash("sha256").update("door-test").digest("base64url")}`;

interface PersonAnswer {
  productRole?: "user" | "product_admin" | null;
  memberActive?: boolean | null;
}

let persons: Record<string, PersonAnswer>;
let released: boolean;
let exchangeAnswer: () => Response;
let scp: string[];
let calls: { url: string; headers: Record<string, string>; body?: string }[];

function keyToken(
  claims: { scp?: string[]; key?: string; sub?: string } = {},
): string {
  return signToken({
    aud: AUD,
    cp: AUD,
    org: ORG,
    sub: claims.sub ?? USER,
    role: "member",
    scp: claims.scp ?? scp,
    key: claims.key ?? KEY_ID,
  });
}

function exchanged(token: string): Response {
  const exp = Math.floor(Date.now() / 1000) + 300;
  return Response.json({
    success: true,
    data: {
      token,
      tokenType: "Bearer",
      expiresAt: new Date(exp * 1000).toISOString(),
      claims: { aud: AUD, cp: AUD, org: ORG, sub: USER, scp, key: KEY_ID, exp },
    },
  });
}

function personBody(userId: string, answer: PersonAnswer) {
  return {
    success: true,
    data: {
      userId,
      organisationId: ORG,
      email: null,
      orgRole: null,
      revokedAt: null,
      memberActive:
        answer.memberActive === undefined ? true : answer.memberActive,
      collections: [],
      settings: { membersMayShareOrg: true, membersMayCreateCollections: true },
      product: {
        key: AUD,
        productRole:
          answer.productRole === undefined ? "user" : answer.productRole,
        governed: true,
        accessMode: "assigned",
        personalAllowed: true,
      },
      grantedLevels: {},
    },
  };
}

function fakeFetch() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({
      url: input,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (input === JWKS_URL) return Response.json(keyDocument());
    if (input === `${PLATFORM}/api/keys/exchange`) return exchangeAnswer();
    const person =
      /\/api\/access\/orgs\/([^/]+)\/users\/([^/]+)\/context\?product=examplelab$/.exec(
        input,
      );
    if (person) {
      const answer = persons[decodeURIComponent(person[2])];
      if (!answer)
        return Response.json(
          { success: false, error: { code: "NOT_FOUND" } },
          { status: 404 },
        );
      return Response.json(personBody(decodeURIComponent(person[2]), answer));
    }
    if (input.startsWith(`${PLATFORM}/api/registry/released`)) {
      return Response.json({
        success: true,
        data: {
          organisationId: ORG,
          product: AUD,
          kind: "lab",
          organisationStatus: "active",
          released,
        },
      });
    }
    if (input.startsWith("http://127.0.0.1:3390/api/v1/notes"))
      return Response.json({ data: [] });
    throw new Error(`unexpected fetch ${input}`);
  });
}

function req(
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
) {
  return new NextRequest(`http://lab.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...headers,
      ...(init.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const asKey = { "x-api-key": BEYONDLES_KEY, "cf-connecting-ip": "203.0.113.7" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function refusal(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

const exchangeCalls = () =>
  calls.filter((c) => c.url.endsWith("/api/keys/exchange"));
const personCalls = () =>
  calls.filter((c) => c.url.includes("/api/access/orgs/"));
const releaseCalls = () =>
  calls.filter((c) => c.url.includes("/api/registry/released"));

beforeEach(() => {
  vi.clearAllMocks();
  persons = { [USER]: {} };
  released = true;
  scp = [`${AUD}:read`, `${AUD}:notes:delete`];
  exchangeAnswer = () => exchanged(keyToken());
  calls = [];
  vi.stubEnv("PLATFORM_API_URL", PLATFORM);
  vi.stubEnv("PLATFORM_API_KEY", "examplelab-service-key");
  vi.stubEnv("ON_BEHALF_ISSUER", TEST_ISSUER);
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_URL", "https://suite.test");
  vi.stubEnv("JWT_SECRET", "");
  vi.stubEnv("ALLOW_LOCAL_JWT", "");
  vi.stubEnv("MCP_SELF_BASE_URL", "");
  vi.stubEnv("PORT", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://examplelab-staging.beyondles.ai");
  vi.stubGlobal("fetch", fakeFetch());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  h.organisation.upsert.mockResolvedValue({});
  h.note.findMany.mockResolvedValue([]);
  h.note.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetOboDoorForTests();
  __resetReleaseGateForTests();
  __clearAccessCacheForTests();
  __resetRateLimitForTests();
  __resetKeyExchangeForTests();
});

describe("a Beyondles key as x-api-key", () => {
  it("is exchanged at the platform and acts as its owner with the scopes of scp, prefix stripped", async () => {
    const key = await requireApiKey(req("/api/v1/notes", asKey));
    expect(key).toMatchObject({
      organisationId: ORG,
      keyId: `bk:${KEY_ID}`,
      keyName: "Beyondles key",
      createdByUserId: USER,
      kind: "user",
      via: "api-key",
      onBehalf: null,
      beyondlesKeyId: KEY_ID,
    });
    expect(key.scopes).toEqual(["read", "notes:delete"]);
    expect(key.access).toMatchObject({ userId: USER, organisationId: ORG });

    expect(exchangeCalls()).toHaveLength(1);
    expect(exchangeCalls()[0].headers["X-API-Key"]).toBe(
      "examplelab-service-key",
    );
    expect(JSON.parse(exchangeCalls()[0].body ?? "{}")).toEqual({
      key: BEYONDLES_KEY,
      audience: AUD,
    });
    // The Lab's own key table is never asked for a Beyondles key.
    expect(h.apiKey.findUnique).not.toHaveBeenCalled();
    // The person behind the key is checked, and the release gate applies like to every key.
    expect(personCalls()).toHaveLength(1);
    expect(releaseCalls()).toHaveLength(1);
  });

  it("reuses the exchanged token: a second request does not exchange again", async () => {
    await requireApiKey(req("/api/v1/notes", asKey));
    await requireApiKey(req("/api/v1/notes", asKey));
    expect(exchangeCalls()).toHaveLength(1);
  });

  it("scp decides: a key with write only is refused for a read function", async () => {
    scp = [`${AUD}:write`];
    const res = await listNotesRoute(req("/api/v1/notes", asKey));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "insufficient_scope",
    );
  });

  it("scp decides: notes:delete reaches the delete route, without it the route refuses", async () => {
    scp = [`${AUD}:read`, `${AUD}:write`];
    const without = await deleteNoteRoute(
      req(`/api/v1/notes/${NOTE}`, asKey, { method: "DELETE" }),
      {
        params: Promise.resolve({ noteId: NOTE }),
      },
    );
    expect(without.status).toBe(403);
    expect(
      ((await without.json()) as { error: { message: string } }).error.message,
    ).toMatch(/notes:delete/);

    // Another key (another cache entry) with notes:delete passes the door; the note does not exist.
    __resetKeyExchangeForTests();
    scp = [`${AUD}:write`, `${AUD}:notes:delete`];
    exchangeAnswer = () => exchanged(keyToken());
    const withScope = await deleteNoteRoute(
      req(`/api/v1/notes/${NOTE}`, asKey, { method: "DELETE" }),
      {
        params: Promise.resolve({ noteId: NOTE }),
      },
    );
    expect(withScope.status).toBe(404);
  });

  it("the person checks still apply: an owner without product access is refused like a Lab key", async () => {
    persons[USER] = { productRole: null };
    const error = await refusal(requireApiKey(req("/api/v1/notes", asKey)));
    expect(error).toMatchObject({ status: 403, code: "KEY_OWNER_NO_ACCESS" });
  });

  it("the person checks still apply: an owner who left the organisation is refused", async () => {
    persons[USER] = { memberActive: false };
    const error = await refusal(requireApiKey(req("/api/v1/notes", asKey)));
    expect(error.status).toBe(403);
    expect(["PERSON_GONE", "KEY_OWNER_NO_ACCESS"]).toContain(error.code);
  });

  it("the release gate applies: not released for the key's organisation = 403 lab_not_released", async () => {
    released = false;
    const error = await refusal(requireApiKey(req("/api/v1/notes", asKey)));
    expect(error).toMatchObject({ status: 403, code: "lab_not_released" });
  });

  it("a refused exchange is 401, and an unreachable platform is 503", async () => {
    exchangeAnswer = () =>
      Response.json(
        { success: false, error: { code: "KEY_INVALID" } },
        { status: 401 },
      );
    expect(
      await refusal(requireApiKey(req("/api/v1/notes", asKey))),
    ).toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    __resetKeyExchangeForTests();
    exchangeAnswer = () => {
      throw new Error("ECONNREFUSED");
    };
    expect(
      await refusal(requireApiKey(req("/api/v1/notes", asKey))),
    ).toMatchObject({
      status: 503,
      code: "key_check_unavailable",
    });
  });

  it("without ON_BEHALF_ISSUER answers 503 not_configured and spends no exchange", async () => {
    vi.stubEnv("ON_BEHALF_ISSUER", "");
    expect(
      await refusal(requireApiKey(req("/api/v1/notes", asKey))),
    ).toMatchObject({
      status: 503,
      code: "not_configured",
    });
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("a classic token from the exchange is never accepted for a key (it would carry fallback scopes)", async () => {
    exchangeAnswer = () =>
      exchanged(signToken({ aud: AUD, cp: AUD, org: ORG, sub: USER }));
    expect(
      await refusal(requireApiKey(req("/api/v1/notes", asKey))),
    ).toMatchObject({
      status: 503,
      code: "key_check_unavailable",
    });
  });

  it("a value with another shape goes to the Lab's own key table, not to the platform", async () => {
    h.apiKey.findUnique.mockResolvedValue(null);
    const error = await refusal(
      requireApiKey(req("/api/v1/notes", { "x-api-key": "bk_short" })),
    );
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
    expect(exchangeCalls()).toHaveLength(0);
    expect(h.apiKey.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("a key token as Bearer (the client exchanged the key itself)", () => {
  it("gets exactly the scopes of its scp, prefix stripped, and its owner's view", async () => {
    const token = keyToken({ scp: [`${AUD}:write`] });
    const key = await requireApiKey(req("/api/v1/notes", bearer(token)));
    expect(key).toMatchObject({
      keyId: `bk:${KEY_ID}`,
      keyName: "Beyondles key",
      createdByUserId: USER,
      kind: "user",
      via: "on-behalf",
      beyondlesKeyId: KEY_ID,
      onBehalf: { callingProduct: AUD, userId: USER, agent: null },
    });
    expect(key.scopes).toEqual(["write"]);
    expect(personCalls()).toHaveLength(1);
    expect(exchangeCalls()).toHaveLength(0);
  });

  it("passes the release gate like a key (a classic token does not)", async () => {
    released = false;
    const error = await refusal(
      requireApiKey(req("/api/v1/notes", bearer(keyToken()))),
    );
    expect(error).toMatchObject({ status: 403, code: "lab_not_released" });
    expect(releaseCalls()).toHaveLength(1);
  });

  it("still checks the person: an owner without product access is refused", async () => {
    persons[USER] = { productRole: null };
    const error = await refusal(
      requireApiKey(req("/api/v1/notes", bearer(keyToken()))),
    );
    expect(error).toMatchObject({ status: 403, code: "no_product_access" });
  });

  it("an empty scp grants nothing, even for a person", async () => {
    const res = await listNotesRoute(
      req("/api/v1/notes", bearer(keyToken({ scp: [] }))),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "insufficient_scope",
    );
  });

  it("counts per key with the key limits, in both forms together", async () => {
    vi.stubEnv("API_RATE_LIMIT_PER_MINUTE", "2");
    vi.stubEnv("ON_BEHALF_RATE_LIMIT_PER_MINUTE", "1000");
    await requireApiKey(req("/api/v1/notes", bearer(keyToken())));
    await requireApiKey(req("/api/v1/notes", asKey));
    const error = await refusal(
      requireApiKey(req("/api/v1/notes", bearer(keyToken()))),
    );
    expect(error).toMatchObject({ status: 429, code: "rate_limited" });
    expect(error.headers["Retry-After"]).toMatch(/^\d+$/);
  });

  it("both credentials at once stay 400 ambiguous_credential", async () => {
    const error = await refusal(
      requireApiKey(req("/api/v1/notes", { ...bearer(keyToken()), ...asKey })),
    );
    expect(error).toMatchObject({ status: 400, code: "ambiguous_credential" });
    expect(exchangeCalls()).toHaveLength(0);
  });
});

describe("POST /api/mcp with a Beyondles key", () => {
  it("forwards the key unchanged to the self-call and names the key in the log line", async () => {
    const log = vi.mocked(console.log);
    const res = await mcpRoute(
      req("/api/mcp", asKey, {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "examplelab_list_notes", arguments: {} },
        },
      }),
    );
    expect(res.status).toBe(200);
    const self = calls.find((c) =>
      c.url.startsWith("http://127.0.0.1:3390/api/v1/notes"),
    );
    expect(self?.headers).toEqual({ "x-api-key": BEYONDLES_KEY });
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(
      `[tool-door] via=api-key cp=- org=${ORG} sub=${USER} agent=- tool=examplelab_list_notes outcome=ok jti=- key=${KEY_ID}`,
    );
  });
});
