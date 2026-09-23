import { requireApiKey } from "@/lib/api-auth";
import { ApiError, apiJson, withErrorEnvelope } from "@/lib/api-errors";
import { getNote } from "@/server/services/notes";

/** GET /api/v1/notes/:noteId — one note, if the key's view may see it. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ noteId: string }> },
): Promise<Response> {
  return withErrorEnvelope(async () => {
    const key = await requireApiKey(request);
    const { noteId } = await context.params;
    const note = await getNote(key.access, noteId);
    // "Does not exist" and "belongs to somebody else" answer the same.
    if (!note) throw new ApiError(404, "not_found", "Note not found.");
    return apiJson({ data: note });
  });
}
