import "server-only";

import { createHash } from "node:crypto";

import { isLocalMode } from "@/lib/jwt-guard";
import { LAB_KEY, LAB_NAME } from "@/lib/lab";
import { platformUrl } from "@/lib/platform/door";

/**
 * Access model, LEVEL 1 — the release switch, which lives in the Suite.
 *
 * Every Lab has a row in the Suite table `labs` with `enabled` (default OFF)
 * and two exception lists (e-mail addresses and organisations). While the Lab
 * is not released, NOBODY gets in, not even an owner, unless they are on a
 * list. The Lab asks `GET <suite>/api/labs/<LAB_KEY>/access` with the person's
 * cookie, caches 60 s per token hash, and treats a network error as CLOSED.
 *
 * Without the Suite row the Suite answers 404 and the Lab is closed for all —
 * on purpose (fail closed). Order for a new Lab: Suite row FIRST, then roll
 * out.
 *
 * Local mode (JWT_SECRET + ALLOW_LOCAL_JWT): there is no Suite, the gate is
 * open.
 */

const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

export type GateReason = "enabled" | "exception" | "blocked" | "unreachable" | "local";

export interface LabGate {
  allowed: boolean;
  reason: GateReason;
  lab: { key: string; name: string; enabled: boolean } | null;
}

interface CacheEntry {
  value: LabGate;
  validUntil: number;
}

const gateCache = new Map<string, CacheEntry>();

function cachePut(key: string, value: LabGate) {
  if (gateCache.size >= CACHE_MAX) {
    const oldest = gateCache.keys().next().value;
    if (oldest !== undefined) gateCache.delete(oldest);
  }
  gateCache.set(key, { value, validUntil: Date.now() + CACHE_TTL_MS });
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getLabGate(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LabGate> {
  if (isLocalMode()) return { allowed: true, reason: "local", lab: null };

  const key = tokenKey(token);
  const hit = gateCache.get(key);
  if (hit && hit.validUntil > Date.now()) return hit.value;
  if (hit) gateCache.delete(key);

  const unreachable: LabGate = { allowed: false, reason: "unreachable", lab: null };
  const suite = platformUrl();
  if (!suite) return unreachable;

  let res: Response;
  try {
    res = await fetchImpl(`${suite}/api/labs/${LAB_KEY}/access`, {
      headers: { cookie: `platform-auth-token=${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return unreachable;
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as {
        lab?: { key?: string; name?: string; enabled?: boolean };
        allowed?: boolean;
        reason?: string;
      };
      // Never "open" because of a reason text: `allowed` is the truth.
      const allowed = body.allowed === true;
      const reason: GateReason =
        allowed && (body.reason === "enabled" || body.reason === "exception")
          ? body.reason
          : allowed
            ? "enabled"
            : "blocked";
      const gate: LabGate = {
        allowed,
        reason,
        lab: body.lab
          ? {
              key: String(body.lab.key ?? LAB_KEY),
              name: String(body.lab.name ?? LAB_NAME),
              enabled: body.lab.enabled === true,
            }
          : null,
      };
      cachePut(key, gate);
      return gate;
    } catch {
      return unreachable;
    }
  }

  // Clear rejection (signed out, Lab unknown) may be cached; 5xx not.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const gate: LabGate = { allowed: false, reason: "blocked", lab: null };
    cachePut(key, gate);
    return gate;
  }
  return unreachable;
}

/** Tests only. */
export function __clearGateCacheForTests(): void {
  gateCache.clear();
}
