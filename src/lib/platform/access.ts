import { createHash } from "node:crypto";

import { isLocalMode } from "@/lib/jwt-guard";
import { LAB_KEY } from "@/lib/lab";
import { accessDoorState, readDoorConfig } from "@/lib/platform/door";
import type { OnBehalfAgent } from "@/lib/platform/on-behalf";

/**
 * Access model, LEVELS 2 + 3 — both come from the PLATFORM, never from a
 * table of the Lab.
 *
 * One request per page view:
 *   `GET <PLATFORM_API_URL>/api/access/me?product=<LAB_KEY>`
 *   with `X-API-Key: <PLATFORM_API_KEY>` (WHICH product asks) and
 *   `Authorization: Bearer <Suite cookie>` (WHICH person asks).
 *
 * The answer says three things:
 *  1. may the person use this Lab at all (`productRole`, `governed`)?
 *  2. which collections is she in, which objects were granted to her
 *     individually (`collections`, `grantedLevels`)?
 *  3. what may she offer when sharing (`personalAllowed`, `membersMayShareOrg`)?
 *
 * FAIL CLOSED. This is the PERMISSION. If the platform is unreachable or
 * answers something unreadable: NO access. A failed service must not hold a
 * door open that is not its own. 60 s cache per token (the contract's limit).
 *
 * No `server-only` on purpose: rbac.ts, the actions and their unit tests load
 * this unmocked.
 */

/* ---------------------------------------------------------------- Types */

/** The top-level object types of this Lab that carry the container columns. */
export const OBJECT_TYPES = ["note"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export type ProductRole = "product_admin" | "user";
export type GrantLevel = "view" | "edit";
export type OrgRole = "owner" | "admin" | "member";

export interface AccessCollection {
  id: string;
  name: string;
  isOwner: boolean;
}

export interface GrantedIds {
  view: string[];
  edit: string[];
}

export interface AccessContext {
  userId: string;
  organisationId: string;
  email: string;
  orgRole: OrgRole;
  /** `null` = no product access (binding as soon as `governed` is true). */
  productRole: ProductRole | null;
  /** True once the organisation manages this Lab in the Suite administration. */
  governed: boolean;
  accessMode: "assigned" | "everyone";
  collections: AccessCollection[];
  grantedIds: Record<ObjectType, GrantedIds>;
  personalAllowed: boolean;
  membersMayShareOrg: boolean;
  membersMayCreateCollections: boolean;
  /**
   * `platform` = normal; `local` = no door (dev/CI); `api-key`/`worker-key` = machine;
   * `agent` = a collection agent behind an on-behalf token (no person, one collection).
   */
  source: "platform" | "local" | "api-key" | "worker-key" | "agent";
}

/* --------------------------------------------------------------- Config */

const REQUEST_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

interface CacheEntry<T> {
  value: T;
  validUntil: number;
}

const cache = new Map<string, CacheEntry<AccessContext | null>>();
const machineCache = new Map<string, CacheEntry<MachineAccess>>();
/** On-behalf tokens: the platform's ANSWER per `${org}:${user}`, never a verdict (the floor is per token). */
const personAnswerCache = new Map<string, CacheEntry<PersonAnswer>>();

const warned = new Set<string>();
function warnOnce(reason: string, text: string): void {
  if (warned.has(reason)) return;
  warned.add(reason);
  console.error(`[platform-access] ${text}`);
}

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | undefined {
  const hit = map.get(key);
  if (hit && hit.validUntil > Date.now()) return hit;
  if (hit) map.delete(key);
  return undefined;
}

function cachePut<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (map.size >= CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { value, validUntil: Date.now() + CACHE_TTL_MS });
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function emptyGrants(): Record<ObjectType, GrantedIds> {
  const out = {} as Record<ObjectType, GrantedIds>;
  for (const type of OBJECT_TYPES) out[type] = { view: [], edit: [] };
  return out;
}

/** Tests only. */
export function __clearAccessCacheForTests(): void {
  cache.clear();
  machineCache.clear();
  personAnswerCache.clear();
  warned.clear();
}

/* ---------------------------------------------------- Local fallback rule */

/**
 * MAY THE LOCAL FALLBACK APPLY AT ALL?
 *
 * The local context makes every signed-in Suite member a user and every owner
 * a product admin. Right for development, an open door in operation. It
 * applies only where it belongs:
 *  - no Suite at all (`NEXT_PUBLIC_PLATFORM_URL` missing) AND not a production
 *    process — local development;
 *  - or sessions are verified LOCALLY (`isLocalMode`) — CI and E2E.
 * On staging and production neither is true. If the door is missing there,
 * the Lab is closed for EVERYONE: "we could not check" never means "come in".
 */
export function localFallbackAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (isLocalMode(env)) return true;
  return accessDoorState(env) === "off" && env.NODE_ENV !== "production";
}

