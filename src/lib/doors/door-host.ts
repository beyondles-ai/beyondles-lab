/**
 * What the shared door code needs from the product it runs in. The module reads no process
 * environment and imports nothing of the product: the product builds ONE host at start-up from
 * its own settings and passes it to `createOboDoor` and `createReleaseGate`.
 *
 *   const host: DoorHost = {
 *     platformApiUrl: () => process.env.PLATFORM_API_URL,
 *     platformApiKey: () => process.env.PLATFORM_API_KEY,
 *     onBehalfIssuer: () => process.env.ON_BEHALF_ISSUER,
 *   };
 *
 * The three settings are read when they are needed (functions, not values), so a test or a
 * changed deployment setting is seen without a restart of the module, as in the Lab template.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DoorLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DoorHost {
  /** `PLATFORM_API_URL` of THIS environment (with or without a trailing slash). */
  platformApiUrl(): string | undefined;
  /** `PLATFORM_API_KEY`: the product's own service key at the platform. */
  platformApiKey(): string | undefined;
  /** `ON_BEHALF_ISSUER`: the issuer this environment accepts. */
  onBehalfIssuer(): string | undefined;
  /** Default: the global `fetch`. */
  fetch?: FetchLike;
  /** Default: `Date.now`, looked up on every call. */
  now?: () => number;
  /** Default: `console`. */
  logger?: DoorLogger;
}

/** The host's clock, or `Date.now` at the moment of the call. */
export function hostNow(host: Pick<DoorHost, "now">): number {
  return host.now ? host.now() : Date.now();
}

/** The host's logger, or `console`. */
export function hostLogger(host: Pick<DoorHost, "logger">): DoorLogger {
  return host.logger ?? console;
}

/** A trimmed setting without trailing slashes, or "". */
export function trimmedUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}
