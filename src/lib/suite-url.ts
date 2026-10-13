import type { ShellLinks } from "@/components/app-shell/types";

/**
 * The ways from this Lab into the Beyondles Suite: "Back to Suite", the
 * person menu (Profile, Organisation settings, Switch account, Sign out) and
 * the no-access page.
 *
 * The base is ALWAYS the Suite of the running environment, read on the server
 * at runtime (`platformUrl()`), never a value baked into the browser bundle
 * and never hard-coded, or a staging user lands in the production Suite and
 * loses the session. Pure functions, so tests can call them without Next.
 */

/** Fallback when no Suite is configured (local development without a Suite). */
export const DEFAULT_SUITE_URL = "https://beyondles.ai";

/** Help and docs in the person menu. */
export const HELP_URL = "https://docs.beyondles.ai";

/** Support address of the error state ("Contact support"). */
export const SUPPORT_MAILTO = "mailto:support@beyondles.ai";

/** The Suite's base URL without a trailing slash. An empty value is not a set value. */
export function suiteBaseUrl(platformUrl: string | null | undefined): string {
  const base = (platformUrl ?? "").trim().replace(/\/+$/, "");
  return base || DEFAULT_SUITE_URL;
}

/** The Suite's account chooser; it sends the person back to `startUrl` after a switch. */
export function switchAccountUrl(suite: string, startUrl: string | null): string {
  const base = `${suiteBaseUrl(suite)}/accounts`;
  return startUrl ? `${base}?callbackUrl=${encodeURIComponent(startUrl)}` : base;
}

/**
 * Every link the frame needs. `organisationSettings` only for admins and
 * owners of the Suite organisation: the entry is hidden for everybody else.
 * Sign out goes to the Suite, which ends the session for every product (a
 * Lab never writes the sign-in cookie).
 */
export function shellLinks(input: {
  platformUrl: string | null | undefined;
  isOrgAdmin: boolean;
  /** Absolute URL of this Lab's start page, or `null` when unknown. */
  startUrl: string | null;
}): ShellLinks {
  const suite = suiteBaseUrl(input.platformUrl);
  return {
    suite,
    profile: `${suite}/settings/profile`,
    organisationSettings: input.isOrgAdmin ? `${suite}/admin/organisation` : undefined,
    help: HELP_URL,
    signOut: `${suite}/logout`,
    switchAccount: switchAccountUrl(suite, input.startUrl),
  };
}

/** Owners and admins of the Suite organisation see "Organisation settings". */
export function isOrganisationAdmin(orgRole: string | null | undefined): boolean {
  return orgRole === "owner" || orgRole === "admin";
}

/**
 * Absolute URL of this Lab's start page ("/"): the configured app URL, or the
 * address the request came in on. `null` when neither is known.
 */
export function appStartUrl(appUrl: string | null | undefined, host: string | null, proto: string | null): string | null {
  const configured = (appUrl ?? "").trim().replace(/\/+$/, "");
  if (configured) return `${configured}/`;
  const cleanHost = (host ?? "").split(",")[0].trim();
  if (!cleanHost || !/^[a-z0-9.-]+(:\d+)?$/i.test(cleanHost)) return null;
  const scheme = (proto ?? "").split(",")[0].trim() === "http" ? "http" : "https";
  return `${scheme}://${cleanHost}/`;
}
