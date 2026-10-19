import { brainOnBehalfCredentials, checkBrainBaseUrl, createBrainClient, isBrainClientError } from "@/lib/brain-client";
import type { BrainClient, BrainClientErrorCode } from "@/lib/brain-client";
import { LAB_KEY } from "@/lib/lab";
import { readDoorConfig } from "@/lib/platform/door";
import { createOnBehalfClient } from "@/lib/platform/on-behalf";

/**
 * The memory door: this Lab's thin wrapper on the shared brain client
 * (`src/lib/brain-client`, generated from beyondles-shared, never edited here).
 *
 * WHAT IT IS FOR: a Lab drops its finished RESULTS into The Brain (decisions,
 * facts, events such as "signed"), never its raw material, and reads what the
 * organisation already knows. Which function writes or reads what is declared
 * per function in `src/server/functions.manifest.ts` (field `memory`), and
 * `npm run check:frame` (block 14) fails a Lab without this door.
 *
 * HOW IT AUTHENTICATES: a Lab holds NO Brain key. Every call carries a
 * five-minute on-behalf token with audience `brain`, issued by the platform
 * to this Lab's own service key (`PLATFORM_API_URL` + `PLATFORM_API_KEY`)
 * through the token helper every Lab carries (`on-behalf.ts`). The token
 * names the organisation and, where there is one, the person; The Brain
 * decides with it which brains the call may reach.
 *
 * WHERE THE BRAIN IS: `BRAIN_API_URL`, the Brain API host of THIS
 * environment. Production `https://api.beyondles.ai`; staging the staging
 * Brain API (never `api.beyondles.ai`); locally `http://localhost:3336`. The
 * platform registry is not a source for it: its `brain` entry holds the
 * DASHBOARD address (`brain.beyondles.ai`, platform-api migration 017), and
 * the dashboard answers every memory call with HTML. Rules checked here:
 *   - never the dashboard host, never plain http to a public host, no `/api`
 *     at the end (`checkBrainBaseUrl` of the shared client);
 *   - never a platform API host (`api-staging.beyondles.ai` is the PLATFORM
 *     on staging, not The Brain);
 *   - a staging Lab never points at the production Brain.
 *
 * A missing or wrong setting is a STATE, never a crash: `brain()` answers
 * `null`, `forgetMemory` reports it, `/api/health` shows it (`brain`). The
 * Lab's own flow never waits for The Brain.
 *
 * Deliberately without `server-only` (like `door.ts`), so the contract check
 * script and pure unit tests can load it. It imports `node:crypto` through
 * `on-behalf.ts`, so it never ends up in a browser bundle either.
 */

type Env = Record<string, string | undefined>;

/**
 * The variables are written out as `process.env.NAME` on purpose:
 * `tests/unit/deployment-env.test.ts` compares exactly that form with the
 * `environment:` block of docker-compose.yml.
 */
function currentEnv(): Env {
  return {
    ...process.env,
    BRAIN_API_URL: process.env.BRAIN_API_URL,
    ON_BEHALF_ISSUER: process.env.ON_BEHALF_ISSUER,
    PLATFORM_API_URL: process.env.PLATFORM_API_URL,
    PLATFORM_API_KEY: process.env.PLATFORM_API_KEY,
  };
}

/** The `source` of every entry this Lab writes: its product key in the platform registry. */
export const MEMORY_SOURCE = LAB_KEY;

/**
 * Stable `sourceRef` of a note. The Brain upserts on (brain, source, sourceRef),
 * so the same note always lands on the same entry, and `forget` finds it again.
 * A Lab with more objects adds one helper and one prefix per object type.
 */
export function noteSourceRef(noteId: string): string {
  return `note:${noteId}`;
}

/** Every prefix this Lab writes under: the tenant deletion forgets each one. */
export const MEMORY_REF_PREFIXES: readonly string[] = ["note:"];

export type LabEnvironment = "staging" | "production" | "unknown";

/** The production Brain API. A staging Lab never points here. */
export const PRODUCTION_BRAIN_API_HOSTS: readonly string[] = ["api.beyondles.ai", "api.beyondles.com"];

/**
 * Platform API hosts. They answer `/api/*` with the platform's own routes, so
 * a Brain address set to one of them fails every call with a 404.
 */
export const PLATFORM_API_HOSTS: readonly string[] = [
  "platform.beyondles.ai",
  "platform-staging.beyondles.ai",
  "api-staging.beyondles.ai",
];

