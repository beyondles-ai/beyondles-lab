/**
 * brain-client: the one error type, how an answer of The Brain becomes one, and what an outbox
 * does with it.
 *
 * Why typed errors: a Lab writes into The Brain from a queue (pg-boss, `JobRun`). The queue must
 * know, without reading message text, whether to try again soon (The Brain was down), later
 * (a rate limit), not until a person acts (the organisation's cost ceiling, 402), never with
 * this configuration (401/404: the edge is broken), or never at all (a write the level rule
 * refuses). `retryAdvice` turns the code into exactly that decision.
 *
 * Imports `./types` only.
 */

import type { BrainClientErrorCode, RetryAdvice } from "./types";

export class BrainClientError extends Error {
  readonly code: BrainClientErrorCode;
  /** HTTP status of The Brain's answer; `0` when there was none (network, timeout, validation before sending). */
  readonly status: number;
  /** `true` when the same call may succeed later without anybody changing anything. */
  readonly retryable: boolean;
  /** The Brain's own `error.code` when it sent one, for logs. Never shown to customers. */
  readonly serverCode: string | null;
  /** From a `Retry-After` header, in milliseconds, when The Brain sent one. */
  readonly retryAfterMs: number | null;

  constructor(
    code: BrainClientErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; serverCode?: string | null; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = "BrainClientError";
    this.code = code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.serverCode = options.serverCode ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function isBrainClientError(value: unknown): value is BrainClientError {
  return value instanceof BrainClientError;
}

/** A `Retry-After` is never trusted beyond one day: a wrong header must not park a job for ever. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * `Retry-After` in milliseconds: delta seconds or an HTTP date. `null` for anything else.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  // An HTTP date names its day and month ("Wed, 14 Oct 2026 20:01:00 GMT"). Without the
  // letters check `Date.parse("-5")` would read the year -5 as a date in the past.
  if (!/^[A-Za-z]{3},/.test(text)) return null;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  return Math.min(Math.max(0, at - nowMs), MAX_RETRY_AFTER_MS);
}

/** The Brain's level refusal. Compared without case: the spec writes it in lower case. */
function isLevelViolation(serverCode: string | null): boolean {
  return serverCode !== null && serverCode.toLowerCase() === "level_violation";
}

/**
 * The error for one answer of The Brain that is not a usable success.
 *
 * The status decides; three server codes are recognised whatever the status, because they name
 * a decision The Brain made on purpose (`USAGE_LIMIT_REACHED`, `SOURCE_DAILY_CAP`,
 * `level_violation`).
 */
export function errorFromAnswer(answer: {
  status: number;
  serverCode: string | null;
  serverMessage: string | null;
  retryAfterMs: number | null;
}): BrainClientError {
  const { status, serverCode, retryAfterMs } = answer;
  const said = answer.serverMessage ?? `The Brain answered ${status}.`;
  const make = (code: BrainClientErrorCode, retryable: boolean, message = said) =>
    new BrainClientError(code, message, { status, retryable, serverCode, retryAfterMs });

  if (serverCode === "USAGE_LIMIT_REACHED" || status === 402) return make("USAGE_LIMIT_REACHED", false);
  if (serverCode === "SOURCE_DAILY_CAP") return make("SOURCE_DAILY_CAP", true);
  if (isLevelViolation(serverCode) && status >= 400 && status < 500) return make("level_violation", false);

  if (status >= 300 && status < 400) {
    // `redirect: "manual"`: a redirect is never followed. The Brain API does not redirect; a
    // dashboard or a login page in front of it does. That is a wrong address, not an outage.
    return make("BAD_RESPONSE", false, `The Brain address answered with a redirect (${status}); it is not the Brain API host.`);
  }
  switch (status) {
    case 400:
    case 409:
    case 413:
    case 422:
      return make("VALIDATION", false);
    case 401:
      return make("UNAUTHORIZED", false);
    case 403:
      return make("FORBIDDEN", false);
    case 404:
      return make("BRAIN_NOT_FOUND", false);
    case 408:
      return make("UNREACHABLE", true);
    case 429:
      return make("RATE_LIMITED", true);
    default:
      break;
  }
  if (status >= 500) return make("UNREACHABLE", true);
  // A 2xx without The Brain envelope, or a 4xx this contract does not name (405: no such route
  // on this host).
  return make("BAD_RESPONSE", false);
}

/** Exponential backoff: `baseMs * 2^attempt`, at most `capMs`. */
function backoff(attempt: number, baseMs: number, capMs: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.min(Math.trunc(attempt), 20) : 0;
  return Math.min(baseMs * 2 ** n, capMs);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * What an outbox does with a failed `remember` (or `forget`). `attempt` counts the failures
 * before this one (0 for the first).
 *
 * - `retry`:       The Brain was not reachable or failed (network, timeout, 5xx). Again soon.
 * - `backoff`:     429. Again after `Retry-After`, else exponentially later.
 * - `park`:        402 `USAGE_LIMIT_REACHED`: the organisation's cost ceiling. Keep the job,
 *                  show a visible notice, resume when a person raised the ceiling.
 * - `edge_broken`: 401, 404, or an answer that is not The Brain's (wrong host). Mark the edge
 *                  broken (health, notice), keep the job, do not hammer.
 * - `drop`:        the call itself is wrong (validation, level rule, forbidden). Repeating it
 *                  changes nothing; log the ids and drop it.
 *
 * Anything that is not a `BrainClientError` (a bug in the caller) counts as `retry`.
 */
export function retryAdvice(error: unknown, attempt = 0): RetryAdvice {
  if (!isBrainClientError(error)) return { action: "retry", delayMs: backoff(attempt, 30_000, HOUR_MS) };
  switch (error.code) {
    case "UNREACHABLE":
      return { action: "retry", delayMs: backoff(attempt, 30_000, HOUR_MS) };
    case "RATE_LIMITED":
      return { action: "backoff", delayMs: error.retryAfterMs ?? backoff(attempt, 60_000, HOUR_MS) };
    case "SOURCE_DAILY_CAP":
      // The cap is per organisation, source and day: trying again within the hour is pointless.
      return { action: "backoff", delayMs: error.retryAfterMs ?? HOUR_MS };
    case "USAGE_LIMIT_REACHED":
      return { action: "park" };
    case "UNAUTHORIZED":
    case "BRAIN_NOT_FOUND":
    case "BAD_RESPONSE":
      return { action: "edge_broken" };
    case "level_violation":
    case "VALIDATION":
    case "FORBIDDEN":
      return { action: "drop" };
  }
}
