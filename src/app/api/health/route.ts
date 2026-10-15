import { NextResponse } from "next/server";

import { healthAccessField } from "@/lib/platform-client/next/health";
import { LAB_KEY } from "@/lib/lab";
import { door } from "@/lib/platform/door";
import { brainHealthField } from "@/lib/platform/memory";
import { oboDoorState } from "@/lib/tool-door/obo-door";

/**
 * Liveness — the only path without sign-in (see PUBLIC_PATHS in middleware).
 * Deliberately WITHOUT a database query: this answers "is the process
 * running", not "is everything healthy". `access` reports the state of the
 * door in the one vocabulary every product uses (`ok` / `local` /
 * `unconfigured` / `off`) so a rollout check can spot the dangerous
 * in-between state without a network call.
 * `onBehalf` says whether on-behalf tokens can be checked here (`ok` /
 * `unconfigured`: `ON_BEHALF_ISSUER` or `PLATFORM_API_URL` missing).
 * `brain` is the memory door from the settings alone (`ok` / `unconfigured` /
 * `wrong-host`: the dashboard, the platform or, on staging, the production
 * Brain); the daily contract check proves the real edge.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: LAB_KEY, ...healthAccessField(door()), onBehalf: oboDoorState(), brain: brainHealthField() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
