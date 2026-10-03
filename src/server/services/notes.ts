import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-errors";
import { allowedVisibilities, visibleWhere } from "@/lib/access-rules";
import type { AccessContext } from "@/lib/platform/access";

/**
 * Service layer for the example object. EVERY function takes the access
 * context and filters by `organisationId` AND the container rules. UI, HTTP
 * door and MCP all call these functions; there is no second path.
 */

/**
 * `visibility` is optional: a person who names none creates a private note.
 * A collection agent (on-behalf token, `source: "agent"`) must name none: its
 * notes always land in its own collection.
 */
export const noteInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  visibility: z.enum(["private", "organisation"]).optional(),
});
export type NoteInput = z.infer<typeof noteInputSchema>;

const select = {
  id: true,
  title: true,
  body: true,
  visibility: true,
  ownerUserId: true,
  collectionId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listNotes(ctx: AccessContext, options: { search?: string; limit?: number }) {
  const search = options.search?.trim();
  return db.note.findMany({
    where: {
      AND: [
        visibleWhere(ctx, "note"),
        search
          ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { body: { contains: search, mode: "insensitive" } }] }
          : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 50, 1), 100),
    select,
  });
}

export async function countVisibleNotes(ctx: AccessContext): Promise<number> {
  return db.note.count({ where: visibleWhere(ctx, "note") });
}

export async function getNote(ctx: AccessContext, noteId: string) {
  return db.note.findFirst({ where: { AND: [{ id: noteId }, visibleWhere(ctx, "note")] }, select });
}

export async function createNote(ctx: AccessContext, input: NoteInput) {
  if (ctx.source === "agent") {
    // A collection agent creates in its own collection and nowhere else: no
    // private rows (it is no person), no organisation-wide rows.
    const collectionId = ctx.collections[0]?.id;
    if (input.visibility !== undefined || !collectionId) {
      throw new ApiError(403, "forbidden", "A collection agent creates notes in its own collection only; do not name a visibility.");
    }
    return db.note.create({
      data: {
        organisationId: ctx.organisationId,
        title: input.title,
        body: input.body,
        visibility: "COLLECTION",
        collectionId,
        ownerUserId: ctx.userId,
      },
      select,
    });
  }

  const wanted = input.visibility ?? "private";
  const visibility = wanted === "organisation" ? "ORGANISATION" : "PRIVATE";
  if (!allowedVisibilities(ctx).includes(visibility)) {
    throw new ApiError(403, "forbidden", `This key or person may not create ${wanted} notes.`);
  }
  return db.note.create({
    data: {
      organisationId: ctx.organisationId,
      title: input.title,
      body: input.body,
      visibility,
      ownerUserId: ctx.userId,
    },
    select,
  });
}
