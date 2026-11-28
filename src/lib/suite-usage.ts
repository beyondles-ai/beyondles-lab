import "server-only";

import { createHash } from "node:crypto";

import { getAuthToken } from "@/lib/auth";
import { platformUrl } from "@/lib/platform/door";
import { platformCookieName } from "@/lib/session-cookies";

/**
 * How much of the organisation's package is used in the current billing
 * period, as ONE percentage. The only usage figure a customer ever sees in a
 * Lab (decision of 2026-11-20, docs/FRAME.md 9.1): Beyondles sells business
 * software at one total price, AI cost is not passed through and never shown.
 * No euro amount, no token count, no cost on any screen, in `/api/v1` or in
 * an MCP result.
 *
 * The source is the Suite alone: `GET <suite>/api/platform/usage-status` with
 * the caller's Suite cookie. The Suite knows the package and sums the real
 * cost of all products; its answer carries a percentage, a state and the
 * billing period (`periodStart`, `periodEnd`: ISO, end exclusive), never
 * tokens or euros. The Lab does not know the package and computes nothing.
 *
 * Three outcomes, kept apart on purpose:
 *  - `ok`: a percentage to show.
 *  - `hidden`: nothing to show for this person or this package. The Suite
 *    answers owners and admins only (401/403 for everyone else), and an
 *    unlimited package has no percentage.
 *  - `unavailable`: the Suite did not answer or answered something unusable.
 *    The start page says so; a failure must never look like 0 %.
 *
 * Ported from AdvisorLab `src/lib/suite-usage.ts` (2026-11-20), extended with
 * the billing period. One deliberate difference: the Suite's `warn_50` is
 * shown as `normal` here, because "almost used up" at half the package is not
 * true.
 */

const USAGE_TIMEOUT_MS = 4000;
const USAGE_CACHE_TTL_MS = 60_000;
const USAGE_CACHE_MAX = 200;

export type SuiteUsageState = "normal" | "warn" | "stopped";

export type SuiteUsage =
  | {
      kind: "ok";
      percent: number;
      state: SuiteUsageState;
      degraded: boolean;
      /** First moment of the billing period, ISO, or `null` when the Suite sent none. */
      periodStart: string | null;
      /** End of the billing period, ISO, EXCLUSIVE (the first moment after it), or `null`. */
      periodEnd: string | null;
    }
  | { kind: "hidden" }
  | { kind: "unavailable" };

/** An ISO timestamp as sent, or `null` for anything that is not a readable date. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * The Suite's answer in our shape. Exported so the mapping is tested without
 * a Suite.
 *
 * A percentage that is missing while the state says `unlimited` is a package
 * without a limit (hidden). Any other missing or non-numeric percentage is an
 * answer we cannot read (unavailable), never 0 %.
 */
export function toSuiteUsage(body: unknown): SuiteUsage {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "unavailable" };
  const row = body as Record<string, unknown>;
  const state = typeof row.state === "string" ? row.state : "";
  const percent = row.percent;

  if (percent === null || percent === undefined) {
    return state === "unlimited" ? { kind: "hidden" } : { kind: "unavailable" };
  }
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
    return { kind: "unavailable" };
  }

  return {
    kind: "ok",
    percent: Math.round(percent),
    state: state === "stopped" ? "stopped" : state === "warn_75" || state === "warn_90" ? "warn" : "normal",
    degraded: row.degraded === true,
    periodStart: isoOrNull(row.periodStart),
    periodEnd: isoOrNull(row.periodEnd),
  };
}

const usageCache = new Map<string, { usage: SuiteUsage; validUntil: number }>();

function cachePut(key: string, usage: SuiteUsage): void {
  if (usageCache.size >= USAGE_CACHE_MAX) {
    const oldest = usageCache.keys().next().value;
    if (oldest !== undefined) usageCache.delete(oldest);
  }
  usageCache.set(key, { usage, validUntil: Date.now() + USAGE_CACHE_TTL_MS });
}

export interface FetchSuiteUsageOptions {
  /** The caller's Suite token; read from the cookie when left out. */
  token?: string | null;
  /** The Suite of this environment; `platformUrl()` when left out. */
  suiteUrl?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * The package usage of the signed-in caller's organisation. Never throws.
 * Cached per token for a minute; a failure is not cached, so the next page
 * load asks again.
 */
export async function fetchSuiteUsage(options: FetchSuiteUsageOptions = {}): Promise<SuiteUsage> {
  const token = options.token === undefined ? await getAuthToken() : options.token;
  if (!token) return { kind: "hidden" };
  // No Suite configured: there is nobody to ask. Not a production fallback.
  const suite = options.suiteUrl === undefined ? platformUrl() : options.suiteUrl;
  if (!suite) return { kind: "unavailable" };

  const key = createHash("sha256").update(token).digest("hex");
  const hit = usageCache.get(key);
  if (hit && hit.validUntil > Date.now()) return hit.usage;
  if (hit) usageCache.delete(key);

  try {
    const res = await (options.fetchImpl ?? fetch)(`${suite.replace(/\/+$/, "")}/api/platform/usage-status`, {
      headers: { cookie: `${platformCookieName()}=${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    // Not an owner or admin in the Suite: the figure is not theirs to see.
    if (res.status === 401 || res.status === 403) {
      const hidden: SuiteUsage = { kind: "hidden" };
      cachePut(key, hidden);
      return hidden;
    }
    if (!res.ok) return { kind: "unavailable" };
    const usage = toSuiteUsage(await res.json());
    if (usage.kind !== "unavailable") cachePut(key, usage);
    return usage;
  } catch (error) {
    // Expected while the Suite is down; the tile says "not available".
    console.warn(`[suite-usage] usage-status not reachable: ${error instanceof Error ? error.name : "error"}`);
    return { kind: "unavailable" };
  }
}

/** Tests only: empty the cache. */
export function __clearSuiteUsageCacheForTests(): void {
  usageCache.clear();
}
