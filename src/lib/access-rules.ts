import type { Prisma, Visibility } from "@prisma/client";

import type { AccessContext, ObjectType } from "@/lib/platform/access";

/**
 * Access model, LEVEL 3 — the CONTAINER on the single row.
 *
 * Every top-level object carries three columns: `visibility`, `ownerUserId`,
 * `collectionId`. Who sees a row follows from them plus what the platform
 * says about the person (collections, individual grants):
 *
 *  - ORGANISATION — everybody with product access in this organisation.
 *  - COLLECTION   — everybody in `collectionId` (collections live on the platform).
 *  - PRIVATE      — the owner, plus people with an individual grant.
 *  - Individual grants (view/edit) open a row regardless of its container.
 *
 * A worker key sees ORGANISATION rows only. These are the same rules for the
 * UI, `/api/v1` and MCP: all three go through `visibleWhere`/`canEdit`.
 *
 * Copy this file's shape for every new object type; the `where` fragment is
 * generic over the three columns.
 */

interface ContainerColumns {
  id: string;
  ownerUserId: string;
  visibility: Visibility;
  collectionId: string | null;
}

/** Prisma `where` fragment selecting the rows this context may SEE. */
export function visibleWhere(ctx: AccessContext, type: ObjectType): Prisma.NoteWhereInput {
  const organisationId = ctx.organisationId;
  if (ctx.source === "worker-key") {
    return { organisationId, visibility: "ORGANISATION" };
  }
  const granted = ctx.grantedIds[type];
  const grantedIds = [...new Set([...granted.view, ...granted.edit])];
  const collectionIds = ctx.collections.map((c) => c.id);

  const or: Prisma.NoteWhereInput[] = [{ visibility: "ORGANISATION" }];
  if (ctx.userId) or.push({ visibility: "PRIVATE", ownerUserId: ctx.userId });
  if (collectionIds.length > 0) or.push({ visibility: "COLLECTION", collectionId: { in: collectionIds } });
  if (grantedIds.length > 0) or.push({ id: { in: grantedIds } });

  return { organisationId, OR: or };
}

/** May this context CHANGE the row? Owner, product admin, or an edit grant. */
export function canEdit(ctx: AccessContext, type: ObjectType, row: ContainerColumns): boolean {
  if (ctx.source === "worker-key") return row.visibility === "ORGANISATION";
  if (ctx.productRole === "product_admin") return true;
  if (ctx.userId && row.ownerUserId === ctx.userId) return true;
  if (ctx.grantedIds[type].edit.includes(row.id)) return true;
  if (row.visibility === "ORGANISATION") return ctx.membersMayShareOrg;
  return false;
}

/** Which containers may this context choose when creating a row? */
export function allowedVisibilities(ctx: AccessContext): Visibility[] {
  const out: Visibility[] = [];
  if (ctx.personalAllowed && ctx.userId) out.push("PRIVATE");
  if (ctx.collections.length > 0) out.push("COLLECTION");
  if (ctx.membersMayShareOrg || ctx.productRole === "product_admin" || ctx.source === "worker-key") {
    out.push("ORGANISATION");
  }
  return out;
}
