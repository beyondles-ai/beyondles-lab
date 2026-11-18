import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

/**
 * The upstream sign-in check: a missing cookie goes to the Suite login with
 * the page as callbackUrl; a present cookie passes the page on to the server
 * (`x-lab-pathname`), so `rbac.requireSession` can keep it when the token
 * turns out to be expired.
 */

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_URL", "https://suite.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://examplelab.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("middleware", () => {
  it("without a cookie: Suite login with the page as callbackUrl", () => {
    const response = middleware(new NextRequest("https://examplelab.test/notes/abc"));
    expect(response.headers.get("location")).toBe(
      "https://suite.test/login?callbackUrl=https%3A%2F%2Fexamplelab.test%2Fnotes%2Fabc",
    );
  });

  it("with a cookie: passes the page and its query on as x-lab-pathname", () => {
    const request = new NextRequest("https://examplelab.test/notes/abc?tab=shared", {
      headers: { cookie: "platform-auth-token=t" },
    });
    const response = middleware(request);
    expect(response.headers.get("location")).toBeNull();
    expect(forwarded(response, "x-lab-pathname")).toBe("/notes/abc?tab=shared");
  });

  it("a client-sent x-lab-pathname is overwritten", () => {
    const request = new NextRequest("https://examplelab.test/notes", {
      headers: { cookie: "platform-auth-token=t", "x-lab-pathname": "//evil.test" },
    });
    expect(forwarded(middleware(request), "x-lab-pathname")).toBe("/notes");
  });
});
