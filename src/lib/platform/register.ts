import { readDoorConfig } from "@/lib/platform/door";
import { LAB_KEY, LAB_NAME } from "@/lib/lab";

/**
 * Self-registration at the platform: `POST /api/registry/self`, once per start.
 *
 * A Lab used to need two manual migrations (a `products` row at the platform, a `labs` row in the
 * Suite) and an edit of a list in the Suite before anybody could see it. Now the Lab says on every
 * start "I exist, my name is …, I live at …", with its own service key. The platform files it in
 * its product registry; the Suite reads the registry and creates the Lab's release switch closed.
 * Releasing the Lab for an organisation stays a deliberate step under /operator/labs.
 *
 * What the platform accepts from a Lab is narrow on purpose: kind `lab`, its name, addresses that
 * are still empty. The key is the service key's name, never a body field, so a Lab can only
 * register itself. Protection, role labels and stored addresses are never changed this way.
 *
 * NEVER THROWS AND NEVER BLOCKS THE START. Without a platform door (local development, CI) it does
 * nothing; a refused or failed call is logged once and retried a few times, then given up until the
 * next start. The Lab works either way: registration is about being listed, not about access.
 */

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

type Env = Record<string, string | undefined>;

export interface RegistrationBody {
  name: string;
  kind: "lab";
  baseUrl?: string;
  toolDoorUrl?: string;
  toolDoorProtocol?: "mcp";
}

export type RegistrationResult =
  | { ok: true; outcome: string }
  | { ok: false; status: number; code: string; retry: boolean };

/**
 * The platform refuses addresses outside *.beyondles.ai (plus localhost) and plain http outside
 * localhost. Such an address is left out instead of sent: a refused body would cost the whole
 * registration, and the name alone is enough to be listed.
 */
function acceptableOrigin(url: URL): boolean {
  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (local) return url.protocol === "http:" || url.protocol === "https:";
  return (
    url.protocol === "https:" &&
    (host === "beyondles.ai" || host.endsWith(".beyondles.ai"))
  );
}

/** The body this Lab sends: its name and, when known, its public address and tool door. */
export function registrationBody(env: Env = process.env): RegistrationBody {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  let baseUrl: string | undefined;
  if (raw) {
    try {
      const parsed = new URL(raw);
      baseUrl = acceptableOrigin(parsed) ? parsed.origin : undefined;
    } catch {
      baseUrl = undefined;
    }
  }
  return baseUrl
    ? {
        name: LAB_NAME,
        kind: "lab",
        baseUrl,
        toolDoorUrl: `${baseUrl}/api/mcp`,
        toolDoorProtocol: "mcp",
      }
    : { name: LAB_NAME, kind: "lab" };
}

/** One attempt. 4xx is final (fix the key or the address) except 429; 5xx and network errors may be retried. */
export async function registerOnce(
  fetchImpl: typeof fetch = fetch,
  env: Env = process.env,
): Promise<RegistrationResult | null> {
  const config = readDoorConfig(env);
  if (!config) return null;
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/api/registry/self`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify(registrationBody(env)),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, code: "NETWORK", retry: true };
  }
  const envelope = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: { outcome?: unknown };
    error?: { code?: string };
  } | null;
  if (res.ok && envelope?.success === true) {
    return {
      ok: true,
      outcome:
        typeof envelope.data?.outcome === "string"
          ? envelope.data.outcome
          : "unknown",
    };
  }
  return {
    ok: false,
    status: res.status,
    code: envelope?.error?.code ?? `HTTP_${res.status}`,
    retry: res.status >= 500 || res.status === 429,
  };
}

/**
 * Register in the background: the first attempt now, a few retries for a platform that is still
 * starting. Resolves when done; the boot check does not await it.
 */
export async function registerInBackground(
  fetchImpl: typeof fetch = fetch,
  env: Env = process.env,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise<void>((r) => {
      setTimeout(r, ms).unref?.();
    }),
  log: (line: string) => void = (line) => console.warn(line),
): Promise<RegistrationResult | null> {
  try {
    return await registerWithRetries(fetchImpl, env, wait, log);
  } catch (err) {
    // Last line of defence: nothing here may become an unhandled rejection at boot.
    try {
      log(
        `[${LAB_KEY}] could not register at the platform registry (0 UNEXPECTED: ${err instanceof Error ? err.message : "unknown"}).`,
      );
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function registerWithRetries(
  fetchImpl: typeof fetch,
  env: Env,
  wait: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<RegistrationResult | null> {
  let result = await registerOnce(fetchImpl, env);
  for (const delay of RETRY_DELAYS_MS) {
    if (result === null || result.ok || !result.retry) break;
    await wait(delay);
    result = await registerOnce(fetchImpl, env);
  }
  if (result && result.ok) {
    console.log(
      `[${LAB_KEY}] registered at the platform registry (${result.outcome})`,
    );
  } else if (result) {
    log(
      `[${LAB_KEY}] could not register at the platform registry (${result.status} ${result.code}). ` +
        "The Lab works, but the Suite does not list it until a start succeeds; check the service key name.",
    );
  }
  return result;
}
