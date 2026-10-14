/**
 * brain-client: the one place that sends a request to The Brain API.
 *
 * Headers, credentials, the time limit and the reading of The Brain envelope
 * (`{ success: true, data }` / `{ success: false, error: { code, message } }`) exist once.
 * `brainRequest` returns the envelope's `data` object or throws `BrainClientError`, nothing else.
 *
 * Rules (the platform-client rules, API.md section 0): imports `./types` and `./errors` only,
 * reads no environment, and looks the global `fetch` up at the moment a request is sent.
 */

import { BrainClientError, errorFromAnswer, isBrainClientError, parseRetryAfter } from "./errors";
import type {
  BrainCallContext,
  BrainClientErrorCode,
  BrainCredentials,
  FetchLike,
  HttpRequestInit,
  HttpResponseLike,
} from "./types";

/**
 * The `fetch` to send with. Without an injected one the global is looked up WHEN THE REQUEST IS
 * SENT: product tests stub the global after the module was loaded.
 */
export function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  return (url, init) => {
    const current = (globalThis as { fetch?: unknown }).fetch;
    if (typeof current !== "function") return Promise.reject(new Error("No fetch is available in this runtime."));
    return (current as FetchLike)(url, init);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NOT_JSON: unique symbol = Symbol("not-json");

async function readBody(response: HttpResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return NOT_JSON;
  }
}

function headerOf(response: HttpResponseLike, name: string): string | null {
  try {
    const value = response.headers?.get(name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** One request as the client builds it. `headers` is the context part (service-key mode only). */
export interface BrainRequest {
  baseUrl: string;
  method: "GET" | "POST";
  /** Starts with `/api/`. */
  path: string;
  body?: unknown;
  ctx: BrainCallContext;
  contextHeaders: Record<string, string>;
  credentials: BrainCredentials;
  timeoutMs: number;
  fetch?: FetchLike;
  now: () => number;
}

/**
 * The code for a token request platform-api refused (`POST /api/on-behalf/token`). Only a
 * refusal that is about the Lab itself breaks the edge for every organisation: its key (401),
 * its registration (`CALLER_NOT_REGISTERED`, `CALLER_NOT_ALLOWED`) or The Brain missing in the
 * registry (`AUDIENCE_UNKNOWN`). A refusal about one organisation or one person (the Lab is not
 * released there, the person or the agent's owner left, the collection is gone) is `FORBIDDEN`:
 * that job is dropped, the other organisations keep writing.
 */
function tokenRefusal(status: number, serverCode: string | null): BrainClientErrorCode {
  if (status === 0 || status >= 500 || status === 408) return "UNREACHABLE";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400) return "VALIDATION";
  if (status === 401) return "UNAUTHORIZED";
  if (serverCode === "CALLER_NOT_REGISTERED" || serverCode === "CALLER_NOT_ALLOWED" || serverCode === "AUDIENCE_UNKNOWN") {
    return "UNAUTHORIZED";
  }
  if (status === 403 || status === 404) return "FORBIDDEN";
  // The template's BAD_RESPONSE (an answer it cannot read) and anything else: the edge.
  return "UNAUTHORIZED";
}

/** Rejects with `UNREACHABLE` when `promise` has not settled by the deadline. */
function withinDeadline<T>(promise: Promise<T>, remainingMs: number, totalMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BrainClientError("UNREACHABLE", `The Brain did not answer within ${totalMs} ms.`, { status: 0, retryable: true }));
    }, Math.max(0, remainingMs));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The credential headers. In on-behalf mode a failing token helper is typed by `tokenRefusal`. */
