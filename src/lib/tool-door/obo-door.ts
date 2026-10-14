import {
  createOboDoor,
  oboDoorState as sharedOboDoorState,
  type OboCheck,
  type OboDoorState,
} from "@/lib/doors/tool-door/obo-door";
import { DOOR_HOST } from "@/lib/tool-door/host";

export {
  OBO_REQUESTS_PER_MINUTE,
  onBehalfBearer,
  onBehalfRateSubject,
  type OboCheck,
  type OboDoorState,
} from "@/lib/doors/tool-door/obo-door";

/**
 * The on-behalf part of this Lab's machine door: the shared door
 * (`src/lib/doors/tool-door/obo-door.ts`, generated from beyondles-shared,
 * never edited here) bound to this Lab's settings. One door per process.
 * Node runtime only (never `middleware.ts`, never a client component).
 */

const door = createOboDoor(DOOR_HOST);

type Env = Record<string, string | undefined>;

/** Spelled out on purpose: the deployment tests look for exactly `process.env.NAME`. */
function currentEnv(): Env {
  return {
    PLATFORM_API_URL: process.env.PLATFORM_API_URL,
    ON_BEHALF_ISSUER: process.env.ON_BEHALF_ISSUER,
  };
}

/** `ok` when this environment's issuer and the platform's address are both set. */
export function oboDoorState(env: Env = currentEnv()): OboDoorState {
  return sharedOboDoorState({
    platformApiUrl: env.PLATFORM_API_URL,
    onBehalfIssuer: env.ON_BEHALF_ISSUER,
  });
}

/** Steps 1 to 3 of the token path. One verifier per audience and process, built on first use. */
export function checkOnBehalfToken(
  token: string,
  audience: string,
): Promise<OboCheck> {
  return door.check(token, audience);
}

/** Tests only: forget verifiers (and their keys), rate windows and the refusal log memory. */
export function __resetOboDoorForTests(): void {
  door.reset();
}
