/**
 * brain-client: the types of The Brain memory functions (spec #377, sections 3 to 5).
 *
 * This file imports nothing. Every other file of the module imports its types from here, so a
 * product that copies single files always takes `types.ts` along.
 *
 * Vocabulary:
 *  - A BRAIN LEVEL is where an entry lives: `personal` (one person), `team` (one platform
 *    collection), `company` (the organisation's default brain).
 *  - The SOURCE is the product that wrote an entry (`summarizelab`, `horaizon`, ...). Its key is
 *    the product key of the platform registry.
 *  - The SOURCE REF is the writer's own stable id of the thing an entry comes from
 *    (`meeting:<uuid>#decision:3`). The Brain upserts on `(brain, source, sourceRef)`.
 */

/** Where an entry lives. */
export type BrainLevel = "personal" | "team" | "company";

/** What The Brain reports as the kind of a brain (public.brains.kind). */
export type BrainKind = "company" | "team" | "personal" | "agent" | "advisor" | "other";

/** What an entry is. Structured kinds skip the LLM extraction; `text` goes through it. */
export type MemoryKind = "fact" | "decision" | "event" | "task" | "text";

/** `proposed` waits in an inbox; `confirmed` is read by everybody who may read the brain. */
export type ReviewState = "proposed" | "confirmed" | "rejected";

/**
 * The id of an entry. The Brain's `knowledge.id` is an integer in the tenant schema today; the
 * client hands back exactly what The Brain sent and sends it back unchanged.
 */
export type EntryId = string | number;

/**
 * The agent a call is made for. `level` is the agent's own level in the brain vocabulary:
 * a private agent is `personal` (with `ownerUserId`), a team agent `team` (with
 * `collectionId`), an organisation agent `company`.
 */
export interface BrainAgent {
  /** The calling product's own id of the agent: 1 to 128 printable ASCII characters, no spaces. */
  id: string;
  level: BrainLevel;
  /** Level `personal` only, and required there: the user id of the agent's owner. */
  ownerUserId?: string;
  /** Level `team` only, and required there: the platform collection id of the agent. */
  collectionId?: string;
}

/**
 * Who a call is made for. In service-key mode this becomes the headers of spec section 3B; in
 * on-behalf mode the token carries it and the product's `getToken` builds the token from it.
 */
export interface BrainCallContext {
  /** Organisation id (uuid). Required. */
  organisationId: string;
  /** The person behind the call (uuid). Absent for a Lab job or an agent without a person. */
  userId?: string | null;
  /** The person's organisation role (`owner`, `admin`, `member`). Service-key mode only. */
  role?: string | null;
  agent?: BrainAgent | null;
}

/** An explicit target of a write. Without one the default is `own-level`. */
export type RememberTarget =
  | "own-level"
  | { brain: BrainLevel; ownerUserId?: string; collectionId?: string }
  | { brainId: string };

/**
 * The record an entry comes from (Lab jobs). It decides `own-level`: a private record goes to
 * the owner's personal brain, a collection record to that collection's team brain, an
 * organisation record to the company brain.
 */
export interface MemoryObject {
  visibility: "private" | "collection" | "organisation";
  /** Required for `private`. */
  ownerUserId?: string;
  /** Required for `collection`. */
  collectionId?: string;
}

/** A pointer to another entry, by its writer's ids. */
export interface MemoryLink {
  source: string;
  sourceRef: string;
}

export interface RememberInput {
  /** Registry key of the writer. Defaults to the client's `productKey`. */
  source?: string;
  /** The writer's stable id of the thing this entry comes from. Required. */
  sourceRef: string;
  kind: MemoryKind;
  /** Required for kind `event` (`signed`, `booked`, `won`, `lost`, ...), not allowed otherwise. */
  event?: string;
  title?: string;
  content: string;
  target?: RememberTarget;
  object?: MemoryObject;
  /** ISO 8601 or a `Date`. Sent as ISO 8601. */
  occurredAt?: string | Date;
  validUntil?: string | Date;
  tags?: string[];
  links?: MemoryLink[];
  language?: "de" | "en";
  /** An optional Brain category; The Brain picks one per kind without it. */
  category?: string;
}

export interface RememberResult {
  id: EntryId;
  brainId: string;
  brainKind: BrainKind;
  status: "created" | "updated" | "unchanged";
  reviewState: ReviewState;
}

/** The brains a recall may be narrowed to, by kind. */
export type RecallBrainKind = BrainLevel | "agent";

export interface RecallInput {
  /** At least three characters after trimming; longer text is cut to `RECALL_MAX_QUERY_CHARS`. */
  query: string;
  /** 1 to 50, default 10. */
  limit?: number;
  brains?: RecallBrainKind[];
  brainIds?: string[];
  sources?: string[];
  kinds?: MemoryKind[];
  since?: string | Date;
  /** Also entries in state `proposed` whose `source` is the caller's own product. */
  includeOwnProposals?: boolean;
  /** Also `proposed` entries of brains the reading person may confirm. */
  includeProposed?: boolean;
}

/** One entry as recall and inbox return it. */
export interface MemoryItem {
  id: EntryId;
  brainId: string;
  brainKind: BrainKind | null;
  title: string;
  /** At most `RECALL_SNIPPET_CHARS` characters. */
  snippet: string;
  /** At most `RECALL_CONTENT_CHARS` characters. */
  content: string;
  source: string | null;
  sourceRef: string | null;
  kind: MemoryKind | null;
  event: string | null;
  reviewState: ReviewState | null;
  occurredAt: string | null;
  originEntryId: EntryId | null;
  originBrainId: string | null;
  score: number | null;
}

