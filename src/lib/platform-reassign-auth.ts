import { exportKeyEquals } from "@/lib/platform-export-auth";

/**
 * Doorkeeper for the leaver hand-over (`POST /api/platform/reassign-owner`).
 *
 * The caller is the Beyondles platform API, which asks every product to hand
 * over what a person owned when that person leaves an organisation. It
 * presents `X-API-Key`; our side of it is `PLATFORM_REASSIGN_KEY` (the third
 * part of this Lab's entry in the platform's `EXPORT_SOURCES`,
 * `name=baseUrl|exportKey|reassignKey`).
 *
 * This is deliberately NOT the export key. The export key only reads; this
 * route changes who owns rows and REVOKES the leaver's API keys, and a key
 * that may only read must never be able to do that (one key per purpose, the
 * lesson of the key that read the export AND rewrote ownership). There is no
 * fallback to `PLATFORM_EXPORT_KEY`: an UNSET reassign key closes the route
 * (`503 REASSIGN_NOT_CONFIGURED`), so the platform reports this Lab as failed
 * instead of believing a hand-over that never happened.
 *
 * Same constant-time comparison (sha256 digests) as the other two keys. Pure
 * function without `server-only`, so it is testable without mocks.
 */

export type ReassignAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 503;
      code: "UNAUTHORIZED" | "REASSIGN_NOT_CONFIGURED";
      message: string;
    };

export function reassignKeyFromEnv(): string | null {
  const value = process.env.PLATFORM_REASSIGN_KEY?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export function checkReassignKey(request: Request): ReassignAuthResult {
  const expected = reassignKeyFromEnv();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: "REASSIGN_NOT_CONFIGURED",
      message: "PLATFORM_REASSIGN_KEY is not set on this server.",
    };
  }
  const presented = request.headers.get("x-api-key")?.trim() ?? "";
  if (presented.length === 0 || !exportKeyEquals(expected, presented)) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Header X-API-Key is missing or invalid.",
    };
  }
  return { ok: true };
}
