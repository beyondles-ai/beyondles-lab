/**
 * brain-client: `createBrainClient`, the client of The Brain memory functions (spec #377,
 * sections 4 and 5).
 *
 *   remember  POST /api/memory/remember   throws BrainClientError
 *   recall    POST /api/memory/recall     NEVER throws: an empty list on any failure
 *   forget    POST /api/memory/forget     throws
 *   inbox     GET  /api/memory/inbox      throws
 *   review    POST /api/memory/review     throws
 *   share     POST /api/memory/share      throws
 *
 * Why recall never throws: it runs inside a product's own flow (an idea chat, an advisor
 * answer, an agent's pre-task read). The Brain being down must make that flow poorer, never
 * break it. The behaviour is AdvisorLab's `brainSearch`: minimum query length, time limit, hit
 * and character caps, empty on failure. Unlike `brainSearch`, the empty list says why
 * (`failure`), so a product can show a notice instead of looking like "nothing known".
 *
 * Why remember throws: it runs from an outbox, and the outbox needs the typed reason to decide
 * between retry, backoff, park and edge broken (`retryAdvice` in `errors.ts`).
 *
 * Imports `./types`, `./errors`, `./validate` and `./http`.
 */

import { BrainClientError, isBrainClientError } from "./errors";
import { brainRequest } from "./http";
import {
  checkContext,
  checkForget,
  checkRemember,
  checkReview,
  checkShare,
  contextHeaders,
  inboxQueryString,
  invalid,
  recallBody,
  RECALL_MAX_ITEMS,
} from "./validate";
import type {
  BrainCallContext,
  BrainClient,
  BrainClientOptions,
  BrainKind,
  EntryId,
  ForgetInput,
  InboxQuery,
  MemoryItem,
  MemoryKind,
  RecallResult,
  RememberInput,
  RememberResult,
  ReviewInput,
  ReviewResult,
  ReviewState,
  ShareInput,
  ShareResult,
} from "./types";

/** Time limit of one request. A write from an outbox can wait; a person's click should not hang. */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Time limit of one recall. The Brain itself stops its fan-out after 4 seconds (spec section 4). */
export const RECALL_TIMEOUT_MS = 5_000;
/** Characters of `snippet` per recalled item. AdvisorLab's `MAX_SNIPPET_CHARS`. */
export const RECALL_SNIPPET_CHARS = 600;
/** Characters of `content` per recalled item, so a prompt cannot grow with every upload. */
export const RECALL_CONTENT_CHARS = 4_000;

/**
 * Hosts that serve The Brain DASHBOARD. The memory functions live on the API host
 * (`api.beyondles.ai` in production). A Lab pointed at the dashboard gets HTML or a login
 * redirect for every call and would look like an outage.
 */
const DASHBOARD_HOST = /^brain(-staging|-admin)?\.beyondles\.(ai|com)$/;
/** Our public domains. Never reached over plain http. */
const PUBLIC_DOMAIN = /(^|\.)beyondles\.(ai|com)$/;

const BRAIN_KINDS: readonly string[] = ["company", "team", "personal", "agent", "advisor", "other"];
const REVIEW_STATES: readonly string[] = ["proposed", "confirmed", "rejected"];
const STATUSES: readonly string[] = ["created", "updated", "unchanged"];
const KINDS: readonly string[] = ["fact", "decision", "event", "task", "text"];

/**
 * Is this a usable Brain API address? Returns the address without trailing slashes, or the
 * reason it is not one. For a product's health check and contract edge as well as for
 * `createBrainClient`.
 */
export function checkBrainBaseUrl(value: unknown): { ok: true; baseUrl: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim() === "") return { ok: false, reason: "The Brain API address is not set." };
  const baseUrl = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, reason: "The Brain API address is not a URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "The Brain API address must start with http:// or https://." };
  }
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, reason: "The Brain API address must not carry a query or a fragment." };
  }
  // `brain.beyondles.ai.` (a trailing dot) is the same host.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (DASHBOARD_HOST.test(host)) {
    return { ok: false, reason: `${url.hostname} is The Brain dashboard, not the Brain API host.` };
  }
  if (url.protocol === "http:" && PUBLIC_DOMAIN.test(host)) {
    // Plain http to a public host would carry the service key or the token in clear text up to
    // the first redirect. http is for the box itself, a container network and local development.
    return { ok: false, reason: `${url.hostname} is a public host: use https://.` };
  }
  if (/\/api$/i.test(url.pathname.replace(/\/+$/, ""))) {
    return { ok: false, reason: "The Brain API address must not end with /api: the client adds the paths." };
  }
  return { ok: true, baseUrl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntryId(value: unknown): value is EntryId {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value !== "");
}

