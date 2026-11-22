import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import { lastDayOfPeriod, packageUsageTile } from "@/lib/package-usage-view";
import { __clearSuiteUsageCacheForTests, fetchSuiteUsage, toSuiteUsage, type SuiteUsage } from "@/lib/suite-usage";

/**
 * Usage is shown to customers as ONE percentage of the package, from the
 * Suite, never in euro or tokens (docs/FRAME.md 9.1, decision 2026-11-20).
 * Pinned here: the Suite answer maps to show / hide / unavailable, a failure
 * never becomes 0 %, the billing period is carried through, and the tile
 * texts name the billing period and never a month, a cost or a token.
 */

const PERIOD = { periodStart: "2026-11-15T00:00:00.000Z", periodEnd: "2026-12-15T00:00:00.000Z" };

describe("the Suite answer as a usage figure", () => {
  it("shows a rounded percentage with its state and the billing period", () => {
    expect(toSuiteUsage({ percent: 42.4, state: "ok", degraded: false, ...PERIOD })).toEqual({
      kind: "ok",
      percent: 42,
      state: "normal",
      degraded: false,
      ...PERIOD,
    });
    expect(toSuiteUsage({ percent: 91, state: "warn_90" })).toMatchObject({ kind: "ok", state: "warn" });
    expect(toSuiteUsage({ percent: 76, state: "warn_75" })).toMatchObject({ kind: "ok", state: "warn" });
    expect(toSuiteUsage({ percent: 100, state: "stopped" })).toMatchObject({ kind: "ok", state: "stopped" });
    expect(toSuiteUsage({ percent: 0, state: "ok" })).toMatchObject({ kind: "ok", percent: 0 });
  });

  it("does not call half the package 'almost used up'", () => {
    expect(toSuiteUsage({ percent: 55, state: "warn_50" })).toMatchObject({ kind: "ok", state: "normal" });
  });

  it("carries no unreadable period", () => {
    expect(toSuiteUsage({ percent: 10, state: "ok", periodStart: "soon", periodEnd: 5 })).toMatchObject({
      periodStart: null,
      periodEnd: null,
    });
  });

  it("hides the figure for a package without a limit", () => {
    expect(toSuiteUsage({ percent: null, state: "unlimited" })).toEqual({ kind: "hidden" });
  });

  it("never turns an unreadable answer into 0 %", () => {
    for (const body of [null, [], "42", { error: "Failed" }, { percent: null, state: "ok" }, { percent: "12" }, { percent: -1 }, { percent: Number.NaN }]) {
      expect(toSuiteUsage(body)).toEqual({ kind: "unavailable" });
    }
  });
});

