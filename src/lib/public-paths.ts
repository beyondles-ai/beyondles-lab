/**
 * Paths this Lab opens WITHOUT a Suite cookie, on top of the frame's own
 * list in `src/middleware.ts` (static files, health, the machine doors, the
 * platform routes).
 *
 * The frame keeps `src/middleware.ts` as it is; a Lab only fills THIS list.
 * Empty in the template: every page of the template is behind the Suite
 * sign-in. A Lab whose readers have no Suite account (a guest on a booking
 * page, a signer on a signature page, a newsletter subscriber on a subscribe
 * or unsubscribe page, a mail webhook) lists their prefixes here, one line
 * each, with the reason. Two rules, held by `tests/unit/public-paths.test.ts`
 * and `npm run check:frame`:
 *
 *  1. Every route behind one of these prefixes protects ITSELF (link token,
 *     webhook secret, API key, rate limit, neutral 404) and answers 401/404,
 *     never with a redirect to the Suite. The middleware checks no signature
 *     anyway (Edge runtime); the security boundary was never there.
 *  2. A prefix never covers the frame's own ground: the signed-in area, the
 *     platform routes, the no-access page. A public prefix starts with "/",
 *     is at least two characters long and is not `/api/` or `/api/platform`.
 *
 * This file is read by the middleware in the Edge runtime: it imports nothing.
 */
export const LAB_PUBLIC_PATHS: readonly string[] = [];

/** Prefixes a Lab may never open; the frame owns them. */
export const RESERVED_PATH_PREFIXES: readonly string[] = [
  "/api/platform",
  "/kein-zugriff",
  "/settings",
];

/** The reasons a list of public prefixes is not acceptable; empty = fine. */
export function publicPathProblems(paths: readonly string[]): string[] {
  const problems: string[] = [];
  for (const p of paths) {
    if (!p.startsWith("/")) problems.push(`${p}: must start with "/"`);
    else if (p === "/" || p === "/api" || p === "/api/")
      problems.push(
        `${p}: opens everything; list the public routes one by one`,
      );
    else if (
      RESERVED_PATH_PREFIXES.some((r) => r.startsWith(p) || p.startsWith(r))
    )
      problems.push(
        `${p}: covers a frame path (${RESERVED_PATH_PREFIXES.join(", ")})`,
      );
  }
  return problems;
}