/** Why a recall came back empty, for a visible notice. Absent when The Brain answered. */
export interface RecallFailure {
  code: BrainClientErrorCode;
  status: number;
}

export interface RecallResult {
  items: MemoryItem[];
  failure?: RecallFailure;
}

export interface ForgetInput {
  /** Defaults to the client's `productKey`. */
  source?: string;
  /** Exactly one of `sourceRef` and `sourceRefPrefix`. */
  sourceRef?: string;
  sourceRefPrefix?: string;
  brainIds?: string[];
}

export interface ForgetResult {
  deleted: number;
}

export interface InboxQuery {
  brain?: BrainLevel;
  collectionId?: string;
  brainId?: string;
  /** 1 to 50. */
  limit?: number;
}

export interface InboxResult {
  items: MemoryItem[];
}

export interface ReviewInput {
  id: EntryId;
  brainId: string;
  action: "confirm" | "reject" | "edit";
  /** For `edit`. */
  title?: string;
  content?: string;
}

export interface ReviewResult {
  id: EntryId;
  brainId: string;
  reviewState: ReviewState | null;
}

export interface ShareInput {
  id: EntryId;
  brainId: string;
  target: { brain: "team" | "company"; collectionId?: string };
}

export interface ShareResult {
  /** The id of the copy in the target brain. */
  id: EntryId;
  /** The target brain. */
  brainId: string;
  originEntryId: EntryId;
  originBrainId: string;
}

// --- credentials -----------------------------------------------------------------------------

/**
 * Labs: a five-minute on-behalf token of platform-api with audience `brain`. `getToken` is the
 * product's own token helper (see `on-behalf.ts` for the adapter to the Lab template's
 * `createOnBehalfClient`). `forgetToken`, when given, drops a cached token after The Brain
 * answered 401, and the call is sent once more with a fresh one.
 */
export interface OnBehalfCredentials {
  mode: "on-behalf";
  getToken: (ctx: BrainCallContext) => Promise<string>;
  forgetToken?: (ctx: BrainCallContext) => void;
}

/** Core products: The Brain service key (`X-API-Key`) plus its internal key (`x-internal-api-key`). */
export interface ServiceKeyCredentials {
  mode: "service-key";
  apiKey: string;
  internalKey: string;
}

export type BrainCredentials = OnBehalfCredentials | ServiceKeyCredentials;

// --- transport -------------------------------------------------------------------------------

/** The part of a `Response` the client reads. */
export interface HttpResponseLike {
  status: number;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null } | null;
}

/** The part of `RequestInit` the client sets. */
export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?: "no-store";
  redirect?: "manual";
  signal?: AbortSignal;
}

/** `fetch`, or anything with its shape. The global `fetch` fits. */
export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponseLike>;

export interface BrainClientOptions {
  /** The Brain API host (`https://api.beyondles.ai`), never the dashboard host. No `/api` at the end. */
  baseUrl: string;
  /** The product key of the caller: the default `source` of writes and forgets. */
  productKey: string;
  credentials: BrainCredentials;
  /** Default: the global `fetch`, looked up when a request is sent. */
  fetch?: FetchLike;
  /** Time limit of one request. Default `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Time limit of one recall. Default `RECALL_TIMEOUT_MS`. */
  recallTimeoutMs?: number;
}

export interface BrainClient {
  /** Throws `BrainClientError`. */
  remember(ctx: BrainCallContext, input: RememberInput): Promise<RememberResult>;
  /** Never throws: an empty list, with `failure` when The Brain did not answer usefully. */
  recall(ctx: BrainCallContext, input: RecallInput): Promise<RecallResult>;
  /** Throws `BrainClientError`. */
  forget(ctx: BrainCallContext, input: ForgetInput): Promise<ForgetResult>;
  /** Throws `BrainClientError`. */
  inbox(ctx: BrainCallContext, query?: InboxQuery): Promise<InboxResult>;
  /** Throws `BrainClientError`. */
  review(ctx: BrainCallContext, input: ReviewInput): Promise<ReviewResult>;
  /** Throws `BrainClientError`. */
  share(ctx: BrainCallContext, input: ShareInput): Promise<ShareResult>;
}

// --- errors ----------------------------------------------------------------------------------

/**
 * The codes a `BrainClientError` carries. The first eight are the contract of spec section 5;
 * `FORBIDDEN` (a 403 that is not a level violation) and `BAD_RESPONSE` (an answer that is not
 * The Brain envelope, for example the dashboard host's HTML) keep two different failures from
 * hiding behind a wrong name.
 */
export type BrainClientErrorCode =
  | "level_violation"
  | "USAGE_LIMIT_REACHED"
  | "RATE_LIMITED"
  | "SOURCE_DAILY_CAP"
  | "UNAUTHORIZED"
  | "BRAIN_NOT_FOUND"
  | "UNREACHABLE"
  | "VALIDATION"
  | "FORBIDDEN"
  | "BAD_RESPONSE";

/** What an outbox does with a failed write (README, "Retry guidance"). */
export type RetryAction = "retry" | "backoff" | "park" | "edge_broken" | "drop";

export interface RetryAdvice {
  action: RetryAction;
  /** For `retry` and `backoff`: the wait before the next attempt. */
  delayMs?: number;
}
