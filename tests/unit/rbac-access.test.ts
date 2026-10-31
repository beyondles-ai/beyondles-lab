import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The person path of `rbac.ts` on top of the shared decision
 * (`core/decide.resolvePersonAccess`): gate, door, platform, ungoverned
 * policy, and the uncached check for actions that mint a credential.
 */

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  session: {
    userId: "22222222-2222-4222-8222-222222222222",
    email: "anna@example.test",
    name: "Anna",
    role: "member",
    organisationId: "11111111-1111-4111-8111-111111111111",
    organisationSlug: "acme",
  } as Record<string, string> | null,
  upsert: vi.fn(),
  requestHeaders: new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: async () => h.session,
  getAuthToken: async () => "token-anna",
  organisationDisplayName: (s: { organisationName?: string; organisationSlug: string }) =>
    s.organisationName?.trim() || s.organisationSlug,
}));
vi.mock("next/headers", () => ({ headers: async () => h.requestHeaders }));
vi.mock("@/lib/db", () => ({ db: { organisation: { upsert: h.upsert } } }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  unstable_rethrow: () => {},
}));

import { __clearGateCacheForTests } from "@/lib/platform-access";
import { __clearAccessCacheForTests } from "@/lib/platform/access";
import { requireAccessOrNull, requireFreshAccessOrNull, requireOrg } from "@/lib/rbac";

const SESSION = h.session!;
const ME = "https://platform.test/api/access/me";
const GATE = "https://suite.test/api/labs/examplelab/access";

function meData(product: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      userId: SESSION.userId,
      organisationId: SESSION.organisationId,
      email: SESSION.email,
      orgRole: "member",
      collections: [],
      settings: { membersMayShareOrg: true, membersMayCreateCollections: true },
      product: {
        key: "examplelab",
        productRole: "user",
        mayPublish: false,
        releaseStep: null,
        accessMode: "assigned",
        personalAllowed: true,
        governed: true,
        ...product,
      },
      grantedObjects: {},
      grantedLevels: {},
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let gateBody: Record<string, unknown>;
let meBody: Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", "");
  vi.stubEnv("ALLOW_LOCAL_JWT", "");
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_URL", "https://suite.test");
  vi.stubEnv("PLATFORM_API_URL", "https://platform.test");
  vi.stubEnv("PLATFORM_API_KEY", "examplelab-service-key");
  gateBody = { allowed: true, reason: "enabled", lab: { key: "examplelab", name: "ExampleLab", enabled: true } };
  meBody = meData();
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith(GATE)) return new Response(JSON.stringify(gateBody), { status: 200 });
    if (url.startsWith(ME)) return new Response(JSON.stringify(meBody), { status: 200 });
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  __clearAccessCacheForTests();
  __clearGateCacheForTests();
  h.upsert.mockReset();
  h.session = SESSION;
  h.requestHeaders = new Headers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const meCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(ME)).length;

describe("rbac on the shared person decision", () => {
  it("gate open and a product role: access, with the organisation of the session", async () => {
    const ctx = await requireAccessOrNull();
    expect(ctx?.access.productRole).toBe("user");
    expect(ctx?.organisationId).toBe(SESSION.organisationId);
    expect(ctx?.isAdmin).toBe(false);
  });

  it("a closed Suite gate wins over a product role", async () => {
    gateBody = { allowed: false, reason: "blocked" };
    expect(await requireAccessOrNull()).toBeNull();
    const org = await requireOrg();
    expect(org.denied).toBe("blocked");
    expect(org.gate.allowed).toBe(false);
  });

  it("an ungoverned organisation without a product role is refused (policy 'refuse')", async () => {
    meBody = meData({ governed: false, productRole: null });
    expect(await requireAccessOrNull()).toBeNull();
    expect((await requireOrg()).denied).toBe("no-product-access");
  });

  it("door unconfigured in production: nobody gets in and the platform is not asked", async () => {
    vi.stubEnv("PLATFORM_API_URL", "");
    vi.stubEnv("PLATFORM_API_KEY", "");
    const org = await requireOrg();
    expect(org.access).toBeNull();
    expect(org.denied).toBe("unavailable");
    expect(org.doorState).toBe("unconfigured");
    expect(meCalls()).toBe(0);
  });

  it("creating a credential asks the platform past its 60 s cache", async () => {
    await requireAccessOrNull();
    await requireAccessOrNull();
    expect(meCalls()).toBe(1);
    const fresh = await requireFreshAccessOrNull();
    expect(fresh?.access.productRole).toBe("user");
    expect(meCalls()).toBe(2);
  });

  it("the fresh check sees a refusal the cache still hides", async () => {
    await requireAccessOrNull();
    meBody = meData({ productRole: null });
    expect(await requireAccessOrNull()).not.toBeNull();
    expect(await requireFreshAccessOrNull()).toBeNull();
  });
});

describe("redirect to the Suite login keeps the Lab page", () => {
  beforeEach(() => {
    // A cookie is present but the token expired or was revoked: no session.
    h.session = null;
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://examplelab.test");
  });

  it("sends the Lab page along as callbackUrl", async () => {
    h.requestHeaders = new Headers({ "x-lab-pathname": "/notes/abc" });
    await expect(requireOrg()).rejects.toThrow(
      "redirect:https://suite.test/login?callbackUrl=https%3A%2F%2Fexamplelab.test%2Fnotes%2Fabc",
    );
  });

  it("keeps the query string of the Lab page", async () => {
    h.requestHeaders = new Headers({ "x-lab-pathname": "/notes?tab=shared" });
    await expect(requireOrg()).rejects.toThrow(
      "redirect:https://suite.test/login?callbackUrl=https%3A%2F%2Fexamplelab.test%2Fnotes%3Ftab%3Dshared",
    );
  });

  it("without the page header: plain Suite login", async () => {
    await expect(requireOrg()).rejects.toThrow(/^redirect:https:\/\/suite\.test\/login$/);
  });

  it("a protocol-relative path is never passed on", async () => {
    h.requestHeaders = new Headers({ "x-lab-pathname": "//evil.test/x" });
    await expect(requireOrg()).rejects.toThrow(/^redirect:https:\/\/suite\.test\/login$/);
    h.requestHeaders = new Headers({ "x-lab-pathname": "/\\evil.test/x" });
    await expect(requireOrg()).rejects.toThrow(/^redirect:https:\/\/suite\.test\/login$/);
  });
});
