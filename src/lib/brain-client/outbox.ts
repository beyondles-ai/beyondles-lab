/**
 * brain-client: the payload of a queued write.
 *
 * Every Lab writes into The Brain from its own queue (pg-boss in SummarizeLab and ContentLab,
 * `JobRun` in the template); the queue stays product-local, there is no shared outbox. What is
 * shared is the payload, so that every queue stores the same thing and every worker hands it
 * to `remember` the same way:
 *
 *   enqueue:  const job = enqueueRemember(ctx, input, { productKey: "summarizelab" });
 *             await boss.send("BRAIN_REMEMBER", job);
 *   worker:   await client.remember(job.ctx, job.input)
 *             on BrainClientError: retryAdvice(error, attempt) decides (README, "Retry guidance")
 *
 * `enqueueRemember` validates exactly as `remember` does and throws the same
 * `BrainClientError` (`VALIDATION`): a job that can never succeed is refused when it is
 * created, not retried for days. The payload is plain JSON (dates as ISO 8601), so it survives
 * a database column and a process restart unchanged.
 *
 * Imports `./types` and `./validate` only.
 */

import { checkContext, checkRemember } from "./validate";
import type { BrainCallContext, RememberInput } from "./types";

/** Bumped when the payload shape changes, so a worker can refuse jobs it cannot read. */
export const REMEMBER_JOB_VERSION = 1;

export interface RememberJob {
  type: "brain.remember";
  version: typeof REMEMBER_JOB_VERSION;
  /**
   * `<organisationId>:<source>:<sourceRef>`: one entry. The organisation is part of it because
   * a source ref is only the writer's own id (a Lab may number its records per organisation).
   * A queue's singleton key keeps the FIRST pending job and refuses later ones: see the README,
   * "From a queue", before using it as one.
   */
  dedupeKey: string;
  /** ISO 8601. */
  createdAt: string;
  ctx: BrainCallContext;
  input: RememberInput & { source: string };
}

/** Builds the payload of one queued write. Throws `BrainClientError` (`VALIDATION`). */
export function enqueueRemember(
  ctx: BrainCallContext,
  input: RememberInput,
  options: { productKey: string; now?: () => number },
): RememberJob {
  const checkedCtx = checkContext(ctx);
  const checkedInput = checkRemember(input, options?.productKey);
  const now = options?.now ?? Date.now;
  // JSON round trip: what is queued is exactly what a worker will read back.
  return JSON.parse(
    JSON.stringify({
      type: "brain.remember",
      version: REMEMBER_JOB_VERSION,
      dedupeKey: `${checkedCtx.organisationId}:${checkedInput.source}:${checkedInput.sourceRef}`,
      createdAt: new Date(now()).toISOString(),
      ctx: checkedCtx,
      input: checkedInput,
    }),
  ) as RememberJob;
}

/** Is this a payload `enqueueRemember` built (this version)? For a worker before it calls `remember`. */
export function isRememberJob(value: unknown): value is RememberJob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  return (
    job.type === "brain.remember" &&
    job.version === REMEMBER_JOB_VERSION &&
    typeof job.dedupeKey === "string" &&
    typeof job.ctx === "object" &&
    job.ctx !== null &&
    typeof job.input === "object" &&
    job.input !== null
  );
}
