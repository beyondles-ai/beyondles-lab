import { NextResponse } from "next/server";

import { LAB_KEY } from "@/lib/lab";
import { accessDoorState } from "@/lib/platform/door";

/**
 * Liveness — the only path without sign-in (see PUBLIC_PATHS in middleware).
 * Deliberately WITHOUT a database query: this answers "is the process
 * running", not "is everything healthy". `access` reports whether the doors
 * are configured (`off` / `unconfigured` / `ok`) so a rollout check can spot
 * the dangerous in-between state without a network call.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: LAB_KEY, access: accessDoorState() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
