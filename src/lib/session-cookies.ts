/**
 * The names of the Suite's session cookies in THIS environment (card #466).
 *
 * The Suite sets its session cookies on `.beyondles.ai`, so every product on a `*.beyondles.ai`
 * host receives them. Staging lives under the same parent domain as production. With the same
 * names that was ONE set of cookies for both: a sign-in on staging replaced the production login
 * in the same browser, and the Lab read the cookie of the other environment under the one name.
 *
 * The rule (src/components/app-shell/session-cookies.ts, shared with the Suite and every
 * product): an environment that shares its parent domain with another one has a suffix, and
 * every session cookie is named `<name>-<suffix>` there.
 *
 *   AUTH_COOKIE_SUFFIX=staging   a deployment that signs in against the staging Suite
 *   (not set)                    production, and any deployment that signs in against the
 *                                production Suite: the names stay as they were
 *
 * The value follows the Suite this deployment is attached to (NEXT_PUBLIC_PLATFORM_URL), not
 * the deployment's own name: the Lab must read the name that Suite writes.
 *
 * Read at request time on the server, never a NEXT_PUBLIC build value, so the middleware (Edge),
 * the routes and the layouts of one process cannot disagree. A malformed value throws: falling
 * back to the plain names would quietly put staging back on the cookies of production.
 *
 * Pure and edge-safe: no Node APIs, so the middleware may import it.
 */
import {
  sessionCookieNames,
  type SessionCookieNames,
} from "@/components/app-shell/session-cookies";

/**
 * `auth`: the Suite's login cookie, which the Lab reads and sends on to the Suite of the same
 * environment. `hint`: the session hint; the shell's guard watches the cookie of this name in
 * the browser.
 */
export function sessionCookies(): SessionCookieNames {
  return sessionCookieNames(process.env.AUTH_COOKIE_SUFFIX);
}

/** The Suite's login cookie in this environment (`platform-auth-token`, with the suffix). */
export function platformCookieName(): string {
  return sessionCookies().auth;
}
