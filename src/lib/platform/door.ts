/**
 * Addresses and keys of the two doors — read in one place.
 *
 *  - `NEXT_PUBLIC_PLATFORM_URL` points to the SUITE (beyondles.ai or
 *    suite-staging.beyondles.ai): sign-in and level 1 (release switch).
 *  - `PLATFORM_API_URL` + `PLATFORM_API_KEY` point to the PLATFORM API
 *    (api.beyondles.ai): levels 2 + 3, AI, mail, protocol, export.
 *
 * The three variables are written out as `process.env.NAME` on purpose:
 * `tests/unit/deployment-env.test.ts` scans `src/` for exactly that form and
 * compares it with the `environment:` block of docker-compose.yml. A variable
 * read through an indirection is invisible to that guard, and that is how the
 * door once went missing on every deploy.
 *
 * A function, not a constant: tests stub `process.env` after the module
 * loaded. Deliberately without `server-only` so pure unit tests can load it.
 */

export interface DoorConfig {
  /** Without trailing slash. */
  baseUrl: string;
  apiKey: string;
}

type Env = Record<string, string | undefined>;

function currentEnv(): Env {
  return {
    NEXT_PUBLIC_PLATFORM_URL: process.env.NEXT_PUBLIC_PLATFORM_URL,
    PLATFORM_API_URL: process.env.PLATFORM_API_URL,
    PLATFORM_API_KEY: process.env.PLATFORM_API_KEY,
  };
}

/**
 * Suite address, or `null` when there is no Suite here. NO production
 * fallback on purpose: a staging box without the line must not silently sign
 * people in against production. The Compose file refuses to start without it.
 */
export function platformUrl(env: Env = currentEnv()): string | null {
  const raw = env.NEXT_PUBLIC_PLATFORM_URL?.trim().replace(/\/+$/, "");
  return raw ? raw : null;
}

/**
 * Address and key of the platform API, or `null` when either is missing.
 * Half configured is not configured: an address without a key answers 401
 * to everything and would look like an outage instead of a missing line.
 */
export function readDoorConfig(env: Env = currentEnv()): DoorConfig | null {
  const baseUrl = env.PLATFORM_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.PLATFORM_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/**
 * State of the doors in one word — for `/api/health` and the boot check:
 *  - `off`          — no Suite: local development, CI, E2E.
 *  - `unconfigured` — Suite yes, platform door no. The dangerous in-between:
 *                     nobody gets in because nobody can be asked.
 *  - `ok`           — both there.
 */
export function accessDoorState(env: Env = currentEnv()): "off" | "unconfigured" | "ok" {
  if (!platformUrl(env)) return "off";
  return readDoorConfig(env) ? "ok" : "unconfigured";
}
