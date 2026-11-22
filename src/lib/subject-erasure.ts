import "server-only";

import type { Visibility } from "@prisma/client";

import type { Actor } from "@/lib/actor";
import { canSee } from "@/lib/access-rules";
import { isProductAdmin, type ObjectType } from "@/lib/platform/access";

/**
 * Erasure by the customer (docs/FRAME.md 9.4). A Lab that stores personal
 * data of the customer's OWN visitors, contacts, guests or leads (people who
 * are not Suite users) lets the organisation answer a data-protection erasure
 * request itself, inside the Lab, on all three doors:
 *
 *  - erase ONE record (a conversation, a booking, a submission), and
 *  - erase EVERYTHING of one person (by the identifier the Lab stores, for
 *    example the e-mail address, sent in the request BODY, never in the URL).
 *
 * The template stores no such data, so it has no erase function. This file
 * is the permission skeleton every such Lab uses; the reference is AdvisorLab
 * (`mayEraseVisitorData` in `src/lib/permissions.ts`,
 * `src/lib/operator-erasure.ts`, `POST /api/v1/contacts/erase`, PRs #196 and
 * #197).
 *
 * WHO MAY: a person who SEES the record's container AND owns it or is a
 * product admin of this Lab. An edit right is NOT enough: an erasure cannot be
 * undone and answers a request the organisation is accountable for. Refused:
 * worker keys and every agent (organisation, collection and private): there
 * is no human behind them who took the request. The SAME function hides the
 * button in the screen and refuses in the service, so nobody sees a button
 * that would be refused.
 *
 * THE AUDIT LINE carries counts only (`erasureAuditDetails`): how many
 * records, messages, files were erased or skipped. Never the address, a name
 * or any text of the erased records.
 */

/** The container columns of the object the subject's records hang on. */
export interface ErasableContainer {
  id: string;
  ownerUserId: string;
  visibility: Visibility;
  collectionId: string | null;
}

/** Why an erasure is refused; `null` = allowed. */
export type ErasureRefusal = "no_person" | "agent" | "not_visible" | "not_owner_or_admin";

export function erasureRefusal(actor: Actor, type: ObjectType, container: ErasableContainer): ErasureRefusal | null {
  if (actor.door === "worker" || !actor.personUserId) return "no_person";
  if (actor.agentLevel !== null) return "agent";
  if (!canSee(actor.access, type, container)) return "not_visible";
  const owner = container.ownerUserId === actor.personUserId;
  return owner || isProductAdmin(actor.access) ? null : "not_owner_or_admin";
}

/**
 * May this actor erase the data subject's records on this container? Use it
 * for the button AND in the service. In the service, answer `not_found` for
 * `not_visible` (existence is not revealed) and `forbidden` for the rest.
 */
export function mayEraseSubjectData(actor: Actor, type: ObjectType, container: ErasableContainer): boolean {
  return erasureRefusal(actor, type, container) === null;
}

/**
 * The `details` of the one audit line an erasure writes: whole, non-negative
 * counts only. Anything else (an address, a name, a text) throws, so personal
 * data can never reach the audit trail through this helper.
 */
export function erasureAuditDetails(
  target: "record" | "person",
  counts: Record<string, number>,
): Record<string, string | number> {
  const details: Record<string, string | number> = { target };
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`erasureAuditDetails: "${key}" is not a count; the audit line carries counts only`);
    }
    details[key] = value;
  }
  return details;
}
