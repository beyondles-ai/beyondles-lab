/**
 * Rate limit for the machine doors (the REST door `v1` and the MCP door `mcp`).
 *
 * Counted per door and per credential: an API key counts as `key:<id>`, an on-behalf token as
 * `cp:<calling product>:<organisation>`. Fixed one-minute windows. Over the limit the product
 * answers `429 rate_limited` with `Retry-After` (JSON-RPC `-32029` on the MCP door).
 *
 * Default limits per minute, tunable by the product's settings (empty = default, `0` = off):
 *   API_RATE_LIMIT_PER_MINUTE        120  per key on the REST door
 *   MCP_RATE_LIMIT_PER_MINUTE         60  per key on the MCP door
 *   ON_BEHALF_RATE_LIMIT_PER_MINUTE  600  per calling product and organisation, per door
 * A tool call also passes the REST door (the tool calls it with the same credential), so the REST
 * limit should stay above the MCP limit.
 *
 * This module reads NO process environment. The product passes its settings in
 * (`rateLimitFor(door, credential, settings)`, usually inside the `limitFor` of
 * `createRateLimiter`), so the names stay visible in the product where its deployment tests look.
 *
 * PER PROCESS. The default store lives in memory: two containers or a restart each count from zero.
 * A product with several replicas passes a shared store (`store` or `setStore`); the interface is
 * one synchronous-looking method so a shared store can implement it with a local cache in front.
 *
 * Moved from the Lab template (`src/lib/rate-limit.ts`) for #383.
 */

export type RateDoor = "v1" | "mcp";
export type RateCredential = "key" | "on-behalf";

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(bucket: string, limit: number, windowMs: number, now: number): RateDecision;
}

export const RATE_LIMIT_DEFAULTS = { v1: 120, mcp: 60, onBehalf: 600 } as const;

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** The product's three settings as raw strings (`process.env.NAME` in the product). */
export interface RateLimitSettings {
  API_RATE_LIMIT_PER_MINUTE?: string;
  MCP_RATE_LIMIT_PER_MINUTE?: string;
  ON_BEHALF_RATE_LIMIT_PER_MINUTE?: string;
}

/** In-memory fixed window. `maxBuckets` bounds memory; expired buckets are swept when it is reached. */
export function createMemoryStore(maxBuckets = 10_000): RateLimitStore {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return {
    hit(bucket, limit, windowMs, now) {
      let entry = buckets.get(bucket);
      if (!entry || now - entry.windowStart >= windowMs) {
        if (!entry && buckets.size >= maxBuckets) {
          for (const [key, value] of buckets) if (now - value.windowStart >= windowMs) buckets.delete(key);
        }
        entry = { windowStart: now, count: 0 };
        buckets.set(bucket, entry);
      }
      entry.count += 1;
      if (entry.count > limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000));
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }
      return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
    },
  };
}

/** A setting as a limit: empty or not a whole number >= 0 keeps the default. */
export function readLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** The limit for one door and credential kind, from the product's settings. */
export function rateLimitFor(door: RateDoor, credential: RateCredential, settings: RateLimitSettings): number {
  if (credential === "on-behalf") {
    return readLimit(settings.ON_BEHALF_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_DEFAULTS.onBehalf);
  }
  return door === "mcp"
    ? readLimit(settings.MCP_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_DEFAULTS.mcp)
    : readLimit(settings.API_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_DEFAULTS.v1);
}

export interface RateLimiter {
  check(input: { door: RateDoor; credential: RateCredential; subject: string; now?: number }): RateDecision;
  /** Replace the store once at start-up (shared store for several replicas). */
  setStore(next: RateLimitStore): void;
  /** Tests only: a fresh in-memory store. */
  reset(): void;
}

/**
 * One limiter per process. `limitFor` is asked on every check, so a changed setting applies at
 * once (the template's behaviour); a limit of `0` never refuses and does not touch the store.
 */
export function createRateLimiter(options: {
  limitFor: (door: RateDoor, credential: RateCredential) => number;
  store?: RateLimitStore;
  windowMs?: number;
  now?: () => number;
}): RateLimiter {
  let store = options.store ?? createMemoryStore();
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  // Looked up per call, not captured: a test that fakes the clock after start-up must be seen.
  const now = () => (options.now ? options.now() : Date.now());
  return {
    check(input) {
      const limit = options.limitFor(input.door, input.credential);
      if (limit === 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };
      return store.hit(`${input.door}|${input.subject}`, limit, windowMs, input.now ?? now());
    },
    setStore(next) {
      store = next;
    },
    reset() {
      store = createMemoryStore();
    },
  };
}
