import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import {
  __clearIntrospectionCacheForTests,
  introspect,
  organisationDisplayName,
  sessionFromPayload,
} from "@/lib/auth";

const ORG = "11111111-1111-4111-8111-111111111111";

function token(payload: Record<string, unknown>): string {
  return jwt.sign(payload, "test-secret", { issuer: "company-brain", audience: "brain-app" });
}

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("sessionFromPayload", () => {
  it("rejects refresh tokens", () => {
    expect(sessionFromPayload({ type: "refresh", userId: "u", organisationId: ORG })).toBeNull();
  });

  it("rejects a token without a uuid organisation — empty means REJECT, never default", () => {
    expect(sessionFromPayload({ type: "access", userId: "u", organisationId: "" })).toBeNull();
    expect(sessionFromPayload({ type: "access", userId: "u", organisationId: "42" })).toBeNull();
    expect(sessionFromPayload({ type: "access", userId: "u" })).toBeNull();
  });

  it("builds a session from a valid access token", () => {
    const s = sessionFromPayload({ type: "access", userId: "u1", email: "a@b.c", organisationId: ORG, role: "owner" });
    expect(s).toMatchObject({ userId: "u1", email: "a@b.c", organisationId: ORG, role: "owner" });
  });
});

describe("introspect", () => {
  beforeEach(() => {
    __clearIntrospectionCacheForTests();
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_URL", "https://suite.example");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the session only when the Suite confirms the SAME user", async () => {
    const t = token({ type: "access", userId: "u1", organisationId: ORG, email: "old@x.y" });
    const ok = await introspect(t, fakeFetch(200, { user: { id: "u1", email: "new@x.y" } }));
    expect(ok?.organisationId).toBe(ORG);
    expect(ok?.email).toBe("new@x.y"); // the Suite's answer is fresher than the token

    __clearIntrospectionCacheForTests();
    const other = await introspect(t, fakeFetch(200, { user: { id: "somebody-else" } }));
    expect(other).toBeNull();
  });

  it("treats 401 as no session and a network error as no session", async () => {
    const t = token({ type: "access", userId: "u1", organisationId: ORG });
    expect(await introspect(t, fakeFetch(401, {}))).toBeNull();
    __clearIntrospectionCacheForTests();
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await introspect(t, failing)).toBeNull();
  });

  it("takes the organisation's display name from the Suite, only for the token's organisation", async () => {
    const t = token({ type: "access", userId: "u1", organisationId: ORG, organisationSlug: "acme" });
    const named = await introspect(t, fakeFetch(200, { user: { id: "u1" }, organisation: { id: ORG, name: " Acme GmbH " } }));
    expect(named?.organisationName).toBe("Acme GmbH");
    expect(named && organisationDisplayName(named)).toBe("Acme GmbH");

    __clearIntrospectionCacheForTests();
    const foreign = await introspect(
      t,
      fakeFetch(200, { user: { id: "u1" }, organisation: { id: "22222222-2222-4222-8222-222222222222", name: "Other" } }),
    );
    expect(foreign?.organisationName).toBeUndefined();
    expect(foreign && organisationDisplayName(foreign)).toBe("acme");

    __clearIntrospectionCacheForTests();
    const older = await introspect(t, fakeFetch(200, { user: { id: "u1" }, organisation: { id: ORG, name: "  " } }));
    expect(older && organisationDisplayName(older)).toBe("acme");
  });

  it("returns nobody when no Suite is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_URL", "");
    const t = token({ type: "access", userId: "u1", organisationId: ORG });
    expect(await introspect(t, fakeFetch(200, { user: { id: "u1" } }))).toBeNull();
  });
});
