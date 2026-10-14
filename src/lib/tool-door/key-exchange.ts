import { createHash } from "node:crypto";

import {
  hostLogger,
  hostNow,
  trimmedUrl,
  type DoorHost,
  type FetchLike,
} from "@/lib/doors/door-host";
import { createMemoryStore, type RateLimitStore } from "@/lib/doors/rate-limit";
import { LAB_KEY } from "@/lib/lab";
import { DOOR_HOST } from "@/lib/tool-door/host";

/**
 * A Beyondles key sent as `x-api-key` (door contract, section 4: the doors
 * module, `src/lib/doors/door-contract.md`).
 *
 * A Beyondles key is created by a person in the Beyondles Suite (Settings,
 * Access) and carries scopes per product (`examplelab:write`). The Lab never
 * checks the key itself: it exchanges the key at the platform for a short
 * on-behalf token to itself (`typ: beyondles-obo-key+jwt`, its `scp` = the
 * key's scopes for this Lab) and then verifies that token like every other
 * on-behalf token (`src/lib/api-auth.ts`). This file is the exchange:
 *
 *  1. a value without the key's shape (`bk_` + 8 hex + `_` + 43 base64url
 *     characters) never reaches the platform: `401` at once;
 *  2. the cache key is `sha256(<key>)` (hex); the plain key is never stored
 *     and never logged;
 *  3. a cache key the platform refused in the last 60 seconds answers the
 *     same refusal at once (bounded, 10,000 entries);
 *  4. a token is reused for at most 60 seconds after its exchange and never
 *     later than 60 seconds before its `exp`, so a revoked key stops working
 *     here within a minute; concurrent requests for one key share one
 *     exchange;
 *  5. otherwise: at most 30 exchanges per minute per client address (before
 *     the platform is called, so random keys cannot make this Lab flood the
 *     platform with its own service key), then
 *     `POST <PLATFORM_API_URL>/api/keys/exchange` with `X-API-Key:
 *     <PLATFORM_API_KEY>` and `{ key, audience }`.
 *
 * The answers: unknown, revoked or malformed key, an owner without access, a
 * key without a scope for this Lab: `401` (negative-cached). This Lab not
 * released for the key's organisation: `403 lab_not_released`
 * (negative-cached; the release gate in `api-auth.ts` says the same for a
 * key token). The platform's limit: `429`. No settings, the platform
 * unreachable, or a refusal of this Lab's own service key: `503`.
 *
 * Node runtime only.
 */

/** `bk_<8 hex>_<32 bytes base64url>`, 55 characters (platform-api docs/API.md, "Beyondles keys"). */
export const BEYONDLES_KEY_PATTERN = /^bk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

export const TOKEN_REUSE_MS = 60_000;
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
export const DENIAL_CACHE_MS = 60_000;
export const EXCHANGES_PER_MINUTE_PER_ADDRESS = 30;

const CACHE_MAX = 10_000;
const WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const PLATFORM_RETRY_AFTER_SECONDS = 60;

/** True when the value has the shape of a Beyondles key. Nothing else is ever sent to the platform. */
export function looksLikeBeyondlesKey(value: string): boolean {
  return BEYONDLES_KEY_PATTERN.test(value);
}

export type KeyExchangeDenial = {
  ok: false;
  status: 401 | 403 | 429 | 503;
  code:
    | "unauthorized"
    | "lab_not_released"
    | "rate_limited"
    | "not_configured"
    | "key_check_unavailable";
  message: string;
  retryAfterSeconds?: number;
};

export type KeyExchangeResult = { ok: true; token: string } | KeyExchangeDenial;

export interface KeyExchange {
  exchange(
    key: string,
    context: { clientAddress: string | null },
  ): Promise<KeyExchangeResult>;
  /** Tests only: forget tokens, refusals, running exchanges and the address windows. */
  reset(): void;
}

const INVALID_KEY = "API key invalid.";
const NO_SCOPE =
  "This Beyondles key carries no scope for this Lab. Create a key with scopes for it in the Beyondles Suite (Settings, Access).";
const OWNER_WITHOUT_ACCESS =
  "The person who owns this Beyondles key no longer has access to its organisation or to this Lab.";
const NOT_RELEASED =
  "This Lab is not released for your organisation in the Beyondles Suite.";
