import type { Prisma, Visibility } from "@prisma/client";

import type { AccessContext, ObjectType } from "@/lib/platform/access";

/**
 * Access model, LEVEL 3 — the CONTAINER on the single row.
 *
 * Every top-level object carries three columns: `visibility`, `ownerUserId`,
 * `collectionId`. Who sees a row follows from them plus what the platform
 * says about the person (collections, individual grants). Rules from the
 * platform contract (ZUGANG-CONTRACT-platform-api.md, "visibility rule"):
 *
 *  - visible  = owner (any visibility) OR ORGANISATION OR COLLECTION with
 *               membership OR an individual grant (view or edit)
 *  - editable = visible AND (owner OR visibility in COLLECTION/ORGANISATION
 *               OR an edit grant). A product admin gets NO superset: an admin
 *               who cannot see a private row cannot edit it either.
 *  - a worker key sees and edits ORGANISATION rows only.
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
  const organisationId = ctx.organisationId;
  if (ctx.source === "worker-key") {
    return { organisationId, visibility: "ORGANISATION" };
  }
  const granted = ctx.grantedIds[type];
  const grantedIds = [...new Set([...granted.view, ...granted.edit])];
  const collectionIds = ctx.collections.map((c) => c.id);

  const or: Prisma.NoteWhereInput[] = [{ visibility: "ORGANISATION" }];
  // The owner sees their own row whatever its container — also after leaving
  // the collection it sits in.
  if (ctx.userId) or.push({ ownerUserId: ctx.userId });
  if (collectionIds.length > 0) or.push({ visibility: "COLLECTION", collectionId: { in: collectionIds } });
  if (grantedIds.length > 0) or.push({ id: { in: grantedIds } });

  return { organisationId, OR: or };
}

/** May this context SEE the row? Same rule as `visibleWhere`, in memory. */
export function canSee(ctx: AccessContext, type: ObjectType, row: ContainerColumns): boolean {
  if (row.visibility === "ORGANISATION") return true;
  if (ctx.source === "worker-key") return false;
  if (ctx.userId && row.ownerUserId === ctx.userId) return true;
  if (row.visibility === "COLLECTION" && row.collectionId && ctx.collections.some((c) => c.id === row.collectionId)) {
    return true;
  }
  const granted = ctx.grantedIds[type];
  return granted.view.includes(row.id) || granted.edit.includes(row.id);
}

/** May this context CHANGE the row? Visible AND (owner, shared container, or edit grant). */
export function canEdit(ctx: AccessContext, type: ObjectType, row: ContainerColumns): boolean {
  if (!canSee(ctx, type, row)) return false;
  if (ctx.source === "worker-key") return row.visibility === "ORGANISATION";
  if (ctx.userId && row.ownerUserId === ctx.userId) return true;
  if (row.visibility === "COLLECTION" || row.visibility === "ORGANISATION") return true;
  return ctx.grantedIds[type].edit.includes(row.id);
}

/** Which containers may this context choose when creating a row? */
export function allowedVisibilities(ctx: AccessContext): Visibility[] {
  const out: Visibility[] = [];
  if (ctx.source === "worker-key") return ["ORGANISATION"];
  if (ctx.personalAllowed && ctx.userId) out.push("PRIVATE");
  if (ctx.collections.length > 0) out.push("COLLECTION");
  // When members may not share organisation-wide, only the organisation's
  // owners and admins may (contract) — not the product admin.
  if (ctx.membersMayShareOrg || ctx.orgRole === "owner" || ctx.orgRole === "admin") out.push("ORGANISATION");
  return out;
}
