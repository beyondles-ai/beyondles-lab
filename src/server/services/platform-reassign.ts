import "server-only";

import { db } from "@/lib/db";

/**
 * The SUCCESSOR rule of the access model: when a person leaves an
 * organisation, the platform asks every product to hand over what that person
 * owns (`POST /api/platform/reassign-owner`).
 *
 * In ONE transaction:
 *  - every note of the organisation owned by `fromUserId` gets
 *    `ownerUserId = toUserId`; visibility and collection stay as they were
 *    (a change of owner is not a share);
 *  - every still active key of the organisation the person created is
 *    revoked (revoked, not deleted: the row stays as evidence). WORKER keys
 *    have no creator and are not touched, so nightly jobs survive a departure.
 *
 * The platform compares ids case-insensitively; the stored id is the token's
 * spelling. So organisation and person are matched without case (`ci()`);
 * the new owner is written as given.
 *
 * Idempotent: a second run, and an organisation this Lab never saw, count 0.
 * Every object table with an owner column belongs in here (match ids with
 * `ci()`); the counts are reported per object type.
 */

/** Match an id without regard to case, like the platform does. */
const ci = (id: string) => ({ equals: id, mode: "insensitive" as const });

export interface ReassignResult {
  reassigned: { note: number };
  revokedApiKeys: number;
}

export async function reassignOwner(
  organisationId: string,
  fromUserId: string,
  toUserId: string,
  now: Date = new Date(),
): Promise<ReassignResult> {
  const [notes, keys] = await db.$transaction([
    db.note.updateMany({
      where: { organisationId: ci(organisationId), ownerUserId: ci(fromUserId) },
      data: { ownerUserId: toUserId },
    }),
    db.apiKey.updateMany({
      where: { organisationId: ci(organisationId), createdByUserId: ci(fromUserId), revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
  return { reassigned: { note: notes.count }, revokedApiKeys: keys.count };
}
