import { z } from "zod";

import { requireApiKey } from "@/lib/api-auth";
import { apiJson, readJson, withErrorEnvelope, zodToApiError } from "@/lib/api-errors";
import { createNote, listNotes, noteInputSchema } from "@/server/services/notes";

/**
 * HTTP door for notes — the machine view of the same functions the UI has.
 *   GET  /api/v1/notes?search=&limit=   list (in the key's view)
 *   POST /api/v1/notes                  create
 * Security boundary: `requireApiKey` (x-api-key). The middleware lets
 * `/api/v1` through without a cookie for exactly that reason.
 */
export const dynamic = "force-dynamic";

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request): Promise<Response> {
  return withErrorEnvelope(async () => {
    const key = await requireApiKey(request);
    const url = new URL(request.url);
    const parsed = listSchema.safeParse({
      search: url.searchParams.get("search") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw zodToApiError(parsed.error);
    const notes = await listNotes(key.access, parsed.data);
    return apiJson({ data: notes });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorEnvelope(async () => {
    const key = await requireApiKey(request);
    const parsed = noteInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw zodToApiError(parsed.error);
    const note = await createNote(key.access, parsed.data);
    return apiJson({ data: note }, 201);
  });
}
