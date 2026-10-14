/**
 * Scopes on machine credentials (the REST door and the MCP door).
 *
 * A small generic model: two base scopes (`read`, `write` in a Lab; `brain:read`, `brain:write` in
 * a core product) plus the product's own extra scopes for operations that cannot be taken back or
 * that reach outside the organisation. A route or tool needs ALL scopes it names; no scope implies
 * another (`write` does not imply `read`, nor any extra scope).
 *
 *  - A new key gets the default scopes (read only) unless its creator ticks more.
 *  - Keys that existed before scopes carry the legacy marker `*` (full access, also to scopes added
 *    later).
 *  - An on-behalf token WITH a `scp` claim (a `beyondles-obo-key+jwt` token, issued for a Beyondles
 *    key, #383) carries exactly those scopes, and only the entries for its own audience
 *    (`<aud>:...`). A token without `scp` gets the fallback rule: a person = every scope of the
 *    product, no person (organisation or collection agent) = the base scopes only. The product
 *    reads a token's scopes with `scopesFromClaims`; `onBehalfScopes` alone refuses a token that
 *    carries `scp` (it answers no scopes), so a key's limit can never be dropped on the way.
 *  - People in the screen are not scoped: their limit is the product's own rule in the service.
 *
 * Naming rule for products (#383): `<product>:<verb>` or `<product>:<object>:<verb>`
 * (`brain:read`, `horaizon:tasks:write`, `contentlab:write`). The Lab template's unprefixed names
 * (`read`, `write`, `notes:delete`) are the transition form.
 *
 * Moved from the Lab template (`src/lib/scopes.ts`) for #383. The template's vocabulary
 * (`LAB_SCOPES`) stays in the product; this file takes it as an argument, or binds it once with
 * `defineScopes`. Pure, no imports.
 */

export const BASE_SCOPES = ["read", "write"] as const;

/** Stored on keys created before scopes existed: everything, also future scopes. */
export const FULL_ACCESS = "*";

/** What a credential carries: scope names, or `*`. */
export type GrantedScopes = readonly string[];

export function missingScopes<S extends string>(granted: GrantedScopes, needed: readonly S[]): S[] {
  if (granted.includes(FULL_ACCESS)) return [];
  return needed.filter((scope) => !granted.includes(scope));
}

export function hasScopes<S extends string>(granted: GrantedScopes, needed: readonly S[]): boolean {
  return missingScopes(granted, needed).length === 0;
}

/**
 * What the key form may store: known scopes in vocabulary order; nothing usable = `defaults`.
 * Never the legacy marker.
 */
export function normaliseKeyScopes<S extends string>(
  values: readonly unknown[],
  allScopes: readonly S[],
  defaults: readonly S[],
): S[] {
  const known = new Set<string>(allScopes);
  const chosen = new Set(values.filter((value): value is S => typeof value === "string" && known.has(value)));
  const out = allScopes.filter((scope) => chosen.has(scope));
  return out.length > 0 ? out : [...defaults];
}

/** The two halves of the fallback rule for tokens without `scp`. */
export interface ScopeFallback<S extends string = string> {
  /** Every scope of the product: what a token that names a person gets. */
  all: readonly S[];
  /** What a token without a person (organisation or collection agent) gets: read and write. */
  withoutPerson: readonly S[];
}

/**
 * THE fallback mapping from an on-behalf token WITHOUT `scp` to scopes. A token that names a person
 * (or a private agent's owner) acts with that person's rights, checked at the platform per request,
 * and the calling product's own agent safety asks a human before a `destructive` tool: every scope.
 * A token without a person gets read and write only: nothing irreversible without somebody behind
 * it.
 *
 * `scp` is a required member on purpose: pass the token's `claims.scp`. When it is present the
 * token was exchanged for a Beyondles key and the fallback does not apply; this function then
 * answers NO scopes (fail closed) instead of every scope. Use `scopesFromClaims` for any token.
 */
export function onBehalfScopes<S extends string>(
  input: { personUserId: string | null; scp: readonly string[] | undefined },
  fallback: ScopeFallback<S>,
): S[] {
  if (input.scp !== undefined) return [];
  return input.personUserId ? [...fallback.all] : [...fallback.withoutPerson];
}

