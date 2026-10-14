import "server-only";

import { type DoorFailure, postDoor, purposeFor, safeNumber } from "@/lib/platform/llm";

/**
 * Embeddings through the platform door: `POST /api/embeddings` (ported from
 * ContentLab `src/lib/platform/embeddings.ts`).
 *
 * The door pins every vector STORE to one model on its first call (today a
 * local model on our own server). The Lab names its store
 * (`<LAB_KEY>.<name>`, for example `examplelab.notes`) and never picks a
 * model, so vectors of two models never meet in one collection.
 * `needsReembedding: true` in an answer means an operator moved the store to
 * another model and the stored vectors must be rebuilt.
 *
 * Embedding has no side effect besides a ledger row and costs nothing, so a
 * network error or timeout IS retried here (unlike completions in `llm.ts`).
 * Contract: platform-api `src/embeddings/run.js`.
 */

/** The door's own pattern for a store name. */
const STORE_NAME = /^[a-z0-9][a-z0-9._-]{1,99}$/;

export interface EmbedRequest {
  organisationId: string;
  /** The action part; the Lab key is prefixed automatically. */
  action: string;
  /** The store suffix; the Lab key is prefixed automatically (`<LAB_KEY>.<store>`). */
  store: string;
  input: string[];
  userId?: string;
}

export type EmbedResult =
  | {
      ok: true;
      /** One vector per input, in input order. */
      vectors: number[][];
      model: string;
      dimensions: number;
      needsReembedding: boolean;
      inputTokens: number;
      ledgerId: string | null;
    }
  | DoorFailure;

const TIMEOUT_MS = 120_000;

/** `<LAB_KEY>.<store>`: one store per Lab and purpose, never shared with another product. */
export function storeFor(store: string): string {
  return purposeFor(store);
}

/** Embeds a batch of texts. Never throws. */
export async function embed(
  request: EmbedRequest,
  fetchImpl: typeof fetch = fetch,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<EmbedResult> {
  const store = storeFor(request.store);
  if (!STORE_NAME.test(store)) {
    return { ok: false, status: 0, code: "VALIDATION", message: `"${store}" is not a valid store name.` };
  }
  if (request.input.length === 0 || request.input.some((text) => typeof text !== "string" || text.trim() === "")) {
    return { ok: false, status: 0, code: "VALIDATION", message: "input must be a non-empty list of non-empty texts." };
  }
  const answer = await postDoor(
    "/api/embeddings",
    {
      organisationId: request.organisationId,
      purpose: purposeFor(request.action),
      store,
      input: request.input,
      ...(request.userId ? { userId: request.userId } : {}),
    },
    fetchImpl,
    { timeoutMs: TIMEOUT_MS, retryOnNetworkError: true, sleep: options.sleep },
  );
  if (!answer.ok) return answer;
  const vectors = answer.data.vectors;
  if (
    !Array.isArray(vectors) ||
    vectors.length !== request.input.length ||
    !vectors.every((v) => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n)))
  ) {
    return { ok: false, status: 200, code: "BAD_RESPONSE", message: "The platform answered with a wrong set of vectors." };
  }
  const usage = (answer.data.usage ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    vectors: vectors as number[][],
    model: String(answer.data.model ?? ""),
    dimensions: safeNumber(answer.data.dimensions),
    needsReembedding: answer.data.needsReembedding === true,
    inputTokens: safeNumber(usage.inputTokens),
    ledgerId: answer.data.ledgerId === null || answer.data.ledgerId === undefined ? null : String(answer.data.ledgerId),
  };
}
