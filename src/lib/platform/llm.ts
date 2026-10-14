import "server-only";

import { LAB_KEY } from "@/lib/lab";
import { readDoorConfig } from "@/lib/platform/door";

/**
 * The AI door of the platform: `POST /api/llm/complete`.
 *
 * A Lab holds NO provider key and NO provider SDK. The Lab names WHAT it
 * needs (`useCase`, such as `general`, `writing` or `verification`) and HOW
 * GOOD it must be (`level`: `economy`, `workhorse`, `frontier`); the platform
 * picks provider and model from the catalogue, applies the customer's rules
 * (third-country providers off by default), books the cost to the
 * organisation and the purpose, and the Suite shows it — the Lab does nothing
 * for cost reporting. A customer's explicit choice goes as `model` (with
 * `fallback`), never as a provider key.
 *
 * `tier` is the old vocabulary (`fast`/`balanced`/`best`). It still works for
 * existing callers and is translated here into `useCase: "general"` plus the
 * level the platform maps it to (`fast` = economy, `balanced` = workhorse,
 * `best` = frontier, platform-api `src/llm/use-cases.js`); the wire only ever
 * carries `useCase` + `level`. New code passes `useCase` + `level`.
 *
 * Purposes are `<lab>.<action>`, lower-case, stable: they are the ledger key
 * the Suite groups costs by. Renaming one splits a customer's cost history.
 *
 * Retry only on 429/503, never on other 4xx; the error code is surfaced to
 * the caller, never swallowed.
 */

/** The quality levels of the platform's model choice. */
export type LlmLevel = "economy" | "workhorse" | "frontier";

/** @deprecated The old words; use `useCase` + `level`. Kept so existing callers keep working. */
export type LlmTier = "fast" | "balanced" | "best";

/** How an old tier word maps onto a level (the platform's own `LEVEL_ALIASES`). */
export const TIER_TO_LEVEL: Readonly<Record<LlmTier, LlmLevel>> = {
  fast: "economy",
  balanced: "workhorse",
  best: "frontier",
};

/** Text use cases every catalogue answers; the platform accepts further benchmark names. */
export type LlmUseCase = "general" | "coding" | "reasoning" | "writing" | "math" | "verification" | (string & {});

/** Without anything named: a general text task at the workhorse level (what `balanced` was). */
export const DEFAULT_USE_CASE: LlmUseCase = "general";
export const DEFAULT_LEVEL: LlmLevel = "workhorse";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  organisationId: string;
  /** The action part; the Lab key is prefixed automatically. */
  action: string;
  messages: LlmMessage[];
  system?: string;
  /** What the call is for. Default `general`. Media use cases have their own door (`media.ts`). */
  useCase?: LlmUseCase;
  /** How good the model must be. Default `workhorse`. */
  level?: LlmLevel;
  /** @deprecated Use `useCase` + `level`; translated by `modelChoice`. */
  tier?: LlmTier;
  /** A model the CUSTOMER chose by name. Overrides `useCase`/`level`/`tier`. */
  model?: string;
  /** With `model` only: may another provider answer when that model's provider is down? Default `auto`. */
  fallback?: "auto" | "none";
  maxTokens?: number;
  temperature?: number;
  /** The acting person, for the ledger. Omit for worker calls. */
  userId?: string;
  metadata?: Record<string, string>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export type LlmResult =
  | {
      ok: true;
      text: string;
      model: string;
      provider: string;
      usage: LlmUsage;
      ledgerId: string | null;
    }
  | { ok: false; status: number; code: string; message: string };

const TIMEOUT_MS = 120_000;
const RETRY_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

/**
 * The model choice of one request as the door expects it: exactly one of
 * `{ model, fallback }` and `{ useCase, level }` (platform-api
 * `validateChoice`). An explicit `level` wins over an old `tier`.
 */
export function modelChoice(
  request: Pick<LlmRequest, "useCase" | "level" | "tier" | "model" | "fallback">,
): { model: string; fallback: "auto" | "none" } | { useCase: string; level: LlmLevel } {
  if (request.model) return { model: request.model, fallback: request.fallback ?? "auto" };
  const level = request.level ?? (request.tier ? TIER_TO_LEVEL[request.tier] : undefined) ?? DEFAULT_LEVEL;
  return { useCase: request.useCase ?? DEFAULT_USE_CASE, level };
}