function value(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

/** Host and port, so that two services on one machine (local development) are told apart. */
function authorityOf(raw: string): string | null {
  try {
    return new URL(raw).host.toLowerCase().replace(/.$/, "") || null;
  } catch {
    return null;
  }
}

function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Which environment is this process? `ON_BEHALF_ISSUER` names it exactly
 * (`beyondles-platform:staging` / `beyondles-platform:production`); the
 * platform address is the fallback for an env file without it.
 */
export function labEnvironment(env: Env = currentEnv()): LabEnvironment {
  const issuer = value(env, "ON_BEHALF_ISSUER").toLowerCase();
  if (issuer.endsWith(":staging")) return "staging";
  if (issuer.endsWith(":production")) return "production";
  const platformHost = hostnameOf(value(env, "PLATFORM_API_URL")) ?? "";
  if (platformHost.includes("staging")) return "staging";
  if (platformHost === "platform.beyondles.ai") return "production";
  return "unknown";
}

/**
 * Why this address is not the Brain API of this environment, or `null` when
 * it is acceptable. `platformApiUrl` is this environment's platform address:
 * the same host for both is always a mistake.
 */
export function brainAddressProblem(
  url: string,
  environment: LabEnvironment,
  platformApiUrl = "",
): string | null {
  const checked = checkBrainBaseUrl(url);
  if (!checked.ok) return checked.reason;
  const host = hostnameOf(checked.baseUrl) ?? "";
  if (PLATFORM_API_HOSTS.includes(host) || (platformApiUrl !== "" && authorityOf(checked.baseUrl) === authorityOf(platformApiUrl))) {
    return `${host} is the platform API, not the Brain API host.`;
  }
  if (environment === "staging" && PRODUCTION_BRAIN_API_HOSTS.includes(host)) {
    return `${host} is the production Brain API; a staging Lab talks to the staging Brain only.`;
  }
  return null;
}

export type BrainConfigState =
  | { state: "ok"; baseUrl: string; environment: LabEnvironment }
  | { state: "unconfigured"; missing: string[]; environment: LabEnvironment }
  | { state: "wrong-host"; reason: string; host: string | null; environment: LabEnvironment };

/** Settings only, no network: for `/api/health` and before every call. */
export function brainConfigState(env: Env = currentEnv()): BrainConfigState {
  const environment = labEnvironment(env);
  const url = value(env, "BRAIN_API_URL");
  const missing: string[] = [];
  if (!url) missing.push("BRAIN_API_URL");
  // The token comes from the platform door; half a door is no door.
  if (!readDoorConfig(env)) missing.push("PLATFORM_API_URL", "PLATFORM_API_KEY");
  if (missing.length > 0) return { state: "unconfigured", missing, environment };
  const reason = brainAddressProblem(url, environment, value(env, "PLATFORM_API_URL"));
  if (reason) return { state: "wrong-host", reason, host: hostnameOf(url), environment };
  return { state: "ok", baseUrl: url.replace(/\/+$/, ""), environment };
}

/** The word `/api/health` reports. */
export function brainHealthField(env: Env = currentEnv()): BrainConfigState["state"] {
  return brainConfigState(env).state;
}

let cached: { key: string; client: BrainClient } | null = null;

/**
 * The brain client of this process, or `null` while The Brain is not (or
 * wrongly) configured. Created on the first call and again when a setting
 * changed, so a missing line is a notice and never a crash at import.
 */
export function brain(env: Env = currentEnv()): BrainClient | null {
  const config = brainConfigState(env);
  if (config.state !== "ok") return null;
  const door = readDoorConfig(env);
  if (!door) return null;
  const key = JSON.stringify([config.baseUrl, door.baseUrl, door.apiKey]);
  if (cached?.key === key) return cached.client;
  const tokens = createOnBehalfClient({ platformApiUrl: door.baseUrl, apiKey: door.apiKey });
  const client = createBrainClient({
    baseUrl: config.baseUrl,
    productKey: MEMORY_SOURCE,
    credentials: brainOnBehalfCredentials(tokens),
  });
  cached = { key, client };
  return client;
}

/** Tests only: forget the cached client. */
export function resetBrainClientForTests(): void {
  cached = null;
}

/** Why a forget did not happen: the shared client's code, or `UNKNOWN` for anything else. */
export type ForgetFailureCode = BrainClientErrorCode | "UNKNOWN";

export type ForgetOutcome =
  | { status: "forgotten"; deleted: number }
  /** Nothing was sent: The Brain is not configured here, or not with a usable address. */
  | { status: "not_configured"; detail: string }
  /**
   * The platform or The Brain refused this organisation or object (`FORBIDDEN`,
   * `level_violation`): an organisation that is no longer active, a Lab that is
   * no longer released there. Repeating changes nothing.
   */
  | { status: "refused"; code: BrainClientErrorCode; detail: string }
  /** The Brain could not be reached or answered something unusable: try again later. */
  | { status: "failed"; code: ForgetFailureCode; detail: string };

const REFUSALS: readonly BrainClientErrorCode[] = ["FORBIDDEN", "level_violation"];

/**
 * Removes the entries this Lab wrote for one object (or one prefix) from
 * every brain of the organisation, copies included. NEVER THROWS: the caller
 * decides what the outcome means (an evidence line, a log line).
 *
 * Called as a Lab job (no person): the Lab already decided that the object
 * goes, and The Brain limits a Lab to its own `source`.
 */
export async function forgetMemory(
  organisationId: string,
  target: { sourceRef: string } | { sourceRefPrefix: string },
  env: Env = currentEnv(),
): Promise<ForgetOutcome> {
  const config = brainConfigState(env);
  if (config.state === "unconfigured") {
    return { status: "not_configured", detail: `The Brain is not configured here (${config.missing.join(", ")} missing).` };
  }
  if (config.state === "wrong-host") {
    // The client refuses such an address, so nothing was ever written through it.
    return { status: "not_configured", detail: `BRAIN_API_URL is not usable here: ${config.reason}` };
  }
  try {
    // Inside the try: building the client checks the Lab key and the address,
    // and a throw there must not undo the caller's deletion either.
    const client = brain(env);
    if (!client) return { status: "not_configured", detail: "The Brain is not configured here." };
    const { deleted } = await client.forget({ organisationId: organisationId.toLowerCase() }, target);
    return { status: "forgotten", deleted };
  } catch (error) {
    if (!isBrainClientError(error)) {
      return { status: "failed", code: "UNKNOWN", detail: "The Brain call failed unexpectedly." };
    }
    if (REFUSALS.includes(error.code)) return { status: "refused", code: error.code, detail: error.message };
    return { status: "failed", code: error.code, detail: error.message };
  }
}

export interface ForgetManyOutcome {
  deleted: number;
  /** `sourceRef` and code of every forget that failed (worth a retry). */
  failed: { sourceRef: string; code: ForgetFailureCode }[];
  /** `sourceRef` and code of every forget that was refused (a retry changes nothing). */
  refused: { sourceRef: string; code: BrainClientErrorCode }[];
  /** Set when nothing was sent because The Brain is not (usably) configured here. */
  notConfigured: string | null;
}

/** At most this many forget calls run at the same time. */
const FORGET_CONCURRENCY = 8;

/**
 * Failures that say nothing about the one object and everything about the
 * edge: The Brain is down or slow, the address or the token is wrong, the
 * organisation is out of budget. After the first of them the remaining
 * objects are not sent; they are reported failed with the same code, so the
 * caller's retry covers them. Without this, 10 000 expired notes against a
 * Brain that hangs would hold the worker for hours (10 s per call).
 */
const EDGE_FAILURES: readonly ForgetFailureCode[] = [
  "UNREACHABLE",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "BRAIN_NOT_FOUND",
  "BAD_RESPONSE",
  "USAGE_LIMIT_REACHED",
  "UNKNOWN",
];

/** `forgetMemory` for many objects of one organisation; never throws. */
export async function forgetMemoryMany(
  organisationId: string,
  sourceRefs: readonly string[],
  env: Env = currentEnv(),
): Promise<ForgetManyOutcome> {
  const outcome: ForgetManyOutcome = { deleted: 0, failed: [], refused: [], notConfigured: null };
  if (sourceRefs.length === 0) return outcome;
  let next = 0;
  let edgeDown: ForgetFailureCode | null = null;
  const worker = async () => {
    while (next < sourceRefs.length && outcome.notConfigured === null) {
      const sourceRef = sourceRefs[next++];
      if (edgeDown !== null) {
        outcome.failed.push({ sourceRef, code: edgeDown });
        continue;
      }
      const one = await forgetMemory(organisationId, { sourceRef }, env);
      if (one.status === "forgotten") outcome.deleted += one.deleted;
      else if (one.status === "not_configured") outcome.notConfigured = one.detail;
      else if (one.status === "refused") outcome.refused.push({ sourceRef, code: one.code });
      else {
        outcome.failed.push({ sourceRef, code: one.code });
        if (EDGE_FAILURES.includes(one.code)) edgeDown = one.code;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FORGET_CONCURRENCY, sourceRefs.length) }, worker));
  return outcome;
}