const UNAVAILABLE =
  "The Beyondles key could not be checked right now; try again later.";

/** Platform refusal codes that are about the KEY (negative-cached, `401`). */
const KEY_DENIALS: Readonly<Record<string, string>> = {
  KEY_INVALID: INVALID_KEY,
  KEY_NO_SCOPE_FOR_PRODUCT: NO_SCOPE,
  KEY_OWNER_NOT_MEMBER: OWNER_WITHOUT_ACCESS,
  ORGANISATION_INACTIVE: OWNER_WITHOUT_ACCESS,
  ORG_NOT_ALLOWED_FOR_KEY: INVALID_KEY,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCodeOf(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function bounded<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

/** The token's expiry in milliseconds: `claims.exp` of the answer, else `expiresAt`. */
function expiryOf(data: Record<string, unknown>): number | null {
  if (
    isRecord(data.claims) &&
    typeof data.claims.exp === "number" &&
    Number.isFinite(data.claims.exp)
  ) {
    return data.claims.exp * 1000;
  }
  if (typeof data.expiresAt === "string") {
    const parsed = Date.parse(data.expiresAt);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function retryAfterOf(response: Response): number {
  const raw = Number(response.headers.get("retry-after"));
  return Number.isInteger(raw) && raw > 0 ? raw : PLATFORM_RETRY_AFTER_SECONDS;
}

export function createKeyExchange(options: {
  host: DoorHost;
  /** This product's key at the platform: the audience of the token. */
  audience: string;
  /** Default 30. */
  exchangesPerMinutePerAddress?: number;
  /** Default: an in-memory fixed window. */
  addressStore?: RateLimitStore;
}): KeyExchange {
  const { host, audience } = options;
  const perAddress =
    options.exchangesPerMinutePerAddress ?? EXCHANGES_PER_MINUTE_PER_ADDRESS;
  let addresses = options.addressStore ?? createMemoryStore(CACHE_MAX);
  const tokens = new Map<string, { token: string; validUntil: number }>();
  const denials = new Map<
    string,
    { denial: KeyExchangeDenial; until: number }
  >();
  const running = new Map<string, Promise<KeyExchangeResult>>();
  const now = () => hostNow(host);

  const deny = (
    status: KeyExchangeDenial["status"],
    code: KeyExchangeDenial["code"],
    message: string,
    retryAfterSeconds?: number,
  ): KeyExchangeDenial =>
    retryAfterSeconds === undefined
      ? { ok: false, status, code, message }
      : { ok: false, status, code, message, retryAfterSeconds };

  function remember(
    cacheKey: string,
    denial: KeyExchangeDenial,
  ): KeyExchangeDenial {
    bounded(denials, cacheKey, { denial, until: now() + DENIAL_CACHE_MS });
    return denial;
  }

  async function callPlatform(
    cacheKey: string,
    key: string,
  ): Promise<KeyExchangeResult> {
    const baseUrl = trimmedUrl(host.platformApiUrl());
    const serviceKey = (host.platformApiKey() ?? "").trim();
    const doFetch: FetchLike =
      host.fetch ?? ((input, init) => fetch(input, init));

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/api/keys/exchange`, {
        method: "POST",
        headers: {
          "X-API-Key": serviceKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ key, audience }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      hostLogger(host).warn(
        `[key-exchange] the platform could not be reached: ${error instanceof Error ? error.name : "error"}`,
      );
      return deny(503, "key_check_unavailable", UNAVAILABLE);
    }

    const body = await readJson(response);
    const code = errorCodeOf(body);

    if (response.status === 200) {
      const data =
        isRecord(body) && body.success === true && isRecord(body.data)
          ? body.data
          : null;
      const token =
        data && typeof data.token === "string" && data.token
          ? data.token
          : null;
      const expiresAt = data ? expiryOf(data) : null;
      if (!token || expiresAt === null) {
        hostLogger(host).error(
          "[key-exchange] the platform answered 200 without a token and its expiry.",
        );
        return deny(503, "key_check_unavailable", UNAVAILABLE);
      }
      const exchangedAt = now();
      const validUntil = Math.min(
        exchangedAt + TOKEN_REUSE_MS,
        expiresAt - TOKEN_EXPIRY_MARGIN_MS,
      );
      if (validUntil > exchangedAt)
        bounded(tokens, cacheKey, { token, validUntil });
      return { ok: true, token };
    }

    if (response.status === 429) {
      return deny(
        429,
        "rate_limited",
        "Too many requests for this key. Wait and try again.",
        retryAfterOf(response),
      );
    }

    if (response.status === 403 && code === "AUDIENCE_NOT_RELEASED") {
      return remember(cacheKey, deny(403, "lab_not_released", NOT_RELEASED));
    }

    if (
      (response.status === 401 || response.status === 403) &&
      code !== null &&
      code in KEY_DENIALS
    ) {
      return remember(
        cacheKey,
        deny(401, "unauthorized", KEY_DENIALS[code] ?? INVALID_KEY),
      );
    }

    if (response.status === 400) {
      // The body is ours and the key passed the shape filter: the platform refuses this value.
      return remember(cacheKey, deny(401, "unauthorized", INVALID_KEY));
    }

    // This Lab's own service key or registration is refused (CALLER_NOT_REGISTERED,
    // CALLER_NOT_ALLOWED, KEY_AUDIENCE_NOT_CALLER, an invalid PLATFORM_API_KEY), or the
    // platform is down (5xx, MEMBERSHIP_SOURCE_*, KEYS_NOT_MIGRATED). Never the key's fault,
    // never cached.
    const line = `[key-exchange] the platform refused the exchange: status=${response.status} code=${code ?? "-"}`;
    if (response.status >= 500) hostLogger(host).warn(line);
    else hostLogger(host).error(line);
    return deny(503, "key_check_unavailable", UNAVAILABLE);
  }

  return {
    async exchange(key, context) {
      if (!looksLikeBeyondlesKey(key))
        return deny(401, "unauthorized", INVALID_KEY);

      const cacheKey = createHash("sha256").update(key, "utf8").digest("hex");

      const refused = denials.get(cacheKey);
      if (refused) {
        if (refused.until > now()) return refused.denial;
        denials.delete(cacheKey);
      }

      const cached = tokens.get(cacheKey);
      if (cached) {
        if (cached.validUntil > now()) return { ok: true, token: cached.token };
        tokens.delete(cacheKey);
      }

      const pending = running.get(cacheKey);
      if (pending) return pending;

      if (
        !trimmedUrl(host.platformApiUrl()) ||
        !(host.platformApiKey() ?? "").trim()
      ) {
        return deny(
          503,
          "not_configured",
          "Beyondles keys are not configured on this server (PLATFORM_API_URL or PLATFORM_API_KEY is missing).",
        );
      }

      const window = addresses.hit(
        `exchange|${context.clientAddress ?? "unknown"}`,
        perAddress,
        WINDOW_MS,
        now(),
      );
      if (!window.allowed) {
        return deny(
          429,
          "rate_limited",
          "Too many new keys from this address. Wait and try again.",
          window.retryAfterSeconds,
        );
      }

      const exchange = callPlatform(cacheKey, key).finally(() =>
        running.delete(cacheKey),
      );
      running.set(cacheKey, exchange);
      return exchange;
    },

    reset() {
      tokens.clear();
      denials.clear();
      running.clear();
      addresses = options.addressStore ?? createMemoryStore(CACHE_MAX);
    },
  };
}

/**
 * The address a request came from, for the exchange limit: Cloudflare's
 * `cf-connecting-ip`, else `x-real-ip`, else the LAST `x-forwarded-for`
 * entry (the one the nearest proxy wrote; the first is the client's own
 * claim). `null` when none is set: all such requests share one window.
 */
export function clientAddressOf(request: Request): string | null {
  const direct =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  if (direct) return direct;
  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded.length > 0
    ? (forwarded[forwarded.length - 1] ?? null)
    : null;
}

const keyExchange = createKeyExchange({ host: DOOR_HOST, audience: LAB_KEY });

/** The process's exchange, bound to this Lab's settings and product key. */
export function exchangeBeyondlesKey(
  key: string,
  context: { clientAddress: string | null },
): Promise<KeyExchangeResult> {
  return keyExchange.exchange(key, context);
}

/** Tests only. */
export function __resetKeyExchangeForTests(): void {
  keyExchange.reset();
}
