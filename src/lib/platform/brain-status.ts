import { isBrainClientError, type BrainClientErrorCode } from "@/lib/brain-client";
import { LAB_KEY } from "@/lib/lab";
import { brain, brainAddressProblem, brainConfigState, type LabEnvironment } from "@/lib/platform/memory";

/**
 * Does THIS running Lab reach the right Brain? Answered from the Lab's own
 * server, because the staging Brain API is reachable over the private network
 * only (never from a GitHub runner). Read by `GET /api/platform/brain-status`,
 * which the daily contract edge `brain-memory-recall`
 * (`src/server/jobs/contract-edges.ts`) calls with the export key.
 *
 * One real recall as a Lab job for the named organisation (on-behalf token
 * with audience `brain`, the way every real call goes). Read-only: recall
 * writes nothing, and the items themselves are never returned, only their
 * count.
 *
 * The answer holds STATES and codes only, never a setting's value (no
 * address, no host, no key): `ok`, `unconfigured` (names of the missing
 * settings), `wrong-host` (no call made) or `failed` (the client's error code
 * and HTTP status). The reason for `wrong-host` goes to the server log.
 *
 * A Lab that is not explicitly production never calls the production Brain:
 * `unknown` is treated like staging here.
 */

export type BrainStatus =
  | { state: "ok"; environment: LabEnvironment; items: number }
  | { state: "unconfigured"; environment: LabEnvironment; missing: string[] }
  | { state: "wrong-host"; environment: LabEnvironment }
  | { state: "failed"; environment: LabEnvironment; failure: { code: BrainClientErrorCode | "UNKNOWN"; status: number } };

type Env = Record<string, string | undefined>;

export async function brainStatus(organisationId: string, env?: Env): Promise<BrainStatus> {
  const config = brainConfigState(env);
  const { environment } = config;
  if (config.state === "unconfigured") return { state: "unconfigured", environment, missing: config.missing };
  const reason =
    config.state === "wrong-host"
      ? config.reason
      : environment === "production"
        ? null
        : brainAddressProblem(config.baseUrl, "staging");
  if (reason) {
    console.warn(`[memory] brain-status wrong-host environment=${environment} reason=${JSON.stringify(reason)}`);
    return { state: "wrong-host", environment };
  }

  try {
    const client = brain(env);
    if (!client) return { state: "unconfigured", environment, missing: [] };
    const answer = await client.recall(
      { organisationId: organisationId.toLowerCase() },
      { query: `${LAB_KEY} contract check`, limit: 1 },
    );
    if (answer.failure) {
      console.warn(`[memory] brain-status failed code=${answer.failure.code} http=${answer.failure.status}`);
      return { state: "failed", environment, failure: { code: answer.failure.code, status: answer.failure.status } };
    }
    return { state: "ok", environment, items: answer.items.length };
  } catch (error) {
    const code = isBrainClientError(error) ? error.code : "UNKNOWN";
    console.warn(`[memory] brain-status failed code=${code}`);
    return { state: "failed", environment, failure: { code, status: 0 } };
  }
}