/** At most this many failure lines per call; the rest is one summary line. */
const MAX_FAILURE_LINES = 20;

/**
 * For deletions a person or a worker makes in the Lab itself: forget, and
 * write one log line per failure (ids and codes only, never content; at most
 * 20 lines, then one line with the count). It waits for The Brain at most
 * the client's time limit (10 s), once per wave of calls. The
 * Lab's deletion stands either way. A Lab that WRITES to The Brain routes
 * these failures into its outbox for a retry (docs/FRAME.md, section 4a).
 */
export async function forgetDeletedObjects(organisationId: string, sourceRefs: readonly string[]): Promise<ForgetManyOutcome> {
  const outcome = await forgetMemoryMany(organisationId, sourceRefs);
  const failures = [...outcome.failed, ...outcome.refused];
  for (const failure of failures.slice(0, MAX_FAILURE_LINES)) {
    console.error(
      `[memory] forget failed source=${MEMORY_SOURCE} organisation=${organisationId.toLowerCase()} ref=${failure.sourceRef} code=${failure.code}`,
    );
  }
  if (failures.length > MAX_FAILURE_LINES) {
    console.error(
      `[memory] forget failed source=${MEMORY_SOURCE} organisation=${organisationId.toLowerCase()} and ${failures.length - MAX_FAILURE_LINES} more objects`,
    );
  }
  return outcome;
}
