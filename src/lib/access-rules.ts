import type { Prisma, Visibility } from "@prisma/client";

import {
  canEdit as sharedCanEdit,
  canSee as sharedCanSee,
  mayChooseVisibility,
  visibilityWhere,
} from "@/lib/platform-client/core/rules";
import type { AccessContext, ObjectType } from "@/lib/platform/access";

/**
 * Access model, LEVEL 3 — the CONTAINER on the single row.
 *
 * Every top-level object carries three columns: `visibility`, `ownerUserId`,
 * `collectionId`. Who sees a row follows from them plus what the platform
 * says about the person (collections, individual grants). The rules are the
 * shared ones of beyondles-ai/beyondles-shared (`core/rules.ts`, policy P4 of
 * the access contract):
 *
 *  - visible  = owner (any visibility) OR ORGANISATION with product access OR
 *               COLLECTION with membership OR an individual grant (view or edit)
 *  - editable = visible AND NOT a private row while the organisation switched
 *               "only me" off (it must be moved first) AND (owner OR
 *               ORGANISATION OR COLLECTION with membership OR an EDIT grant).
 *               A view grant never yields edit. A product admin gets NO
 *               superset: an admin who cannot see a private row cannot edit
 *               it either.
 *  - a worker key owns nothing, is in no collection and holds no grant, so it
 *    sees and edits ORGANISATION rows only.
 *
 * These are the same rules for the UI, `/api/v1` and MCP: all three go
 * through `visibleWhere` / `canEdit`. Copy this file's shape for every new
 * object type; the `where` fragment is generic over the three columns.
 */

interface ContainerColumns {
  id: string;
  ownerUserId: string;
  visibility: Visibility;
  collectionId: string | null;
}

/** Prisma `where` fragment selecting the rows this context may SEE. */
export function visibleWhere(ctx: AccessContext, type: ObjectType): Prisma.NoteWhereInput {
  return { organisationId: ctx.organisationId, ...(visibilityWhere(ctx, type) as Prisma.NoteWhereInput) };
}

/** May this context SEE the row? Same rule as `visibleWhere`, in memory. */
export function canSee(ctx: AccessContext, type: ObjectType, row: ContainerColumns): boolean {
  return sharedCanSee(ctx, type, row);
}

/** May this context CHANGE the row? */
export function canEdit(ctx: AccessContext, type: ObjectType, row: ContainerColumns): boolean {
  return sharedCanEdit(ctx, type, row);
}

/**
 * Which containers may this context choose when creating a row? The shared
 * `mayChooseVisibility` decides each one ("only me" switched off, members not
 * allowed to share with everyone: only the organisation's owners and admins,
 * not the product admin). This Lab adds two facts of its own: a collection
 * is offered only to a member of one, and a context without a person (a
 * worker key) creates nothing private.
 */
export function allowedVisibilities(ctx: AccessContext): Visibility[] {
  const out: Visibility[] = [];
  if (ctx.userId && mayChooseVisibility(ctx, "PRIVATE")) out.push("PRIVATE");
  if (ctx.collections.length > 0 && mayChooseVisibility(ctx, "COLLECTION")) out.push("COLLECTION");
  if (mayChooseVisibility(ctx, "ORGANISATION")) out.push("ORGANISATION");
  return out;
}
