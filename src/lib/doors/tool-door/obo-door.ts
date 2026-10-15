import { hostLogger, hostNow, trimmedUrl, type DoorHost } from "../door-host";
import {
  createOnBehalfVerifier,
  looksLikeOnBehalfToken,
  type OnBehalfClaims,
  type OnBehalfDenyReason,
  type OnBehalfVerifier,
} from "../on-behalf";
import type { RateCredential } from "../rate-limit";

/**
 * The on-behalf part of a product's machine door (connection layer contract, stage 6, 2.4/2.5).
 *
 * Another Beyondles product (Beyondles HorAIzon, a Lab) calls with
 * `Authorization: Bearer <on-behalf token>`: a five-minute token the platform signed for
 * audience = this product. This file reads that credential, verifies the token (steps 1 and 2 of
 * the token path), applies the coarse per-product rate limit (step 3) and writes the refusal log
 * line. Whose view the token gets and the person check (steps 4 and 5) are the product's own, in
 * its machine door.
 *
 * How a verdict becomes an answer:
 *  - `ON_BEHALF_ISSUER` or `PLATFORM_API_URL` missing, or the platform's keys cannot be fetched:
 *    `503 token_check_unavailable`;
 *  - every other refusal: `401 unauthorized` with one message for all reasons; the reason goes to
 *    the log only, as `[on-behalf] refused reason=<reason>`, at most once a minute per reason;
 *  - more than 1,200 requests per minute for one calling product and organisation: `429`. A token
 *    exchanged for a Beyondles key (it carries `key`) counts per KEY instead (`key:<id>`), so one
 *    runaway key never uses up its organisation's window. The verdict names the subject
 *    (`onBehalfRateSubject`) for the product's own per-door limiter (`rate-limit.ts`), which then
 *    applies the key limits to such a token.
 *
 * Moved from the Lab template (`src/lib/tool-door/obo-door.ts`) for #383. The settings come from
 * the product's `DoorHost` instead of `process.env`; the state that was module-level in the
 * template (verifiers, rate windows, refusal log memory) lives in the door `createOboDoor`
 * returns. One door per process. Node runtime only.
 */

export type OboDoorState = "ok" | "unconfigured";

/** `ok` when this environment's issuer and the platform's address are both set. */
export function oboDoorState(settings: { platformApiUrl?: string; onBehalfIssuer?: string }): OboDoorState {
  const base = (settings.platformApiUrl ?? "").trim();
  const issuer = (settings.onBehalfIssuer ?? "").trim();
  return base && issuer ? "ok" : "unconfigured";
}

/**
 * null: no on-behalf token in Authorization.
 *
 * Only a bearer that looks like an on-behalf token (its header type) counts; any other bearer
 * (a product's own key, a Suite token) is left to the product's existing path. A token next to
 * an `x-api-key` header is ambiguous and refused by the caller with `400`.
 */
export function onBehalfBearer(request: Request): { token: string } | { ambiguous: true } | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return null;
  const token = match[1] ?? "";
  if (!looksLikeOnBehalfToken(token)) return null;
  if ((request.headers.get("x-api-key") ?? "").trim()) return { ambiguous: true };
  return { token };
}

/**
 * How the product's own rate limiter (`createRateLimiter`) counts a verified token: a token
 * exchanged for a Beyondles key as that key (`key:<id>`, key limits), every other token per calling
 * product and organisation (`cp:<product>:<org>`, on-behalf limits).
 */
export function onBehalfRateSubject(claims: Pick<OnBehalfClaims, "cp" | "org" | "key">): {
  credential: RateCredential;
  subject: string;
} {
  return claims.key
    ? { credential: "key", subject: `key:${claims.key}` }
    : { credential: "on-behalf", subject: `cp:${claims.cp}:${claims.org}` };
}

export type OboCheck =
  | { ok: true; claims: OnBehalfClaims; rate: { credential: RateCredential; subject: string } }
  | {
      ok: false;
      status: 401 | 429 | 503;
      code: "unauthorized" | "rate_limited" | "token_check_unavailable";
      message: string;
      retryAfterSeconds?: number;
    };

export const OBO_REQUESTS_PER_MINUTE = 1200;

