import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Card #466: staging and production shared the login cookies.
 *
 * Staging lives under the same parent domain as production, so the Suite's cookies on
 * `.beyondles.ai` were one set for both. A sign-in on staging replaced the production login in
 * the same browser, and the Lab read the cookie of the other environment under the one name.
 *
 * With AUTH_COOKIE_SUFFIX set (a deployment that signs in against the staging Suite) every
 * session cookie is `<name>-<suffix>`; without it (production) the names stay. What must hold:
 *   - the names per environment (src/lib/session-cookies.ts),
 *   - the middleware and the session reader read the cookie of this environment only,
 *   - both calls to the Suite (/api/auth/me and the Lab gate) send the token under the name
 *     the Suite of the same environment reads,
 *   - the frame reads its own hint and every page hands the shell the hint cookie's name,
 *   - no source file names a session cookie by hand any more.
 */

vi.mock("server-only", () => ({}));

const PRODUCTION = {
  auth: "platform-auth-token",
  refresh: "platform-refresh-token",
  hint: "platform-session-hint",
};
const STAGING = {
  auth: "platform-auth-token-staging",
  refresh: "platform-refresh-token-staging",
  hint: "platform-session-hint-staging",
};

/** The cookies of the request `next/headers` hands out; a test fills it. */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
  }),
  headers: async () => ({ get: () => null }),
}));

const USER_ID = "11111111-2222-4333-8444-555555555555";
const ORG_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** A token as the Suite mints it. Nobody checks the signature here; the Suite does. */
function accessToken(): string {
  return jwt.sign(
    {
      type: "access",
      userId: USER_ID,
      email: "person@beyondles.ai",
      name: "Test Person",
      role: "owner",
      organisationId: ORG_ID,
      organisationSlug: "beyondles-ug",
    },
    "any-secret-the-suite-would-check",
    { issuer: "company-brain", audience: "brain-app", expiresIn: "1h" },
  );
}

function runAs(environment: "staging" | "production"): void {
  if (environment === "staging") vi.stubEnv("AUTH_COOKIE_SUFFIX", "staging");
  else vi.stubEnv("AUTH_COOKIE_SUFFIX", "");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  jar.clear();
  // Introspection mode, as on the servers: no local signing secret.
  vi.stubEnv("JWT_SECRET", "");
  vi.stubEnv("ALLOW_LOCAL_JWT", "");
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_URL", "https://platform.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://lab.test");
  runAs("production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the names per environment", () => {
  it("production: the names every product has always read", async () => {
    const { platformCookieName, sessionCookies } =
      await import("@/lib/session-cookies");
    expect(sessionCookies()).toEqual(PRODUCTION);
    expect(platformCookieName()).toBe(PRODUCTION.auth);
    // An empty value in an env file is "not set".
    vi.stubEnv("AUTH_COOKIE_SUFFIX", "  ");
    expect(sessionCookies()).toEqual(PRODUCTION);
  });

  it("staging: every name carries the suffix, and none is shared with production", async () => {
    runAs("staging");
    const { platformCookieName, sessionCookies } =
      await import("@/lib/session-cookies");
    expect(sessionCookies()).toEqual(STAGING);
    expect(platformCookieName()).toBe(STAGING.auth);
    for (const name of Object.values(STAGING)) {
      expect(Object.values(PRODUCTION)).not.toContain(name);
    }
  });

  it.each([
    "Staging",
    "-staging",
    "staging-",
    "pre_view",
    "pre view",
    "staging; Domain=evil.test",
    "x".repeat(33),
  ])(
    "a malformed setting is refused, never read as no suffix: %s",
    async (bad) => {
      vi.stubEnv("AUTH_COOKIE_SUFFIX", bad);
      const { sessionCookies } = await import("@/lib/session-cookies");
      expect(() => sessionCookies()).toThrow(/AUTH_COOKIE_SUFFIX/);
    },
  );
});

describe("the middleware asks for the cookie of its environment", () => {
  async function answer(cookie: string): Promise<Response> {
    const { middleware } = await import("@/middleware");
    return middleware(
      new NextRequest("https://lab.test/some-page", {
        headers: { cookie },
      }),
    );
  }

  const passes = (res: Response) =>
    res.headers.get("x-middleware-next") === "1";
  const TO_SUITE = /^https:\/\/platform\.test\/login\?callbackUrl=/;

  it("production: its own cookie passes, a staging cookie alone goes to the sign-in", async () => {
    expect(passes(await answer(`${PRODUCTION.auth}=t`))).toBe(true);
    const res = await answer(`${STAGING.auth}=t`);
    expect(res.headers.get("location") ?? "").toMatch(TO_SUITE);
  });

  it("staging: its own cookie passes, a production cookie alone goes to the sign-in", async () => {
    runAs("staging");
    expect(passes(await answer(`${STAGING.auth}=t`))).toBe(true);
    const res = await answer(`${PRODUCTION.auth}=t`);
    expect(res.headers.get("location") ?? "").toMatch(TO_SUITE);
  });
});

describe("the session", () => {
  /** The Suite confirms the token; the answer records the cookie it was asked with. */
  function suite(): { cookies: string[] } {
    const seen: { cookies: string[] } = { cookies: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.cookies.push((init?.headers as Record<string, string>).cookie);
        return new Response(
          JSON.stringify({
            user: { id: USER_ID, email: "person@beyondles.ai", name: "P" },
          }),
          { status: 200 },
        );
      }),
    );
    return seen;
  }

  async function load() {
    const mod = await import("@/lib/auth");
    mod.__clearIntrospectionCacheForTests();
    return mod;
  }

  it("production: reads platform-auth-token and asks the Suite under that name", async () => {
    const token = accessToken();
    jar.set(PRODUCTION.auth, token);
    jar.set(STAGING.auth, "the-token-of-staging");
    const seen = suite();
    const { getAuthToken, getSession } = await load();

    expect(await getAuthToken()).toBe(token);
    expect((await getSession())?.userId).toBe(USER_ID);
    expect(seen.cookies).toEqual([`${PRODUCTION.auth}=${token}`]);
  });

  it("production: a staging cookie alone is no session, and the Suite is not asked", async () => {
    jar.set(STAGING.auth, accessToken());
    const seen = suite();
    const { getAuthToken, getSession } = await load();

    expect(await getAuthToken()).toBeUndefined();
    expect(await getSession()).toBeNull();
    expect(seen.cookies).toEqual([]);
  });

  it("staging: reads platform-auth-token-staging and asks the Suite under that name", async () => {
    runAs("staging");
    const token = accessToken();
    jar.set(STAGING.auth, token);
    jar.set(PRODUCTION.auth, "the-token-of-production");
    const seen = suite();
    const { getAuthToken, getSession } = await load();

    expect(await getAuthToken()).toBe(token);
    expect((await getSession())?.userId).toBe(USER_ID);
    expect(seen.cookies).toEqual([`${STAGING.auth}=${token}`]);
  });

  it("staging: the production cookie alone is no session, and the Suite is not asked", async () => {
    runAs("staging");
    jar.set(PRODUCTION.auth, accessToken());
    const seen = suite();
    const { getAuthToken, getSession } = await load();

    expect(await getAuthToken()).toBeUndefined();
    expect(await getSession()).toBeNull();
    expect(seen.cookies).toEqual([]);
  });
});