async function credentialHeaders(request: BrainRequest, deadline: number): Promise<Record<string, string>> {
  const { credentials } = request;
  if (credentials.mode === "service-key") {
    // WHICH product asks (the Brain service key) plus the proof that it is an internal caller:
    // The Brain reads x-organisation-id and x-user-id only together with x-internal-api-key
    // (api/src/server.js, apiKeyAuth). The context headers follow from the ctx.
    return { "X-API-Key": credentials.apiKey, "x-internal-api-key": credentials.internalKey, ...request.contextHeaders };
  }
  let token: unknown;
  try {
    // The token request counts against the same time limit as the call: a hanging platform
    // must not hold a recall longer than its limit.
    token = await withinDeadline(
      Promise.resolve().then(() => credentials.getToken(request.ctx)),
      deadline - request.now(),
      request.timeoutMs,
    );
  } catch (cause) {
    if (isBrainClientError(cause)) throw cause;
    // The template's OnBehalfError carries `code` and `status` (0 when the platform did not answer).
    const status = isRecord(cause) && typeof cause.status === "number" ? cause.status : 0;
    const serverCode = isRecord(cause) && typeof cause.code === "string" ? cause.code : null;
    const code = tokenRefusal(status, serverCode);
    throw new BrainClientError(code, `No on-behalf token for The Brain${serverCode ? ` (${serverCode})` : ""}.`, {
      status: 0,
      retryable: code === "UNREACHABLE" || code === "RATE_LIMITED",
      serverCode,
    });
  }
  if (typeof token !== "string" || token.trim() === "") {
    throw new BrainClientError("UNAUTHORIZED", "The on-behalf token helper returned no token.", { status: 0 });
  }
  return { Authorization: `Bearer ${token.trim()}` };
}

async function sendOnce(request: BrainRequest, deadline: number): Promise<HttpResponseLike> {
  const headers: Record<string, string> = { ...(await credentialHeaders(request, deadline)), Accept: "application/json" };
  const init: HttpRequestInit = { method: request.method, headers };
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(request.body);
  }
  // Memory answers are per person and per agent: never out of a cache in between.
  init.cache = "no-store";
  // A redirect means the address is not the Brain API (a dashboard sends a login redirect).
  init.redirect = "manual";
  const remainingMs = deadline - request.now();
  if (remainingMs <= 0) {
    throw new BrainClientError("UNREACHABLE", `The Brain did not answer within ${request.timeoutMs} ms.`, { status: 0, retryable: true });
  }
  init.signal = AbortSignal.timeout(remainingMs);
  let response: unknown;
  try {
    response = await resolveFetch(request.fetch)(`${request.baseUrl}${request.path}`, init);
  } catch (cause) {
    const timedOut = isRecord(cause) && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new BrainClientError(
      "UNREACHABLE",
      timedOut ? `The Brain did not answer within ${request.timeoutMs} ms.` : "The Brain could not be reached.",
      { status: 0, retryable: true },
    );
  }
  if (!isRecord(response) || typeof response.status !== "number") {
    throw new BrainClientError("UNREACHABLE", "The Brain gave no answer.", { status: 0, retryable: true });
  }
  return response as unknown as HttpResponseLike;
}

/**
 * One call. Returns the envelope's `data` object (`{}` when a success carries none). Throws
 * `BrainClientError` and nothing else.
 *
 * On-behalf mode: a 401 with a token is answered once by dropping that token
 * (`forgetToken`) and sending again with a fresh one. A token can be refused for a reason the
 * cache cannot see (a key rotation on the platform); a second 401 is the real answer.
 *
 * `timeoutMs` is the limit of the WHOLE call: the token request, the first send and the one
 * resend share it.
 */
export async function brainRequest(request: BrainRequest): Promise<Record<string, unknown>> {
  const deadline = request.now() + request.timeoutMs;
  let response = await sendOnce(request, deadline);
  const { credentials } = request;
  if (response.status === 401 && credentials.mode === "on-behalf" && credentials.forgetToken) {
    try {
      credentials.forgetToken(request.ctx);
    } catch {
      // A failing cache helper must not hide The Brain's answer.
    }
    response = await sendOnce(request, deadline);
  }

  const status = response.status;
  const body = await readBody(response);
  if (status >= 200 && status < 300 && isRecord(body) && body.success === true) {
    return isRecord(body.data) ? body.data : {};
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  throw errorFromAnswer({
    status,
    serverCode: error && typeof error.code === "string" ? error.code : null,
    serverMessage: error && typeof error.message === "string" ? error.message : null,
    retryAfterMs: parseRetryAfter(headerOf(response, "retry-after"), request.now()),
  });
}