const WINDOW_MS = 60_000;
const RATE_MAX_ENTRIES = 10_000;
const REFUSAL_LOG_INTERVAL_MS = 60_000;

const REFUSED_MESSAGE = "The on-behalf token is not valid for this service.";

export interface OboDoor {
  /** `ok` when the host has an issuer and a platform address. */
  state(): OboDoorState;
  /** Steps 1 to 3 of the token path. One verifier per audience, built on first use. */
  check(token: string, audience: string): Promise<OboCheck>;
  /** Tests only: forget verifiers (and their keys), rate windows and the refusal log memory. */
  reset(): void;
}

export function createOboDoor(host: DoorHost): OboDoor {
  const verifiers = new Map<string, OnBehalfVerifier>();
  const windows = new Map<string, { startedAt: number; count: number }>();
  const lastRefusalLogAt = new Map<OnBehalfDenyReason, number>();

  const state = (): OboDoorState =>
    oboDoorState({ platformApiUrl: host.platformApiUrl(), onBehalfIssuer: host.onBehalfIssuer() });

  /** One verifier per audience and process, built on first use (never at build time). */
  function verifierFor(audience: string): OnBehalfVerifier {
    let verifier = verifiers.get(audience);
    if (!verifier) {
      const base = trimmedUrl(host.platformApiUrl());
      verifier = createOnBehalfVerifier({
        jwksUrl: base ? `${base}/api/on-behalf/jwks` : "",
        issuer: (host.onBehalfIssuer() ?? "").trim(),
        audience,
        fetchImpl: host.fetch,
        now: host.now ? () => hostNow(host) : undefined,
      });
      verifiers.set(audience, verifier);
    }
    return verifier;
  }

  function logRefusal(reason: OnBehalfDenyReason): void {
    const now = hostNow(host);
    const last = lastRefusalLogAt.get(reason);
    if (last !== undefined && now - last < REFUSAL_LOG_INTERVAL_MS) return;
    lastRefusalLogAt.set(reason, now);
    hostLogger(host).warn(`[on-behalf] refused reason=${reason}`);
  }

  /** Fixed one-minute window per calling product and organisation (or per Beyondles key), in memory. */
  function hit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = hostNow(host);
    let entry = windows.get(key);
    if (!entry || now - entry.startedAt >= WINDOW_MS) {
      if (!entry && windows.size >= RATE_MAX_ENTRIES) {
        for (const [k, v] of windows) if (now - v.startedAt >= WINDOW_MS) windows.delete(k);
        if (windows.size >= RATE_MAX_ENTRIES) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
      }
      entry = { startedAt: now, count: 0 };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > OBO_REQUESTS_PER_MINUTE) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + WINDOW_MS - now) / 1000)) };
    }
    return { allowed: true };
  }

  return {
    state,

    async check(token: string, audience: string): Promise<OboCheck> {
      if (state() !== "ok") {
        return {
          ok: false,
          status: 503,
          code: "token_check_unavailable",
          message:
            "On-behalf tokens are not configured on this server (ON_BEHALF_ISSUER or PLATFORM_API_URL is missing).",
        };
      }

      const verdict = await verifierFor(audience).verify(token);
      if (!verdict.ok) {
        if (verdict.reason === "keys_unavailable" || verdict.reason === "not_configured") {
          return {
            ok: false,
            status: 503,
            code: "token_check_unavailable",
            message: "The on-behalf token could not be checked right now; try again later.",
          };
        }
        logRefusal(verdict.reason);
        return { ok: false, status: 401, code: "unauthorized", message: REFUSED_MESSAGE };
      }

      const subject = onBehalfRateSubject(verdict.claims);
      const rate = hit(subject.subject);
      if (!rate.allowed) {
        return {
          ok: false,
          status: 429,
          code: "rate_limited",
          message: verdict.claims.key
            ? `Too many requests for this key (${OBO_REQUESTS_PER_MINUTE} per minute).`
            : `Too many requests for this product and organisation (${OBO_REQUESTS_PER_MINUTE} per minute).`,
          retryAfterSeconds: rate.retryAfterSeconds,
        };
      }
      return { ok: true, claims: verdict.claims, rate: subject };
    },

    reset(): void {
      verifiers.clear();
      windows.clear();
      lastRefusalLogAt.clear();
    },
  };
}
