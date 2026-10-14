/**
 * brain-client: checking what a product hands in, before anything is sent or queued.
 *
 * Every check here is one The Brain makes as well. Making it in the client too has two
 * reasons: an outbox must not queue a job that can never succeed (it would be retried for
 * days), and a mistake in a product shows up in its own unit tests instead of as a 400 in a
 * server log nobody reads.
 *
 * Each function returns the normalised value (trimmed ids in lower case, dates as ISO 8601,
 * no `undefined` members) or throws `BrainClientError` with code `VALIDATION` and status 0.
 *
 * Imports `./types` and `./errors` only.
 */

import { BrainClientError } from "./errors";
import type {
  BrainAgent,
  BrainCallContext,
  BrainLevel,
  EntryId,
  InboxQuery,
  MemoryKind,
  RecallInput,
  RememberInput,
  ReviewInput,
  ShareInput,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A registry product key, as platform-api checks it (`src/routes/on-behalf.js` PRODUCT_KEY). */
const PRODUCT_KEY = /^[a-z0-9_]{2,40}$/;
/** As platform-api checks an agent id: 1 to 128 printable ASCII characters without spaces. */
const AGENT_ID = /^[\x21-\x7e]{1,128}$/;
const ROLE = /^[a-z_]{1,32}$/;
const EVENT = /^[a-z][a-z0-9_]{0,39}$/;

export const BRAIN_LEVELS: readonly BrainLevel[] = ["personal", "team", "company"];
export const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "decision", "event", "task", "text"];
const RECALL_BRAIN_KINDS: readonly string[] = ["personal", "team", "company", "agent"];
const VISIBILITIES: readonly string[] = ["private", "collection", "organisation"];
const REVIEW_ACTIONS: readonly string[] = ["confirm", "reject", "edit"];

/** `knowledge.title` is `varchar(255)` in the tenant schema. */
export const MAX_TITLE_CHARS = 255;
/** One entry. Longer text is refused, never cut: a cut fact is a wrong fact. */
export const MAX_CONTENT_CHARS = 50_000;
export const MAX_SOURCE_REF_CHARS = 500;
export const MAX_TAGS = 30;
export const MAX_TAG_CHARS = 64;
export const MAX_LINKS = 20;
export const MAX_CATEGORY_CHARS = 100;
/** The most brain ids a recall or forget may name. */
export const MAX_BRAIN_IDS = 50;

export function invalid(message: string): BrainClientError {
  return new BrainClientError("VALIDATION", message, { status: 0, retryable: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Empty means empty after trimming (the platform-client rule). */
function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim().toLowerCase())) {
    throw invalid(`${name} must be a uuid.`);
  }
  return value.trim().toLowerCase();
}

function optionalUuid(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return uuid(value, name);
}

function productKey(value: unknown, name: string): string {
  if (typeof value !== "string" || !PRODUCT_KEY.test(value)) {
    throw invalid(`${name} must be a product key (2 to 40 characters a-z, 0-9, _).`);
  }
  return value;
}

function text(value: unknown, name: string, max: number): string {
  if (!present(value)) throw invalid(`${name} must be a non-empty string.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${name} is longer than ${max} characters.`);
  return trimmed;
}

function isoDate(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw invalid(`${name} must be a Date or an ISO 8601 string.`);
  return new Date(ms).toISOString();
}

function entryId(value: unknown, name: string): EntryId {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (present(value) && value.trim().length <= 64) return value.trim();
  throw invalid(`${name} must be a positive integer or a non-empty string.`);
}

