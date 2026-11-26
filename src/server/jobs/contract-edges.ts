import { LAB_KEY } from "@/lib/lab";

/**
 * Contract test per platform edge (lab learnings, rule 15).
 *
 * WHY: the staging AI door answered 502 for 12 days while every Lab test
 * stayed green, because the tests use a FAKE door. Uploads landed in the
 * wrong Brain while the Lab said "accepted". Fakes prove our side; only a
 * real call proves the edge. `scripts/contract-check.ts` makes ONE cheap
 * real call per edge against staging, once a day (.github/workflows/
 * contract-check.yml), and alerts on failure.
 *
 * An edge whose settings are missing is reported as `missing`, which FAILS
 * the run: a check that silently skips is how the 12 days happened. A Lab
 * that does not use an edge removes it from `buildEdges`, in code, reviewed.
 */

export interface Edge {
  name: string;
  /** Names of the settings this edge needs; empty value = edge `missing`. */
  needs: string[];
  /**
   * Optional step before the request (a host check, a token). Its values join
   * the settings handed to `request`. A throw fails the edge with the
   * message as the reason (never a secret in it).
   */
  prepare?: (env: Record<string, string>, fetchImpl: typeof fetch) => Promise<Record<string, string>>;
  request: (env: Record<string, string>) => { url: string; init: RequestInit };
  /** Is this answer the contract? Gets status and parsed JSON (or null). */
  accept: (status: number, body: unknown) => boolean;
  /**
   * Optional: why an answer that is not the contract failed, as a short word
   * for the job log (a state, a code; never a secret, never a setting's value).
   */
  explain?: (status: number, body: unknown) => string | undefined;
}