/* ------------------------------------------------------------- Parsing */

interface RawMe {
  userId?: unknown;
  organisationId?: unknown;
  email?: unknown;
  orgRole?: unknown;
  product?: {
    key?: unknown;
    productRole?: unknown;
    accessMode?: unknown;
    personalAllowed?: unknown;
    governed?: unknown;
  } | null;
  collections?: unknown;
  grantedObjects?: Record<string, unknown> | null;
  grantedLevels?: Record<string, unknown> | null;
  settings?: {
    membersMayShareOrg?: unknown;
    membersMayCreateCollections?: unknown;
  } | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function asOrgRole(value: unknown): OrgRole {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "owner" || raw === "admin" ? raw : "member";
}
function asProductRole(value: unknown): ProductRole | null {
  return value === "product_admin" || value === "user" ? value : null;
}
function asCollections(value: unknown): AccessCollection[] {
  if (!Array.isArray(value)) return [];
  const out: AccessCollection[] = [];
  for (const raw of value) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const id = asString(row.id);
    if (!id) continue;
    out.push({ id, name: asString(row.name) ?? id, isOwner: asBool(row.isOwner, false) });
  }
  return out;
}

/**
 * `grantedLevels[<type>]` is the truth about view/edit. `grantedObjects` is
 * the same set without a level (older platform versions) and counts as the
 * cautious level "view".
 */
function asGrants(body: RawMe): Record<ObjectType, GrantedIds> {
  const out = emptyGrants();
  for (const type of OBJECT_TYPES) {
    const view = new Set<string>();
    const edit = new Set<string>();
    const levels = body.grantedLevels?.[type];
    if (levels && typeof levels === "object" && !Array.isArray(levels)) {
      for (const [id, level] of Object.entries(levels as Record<string, unknown>)) {
        if (!id) continue;
        if (level === "edit") edit.add(id);
        else view.add(id);
      }
    }
    const objects = body.grantedObjects?.[type];
    if (Array.isArray(objects)) {
      for (const raw of objects) {
        const id = asString(raw);
        if (id && !edit.has(id)) view.add(id);
      }
    }
    out[type] = { view: [...view], edit: [...edit] };
  }
  return out;
}

export function toContext(body: RawMe): AccessContext | null {
  const userId = asString(body.userId);
  const organisationId = asString(body.organisationId);
  if (!userId || !organisationId) return null;
  const product = body.product ?? null;
  const settings = body.settings ?? null;
  return {
    userId,
    organisationId,
    email: asString(body.email) ?? "",
    orgRole: asOrgRole(body.orgRole),
    productRole: asProductRole(product?.productRole),
    governed: asBool(product?.governed, false),
    accessMode: product?.accessMode === "everyone" ? "everyone" : "assigned",
    collections: asCollections(body.collections),
    grantedIds: asGrants(body),
    personalAllowed: asBool(product?.personalAllowed, true),
    membersMayShareOrg: asBool(settings?.membersMayShareOrg, true),
    membersMayCreateCollections: asBool(settings?.membersMayCreateCollections, true),
    source: "platform",
  };
}

/* --------------------------------------------------------------- People */

/**
 * Levels 2 + 3 for ONE person. `null` always and only means NO ACCESS.
 * Only clear answers are cached (a valid context, 401/403/404); network
 * errors and 5xx are not, so a short outage locks nobody out longer than
 * necessary.
 */
export async function getAccessContext(
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<AccessContext | null> {
  const config = readDoorConfig();
  if (!config || !token) return null;

  const key = tokenKey(token);
  const hit = cacheGet(cache, key);
  if (hit) return hit.value;

  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/api/access/me?product=${LAB_KEY}`, {
      headers: {
        "X-API-Key": config.apiKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    warnOnce("unreachable", "the platform did not answer /api/access/me — nobody has access until it does.");
    return null;
  }

  if (res.ok) {
    let context: AccessContext | null = null;
    try {
      const envelope = (await res.json()) as { success?: boolean; data?: RawMe };
      if (envelope.success === true && envelope.data) context = toContext(envelope.data);
    } catch {
      context = null;
    }
    if (!context) warnOnce("bad-response", "the platform answered /api/access/me with a body this build cannot read.");
    cachePut(cache, key, context);
    return context;
  }

  // 401 = OUR service key is wrong, 403 ORG_NOT_ALLOWED_FOR_KEY = our key
  // is limited to other organisations. Both are operator errors and must be
  // loud; to the person they look like "no access", which is right (closed)
  // but not the whole story.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const code = await errorCode(res);
    if (res.status === 401 || code === "ORG_NOT_ALLOWED_FOR_KEY") {
      warnOnce(
        `key-${res.status}`,
        `the platform rejected the Lab's own service key (HTTP ${res.status}${code ? ` ${code}` : ""}). ` +
          `Check PLATFORM_API_KEY — until it is fixed, nobody has access.`,
      );
    }
    cachePut(cache, key, null);
    return null;
  }
  warnOnce(`http-${res.status}`, `the platform answered /api/access/me with HTTP ${res.status}.`);
  return null;
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}