describe("asking the Suite", () => {
  beforeEach(() => __clearSuiteUsageCacheForTests());

  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  it("asks usage-status with the caller's Suite cookie", async () => {
    const fetchImpl = answer(200, { percent: 12, state: "ok", ...PERIOD });
    const usage = await fetchSuiteUsage({ token: "tok-1", suiteUrl: "https://suite.test/", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(usage).toMatchObject({ kind: "ok", percent: 12 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://suite.test/api/platform/usage-status");
    expect((init.headers as Record<string, string>).cookie).toBe("platform-auth-token=tok-1");
  });

  it("hides the figure for 401 and 403 (not an owner or admin)", async () => {
    for (const status of [401, 403]) {
      __clearSuiteUsageCacheForTests();
      const fetchImpl = answer(status, { error: "Forbidden" });
      expect(await fetchSuiteUsage({ token: "tok", suiteUrl: "https://suite.test", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ kind: "hidden" });
    }
  });

  it("says unavailable for a server error, a network error and a missing Suite", async () => {
    const broken = answer(500, { error: "x" });
    expect(await fetchSuiteUsage({ token: "tok", suiteUrl: "https://suite.test", fetchImpl: broken as unknown as typeof fetch })).toEqual({ kind: "unavailable" });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await fetchSuiteUsage({ token: "tok", suiteUrl: "https://suite.test", fetchImpl: offline as unknown as typeof fetch })).toEqual({ kind: "unavailable" });
    warn.mockRestore();
    expect(await fetchSuiteUsage({ token: "tok", suiteUrl: null })).toEqual({ kind: "unavailable" });
  });

  it("shows nothing without a sign-in", async () => {
    expect(await fetchSuiteUsage({ token: null, suiteUrl: "https://suite.test" })).toEqual({ kind: "hidden" });
  });

  it("remembers an answer for a minute but never a failure", async () => {
    const failing = answer(503, {});
    await fetchSuiteUsage({ token: "tok", suiteUrl: "https://suite.test", fetchImpl: failing as unknown as typeof fetch });
    const ok = answer(200, { percent: 30, state: "ok" });
    const opts = { token: "tok", suiteUrl: "https://suite.test", fetchImpl: ok as unknown as typeof fetch };
    expect(await fetchSuiteUsage(opts)).toMatchObject({ kind: "ok", percent: 30 });
    expect(await fetchSuiteUsage(opts)).toMatchObject({ kind: "ok", percent: 30 });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe("the start-page tile", () => {
  const translator = (messages: typeof en) => (key: string, values: Record<string, string | number> = {}) => {
    const text = (messages.dashboard as Record<string, string>)[key];
    if (text === undefined) throw new Error(`missing dashboard.${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  };
  const ok = (patch: Partial<Extract<SuiteUsage, { kind: "ok" }>> = {}): SuiteUsage => ({
    kind: "ok",
    percent: 42,
    state: "normal",
    degraded: false,
    ...PERIOD,
    ...patch,
  });

  it("is missing when the figure is hidden", () => {
    expect(packageUsageTile({ kind: "hidden" }, translator(en), "en")).toBeNull();
  });

  it("says 'not available' instead of 0 % when the Suite does not answer", () => {
    const tile = packageUsageTile({ kind: "unavailable" }, translator(en), "en");
    expect(tile).toMatchObject({ value: "Not available" });
    expect(tile?.value).not.toMatch(/0/);
  });

  it("shows the percentage and the last day of the billing period", () => {
    expect(packageUsageTile(ok(), translator(en), "en")).toEqual({
      label: "Package usage",
      value: "42%",
      hint: "Current billing period until 14 December 2026, all products of your organisation together.",
      hintTone: "neutral",
    });
    expect(packageUsageTile(ok(), translator(de), "de")?.hint).toBe(
      "Laufender Abrechnungszeitraum bis 14. Dezember 2026, alle Produkte Ihrer Organisation zusammen.",
    );
    expect(packageUsageTile(ok({ periodEnd: null }), translator(en), "en")?.hint).toBe(
      "Current billing period, all products of your organisation together.",
    );
  });

  it("warns when almost used up, used up, and stopped", () => {
    expect(packageUsageTile(ok({ state: "warn", percent: 91 }), translator(en), "en")).toMatchObject({ hint: "The package is almost used up.", hintTone: "negative" });
    expect(packageUsageTile(ok({ state: "warn", percent: 120 }), translator(en), "en")?.hint).toBe("The package is used up for this billing period.");
    expect(packageUsageTile(ok({ state: "stopped", percent: 100 }), translator(en), "en")?.hint).toMatch(/paused/);
  });

  it("names the billing period, never a month, a cost or a token", () => {
    for (const messages of [en, de]) {
      const texts = Object.entries(messages.dashboard)
        .filter(([key]) => key.startsWith("usage"))
        .map(([, text]) => text)
        .join(" ");
      expect(texts).not.toMatch(/month|monat|€|euro|\beur\b|token|cost|kosten/i);
    }
  });

  it("finds the last day of a period whose end is exclusive", () => {
    expect(lastDayOfPeriod("2027-01-01T00:00:00.000Z", "en")).toBe("31 December 2026");
    expect(lastDayOfPeriod(null, "en")).toBeNull();
    expect(lastDayOfPeriod("later", "de")).toBeNull();
  });
});