describe("the Lab gate is asked with the cookie name its own environment reads", () => {
  async function gateCookie(): Promise<string> {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ allowed: true, reason: "enabled" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("@/lib/platform-access");
    mod.__clearGateCacheForTests();
    await mod.getLabGate("some-token");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    return (init.headers as Record<string, string>).cookie;
  }

  it("production: platform-auth-token", async () => {
    expect(await gateCookie()).toBe(`${PRODUCTION.auth}=some-token`);
  });

  it("staging: platform-auth-token-staging", async () => {
    runAs("staging");
    expect(await gateCookie()).toBe(`${STAGING.auth}=some-token`);
  });
});

describe("the frame", () => {
  it("production: reads its own hint and names its cookie", async () => {
    jar.set(PRODUCTION.hint, "hint-of-production");
    jar.set(STAGING.hint, "hint-of-staging");
    const { frameContext } = await import("@/lib/frame");
    const frame = await frameContext("owner");
    expect(frame.sessionHint).toBe("hint-of-production");
    expect(frame.sessionHintCookie).toBe(PRODUCTION.hint);
  });

  it("staging: reads its own hint and names its cookie, the hint of production is not taken", async () => {
    runAs("staging");
    jar.set(PRODUCTION.hint, "hint-of-production");
    const { frameContext } = await import("@/lib/frame");
    const frame = await frameContext("owner");
    expect(frame.sessionHint).toBeNull();
    expect(frame.sessionHintCookie).toBe(STAGING.hint);

    jar.set(STAGING.hint, "hint-of-staging");
    expect((await frameContext("owner")).sessionHint).toBe("hint-of-staging");
  });
});

describe("the sources", () => {
  const src = path.resolve(__dirname, "..", "..", "src");

  /** Generated from beyondles-shared (never edited here): every folder with a `.shared-version`. */
  const isGenerated = (dir: string) =>
    existsSync(path.join(dir, ".shared-version"));

  function sources(): { file: string; text: string }[] {
    const found: { file: string; text: string }[] = [];
    const walk = (dir: string): void => {
      if (isGenerated(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          found.push({
            file: path.relative(src, full),
            text: readFileSync(full, "utf8"),
          });
        }
      }
    };
    walk(src);
    return found;
  }

  it("every page that hands the hint to the shell hands over the cookie's name as well", () => {
    const pages = sources().filter(({ text }) => /\bsessionHint=\{/.test(text));
    expect(pages.length).toBeGreaterThan(0);
    for (const { file, text } of pages) {
      const hints = text.match(/\bsessionHint=\{/g) ?? [];
      const names = text.match(/\bsessionHintCookie=\{/g) ?? [];
      expect(names.length, file).toBe(hints.length);
    }
  });

  it("every Suite client is given the cookie name of this environment", () => {
    const clients = sources().filter(({ text }) =>
      text.includes("createSuiteClient("),
    );
    for (const { file, text } of clients) {
      expect(text, file).toContain("cookieName: platformCookieName()");
    }
  });

  it("no source file names a session cookie by hand", () => {
    // A quoted name, or a cookie header built in a template.
    const literal =
      /(['"])platform-(auth-token|refresh-token|session-hint)\1|platform-auth-token=\$\{/;
    const offenders = sources()
      .filter(({ text }) => literal.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
    expect(literal.test('request.cookies.get("platform-auth-token")')).toBe(
      true,
    );
    expect(literal.test("cookie: `platform-auth-token=${token}`")).toBe(true);
    expect(
      literal.test("// the cookie `platform-auth-token` of the Suite"),
    ).toBe(false);
  });
});
