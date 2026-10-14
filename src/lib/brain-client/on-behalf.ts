/**
 * brain-client: on-behalf credentials for Labs (audience `brain`).
 *
 * A Lab holds no Brain key. It asks platform-api for a five-minute token
 * (`POST /api/on-behalf/token`, platform-api `src/routes/on-behalf.js`) that names the Lab, The
 * Brain, the organisation and, where there is one, the person and the agent; The Brain verifies
 * it with the platform's public keys. Every Lab already carries the token helper:
 * `createOnBehalfClient` in `src/lib/platform/on-behalf.ts` of the template (copied verbatim
 * into every Lab), with an in-memory cache and `forget` for a refused token.
 *
 * This file only connects that helper to the brain client, so the client depends on nothing
 * of the host:
 *
 *   import { createOnBehalfClient } from "@/lib/platform/on-behalf";
 *   const tokens = createOnBehalfClient({ platformApiUrl, apiKey });   // once per process
 *   const client = createBrainClient({
 *     baseUrl, productKey: "summarizelab", credentials: brainOnBehalfCredentials(tokens),
 *   });
 *
 * The one translation it makes is the agent level. The brain vocabulary names where an entry
 * lives (`personal`, `team`, `company`); the token names who an agent belongs to (`private`,
 * `collection`, `organisation`). platform-api refuses an owner on anything but a private agent
 * and a collection on anything but a collection agent, so only the member that belongs to the
 * level is sent.
 *
 * Imports `./types` only. No `next`, no `node:crypto`, no environment.
 */

import type { BrainAgent, BrainCallContext, OnBehalfCredentials } from "./types";

/** The product key of The Brain in the platform registry (platform-api migration 017). */
export const BRAIN_AUDIENCE = "brain";

export type OnBehalfAgentLevel = "private" | "collection" | "organisation";

/** The request shape of the template's `OnBehalfTokenRequest`. */
export interface BrainTokenRequest {
  audience: string;
  organisationId: string;
  userId: string | null;
  agent: {
    id: string;
    level: OnBehalfAgentLevel;
    ownerUserId?: string;
    collectionId?: string;
  } | null;
}

/** What the template's `createOnBehalfClient` returns, as far as this file uses it. */
export interface OnBehalfTokenSource {
  getToken(request: BrainTokenRequest): Promise<string>;
  forget?(request: BrainTokenRequest): void;
}

const LEVEL_TO_TOKEN: Record<BrainAgent["level"], OnBehalfAgentLevel> = {
  personal: "private",
  team: "collection",
  company: "organisation",
};

/**
 * The token request for one call. The ctx reaching this function was checked by the client
 * (uuids, the owner and collection pairing), so it maps without checking again.
 */
export function brainTokenRequest(ctx: BrainCallContext): BrainTokenRequest {
  const request: BrainTokenRequest = {
    audience: BRAIN_AUDIENCE,
    organisationId: ctx.organisationId,
    userId: ctx.userId ? ctx.userId : null,
    agent: null,
  };
  if (ctx.agent) {
    const level = LEVEL_TO_TOKEN[ctx.agent.level];
    const agent: NonNullable<BrainTokenRequest["agent"]> = { id: ctx.agent.id, level };
    if (level === "private" && ctx.agent.ownerUserId) agent.ownerUserId = ctx.agent.ownerUserId;
    if (level === "collection" && ctx.agent.collectionId) agent.collectionId = ctx.agent.collectionId;
    request.agent = agent;
  }
  return request;
}

/** On-behalf credentials for `createBrainClient` on top of the Lab's token helper. */
export function brainOnBehalfCredentials(tokens: OnBehalfTokenSource): OnBehalfCredentials {
  return {
    mode: "on-behalf",
    getToken: (ctx) => tokens.getToken(brainTokenRequest(ctx)),
    forgetToken: (ctx) => {
      if (typeof tokens.forget === "function") tokens.forget(brainTokenRequest(ctx));
    },
  };
}
