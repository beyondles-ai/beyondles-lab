import {
  createRateLimiter,
  rateLimitFor as sharedRateLimitFor,
  type RateCredential,
  type RateDecision,
  type RateDoor,
  type RateLimitSettings,
  type RateLimitStore,
} from "@/lib/doors/rate-limit";

export {
  RATE_LIMIT_DEFAULTS,
  createMemoryStore,
  type RateCredential,
  type RateDecision,
  type RateDoor,
  type RateLimitStore,
} from "@/lib/doors/rate-limit";

/**
 * Rate limit for the machine doors `/api/v1` and `/api/mcp`: the shared
 * limiter (`src/lib/doors/rate-limit.ts`, generated from beyondles-shared,
 * never edited here) with this Lab's three settings.
 *
 * Counted per door and per credential: an API key (a Lab key, or a Beyondles
 * key in either form) counts as `key:<id>`, an on-behalf token as
 * `cp:<calling product>:<organisation>`. Fixed one-minute windows. Over the
 * limit: `429 rate_limited` with `Retry-After` (`src/lib/api-auth.ts`).
 *
 * Defaults per minute (env-tunable, empty = default, `0` = off):
 *   API_RATE_LIMIT_PER_MINUTE        120  per key on /api/v1
 *   MCP_RATE_LIMIT_PER_MINUTE         60  per key on /api/mcp
 *   ON_BEHALF_RATE_LIMIT_PER_MINUTE  600  per calling product and organisation, per door
 * A tool call also passes `/api/v1` (the tool calls it with the same
 * credential), so the v1 limit should stay above the MCP limit.
 * The token path has a second, coarser limit in the shared tool door
 * (`OBO_REQUESTS_PER_MINUTE`, 1200); this one is the Lab's own.
 *
 * PER PROCESS. The default store lives in memory: two containers or a
 * restart each count from zero. That is acceptable for one container per
 * environment (the Playground setup). A Lab that runs several replicas
 * replaces the store once at start-up with `setRateLimitStore` (Redis,
 * Postgres).
 */

/** Named reads, so `tests/unit/deployment-env.test.ts` sees them and checks Compose. */
function currentEnv(): RateLimitSettings {
  return {
    API_RATE_LIMIT_PER_MINUTE: process.env.API_RATE_LIMIT_PER_MINUTE,
    MCP_RATE_LIMIT_PER_MINUTE: process.env.MCP_RATE_LIMIT_PER_MINUTE,
    ON_BEHALF_RATE_LIMIT_PER_MINUTE:
      process.env.ON_BEHALF_RATE_LIMIT_PER_MINUTE,
  };
}

export function rateLimitFor(
  door: RateDoor,
  credential: RateCredential,
  env: RateLimitSettings = currentEnv(),
): number {
  return sharedRateLimitFor(door, credential, env);
}

const limiter = createRateLimiter({
  limitFor: (door, credential) => rateLimitFor(door, credential),
});

/** Replace the store once at start-up (shared store for several replicas). */
export function setRateLimitStore(next: RateLimitStore): void {
  limiter.setStore(next);
}

export function __resetRateLimitForTests(): void {
  limiter.reset();
}

export function checkRateLimit(input: {
  door: RateDoor;
  credential: RateCredential;
  subject: string;
  now?: number;
}): RateDecision {
  return limiter.check(input);
}