function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

function oneOfOr<T extends string>(value: unknown, allowed: readonly string[], fallback: T | null): T | null {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback;
}

/** At most `max` characters, cut at a word boundary when one is near. */
function cap(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space >= max * 0.8 ? cut.slice(0, space) : cut).trimEnd();
}

function badResponse(what: string): BrainClientError {
  return new BrainClientError("BAD_RESPONSE", `The Brain answered ${what} with a body this client cannot read.`, {
    status: 200,
  });
}

/** One item of recall or inbox, or `null` when it lacks what every item must have. */
function readItem(value: unknown): MemoryItem | null {
  if (!isRecord(value)) return null;
  if (!isEntryId(value.id) || typeof value.brainId !== "string" || value.brainId === "") return null;
  const content = stringOr(value.content, "");
  const snippet = stringOr(value.snippet, content);
  return {
    id: value.id,
    brainId: value.brainId,
    brainKind: oneOfOr<BrainKind>(value.brainKind, BRAIN_KINDS, null),
    title: cap(stringOr(value.title, ""), 255),
    snippet: cap(snippet, RECALL_SNIPPET_CHARS),
    content: cap(content, RECALL_CONTENT_CHARS),
    source: stringOr(value.source, null),
    sourceRef: stringOr(value.sourceRef, null),
    kind: oneOfOr<MemoryKind>(value.kind, KINDS, null),
    event: stringOr(value.event, null),
    reviewState: oneOfOr<ReviewState>(value.reviewState, REVIEW_STATES, null),
    occurredAt: stringOr(value.occurredAt, null),
    originEntryId: isEntryId(value.originEntryId) ? value.originEntryId : null,
    originBrainId: stringOr(value.originBrainId, null),
    score: typeof value.score === "number" && Number.isFinite(value.score) ? value.score : null,
  };
}

