import {
  createReleaseGate,
  type ReleaseVerdict,
} from "@/lib/doors/tool-door/release-gate";
import type { FetchLike } from "@/lib/doors/door-host";
import { DOOR_HOST } from "@/lib/tool-door/host";

export {
  RELEASE_CACHE_MS,
  RELEASE_GRACE_MS,
  type ReleaseVerdict,
} from "@/lib/doors/tool-door/release-gate";

/**
 * The release gate for this Lab's machine keys (Lab keys and Beyondles keys):
 * the shared gate (`src/lib/doors/tool-door/release-gate.ts`, generated from
 * beyondles-shared, never edited here) bound to this Lab's settings. One gate
 * per process. Node runtime only.
 */

const gate = createReleaseGate(DOOR_HOST);

export function checkLabReleased(
  organisationId: string,
  options: { localMode: boolean; fetchImpl?: FetchLike; now?: () => number },
): Promise<ReleaseVerdict> {
  return gate.check(organisationId, options);
}

/** Tests only. */
export function __resetReleaseGateForTests(): void {
  gate.reset();
}