/**
 * The context WITHOUT a platform: local development, CI, E2E. Only reachable
 * while `localFallbackAllowed()` is true — `rbac.ts` checks that. The Suite
 * role maps to `product_admin` so a developer reaches the settings; this is
 * NO floor for operation.
 */
export function localAccessContext(session: {
  userId: string;
  email: string;
  organisationId: string;
  role: string;
}): AccessContext {
  const orgRole = asOrgRole(session.role);
  return {
    userId: session.userId,
    organisationId: session.organisationId,
    email: session.email,
    orgRole,
    productRole: orgRole === "member" ? "user" : "product_admin",
    governed: false,
    accessMode: "everyone",
    collections: [],
    grantedIds: emptyGrants(),
    personalAllowed: true,
    membersMayShareOrg: true,
    membersMayCreateCollections: true,
    source: "local",
  };
}

/* ------------------------------------------------------------- Machines */

export type MachineDenyReason =
  /** The person behind the key has no product access (any more). */
  | "KEY_OWNER_NO_ACCESS"
  /** The key is older than the token floor of its creator. */
  | "KEY_REVOKED"
  /** The platform could not be asked — "unclear" means "no". */
  | "KEY_CHECK_UNAVAILABLE"
  /** On-behalf token: the Suite holds no active membership of the named person any more. */
  | "PERSON_GONE";

export type MachineAccess =
  | { ok: true; context: AccessContext }
  | { ok: false; reason: MachineDenyReason };

/**
 * A WORKER key: no person behind it. Sees only `visibility = ORGANISATION`,
 * creates nothing private, books door calls without a user, survives every
 * single person leaving.
 */
export function workerAccessContext(organisationId: string): AccessContext {
  return {
    userId: "",
    organisationId,
    email: "",
    orgRole: "member",
    productRole: "user",
    governed: false,
    accessMode: "assigned",
    collections: [],
    grantedIds: emptyGrants(),
    personalAllowed: false,
    membersMayShareOrg: true,
    membersMayCreateCollections: false,
    source: "worker-key",
  };
}

/** A USER key WITHOUT a platform door: development, CI, E2E only. */
export function apiKeyAccessContext(input: {
  organisationId: string;
  createdByUserId: string | null;
}): AccessContext {
  return {
    userId: input.createdByUserId ?? "",
    organisationId: input.organisationId,
    email: "",
    orgRole: "member",
    productRole: "user",
    governed: false,
    accessMode: "assigned",
    collections: [],
    grantedIds: emptyGrants(),
    personalAllowed: true,
    membersMayShareOrg: true,
    membersMayCreateCollections: true,
    source: "api-key",
  };
}

/**
 * AN API KEY ACTS AS THE PERSON WHO CREATED IT — asked fresh at the platform
 * per request (60 s cache per key):
 *   `GET /api/access/orgs/:org/users/:user/context?product=<LAB_KEY>`
 * with the service key and WITHOUT a user token. Same answer shape as
 * `/api/access/me`, so the same parser applies.
 *
 * Three answers are a NO: `productRole === null` (access lost), key older
 * than `revokedAt` (token floor), platform unreachable/5xx.
 */
