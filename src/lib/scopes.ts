import {
  BASE_SCOPES,
  FULL_ACCESS,
  defineScopes,
  type GrantedScopes,
} from "@/lib/doors/scopes";

export { BASE_SCOPES, FULL_ACCESS, type GrantedScopes };

/**
 * Scopes on machine credentials (`/api/v1`, `/api/mcp`): this Lab's
 * vocabulary, bound once to the shared model (`src/lib/doors/scopes.ts`,
 * generated from beyondles-shared, never edited here).
 *
 * A small generic model: `read`, `write`, plus the Lab's own extra scopes for
 * operations that cannot be taken back or that reach outside the organisation
 * (`LAB_SCOPES`). A route or tool needs ALL scopes it names; no scope implies
 * another (`write` does not imply `read`, nor any extra scope).
 *
 *  - A new key gets `read` only unless its creator ticks more.
 *  - Keys that existed before scopes carry the legacy marker `*` (full
 *    access, also to scopes added later). Their owners narrow them by
 *    creating a new key and revoking the old one.
 *  - A Beyondles key carries the scopes its owner chose for this Lab, as the
 *    `scp` claim of the token the platform exchanges it for
 *    (`<labkey>:write`). The Lab's vocabulary is unprefixed (`write`), so the
 *    prefix is stripped (`stripProductPrefix`). `scopesFromClaims` is the ONE
 *    mapping from a token to scopes; a token without `scp` gets the fallback
 *    rule (`onBehalfScopes`).
 *  - People in the screen are not scoped: their permission is the container
 *    rule in the service, which applies to every door alike.
 *
 * Pure: loaded by the key form, `api-auth`, the manifest and tests.
 */

/**
 * The Lab's extra scopes, each with a label for the key form. Name them
 * `<object>:<verb>`. Add one for every operation that deletes data, reaches
 * a person outside the organisation, or spends money or credits.
 */
export const LAB_SCOPES = {
  "notes:delete": {
    de: "Notizen endgültig löschen",
    en: "Delete notes permanently",
  },
} as const;

export type Scope = (typeof BASE_SCOPES)[number] | keyof typeof LAB_SCOPES;

/** The shared helpers bound to this Lab's vocabulary. */
export const SCOPE_MODEL = defineScopes({
  base: BASE_SCOPES,
  extra: Object.keys(LAB_SCOPES) as (keyof typeof LAB_SCOPES)[],
  defaults: ["read"],
  stripProductPrefix: true,
});

export const ALL_SCOPES: readonly Scope[] = SCOPE_MODEL.ALL_SCOPES;

export const DEFAULT_KEY_SCOPES: readonly Scope[] =
  SCOPE_MODEL.DEFAULT_KEY_SCOPES;

export function missingScopes(
  granted: GrantedScopes,
  needed: readonly Scope[],
): Scope[] {
  return SCOPE_MODEL.missingScopes(granted, needed);
}

export function hasScopes(
  granted: GrantedScopes,
  needed: readonly Scope[],
): boolean {
  return SCOPE_MODEL.hasScopes(granted, needed);
}

/** What the key form may store: known scopes in vocabulary order; nothing usable = read only. */
export function normaliseKeyScopes(values: readonly unknown[]): Scope[] {
  return SCOPE_MODEL.normaliseKeyScopes(values);
}

/**
 * The fallback rule for an on-behalf token WITHOUT `scp`. A token that names a
 * person (or a private agent's owner) acts with that person's rights, checked
 * at the platform per request, and the calling product's own agent safety
 * asks a human before a `destructive` tool: read, write and the Lab's extra
 * scopes. A token without a person (organisation or collection agent) gets
 * read and write only: nothing irreversible without somebody behind it.
 *
 * Pass the token's `scp`: when it is present the answer is NO scopes (fail
 * closed). `scopesFromClaims` handles every token.
 */
export function onBehalfScopes(input: {
  personUserId: string | null;
  scp: readonly string[] | undefined;
}): Scope[] {
  return SCOPE_MODEL.onBehalfScopes(input);
}

/**
 * The scopes of a verified on-behalf token. With `scp` (a token exchanged for
 * a Beyondles key): exactly its entries for this Lab, prefix stripped
 * (`examplelab:notes:delete` becomes `notes:delete`), never another
 * product's. Without `scp`: the fallback rule for `personUserId` (default:
 * the token's `sub`).
 */
export function scopesFromClaims(
  claims: { aud: string; sub?: string; scp?: readonly string[] },
  options: { personUserId?: string | null } = {},
): string[] {
  return SCOPE_MODEL.scopesFromClaims(claims, options);
}
