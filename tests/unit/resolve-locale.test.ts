import { beforeEach, describe, expect, it, vi } from "vitest";

let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "NEXT_LOCALE" && cookieValue !== undefined
        ? { value: cookieValue }
        : undefined,
  }),
}));

import { resolveLocale } from "@/i18n/locale";

describe("resolveLocale", () => {
  beforeEach(() => {
    cookieValue = undefined;
  });

  it("uses the NEXT_LOCALE cookie when it is supported", async () => {
    cookieValue = "de";
    expect(await resolveLocale()).toBe("de");
    cookieValue = "en";
    expect(await resolveLocale()).toBe("en");
  });

  it("falls back to English without a cookie", async () => {
    expect(await resolveLocale()).toBe("en");
  });

  it("falls back to English for an unsupported cookie value", async () => {
    cookieValue = "fr";
    expect(await resolveLocale()).toBe("en");
  });
});
