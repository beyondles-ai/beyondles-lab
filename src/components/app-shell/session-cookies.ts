/**
 * The names of the cookies the Beyondles Suite writes for a signed-in person, per environment
 * (card #466).
 *
 * The Suite sets its session cookies on the parent domain `.beyondles.ai`, so that every product
 * on a `*.beyondles.ai` host receives them. Staging lives under the same parent domain as
 * production. With the same names that is ONE set of cookies for both: a sign-in on staging
 * replaced the production login in the same browser, and a sign-out on staging ended it.
 *
 * The rule: an environment that shares its parent domain with another one carries a suffix, and
 * every cookie of the session is named `<name>-<suffix>` there (`platform-auth-token-staging`).
 * Production has no suffix and keeps the names it always had, so nobody is signed out by this.
 *
 * The suffix comes from the host's environment, by convention the variable AUTH_COOKIE_SUFFIX,
 * set to the same value in the Suite and in every product of that environment. This file reads
 * no environment: the host reads its own and passes the value in, on the server. A product that
 * reads another name than the Suite writes finds no session, so the value is checked strictly
 * and a malformed one is refused instead of being repaired differently in two places.
 *
 * Pure module: no React, no Next, nothing runs at import time. Safe in a middleware.
 */
import { SESSION_HINT_COOKIE } from './session-hint';

const AUTH_COOKIE = 'platform-auth-token';
const REFRESH_COOKIE = 'platform-refresh-token';

/** Lower-case letters and digits, in words joined by single hyphens: `staging`, `preview-2`. */
const SUFFIX_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUFFIX_MAX_LENGTH = 32;

/**
 * `name` as it is called in the environment with this suffix.
 *
 * No suffix (missing, empty or only white space) is production: the name stays as it is. Any
 * other value must be lower-case letters and digits in words joined by single hyphens, at most
 * 32 characters; everything else throws. Falling back to the plain name would quietly put the
 * environment back on the cookies of production.
 */
export function environmentCookieName(name: string, suffix: string | null | undefined): string {
  const value = typeof suffix === 'string' ? suffix.trim() : '';
  if (value === '') return name;
  if (value.length > SUFFIX_MAX_LENGTH || !SUFFIX_FORMAT.test(value)) {
    throw new Error(
      `AUTH_COOKIE_SUFFIX is ${JSON.stringify(value.slice(0, 40))}: expected lower-case letters and digits in words ` +
        `joined by single hyphens, at most ${SUFFIX_MAX_LENGTH} characters (for example "staging"), or no value at all.`
    );
  }
  return `${name}-${value}`;
}

export interface SessionCookieNames {
  /** The access token, httpOnly. Every product reads it on the server. */
  auth: string;
  /** The refresh token, httpOnly. Only the Suite reads it. */
  refresh: string;
  /** The session hint, readable by scripts: pass it to the shell as `sessionHintCookie`. */
  hint: string;
}

/**
 * The session cookies of the environment with this suffix. Call it on the server with the
 * host's own setting (the value of its AUTH_COOKIE_SUFFIX variable, read at request time).
 */
export function sessionCookieNames(suffix: string | null | undefined): SessionCookieNames {
  return {
    auth: environmentCookieName(AUTH_COOKIE, suffix),
    refresh: environmentCookieName(REFRESH_COOKIE, suffix),
    hint: environmentCookieName(SESSION_HINT_COOKIE, suffix),
  };
}