const json = (body: unknown): RequestInit["body"] => JSON.stringify(body);
const trim = (url: string) => url.replace(/\/+$/, "");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function buildEdges(): Edge[] {
  return [
    {
      name: "door-llm-complete",
      needs: ["PLATFORM_API_URL", "PLATFORM_API_KEY", "CONTRACT_ORGANISATION_ID"],
      request: (env) => ({
        url: `${trim(env.PLATFORM_API_URL)}/api/llm/complete`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": env.PLATFORM_API_KEY },
          // The door contract: { useCase, level }. Smallest possible call.
          body: json({
            organisationId: env.CONTRACT_ORGANISATION_ID,
            purpose: `${LAB_KEY}.contract-check`,
            useCase: "verification",
            level: "economy",
            messages: [{ role: "user", content: "Reply with the single word OK." }],
            maxTokens: 5,
          }),
        },
      }),
      accept: (status, body) =>
        status === 200 && isObject(body) && body.success === true && isObject(body.data) && typeof body.data.text === "string",
    },
    {
      // The media door's routing for this organisation: free (no generation),
      // but it proves key, organisation and media catalogue. A real image would
      // cost money every day. `/api/media` itself has no GET (404).
      name: "door-media-route",
      needs: ["PLATFORM_API_URL", "PLATFORM_API_KEY", "CONTRACT_ORGANISATION_ID"],
      request: (env) => ({
        url: `${trim(env.PLATFORM_API_URL)}/api/llm/route?organisationId=${encodeURIComponent(env.CONTRACT_ORGANISATION_ID)}&useCase=image&level=economy`,
        init: { method: "GET", headers: { "X-API-Key": env.PLATFORM_API_KEY } },
      }),
      accept: (status, body) =>
        status === 200 && isObject(body) && body.success === true && isObject(body.data) && typeof body.data.model === "string",
    },
    {
      // Without a session the Suite must answer 401 as JSON: that proves the
      // login edge is there and speaks the contract. A stored session token
      // would expire after 24 hours and turn this check red for good.
      name: "suite-auth-me",
      needs: ["NEXT_PUBLIC_PLATFORM_URL"],
      request: (env) => ({
        url: `${trim(env.NEXT_PUBLIC_PLATFORM_URL)}/api/auth/me`,
        init: { method: "GET" },
      }),
      accept: (status, body) => status === 401 && isObject(body) && !("unparsable" in body),
    },
    {
      // The platform reads OUR export with PLATFORM_EXPORT_KEY. Checked
      // against the Lab's own staging address with the staging key.
      name: "lab-export-key",
      needs: ["CONTRACT_LAB_URL", "PLATFORM_EXPORT_KEY", "CONTRACT_ORGANISATION_ID"],
      request: (env) => ({
        url: `${trim(env.CONTRACT_LAB_URL)}/api/platform/export?organisationId=${encodeURIComponent(env.CONTRACT_ORGANISATION_ID)}`,
        init: { method: "GET", headers: { "x-api-key": env.PLATFORM_EXPORT_KEY } },
      }),
      accept: (status) => status === 200,
    },
    {
      // The memory door (docs/FRAME.md 4a). The staging Brain API is
      // reachable over the private network only, never from the GitHub
      // runner, so the Lab makes the call from where it runs: `GET
      // /api/platform/brain-status` with the export key. The Lab checks the
      // address first (never the dashboard, never the platform, a staging
      // Lab never the production Brain) and reports `wrong-host` without a
      // call; otherwise it recalls once with an on-behalf token (audience
      // `brain`), the way every real call goes. Only `ok` is the contract.
      name: "brain-memory-recall",
      needs: ["CONTRACT_LAB_URL", "PLATFORM_EXPORT_KEY", "CONTRACT_ORGANISATION_ID"],
      request: (env) => ({
        url: `${trim(env.CONTRACT_LAB_URL)}/api/platform/brain-status?organisationId=${encodeURIComponent(env.CONTRACT_ORGANISATION_ID)}`,
        init: { method: "GET", headers: { "x-api-key": env.PLATFORM_EXPORT_KEY } },
      }),
      accept: (status, body) =>
        status === 200 && isObject(body) && body.success === true && isObject(body.data) && body.data.state === "ok",
      explain: (_status, body) => {
        if (!isObject(body) || !isObject(body.data) || typeof body.data.state !== "string") return undefined;
        const failure = isObject(body.data.failure) && typeof body.data.failure.code === "string" ? ` code=${body.data.failure.code}` : "";
        return `state=${body.data.state}${failure}`;
      },
    },
  ];
}

export type EdgeResult = {
  name: string;
  status: "ok" | "failed" | "missing";
  http?: number;
  /** Why `prepare` failed the edge before any request, or what `explain` read from the answer. */
  reason?: string;
};

export async function checkEdges(
  edges: Edge[],
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<EdgeResult[]> {
  const results: EdgeResult[] = [];
  for (const edge of edges) {
    const values: Record<string, string> = {};
    const missing = edge.needs.filter((name) => !(values[name] = env[name]?.trim() ?? ""));
    if (missing.length > 0) {
      results.push({ name: edge.name, status: "missing" });
      continue;
    }
    if (edge.prepare) {
      try {
        Object.assign(values, await edge.prepare(values, fetchImpl));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "prepare failed";
        results.push({ name: edge.name, status: "failed", http: 0, reason });
        console.error(`edge=${edge.name} prepare_failed=${JSON.stringify(reason)}`);
        continue;
      }
    }
    const { url, init } = edge.request(values);
    try {
      const res = await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body: unknown = await res.json().catch((error: unknown) => ({ unparsable: String(error) }));
      if (edge.accept(res.status, body)) {
        results.push({ name: edge.name, status: "ok", http: res.status });
      } else {
        const reason = edge.explain?.(res.status, body);
        results.push({ name: edge.name, status: "failed", http: res.status, ...(reason ? { reason } : {}) });
      }
    } catch (error) {
      results.push({ name: edge.name, status: "failed", http: 0 });
      console.error(`edge=${edge.name} network_error=${error instanceof Error ? error.name : "unknown"}`);
    }
  }
  return results;
}