function readItems(data: Record<string, unknown>, max: number): MemoryItem[] | null {
  if (!Array.isArray(data.items)) return null;
  const items: MemoryItem[] = [];
  for (const entry of data.items) {
    const item = readItem(entry);
    if (item) items.push(item);
    if (items.length >= max) break;
  }
  return items;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The client. Throws `BrainClientError` (`VALIDATION`) for a configuration that can never work:
 * an address that is not the Brain API, a product key that is none, credentials without a key
 * or without a token helper. A product creates it lazily (on the first call), so a missing
 * setting turns into a visible notice and never stops the product from starting.
 */
export function createBrainClient(options: BrainClientOptions): BrainClient {
  if (!isRecord(options)) throw invalid("createBrainClient needs an options object.");
  const address = checkBrainBaseUrl(options.baseUrl);
  if (!address.ok) throw invalid(address.reason);
  const productKey = options.productKey;
  if (typeof productKey !== "string" || !/^[a-z0-9_]{2,40}$/.test(productKey)) {
    throw invalid("productKey must be the product's registry key (2 to 40 characters a-z, 0-9, _).");
  }
  const credentials = options.credentials;
  if (!isRecord(credentials)) throw invalid("credentials are required.");
  if (credentials.mode === "service-key") {
    if (typeof credentials.apiKey !== "string" || credentials.apiKey.trim() === "") throw invalid("credentials.apiKey is empty.");
    if (typeof credentials.internalKey !== "string" || credentials.internalKey.trim() === "") {
      throw invalid("credentials.internalKey is empty.");
    }
  } else if (credentials.mode === "on-behalf") {
    if (typeof credentials.getToken !== "function") throw invalid("credentials.getToken must be a function.");
  } else {
    throw invalid('credentials.mode must be "on-behalf" or "service-key".');
  }

  const baseUrl = address.baseUrl;
  const timeoutMs = positiveTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const recallTimeoutMs = positiveTimeout(options.recallTimeoutMs, RECALL_TIMEOUT_MS);
  const now = () => Date.now();

  function call(
    ctx: BrainCallContext,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    limitMs = timeoutMs,
  ): Promise<Record<string, unknown>> {
    return brainRequest({
      baseUrl,
      method,
      path,
      body,
      ctx,
      // In on-behalf mode the token carries the context; headers would be a second, unchecked
      // opinion about who calls.
      contextHeaders: credentials.mode === "service-key" ? contextHeaders(ctx) : {},
      credentials,
      timeoutMs: limitMs,
      fetch: options.fetch,
      now,
    });
  }

  return {
    async remember(ctxInput: BrainCallContext, input: RememberInput): Promise<RememberResult> {
      const ctx = checkContext(ctxInput);
      const body = checkRemember(input, productKey);
      const data = await call(ctx, "POST", "/api/memory/remember", body);
      const status = oneOfOr<RememberResult["status"]>(data.status, STATUSES, null);
      const reviewState = oneOfOr<ReviewState>(data.reviewState, REVIEW_STATES, null);
      if (!isEntryId(data.id) || typeof data.brainId !== "string" || data.brainId === "" || !status || !reviewState) {
        throw badResponse("remember");
      }
      return {
        id: data.id,
        brainId: data.brainId,
        // A brain kind this build does not know yet is reported as `other`, not as a failure:
        // the write itself succeeded.
        brainKind: oneOfOr<BrainKind>(data.brainKind, BRAIN_KINDS, "other") ?? "other",
        status,
        reviewState,
      };
    },

    async recall(ctxInput: BrainCallContext, input): Promise<RecallResult> {
      try {
        const prepared = recallBody(input);
        if ("refused" in prepared) {
          // Too short: nothing to search, no notice. An unusable filter: a mistake of the
          // product, reported like an invalid context, never sent without the filter.
          return prepared.refused === "too_short" ? { items: [] } : { items: [], failure: { code: "VALIDATION", status: 0 } };
        }
        const body = prepared.body;
        const ctx = checkContext(ctxInput);
        const data = await call(ctx, "POST", "/api/memory/recall", body, recallTimeoutMs);
        const items = readItems(data, Math.min(Number(body.limit), RECALL_MAX_ITEMS));
        if (!items) return { items: [], failure: { code: "BAD_RESPONSE", status: 200 } };
        return { items };
      } catch (error) {
        if (isBrainClientError(error)) return { items: [], failure: { code: error.code, status: error.status } };
        return { items: [], failure: { code: "UNREACHABLE", status: 0 } };
      }
    },

    async forget(ctxInput: BrainCallContext, input: ForgetInput) {
      const ctx = checkContext(ctxInput);
      const body = checkForget(input, productKey);
      const data = await call(ctx, "POST", "/api/memory/forget", body);
      if (typeof data.deleted !== "number" || !Number.isInteger(data.deleted) || data.deleted < 0) {
        throw badResponse("forget");
      }
      return { deleted: data.deleted };
    },

    async inbox(ctxInput: BrainCallContext, query?: InboxQuery) {
      const ctx = checkContext(ctxInput);
      const data = await call(ctx, "GET", `/api/memory/inbox${inboxQueryString(query)}`, undefined);
      const items = readItems(data, RECALL_MAX_ITEMS);
      if (!items) throw badResponse("inbox");
      return { items };
    },

    async review(ctxInput: BrainCallContext, input: ReviewInput): Promise<ReviewResult> {
      const ctx = checkContext(ctxInput);
      const body = checkReview(input);
      const data = await call(ctx, "POST", "/api/memory/review", body);
      return {
        id: isEntryId(data.id) ? data.id : body.id,
        brainId: typeof data.brainId === "string" && data.brainId !== "" ? data.brainId : body.brainId,
        reviewState: oneOfOr<ReviewState>(data.reviewState, REVIEW_STATES, null),
      };
    },

    async share(ctxInput: BrainCallContext, input: ShareInput): Promise<ShareResult> {
      const ctx = checkContext(ctxInput);
      const body = checkShare(input);
      const data = await call(ctx, "POST", "/api/memory/share", body);
      if (!isEntryId(data.id) || typeof data.brainId !== "string" || data.brainId === "") throw badResponse("share");
      return {
        id: data.id,
        brainId: data.brainId,
        originEntryId: isEntryId(data.originEntryId) ? data.originEntryId : body.id,
        originBrainId: typeof data.originBrainId === "string" && data.originBrainId !== "" ? data.originBrainId : body.brainId,
      };
    },
  };
}
