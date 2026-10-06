import {
  apiJson,
  readJson,
  withErrorEnvelope,
  zodToApiError,
} from "@/lib/api-errors";
import { openMachineDoor } from "@/server/machine-door";
import { expireNotesSchema } from "@/server/schemas/notes";
import { expireNotes } from "@/server/services/notes";

/**
 * WORKER-TRIGGERED ROUTE (docs/FRAME.md 5, "Worker routes").
 *   POST /api/v1/worker/expire-notes  { "olderThanDays": 365 }
 * Called by a scheduler (cron on the host, a platform job) with a WORKER key
 * of this Lab that carries `write` and `notes:delete`. A USER key, an
 * on-behalf token or a missing scope is refused by `openMachineDoor`.
 * REST only by design: no screen, no MCP tool (see the manifest).
 * All worker routes live under `/api/v1/worker/`.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorEnvelope(async () => {
    const actor = await openMachineDoor(request, "expireNotes");
    const parsed = expireNotesSchema.safeParse(await readJson(request));
    if (!parsed.success) throw zodToApiError(parsed.error);
    return apiJson({ data: await expireNotes(actor, parsed.data) });
  });
}
