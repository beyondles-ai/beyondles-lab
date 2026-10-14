/**
 * brain-client: the barrel. A product imports from here; single files work as well.
 */

export { createBrainClient, checkBrainBaseUrl, DEFAULT_TIMEOUT_MS, RECALL_TIMEOUT_MS, RECALL_SNIPPET_CHARS, RECALL_CONTENT_CHARS } from "./client";
export { BrainClientError, isBrainClientError, retryAdvice } from "./errors";
export { enqueueRemember, isRememberJob, REMEMBER_JOB_VERSION } from "./outbox";
export type { RememberJob } from "./outbox";
export { BRAIN_AUDIENCE, brainOnBehalfCredentials, brainTokenRequest } from "./on-behalf";
export type { BrainTokenRequest, OnBehalfAgentLevel, OnBehalfTokenSource } from "./on-behalf";
export { RECALL_DEFAULT_LIMIT, RECALL_MAX_ITEMS, RECALL_MAX_QUERY_CHARS, RECALL_MIN_QUERY_CHARS } from "./validate";
export type { BrainLevel, BrainKind, MemoryKind, ReviewState, EntryId, BrainAgent, BrainCallContext, RememberTarget, MemoryObject, MemoryLink, RememberInput, RememberResult, RecallBrainKind, RecallInput, MemoryItem, RecallFailure, RecallResult, ForgetInput, ForgetResult, InboxQuery, InboxResult, ReviewInput, ReviewResult, ShareInput, ShareResult, OnBehalfCredentials, ServiceKeyCredentials, BrainCredentials, HttpResponseLike, HttpRequestInit, FetchLike, BrainClientOptions, BrainClient, BrainClientErrorCode, RetryAction, RetryAdvice } from "./types";
