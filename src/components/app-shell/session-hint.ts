/**
 * The session hint: a cookie the Beyondles Suite writes next to `platform-auth-token` so that
 * every product tab can notice when the person behind it changed in another tab.
 *
 * Contract (fixed 2026-10-13, card #350):
 * - name `platform-session-hint`, domain `.beyondles.ai`, path `/`, NOT httpOnly
 * - value `1.<s>.<fp>`: `1` is the format version, `s` is `1` when "Switch account" is visible
 *   for this person and `0` otherwise, `fp` is an opaque fingerprint of 22 base64url characters
 * - a UI signal only, never an authorisation input; it holds no readable identity
 *
 * Pure module: no React, no Next, nothing runs at import time. A server layout imports
 * `SESSION_HINT_COOKIE` from here to read the cookie and passes the value to the shell.
 */

export const SESSION_HINT_COOKIE = 'platform-session-hint';

/** How often a visible tab compares the cookie with the value its page was rendered with, in ms. */
export const SESSION_HINT_POLL_MS = 15000;

export interface SessionHint {
  /** Format version. Only 1 exists. */
  version: 1;
  /** True when "Switch account" may be shown to this person. */
  switching: boolean;
  /** Opaque, stable for one person in one organisation. */
  fingerprint: string;
}

const HINT_FORMAT = /^1\.([01])\.([A-Za-z0-9_-]{22})$/;

/** The hint in a cookie value, or `null` when the value is missing or not in format 1. */
export function parseSessionHint(value: string | null | undefined): SessionHint | null {
  if (typeof value !== 'string') return null;
  const match = HINT_FORMAT.exec(value.trim());
  if (!match) return null;
  return { version: 1, switching: match[1] === '1', fingerprint: match[2] };
}

/**
 * The value of the hint cookie in a `document.cookie` string (or a `Cookie` header), or `null`.
 * When a browser sends the name twice, the first one counts, as it does for the server.
 */
export function readSessionHintCookie(cookieString: string | null | undefined): string | null {
  if (typeof cookieString !== 'string' || cookieString === '') return null;
  for (const part of cookieString.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== SESSION_HINT_COOKIE) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export type SessionHintComparison = 'same' | 'changed' | 'signed-out';

/**
 * How the hint now compares with the one the page was rendered with.
 * - `signed-out`: the cookie is gone (signed out in another tab).
 * - `changed`: another person or another organisation.
 * - `same`: the same person; a change of the switching bit alone is not an account change.
 */
export function compareSessionHints(baseline: string, current: string | null): SessionHintComparison {
  if (current === null || current.trim() === '') return 'signed-out';
  if (current === baseline) return 'same';
  const before = parseSessionHint(baseline);
  const now = parseSessionHint(current);
  if (before && now && before.fingerprint === now.fingerprint) return 'same';
  return 'changed';
}

/**
 * What a same-origin `fetch` rejects with after the account changed in another tab. The page
 * still shows the previous person; nothing may be sent on their behalf any more.
 */
export class AccountChangedError extends Error {
  readonly reason: Exclude<SessionHintComparison, 'same'>;

  constructor(reason: Exclude<SessionHintComparison, 'same'>) {
    super(
      reason === 'signed-out'
        ? 'Signed out in another tab. The request was not sent.'
        : 'The Beyondles account changed in another tab. The request was not sent.'
    );
    this.name = 'AccountChangedError';
    this.reason = reason;
  }
}
