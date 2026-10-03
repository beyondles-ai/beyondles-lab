import "server-only";

import { db } from "@/lib/db";
import { hashApiKey, hashEquals } from "@/lib/api-keys";
import { ApiError } from "@/lib/api-errors";
import { MACHINE_DENY_STATUS } from "@/lib/platform-client/core/types";
import {
  getApiKeyAccessContext,
  type AccessContext,
  type MachineDenyReason,
} from "@/lib/platform/access";

/**
 * The door for machines: header `x-api-key`.
 *
 * People keep coming through the Suite cookie (`src/lib/rbac.ts`). The
 * middleware lets `/api/v1` and `/api/mcp` through without a cookie; the
 * security boundary is THIS file, running in the Node process with database
 * access.
 *
 * Two kinds of keys:
 *  - USER   — created for a PERSON. Acts in her view of TODAY: the Lab asks
 *             the platform per request what she may see. Lost access = dead
 *             key (403), not "then only organisation-wide". A USER key whose
 *             person is missing is refused (403), never served as a worker.
 *  - WORKER — created for the ORGANISATION. No person behind it: only
 *             organisation-wide rows, nothing private, survives departures.
 */

export interface ApiKeyContext {
  organisationId: string;
  keyId: string;
  keyName: string;
  createdByUserId: string | null;
  kind: "user" | "worker";
  access: AccessContext;
}

const LAST_USED_GRANULARITY_MS = 60_000;

/** The status of each refusal is the access contract's (policy P3); the texts are this Lab's. */
const DENIALS: Record<MachineDenyReason, string> = {
  KEY_OWNER_NO_ACCESS:
    "The person who created this key has no access to this Lab. The key never sees more than they do.",
  KEY_REVOKED:
    "This key was issued before its creator's access was revoked and is no longer valid. Create a new one.",
  PERSON_GONE:
    "The person who created this key is no longer a member of the organisation. Create a new key.",
  KEY_CHECK_UNAVAILABLE:
    "The access of this key could not be checked right now. Unchecked is not served — try again later.",
};

/**
 * Reads `x-api-key`, checks it and returns organisation plus view.
 * 401 for missing, unknown or revoked (all three answer the same, so a
 * guessed key learns nothing). 403/503 only after that.
 */
export async function requireApiKey(request: Request): Promise<ApiKeyContext> {
  const plaintext = request.headers.get("x-api-key")?.trim();
  if (!plaintext) throw new ApiError(401, "unauthorized", "Header x-api-key is missing.");

  const hash = hashApiKey(plaintext);
  const row = await db.apiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      name: true,
      organisationId: true,
      keyHash: true,
      createdByUserId: true,
      kind: true,
      createdAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });

  if (!row || row.revokedAt || !hashEquals(row.keyHash, hash)) {
    throw new ApiError(401, "unauthorized", "API key invalid.");
  }

  // The kind is the row's. A USER row without a creator stays a user key and
  // is refused (policy P3); only a WORKER row acts for nobody.
  const kind: "user" | "worker" = row.kind === "WORKER" ? "worker" : "user";

  const access = await getApiKeyAccessContext({
    keyId: row.id,
    organisationId: row.organisationId,
    createdByUserId: row.createdByUserId,
    mintedAt: row.createdAt,
    kind,
  });
  if (!access.ok) {
    throw new ApiError(MACHINE_DENY_STATUS[access.reason], access.reason, DENIALS[access.reason]);
  }

  await rememberUse(row.id, row.lastUsedAt);

  return {
    organisationId: row.organisationId,
    keyId: row.id,
    keyName: row.name,
    createdByUserId: row.createdByUserId,
    kind,
    access: access.context,
  };
}

/** Best effort, at most once a minute; a failed write never fails the request. */
async function rememberUse(keyId: string, lastUsedAt: Date | null): Promise<void> {
  const now = Date.now();
  if (lastUsedAt && now - lastUsedAt.getTime() < LAST_USED_GRANULARITY_MS) return;
  try {
    await db.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date(now) } });
  } catch (error) {
    console.warn("[api-auth] lastUsedAt could not be written:", error);
  }
}