function list<T>(value: unknown, name: string, max: number, item: (entry: unknown, at: string) => T): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid(`${name} must be a list.`);
  if (value.length > max) throw invalid(`${name} has more than ${max} entries.`);
  return value.map((entry, index) => item(entry, `${name}[${index}]`));
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw invalid(`${name} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

// --- context ---------------------------------------------------------------------------------

function checkAgent(value: unknown): BrainAgent {
  if (!isRecord(value)) throw invalid("ctx.agent must be an object.");
  if (typeof value.id !== "string" || !AGENT_ID.test(value.id)) {
    throw invalid("ctx.agent.id must be 1 to 128 printable ASCII characters without spaces.");
  }
  const level = oneOf<BrainLevel>(value.level, BRAIN_LEVELS, "ctx.agent.level");
  const agent: BrainAgent = { id: value.id, level };
  // The same pairing platform-api enforces for the token (owner only for a private agent,
  // collection only for a team agent), so both modes refuse the same contexts.
  if (level === "personal") {
    agent.ownerUserId = uuid(value.ownerUserId, "ctx.agent.ownerUserId (required for a personal agent)");
  } else if (value.ownerUserId !== undefined && value.ownerUserId !== null) {
    throw invalid("ctx.agent.ownerUserId is only allowed for a personal agent.");
  }
  if (level === "team") {
    agent.collectionId = uuid(value.collectionId, "ctx.agent.collectionId (required for a team agent)");
  } else if (value.collectionId !== undefined && value.collectionId !== null) {
    throw invalid("ctx.agent.collectionId is only allowed for a team agent.");
  }
  return agent;
}

/** The context, normalised. A blank `userId` or `role` is no `userId` or `role`. */
export function checkContext(ctx: unknown): BrainCallContext {
  if (!isRecord(ctx)) throw invalid("ctx must be an object.");
  const out: BrainCallContext = { organisationId: uuid(ctx.organisationId, "ctx.organisationId") };
  if (present(ctx.userId)) out.userId = uuid(ctx.userId, "ctx.userId");
  if (present(ctx.role)) {
    const role = ctx.role.trim().toLowerCase();
    if (!ROLE.test(role)) throw invalid("ctx.role must be a role name such as owner, admin or member.");
    out.role = role;
  }
  if (ctx.agent !== undefined && ctx.agent !== null) out.agent = checkAgent(ctx.agent);
  return out;
}

/**
 * Service-key mode: the context as the headers of spec section 3B. Only proven values: every
 * id is a checked uuid, so no header can carry a line break.
 */
export function contextHeaders(ctx: BrainCallContext): Record<string, string> {
  const headers: Record<string, string> = { "x-organisation-id": ctx.organisationId };
  if (ctx.userId) headers["x-user-id"] = ctx.userId;
  if (ctx.role) headers["x-user-role"] = ctx.role;
  if (ctx.agent) {
    headers["x-agent-id"] = ctx.agent.id;
    headers["x-agent-level"] = ctx.agent.level;
    if (ctx.agent.ownerUserId) headers["x-agent-owner-user-id"] = ctx.agent.ownerUserId;
    if (ctx.agent.collectionId) headers["x-agent-collection-id"] = ctx.agent.collectionId;
  }
  return headers;
}

// --- remember --------------------------------------------------------------------------------

function checkTarget(value: unknown): RememberInput["target"] {
  if (value === undefined || value === null || value === "own-level") return "own-level";
  if (!isRecord(value)) throw invalid('target must be "own-level", { brain } or { brainId }.');
  if ("brainId" in value) {
    if (Object.keys(value).length !== 1) throw invalid("target { brainId } takes no other member.");
    return { brainId: uuid(value.brainId, "target.brainId") };
  }
  const brain = oneOf<BrainLevel>(value.brain, BRAIN_LEVELS, "target.brain");
  const target: { brain: BrainLevel; ownerUserId?: string; collectionId?: string } = { brain };
  if (brain === "team") {
    target.collectionId = uuid(value.collectionId, "target.collectionId (required for a team brain)");
  } else if (value.collectionId !== undefined) {
    throw invalid("target.collectionId is only allowed for a team brain.");
  }
  if (brain === "personal") {
    const owner = optionalUuid(value.ownerUserId, "target.ownerUserId");
    if (owner) target.ownerUserId = owner;
  } else if (value.ownerUserId !== undefined) {
    throw invalid("target.ownerUserId is only allowed for a personal brain.");
  }
  return target;
}

function checkObject(value: unknown): RememberInput["object"] {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw invalid("object must be an object.");
  const visibility = oneOf<"private" | "collection" | "organisation">(value.visibility, VISIBILITIES, "object.visibility");
  const object: NonNullable<RememberInput["object"]> = { visibility };
  if (visibility === "private") {
    object.ownerUserId = uuid(value.ownerUserId, "object.ownerUserId (required for a private object)");
  } else {
    const owner = optionalUuid(value.ownerUserId, "object.ownerUserId");
    if (owner) object.ownerUserId = owner;
  }
  if (visibility === "collection") {
    object.collectionId = uuid(value.collectionId, "object.collectionId (required for a collection object)");
  }
  return object;
}

/** The remember input as the body of `POST /api/memory/remember`. `source` defaults to `productKey`. */
export function checkRemember(input: unknown, defaultSource: string): RememberInput & { source: string } {
  if (!isRecord(input)) throw invalid("remember input must be an object.");
  const source = productKey(input.source ?? defaultSource, "source");
  const kind = oneOf<MemoryKind>(input.kind, MEMORY_KINDS, "kind");
  const body: RememberInput & { source: string } = {
    source,
    sourceRef: text(input.sourceRef, "sourceRef", MAX_SOURCE_REF_CHARS),
    kind,
    content: text(input.content, "content", MAX_CONTENT_CHARS),
  };
  if (kind === "event") {
    if (typeof input.event !== "string" || !EVENT.test(input.event)) {
      throw invalid("event is required for kind event: a lower-case name such as signed, booked, won or lost.");
    }
    body.event = input.event;
  } else if (input.event !== undefined && input.event !== null) {
    throw invalid("event is only allowed for kind event.");
  }
  if (input.title !== undefined && input.title !== null) body.title = text(input.title, "title", MAX_TITLE_CHARS);
  body.target = checkTarget(input.target);
  const object = checkObject(input.object);
  if (object) body.object = object;
  const occurredAt = isoDate(input.occurredAt, "occurredAt");
  if (occurredAt) body.occurredAt = occurredAt;
  const validUntil = isoDate(input.validUntil, "validUntil");
  if (validUntil) body.validUntil = validUntil;
  const tags = list(input.tags, "tags", MAX_TAGS, (tag, at) => text(tag, at, MAX_TAG_CHARS));
  if (tags) body.tags = tags;
  const links = list(input.links, "links", MAX_LINKS, (link, at) => {
    if (!isRecord(link)) throw invalid(`${at} must be { source, sourceRef }.`);
    return {
      source: productKey(link.source, `${at}.source`),
      sourceRef: text(link.sourceRef, `${at}.sourceRef`, MAX_SOURCE_REF_CHARS),
    };
  });
  if (links) body.links = links;
  if (input.language !== undefined && input.language !== null) {
    body.language = oneOf<"de" | "en">(input.language, ["de", "en"], "language");
  }
  if (input.category !== undefined && input.category !== null) {
    body.category = text(input.category, "category", MAX_CATEGORY_CHARS);
  }
  return body;
}

// --- recall ----------------------------------------------------------------------------------

/** A recall needs this much text; The Brain refuses shorter queries anyway. */
export const RECALL_MIN_QUERY_CHARS = 3;
/** Longer query text is cut: a recall is a search, not a write. */
export const RECALL_MAX_QUERY_CHARS = 1000;
export const RECALL_DEFAULT_LIMIT = 10;
/** The Brain's own maximum per recall (spec section 4). */
export const RECALL_MAX_ITEMS = 50;

/** Why `recallBody` sends nothing. */
export type RecallRefusal = "too_short" | "unusable_filter";

/**
 * The recall body, or the reason no request is sent. Never throws: the caller of `recall` must
 * never see an exception.
 *
 * A filter only ever NARROWS a recall. So a wrong value inside a filter is dropped while at
 * least one good value remains (the result is narrower than asked, never wider). A filter that
 * was given but has no usable value left is refused as a whole (`unusable_filter`): sending the
 * recall without it would widen it to every readable brain, and a product that asked for
 * `brains: ["company"]` before posting into a shared channel must never get a person's own
 * entries because of a typo.
 */
export function recallBody(input: RecallInput): { body: Record<string, unknown> } | { refused: RecallRefusal } {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (query.length < RECALL_MIN_QUERY_CHARS) return { refused: "too_short" };
  const requested = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.trunc(input.limit) : RECALL_DEFAULT_LIMIT;
  const body: Record<string, unknown> = {
    query: query.slice(0, RECALL_MAX_QUERY_CHARS),
    limit: Math.max(1, Math.min(RECALL_MAX_ITEMS, requested)),
  };
  let unusable = false;
  const strings = (value: unknown, keep: (entry: string) => boolean): string[] | undefined => {
    if (value === undefined || value === null) return undefined;
    const kept = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && keep(entry)) : [];
    if (kept.length === 0) {
      unusable = true;
      return undefined;
    }
    return Array.from(new Set(kept)).slice(0, MAX_BRAIN_IDS);
  };
  const brains = strings(input.brains, (entry) => RECALL_BRAIN_KINDS.includes(entry));
  if (brains) body.brains = brains;
  const brainIds = strings(input.brainIds, (entry) => UUID.test(entry.toLowerCase()));
  if (brainIds) body.brainIds = brainIds.map((entry) => entry.toLowerCase());
  const sources = strings(input.sources, (entry) => PRODUCT_KEY.test(entry));
  if (sources) body.sources = sources;
  const kinds = strings(input.kinds, (entry) => (MEMORY_KINDS as readonly string[]).includes(entry));
  if (kinds) body.kinds = kinds;
  if (input.since !== undefined && input.since !== null) {
    const ms = input.since instanceof Date ? input.since.getTime() : Date.parse(String(input.since));
    if (Number.isFinite(ms)) body.since = new Date(ms).toISOString();
    else unusable = true;
  }
  if (unusable) return { refused: "unusable_filter" };
  if (input.includeOwnProposals === true) body.includeOwnProposals = true;
  if (input.includeProposed === true) body.includeProposed = true;
  return { body };
}

// --- forget, inbox, review, share ------------------------------------------------------------

export function checkForget(input: unknown, defaultSource: string): Record<string, unknown> {
  if (!isRecord(input)) throw invalid("forget input must be an object.");
  const hasRef = input.sourceRef !== undefined && input.sourceRef !== null;
  const hasPrefix = input.sourceRefPrefix !== undefined && input.sourceRefPrefix !== null;
  // A forget without either would mean "everything this product ever wrote". That is a
  // different action (organisation deletion runs through the platform fan-out), never a
  // missing argument.
  if (hasRef === hasPrefix) throw invalid("forget needs exactly one of sourceRef and sourceRefPrefix.");
  const body: Record<string, unknown> = { source: productKey(input.source ?? defaultSource, "source") };
  if (hasRef) body.sourceRef = text(input.sourceRef, "sourceRef", MAX_SOURCE_REF_CHARS);
  else body.sourceRefPrefix = text(input.sourceRefPrefix, "sourceRefPrefix", MAX_SOURCE_REF_CHARS);
  const brainIds = list(input.brainIds, "brainIds", MAX_BRAIN_IDS, (id, at) => uuid(id, at));
  if (brainIds) body.brainIds = brainIds;
  return body;
}

/** The inbox query string, starting with `?` or empty. */
export function inboxQueryString(query: InboxQuery | undefined): string {
  if (query === undefined || query === null) return "";
  if (!isRecord(query)) throw invalid("inbox query must be an object.");
  const params = new URLSearchParams();
  if (query.brain !== undefined) params.set("brain", oneOf<BrainLevel>(query.brain, BRAIN_LEVELS, "brain"));
  const collectionId = optionalUuid(query.collectionId, "collectionId");
  if (collectionId) params.set("collectionId", collectionId);
  if (query.brain === "team" && !collectionId && query.brainId === undefined) {
    throw invalid("inbox of a team brain needs collectionId or brainId.");
  }
  const brainId = optionalUuid(query.brainId, "brainId");
  if (brainId) params.set("brainId", brainId);
  if (query.limit !== undefined) {
    if (typeof query.limit !== "number" || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > RECALL_MAX_ITEMS) {
      throw invalid(`limit must be an integer from 1 to ${RECALL_MAX_ITEMS}.`);
    }
    params.set("limit", String(query.limit));
  }
  const encoded = params.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

export function checkReview(input: unknown): ReviewInput {
  if (!isRecord(input)) throw invalid("review input must be an object.");
  const action = oneOf<ReviewInput["action"]>(input.action, REVIEW_ACTIONS, "action");
  const body: ReviewInput = { id: entryId(input.id, "id"), brainId: uuid(input.brainId, "brainId"), action };
  if (action === "edit") {
    if (input.title === undefined && input.content === undefined) throw invalid("edit needs a title or a content.");
    if (input.title !== undefined) body.title = text(input.title, "title", MAX_TITLE_CHARS);
    if (input.content !== undefined) body.content = text(input.content, "content", MAX_CONTENT_CHARS);
  } else if (input.title !== undefined || input.content !== undefined) {
    throw invalid("title and content are only allowed for edit.");
  }
  return body;
}

export function checkShare(input: unknown): ShareInput {
  if (!isRecord(input)) throw invalid("share input must be an object.");
  const target = input.target;
  if (!isRecord(target)) throw invalid("share target must be { brain: 'team' | 'company', collectionId? }.");
  // Sharing goes upwards only (spec section 4): never into a personal brain.
  const brain = oneOf<"team" | "company">(target.brain, ["team", "company"], "target.brain");
  const out: ShareInput = { id: entryId(input.id, "id"), brainId: uuid(input.brainId, "brainId"), target: { brain } };
  if (brain === "team") out.target.collectionId = uuid(target.collectionId, "target.collectionId (required for a team brain)");
  else if (target.collectionId !== undefined) throw invalid("target.collectionId is only allowed for a team brain.");
  return out;
}