export async function getApiKeyAccessContext(
  input: {
    keyId: string;
    organisationId: string;
    createdByUserId: string | null;
    mintedAt: Date;
    kind: "user" | "worker";
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MachineAccess> {
  if (input.kind === "worker" || !input.createdByUserId) {
    return { ok: true, context: workerAccessContext(input.organisationId) };
  }

  const config = readDoorConfig();
  if (!config) {
    // No door. In development/CI the local context is the right answer. On a
    // server it is NOT: an unchecked view is never served.
    if (!localFallbackAllowed()) return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
    return { ok: true, context: apiKeyAccessContext(input) };
  }

  const hit = cacheGet(machineCache, input.keyId);
  if (hit) return hit.value;

  let res: Response;
  try {
    res = await fetchImpl(
      `${config.baseUrl}/api/access/orgs/${encodeURIComponent(input.organisationId)}/users/${encodeURIComponent(
        input.createdByUserId,
      )}/context?product=${LAB_KEY}`,
      {
        headers: { "X-API-Key": config.apiKey, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
  }

  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? await errorCode(res) : null;
    // A rejected SERVICE key is our problem, not the key owner's: say so in
    // the log and answer "could not check", never "you have no access".
    if (res.status === 401 || code === "ORG_NOT_ALLOWED_FOR_KEY") {
      warnOnce(`key-${res.status}`, `the platform rejected the Lab's own service key on the key path (HTTP ${res.status}).`);
      return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
    }
    if (res.status === 403 || res.status === 404) {
      const denied: MachineAccess = { ok: false, reason: "KEY_OWNER_NO_ACCESS" };
      cachePut(machineCache, input.keyId, denied);
      return denied;
    }
    return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
  }

  let context: AccessContext | null = null;
  let revokedAt: Date | null = null;
  try {
    const envelope = (await res.json()) as {
      success?: boolean;
      data?: RawMe & { revokedAt?: unknown };
    };
    if (envelope.success === true && envelope.data) {
      context = toContext(envelope.data);
      const raw = asString(envelope.data.revokedAt);
      if (raw) revokedAt = new Date(raw);
    }
  } catch {
    context = null;
  }

  let result: MachineAccess;
  if (!context || !hasProductAccess(context)) {
    result = { ok: false, reason: "KEY_OWNER_NO_ACCESS" };
  } else if (revokedAt && !Number.isNaN(revokedAt.getTime()) && input.mintedAt < revokedAt) {
    result = { ok: false, reason: "KEY_REVOKED" };
  } else if (context.organisationId.toLowerCase() !== input.organisationId.toLowerCase()) {
    // The key belongs to ONE organisation (its row). A platform answer for
    // another organisation is never acted upon.
    warnOnce("key-org-mismatch", "the platform answered the key check with a different organisation than the key's row.");
    result = { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
  } else {
    result = { ok: true, context: { ...context, organisationId: input.organisationId, source: "api-key" } };
  }
  cachePut(machineCache, input.keyId, result);
  return result;
}

/* ------------------------------------------------------ On-behalf tokens */

/**
 * A COLLECTION AGENT behind an on-behalf token: no person, exactly one
 * collection. With `userId ""`, `personalAllowed false` and
 * `membersMayShareOrg false` the rules of `src/lib/access-rules.ts` give it
 * organisation rows plus the rows of its collection, editing what it sees and
 * creating in its collection only. Nothing private, no individual grants.
 */
export function agentAccessContext(organisationId: string, collectionId: string): AccessContext {
  return {
    userId: "",
    organisationId,
    email: "",
    orgRole: "member",
    productRole: "user",
    governed: false,
    accessMode: "assigned",
    collections: [{ id: collectionId, name: collectionId, isOwner: false }],
    grantedIds: emptyGrants(),
    personalAllowed: false,
    membersMayShareOrg: false,
    membersMayCreateCollections: false,
    source: "agent",
  };
}

interface PersonAnswer {
  context: AccessContext | null;
  revokedAt: string | null;
  memberActive: boolean | null;
}

/** The machine route's answer for one person, cached 60 s per `${org}:${user}`. Failures are never cached. */
async function personAnswer(
  organisationId: string,
  userId: string,
  fetchImpl: typeof fetch,
): Promise<PersonAnswer | null> {
  const config = readDoorConfig();
  if (!config) return null;

  const key = `${organisationId.toLowerCase()}:${userId.toLowerCase()}`;
  const hit = cacheGet(personAnswerCache, key);
  if (hit) return hit.value;

  let res: Response;
  try {
    res = await fetchImpl(
      `${config.baseUrl}/api/access/orgs/${encodeURIComponent(organisationId)}/users/${encodeURIComponent(
        userId,
      )}/context?product=${LAB_KEY}`,
      {
        headers: { "X-API-Key": config.apiKey, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return null;
  }
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? await errorCode(res) : null;
    // A rejected SERVICE key is our problem, not the person's: "could not check".
    if (res.status === 401 || code === "ORG_NOT_ALLOWED_FOR_KEY") {
      warnOnce(`obo-key-${res.status}`, `the platform rejected the Lab's own service key on the token path (HTTP ${res.status}).`);
      return null;
    }
    // Any other 403, or 404: a final refusal about the person, as on the key
    // path. Not cached (contract 2.4 step 5 caches answers, never failures).
    if (res.status === 403 || res.status === 404) return { context: null, revokedAt: null, memberActive: null };
    return null;
  }

  let answer: PersonAnswer | null = null;
  try {
    const envelope = (await res.json()) as {
      success?: boolean;
      data?: RawMe & { revokedAt?: unknown; memberActive?: unknown };
    };
    if (envelope.success === true && envelope.data) {
      answer = {
        context: toContext(envelope.data),
        revokedAt: asString(envelope.data.revokedAt),
        memberActive: typeof envelope.data.memberActive === "boolean" ? envelope.data.memberActive : null,
      };
    }
  } catch {
    answer = null;
  }
  if (!answer) {
    warnOnce("obo-bad-response", "the platform answered the person check of an on-behalf token with a body this build cannot read.");
    return null;
  }
  cachePut(personAnswerCache, key, answer);
  return answer;
}

/**
 * Steps 4 and 5 of the token path (connection layer contract, stage 6, 2.4):
 * WHOSE view a token gets, and the check of every person it names.
 *
 *  - organisation agent, or neither agent nor person: the WORKER view;
 *  - collection agent: `agentAccessContext` (its collection, no person);
 *  - private agent: the view of `agent.owner`;
 *  - no agent, `personUserId` (`claims.sub`) present: that person's view.
 *
 * Every named person is checked (`personUserId` whenever present, and the
 * owner of a private agent), in this order: the floor against the token's
 * `issuedAt` (`KEY_REVOKED`), `memberActive === false` (`PERSON_GONE`),
 * product access (`KEY_OWNER_NO_ACCESS`, also for a person-level `403`/`404`).
 * Platform unreachable, `5xx`, a rejected service key or any other unusable
 * answer: `KEY_CHECK_UNAVAILABLE`.
 */
export async function getOnBehalfAccessContext(
  input: {
    organisationId: string;
    personUserId: string | null;
    issuedAt: Date;
    agent: OnBehalfAgent | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MachineAccess> {
  const named = new Set<string>();
  if (input.personUserId) named.add(input.personUserId.toLowerCase());
  const owner = input.agent?.level === "private" ? input.agent.owner?.toLowerCase() ?? null : null;
  if (input.agent?.level === "private" && !owner) return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
  if (owner) named.add(owner);

  const contexts = new Map<string, AccessContext>();
  for (const userId of named) {
    const answer = await personAnswer(input.organisationId, userId, fetchImpl);
    if (!answer) return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
    if (answer.revokedAt) {
      const floor = Date.parse(answer.revokedAt);
      if (!Number.isNaN(floor) && input.issuedAt.getTime() < floor) return { ok: false, reason: "KEY_REVOKED" };
    }
    if (answer.memberActive === false) return { ok: false, reason: "PERSON_GONE" };
    if (!answer.context || !hasProductAccess(answer.context)) return { ok: false, reason: "KEY_OWNER_NO_ACCESS" };
    if (answer.context.organisationId.toLowerCase() !== input.organisationId.toLowerCase()) {
      warnOnce("obo-org-mismatch", "the platform answered the person check with a different organisation than the token's.");
      return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
    }
    contexts.set(userId, { ...answer.context, organisationId: input.organisationId, source: "api-key" });
  }

  const level = input.agent?.level ?? null;
  if (level === "organisation") return { ok: true, context: workerAccessContext(input.organisationId) };
  if (level === "collection") {
    const collectionId = input.agent?.col;
    if (!collectionId) return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
    return { ok: true, context: agentAccessContext(input.organisationId, collectionId) };
  }
  const viewPerson = level === "private" ? owner : input.personUserId?.toLowerCase() ?? null;
  if (viewPerson) {
    const context = contexts.get(viewPerson);
    if (!context) return { ok: false, reason: "KEY_CHECK_UNAVAILABLE" };
    return { ok: true, context };
  }
  return { ok: true, context: workerAccessContext(input.organisationId) };
}

/* -------------------------------------------------------------- Helpers */

/**
 * May this context use the Lab? For a platform answer only `productRole`
 * counts — the platform has already folded `accessMode = everyone` into it
 * (contract: "refuse when productRole is null"). No second way in here.
 */
export function hasProductAccess(ctx: AccessContext): boolean {
  if (ctx.source === "local" || ctx.source === "worker-key" || ctx.source === "agent") return true;
  return ctx.productRole !== null;
}

export function isProductAdmin(ctx: AccessContext): boolean {
  return ctx.productRole === "product_admin";
}
