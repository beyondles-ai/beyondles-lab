import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { brainStatus } from "@/lib/platform/brain-status";
import { checkExportKey } from "@/lib/platform-export-auth";

/**
 * `GET /api/platform/brain-status?organisationId=<uuid>`: does THIS running
 * Lab reach the right Brain? Called by the daily contract edge
 * `brain-memory-recall` (`src/server/jobs/contract-edges.ts`): the staging
 * Brain API is reachable over the private network only, so the check runs
 * where the Lab runs instead of on the GitHub runner.
 *
 * Answer: `200 { success: true, data: { state, environment, ... } }`
 * whenever the check itself ran, so the caller reads `state` (`ok`,
 * `unconfigured`, `wrong-host`, `failed`) instead of guessing from a status
 * code. States and codes only, never a setting's value
 * (`src/lib/platform/brain-status.ts`).
 *
 * ACCESS: like `/api/platform/export`: `X-API-Key` against
 * `PLATFORM_EXPORT_KEY` in constant time; unset key = `503
 * EXPORT_NOT_CONFIGURED`, never open. Read-only (one recall, no write).
 * `Cache-Control: no-store` on every answer. Public in `src/middleware.ts`
 * through the `/api/platform/` prefix because it authenticates itself.
 */
export const dynamic = "force-dynamic";

// Well-formed uuid and no more, like the export route.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const querySchema = z.object({ organisationId: z.string().regex(UUID) });

function answer(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = checkExportKey(request);
  if (!auth.ok) return answer(auth.status, { success: false, error: { code: auth.code, message: auth.message } });

  const parsed = querySchema.safeParse({
    organisationId: request.nextUrl.searchParams.get("organisationId") ?? "",
  });
  if (!parsed.success) {
    return answer(400, { success: false, error: { code: "VALIDATION", message: "organisationId (uuid) missing or invalid." } });
  }

  return answer(200, { success: true, data: await brainStatus(parsed.data.organisationId) });
}