export interface ScopesFromClaimsOptions {
  /**
   * The person the product found behind the token, when it decides that itself (a private agent's
   * owner, the person the platform's access check named). Default: the token's `sub`.
   */
  personUserId?: string | null;
  /**
   * For a vocabulary in the Lab template's unprefixed transition form (`read`, `notes:delete`):
   * `contentlab:notes:delete` at audience `contentlab` becomes `notes:delete`. Only entries of the
   * token's OWN audience are ever stripped; every other entry is dropped first.
   */
  stripProductPrefix?: boolean;
}

/**
 * The scopes of a verified on-behalf token. With a `scp` claim (a token exchanged for a Beyondles
 * key): exactly those of them that belong to the token's audience (`<aud>:...`), never more, never
 * another product's. Without one: the fallback rule, decided by whether the token names a person
 * (`sub`, or `options.personUserId`).
 */
export function scopesFromClaims(
  claims: { aud: string; sub?: string; scp?: readonly string[] },
  fallback: ScopeFallback,
  options: ScopesFromClaimsOptions = {},
): string[] {
  if (claims.scp !== undefined) {
    if (!Array.isArray(claims.scp)) return [];
    const prefix = `${claims.aud}:`;
    const own = claims.scp.filter((entry) => typeof entry === "string" && entry.startsWith(prefix) && entry.length > prefix.length);
    return options.stripProductPrefix ? own.map((entry) => entry.slice(prefix.length)) : [...own];
  }
  const person = options.personUserId !== undefined ? options.personUserId : (claims.sub ?? null);
  return onBehalfScopes({ personUserId: person, scp: undefined }, fallback);
}

/** The helpers bound to one product's vocabulary. */
export interface ScopeModel<S extends string> {
  ALL_SCOPES: readonly S[];
  BASE: readonly S[];
  DEFAULT_KEY_SCOPES: readonly S[];
  missingScopes(granted: GrantedScopes, needed: readonly S[]): S[];
  hasScopes(granted: GrantedScopes, needed: readonly S[]): boolean;
  normaliseKeyScopes(values: readonly unknown[]): S[];
  onBehalfScopes(input: { personUserId: string | null; scp: readonly string[] | undefined }): S[];
  scopesFromClaims(
    claims: { aud: string; sub?: string; scp?: readonly string[] },
    options?: Pick<ScopesFromClaimsOptions, "personUserId">,
  ): string[];
}

/**
 * Binds the helpers to a product's vocabulary once:
 *
 *   export const SCOPES = defineScopes({ base: ["read", "write"], extra: ["notes:delete"] });
 *
 * `base` is what a token without a person gets; `defaults` (default: the first base scope) is what
 * a new key gets when nothing usable was chosen. `stripProductPrefix` for a vocabulary in the
 * unprefixed transition form (see `ScopesFromClaimsOptions`).
 */
export function defineScopes<B extends string, E extends string = never>(input: {
  base: readonly B[];
  extra?: readonly E[];
  defaults?: readonly (B | E)[];
  stripProductPrefix?: boolean;
}): ScopeModel<B | E> {
  type S = B | E;
  const all: readonly S[] = [...input.base, ...(input.extra ?? [])];
  const base: readonly S[] = [...input.base];
  const defaults: readonly S[] = input.defaults ? [...input.defaults] : base.slice(0, 1);
  const fallback: ScopeFallback<S> = { all, withoutPerson: base };
  return {
    ALL_SCOPES: all,
    BASE: base,
    DEFAULT_KEY_SCOPES: defaults,
    missingScopes: (granted, needed) => missingScopes(granted, needed),
    hasScopes: (granted, needed) => hasScopes(granted, needed),
    normaliseKeyScopes: (values) => normaliseKeyScopes(values, all, defaults),
    onBehalfScopes: (person) => onBehalfScopes(person, fallback),
    scopesFromClaims: (claims, options) =>
      scopesFromClaims(claims, fallback, { ...options, stripProductPrefix: input.stripProductPrefix === true }),
  };
}