export function purposeFor(action: string): string {
  const clean = action.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${LAB_KEY}.${clean}`.slice(0, 120);
}

/** A failed door call: the platform's own code, or `DOOR_NOT_CONFIGURED`, `NETWORK`, `BAD_RESPONSE`. */
export interface DoorFailure {
  ok: false;
  /** HTTP status; 0 when the platform did not answer. */
  status: number;
  code: string;
  message: string;
}

export type DoorAnswer = { ok: true; data: Record<string, unknown> } | DoorFailure;

export interface DoorCallOptions {
  timeoutMs?: number;
  /**
   * May a network error or timeout be retried? Only for calls without a cost
   * or side effect (embeddings). A completion, an image or a transcription
   * may already have run and been billed when the answer got lost.
   */
  retryOnNetworkError?: boolean;
  /** Tests: the pause between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One JSON call to a door of the platform (`/api/llm/complete`,
 * `/api/media/*`, `/api/embeddings`): the Lab's service key, the platform
 * envelope, retry ONLY where the platform itself said it did nothing (429,
 * 503), at most three attempts. Never throws.
 */
export async function postDoor(
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  options: DoorCallOptions = {},
): Promise<DoorAnswer> {
  const config = readDoorConfig();
  if (!config) {
    return { ok: false, status: 503, code: "DOOR_NOT_CONFIGURED", message: "The platform door is not configured." };
  }
  const sleep = options.sleep ?? wait;
  const payload = JSON.stringify(body);

  let last: DoorFailure = { ok: false, status: 0, code: "NETWORK", message: "no attempt made" };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (error) {
      // NO retry on a network error or timeout unless the caller says the
      // call is free of side effects: the platform may already have
      // completed and billed it. Only 429/503 (the platform itself answered,
      // it did nothing) are always retried below.
      last = { ok: false, status: 0, code: "NETWORK", message: error instanceof Error ? error.message : "network error" };
      if (!options.retryOnNetworkError) return last;
      if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
      continue;
    }

    const envelope = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }
      | null;

    if (res.ok && envelope?.success === true && envelope.data && typeof envelope.data === "object") {
      return { ok: true, data: envelope.data };
    }

    last = {
      ok: false,
      status: res.status,
      code: envelope?.error?.code ?? (res.ok ? "BAD_RESPONSE" : `HTTP_${res.status}`),
      message: envelope?.error?.message ?? `The platform answered HTTP ${res.status}.`,
    };
    if (!RETRY_STATUSES.has(res.status)) return last;
    if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
  }
  return last;
}

/**
 * A number from a foreign answer: only finite, non-negative values count.
 * Anything else (`"n/a"`, `null`, NaN, Infinity, negative) is 0, so a NaN
 * never reaches a cost figure.
 */
export function safeNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function complete(
  request: LlmRequest,
  fetchImpl: typeof fetch = fetch,
  options: Pick<DoorCallOptions, "sleep"> = {},
): Promise<LlmResult> {
  const answer = await postDoor(
    "/api/llm/complete",
    {
      organisationId: request.organisationId,
      purpose: purposeFor(request.action),
      messages: request.messages,
      system: request.system,
      ...modelChoice(request),
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      userId: request.userId,
      metadata: request.metadata,
    },
    fetchImpl,
    { timeoutMs: TIMEOUT_MS, sleep: options.sleep },
  );
  if (!answer.ok) return answer;
  const d = answer.data;
  const usage = (d.usage ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    text: String(d.text ?? ""),
    model: String(d.model ?? ""),
    provider: String(d.provider ?? ""),
    usage: {
      inputTokens: safeNumber(usage.inputTokens),
      outputTokens: safeNumber(usage.outputTokens),
      costCents: safeNumber(usage.costCents),
    },
    ledgerId: typeof d.ledgerId === "string" ? d.ledgerId : null,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
